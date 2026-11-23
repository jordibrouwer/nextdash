package app

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
One screen per service: GET /api/service.

A service is not stored anywhere. It is a bookmark (the anchor, by its
canonical address), the container the browser matched to it, and whatever the
health history, the network checks and the watched feeds already hold for that
address. The browser decides the identity -- it alone knows the hostname the
dashboard was opened on, which the matching needs -- and this route gathers
what belongs to it and builds the one thing that did not exist yet: a merged
timeline.

Read-only, no token, never cached. Because no token guards it, nothing a token
guards may be in the answer: no env values (not even names), no labels, no
mounts, no log lines and no output of the container's healthcheck. Logs, env
and the like stay on their own routes, behind the write token.
*/

const (
	serviceTimelineMax   = 100
	serviceWatchItems    = 5
	serviceDaysKept      = 30
	serviceTimelinePart  = "local-only"
	serviceSourceDocker  = "docker"
	serviceSourceUpdate  = "update"
	serviceSourceHealth  = "health"
	serviceSourceCheck   = "check"
	serviceSourceRelease = "release"
)

type serviceTimelineItem struct {
	At     int64  `json:"at"`     // unix milliseconds
	Source string `json:"source"` // docker update health check release
	Kind   string `json:"kind"`
	Detail string `json:"detail,omitempty"`
}

type serviceUptime struct {
	Uptime24h   UptimeWindow `json:"uptime24h"`
	Uptime7d    UptimeWindow `json:"uptime7d"`
	Uptime30d   UptimeWindow `json:"uptime30d"`
	LastPingMs  int          `json:"lastPingMs,omitempty"`
	LastSample  int64        `json:"lastSample,omitempty"`
	DownSince   int64        `json:"downSince,omitempty"`
	TotalChecks int          `json:"totalChecks"`
	CoveredMs   int64        `json:"coveredMs,omitempty"`
}

type serviceAlso struct {
	PageID   int    `json:"pageId"`
	PageName string `json:"pageName,omitempty"`
}

type serviceCertificate struct {
	Host      string `json:"host"`
	ExpiresAt int64  `json:"expiresAt"`
}

type serviceBookmark struct {
	Found        bool                `json:"found"`
	Name         string              `json:"name,omitempty"`
	URL          string              `json:"url,omitempty"`
	PageID       int                 `json:"pageId,omitempty"`
	Index        int                 `json:"index"` // position on its page, for the write routes
	PageName     string              `json:"pageName,omitempty"`
	Unsorted     bool                `json:"unsorted,omitempty"`
	Icon         string              `json:"icon,omitempty"`
	Note         string              `json:"note,omitempty"`
	PreviewTitle string              `json:"previewTitle,omitempty"`
	CheckMode    string              `json:"checkMode,omitempty"` // off | periodic | monitor
	Status       string              `json:"status,omitempty"`
	Score        int                 `json:"score,omitempty"`
	LastChecked  int64               `json:"lastChecked,omitempty"`
	LastError    string              `json:"lastError,omitempty"`
	BrokenSince  int64               `json:"brokenSince,omitempty"`
	Monitor      *serviceUptime      `json:"monitor,omitempty"`
	Certificate  *serviceCertificate `json:"certificate,omitempty"`
	Also         []serviceAlso       `json:"also,omitempty"`
}

type serviceCheck struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Label   string `json:"label"`
	Enabled bool   `json:"enabled"`
	Known   bool   `json:"known"` // has run at least once
	OK      bool   `json:"ok"`
	Paused  bool   `json:"paused,omitempty"`
	Warn    bool   `json:"warn,omitempty"`
	At      int64  `json:"at,omitempty"`
	Since   int64  `json:"since,omitempty"` // start of the current state
	Ms      int    `json:"ms,omitempty"`
}

type serviceWatchItem struct {
	Title       string `json:"title"`
	Link        string `json:"link,omitempty"`
	PublishedAt int64  `json:"publishedAt,omitempty"`
	FoundAt     int64  `json:"foundAt,omitempty"`
}

type serviceWatch struct {
	FeedURL  string             `json:"feedUrl"`
	Title    string             `json:"title,omitempty"`
	NewestAt int64              `json:"newestAt,omitempty"`
	Items    []serviceWatchItem `json:"items"`
}

// serviceContainer is a summary of the container plus a few inspect facts. It
// embeds the list's own view model, which carries no env, labels or mounts.
type serviceContainer struct {
	dockerViewContainer
	Version       string `json:"version,omitempty"`
	Source        string `json:"source,omitempty"`
	RestartPolicy string `json:"restartPolicy,omitempty"`
	RestartCount  int    `json:"restartCount,omitempty"`
	// HealthStatus is the healthcheck's verdict only, never its output.
	HealthStatus string `json:"healthStatus,omitempty"`
}

type serviceView struct {
	Bookmark  serviceBookmark       `json:"bookmark"`
	Days      []HealthDay           `json:"days"`
	Checks    []serviceCheck        `json:"checks"`
	Watches   []serviceWatch        `json:"watches"`
	Container *serviceContainer     `json:"container"`
	Docker    map[string]any        `json:"docker"`
	Timeline  []serviceTimelineItem `json:"timeline"`
	// TimelinePartial is set when a source could not be read for this host.
	TimelinePartial string `json:"timelinePartial,omitempty"`
	// Host is the Docker host the container section is about: empty for this
	// machine, "d_..." for another one.
	Host        string `json:"host,omitempty"`
	Control     bool   `json:"control"`
	Self        bool   `json:"self"`
	GeneratedAt int64  `json:"generatedAt"`
}

// ServiceViewHandler answers GET /api/service?url=&page=&container=[&host=].
func (h *Handlers) ServiceViewHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	pageID, _ := strconv.Atoi(strings.TrimSpace(q.Get("page")))
	host := strings.TrimSpace(q.Get("host"))
	view := h.buildServiceView(r.Context(), q.Get("url"), pageID, strings.TrimSpace(q.Get("container")), host, dockerHostControl(r))
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, view)
}

func (h *Handlers) buildServiceView(ctx context.Context, rawURL string, pageID int, container, host string, control bool) serviceView {
	now := time.Now()
	view := serviceView{
		Days: []HealthDay{}, Checks: []serviceCheck{}, Watches: []serviceWatch{}, Timeline: []serviceTimelineItem{},
		Docker: map[string]any{"available": false}, Control: control, GeneratedAt: now.UnixMilli(),
	}
	timeline := []serviceTimelineItem{}

	if key := canonicalBookmarkURLKey(rawURL); key != "" {
		timeline = append(timeline, h.fillServiceBookmark(&view, key, pageID, now)...)
	}

	remote := host != "" && host != dockerLocalHostID
	if remote {
		view.Host = host
	} else {
		host = dockerLocalHostID
	}
	if container != "" {
		// What nextDash keeps about a container (its timeline, the update
		// history, the hidden names, the restart count) is about its own host,
		// so a remote one gets none of it and the answer says so.
		if remote {
			view.TimelinePartial = serviceTimelinePart
		}
		timeline = append(timeline, h.fillServiceContainer(ctx, &view, container, host)...)
	}

	sort.SliceStable(timeline, func(i, j int) bool { return timeline[i].At > timeline[j].At })
	if len(timeline) > serviceTimelineMax {
		timeline = timeline[:serviceTimelineMax]
	}
	view.Timeline = timeline
	return view
}

// fillServiceBookmark fills everything that hangs off the bookmark's address
// and returns the timeline items it contributes.
func (h *Handlers) fillServiceBookmark(view *serviceView, key string, pageID int, now time.Time) []serviceTimelineItem {
	var items []serviceTimelineItem
	pages := h.store.GetPages()
	pageName := map[int]string{}
	pageHidden := map[int]bool{}
	for _, p := range pages {
		pageName[p.ID] = p.Name
		pageHidden[p.ID] = p.Hidden
	}

	// The copy the person came from, else the first one with this address.
	var found *Bookmark
	var foundPage, foundIndex int
	var also []serviceAlso
	for _, p := range pages {
		for i, bm := range h.store.GetBookmarksByPage(p.ID) {
			if canonicalBookmarkURLKey(bm.URL) != key {
				continue
			}
			bm := bm
			if found == nil || (p.ID == pageID && foundPage != pageID) {
				if found != nil {
					also = append(also, serviceAlso{PageID: foundPage, PageName: pageName[foundPage]})
				}
				found, foundPage, foundIndex = &bm, p.ID, i
				continue
			}
			also = append(also, serviceAlso{PageID: p.ID, PageName: p.Name})
		}
	}
	if found == nil {
		return nil
	}
	b := &view.Bookmark
	b.Index = foundIndex
	b.Found, b.Name, b.URL, b.PageID, b.PageName = true, found.Name, found.URL, foundPage, pageName[foundPage]
	b.Unsorted = pageHidden[foundPage]
	b.Icon, b.Note, b.PreviewTitle = found.Icon, found.Note, found.PreviewTitle
	b.CheckMode = checkModeFor(*found)
	b.LastChecked, b.LastError, b.BrokenSince = found.LastChecked, found.LastError, found.BrokenSince
	b.Also = also

	// The cached report: status and score come from the one place that
	// decides them. Never forced to refresh from here.
	report := h.loadBookmarkHealthReport(false)
	for _, is := range report.Issues {
		if canonicalBookmarkURLKey(is.URL) != key || is.PageID != foundPage {
			continue
		}
		b.Status, b.Score = is.Status, is.Score
		if is.BrokenSince > 0 {
			b.BrokenSince = is.BrokenSince
		}
		if s := is.MonitorStats; s != nil {
			b.Monitor = &serviceUptime{Uptime24h: s.Uptime24h, Uptime7d: s.Uptime7d, Uptime30d: s.Uptime30d,
				LastPingMs: s.LastPingMs, LastSample: s.LastSample, DownSince: s.DownSince,
				TotalChecks: s.TotalChecks, CoveredMs: s.CoveredMs}
		}
		if c, ok := report.Certificates[is.CertHost]; ok && is.CertHost != "" && c.ExpiresAt > 0 {
			b.Certificate = &serviceCertificate{Host: c.Host, ExpiresAt: c.ExpiresAt}
		}
		break
	}

	history, allDays := h.readAllHealthHistoryAndDays()
	samples := history[key]
	if found.Monitor || len(samples) > 0 {
		days := foldSamplesIntoDays(append([]HealthDay(nil), allDays[key]...), append([]HealthSample(nil), samples...))
		cutoff := now.Add(-serviceDaysKept * 24 * time.Hour).UnixMilli()
		for _, d := range days {
			if d.D+24*time.Hour.Milliseconds() > cutoff {
				view.Days = append(view.Days, d)
			}
		}
		for _, inc := range deriveIncidents(samples, now) {
			items = append(items, incidentItems(serviceSourceHealth, "", inc)...)
		}
	}

	// Network checks, through the same state derivation as the checks route.
	for _, c := range found.Checks {
		smp := history[netHistoryKey(c.ID)]
		sc := serviceCheck{ID: c.ID, Type: c.Type, Label: netCheckLabel(c, *found), Enabled: c.Enabled}
		if st := netCheckStateFor(c, smp); st != nil {
			sc.Known, sc.OK, sc.Paused, sc.Warn, sc.At, sc.Ms = true, st.OK, st.Paused, st.Warn, st.At, st.Ms
			sc.Since = currentStateSince(smp)
		}
		view.Checks = append(view.Checks, sc)
		for _, inc := range deriveIncidents(smp, now) {
			items = append(items, incidentItems(serviceSourceCheck, sc.Label, inc)...)
		}
	}

	// Watched feeds of this address: already stored here, so no outside call.
	feedWatchMu.Lock()
	file := readFeedWatchFile()
	feedWatchMu.Unlock()
	for _, wt := range file.Watches {
		if wt.BookmarkKey != key {
			continue
		}
		sw := serviceWatch{FeedURL: wt.FeedURL, Title: wt.Title, NewestAt: wt.NewestAt, Items: []serviceWatchItem{}}
		for i, it := range wt.Items {
			at := it.PublishedAt
			if at == 0 {
				at = it.FoundAt
			}
			if i < serviceWatchItems {
				sw.Items = append(sw.Items, serviceWatchItem{Title: it.Title, Link: it.Link, PublishedAt: it.PublishedAt, FoundAt: it.FoundAt})
			}
			if at > 0 {
				items = append(items, serviceTimelineItem{At: at, Source: serviceSourceRelease, Kind: "release", Detail: it.Title})
			}
		}
		view.Watches = append(view.Watches, sw)
	}
	return items
}

// incidentItems turns one outage into its two edges: down when it began, up
// when a check saw it recover.
func incidentItems(source, label string, inc HealthIncident) []serviceTimelineItem {
	detail := inc.Reason
	if label != "" {
		if detail != "" {
			detail = label + ": " + detail
		} else {
			detail = label
		}
	}
	out := []serviceTimelineItem{{At: inc.Start, Source: source, Kind: "down", Detail: detail}}
	if !inc.Ongoing && inc.End > 0 {
		up := label
		if inc.Duration > 0 {
			if up != "" {
				up += ": "
			}
			up += "down " + serviceDownFor(inc.Duration)
		}
		out = append(out, serviceTimelineItem{At: inc.End, Source: source, Kind: "up", Detail: up})
	}
	return out
}

// currentStateSince is when the newest run of identical results began.
// Maintenance-window samples are skipped, as deriveIncidents and uptimeRatio
// skip them: they neither end nor extend a run.
func currentStateSince(samples []HealthSample) int64 {
	var last *HealthSample
	var since int64
	for i := len(samples) - 1; i >= 0; i-- {
		s := samples[i]
		if s.Maint {
			continue
		}
		if last == nil {
			last = &samples[i]
			since = s.T
			continue
		}
		if s.Up != last.Up {
			break
		}
		since = s.T
	}
	return since
}

// fillServiceContainer fills the container section and returns its timeline
// items. A hidden container, or none by that name, leaves the section empty.
func (h *Handlers) fillServiceContainer(ctx context.Context, view *serviceView, name, host string) []serviceTimelineItem {
	remote := host != dockerLocalHostID
	api, reason := dockerHostAPI(host)
	if api == nil {
		view.Docker = map[string]any{"available": false, "reason": reason}
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	list, err := api.listContainers(ctx)
	if err != nil {
		reason := dockerDialReason(err)
		if remote {
			reason = dockerHostFailure(err)
		}
		view.Docker = map[string]any{"available": false, "reason": reason}
		return nil
	}
	view.Docker = map[string]any{"available": true}
	// Hidden names are this host's own setting.
	if !remote && dockerHiddenSet()[name] {
		return nil
	}
	var c *dockerContainerSummary
	for i := range list {
		if list[i].name() == name && !dockerIsOwnHelper(list[i].Labels) {
			c = &list[i]
			break
		}
	}
	if c == nil {
		return nil
	}
	self := dockerSelfID()
	if remote {
		// nextDash's own container is on this machine, not on that one.
		self = ""
	}
	sc := serviceContainer{dockerViewContainer: toDockerViewOn(*c, self, remote)}
	sc.LanIP = dockerLanIP(*c, api.dockerLanNetworks(ctx))
	sc.Update = dockerRowUpdate(h.dockerUpdateSnapshotFor(host)[c.Image], *c, api.imageTagIDs(ctx))
	if !remote {
		sc.Restarts = dockerTimelines.restartsSince(c.name(), time.Now().Add(-24*time.Hour))
	}
	if in, err := api.inspectContainer(ctx, c.ID); err == nil {
		sc.RestartPolicy = in.HostConfig.RestartPolicy.Name
		sc.RestartCount = in.RestartCount
		if in.State.Health != nil {
			sc.HealthStatus = in.State.Health.Status
		}
		if img, err := api.inspectImage(ctx, in.Image); err == nil {
			sc.Version = img.Config.Labels["org.opencontainers.image.version"]
			sc.Source = img.Config.Labels["org.opencontainers.image.source"]
		}
	}
	view.Container = &sc
	view.Self = sc.Self

	if remote {
		return nil
	}
	var items []serviceTimelineItem
	for _, e := range dockerTimelineFor(c.name()) {
		source := serviceSourceDocker
		if e.Kind == "update" || e.Kind == "rollback" {
			source = serviceSourceUpdate
		}
		items = append(items, serviceTimelineItem{At: e.At, Source: source, Kind: e.Kind, Detail: e.Detail})
	}
	return items
}

// serviceDownFor says how long an outage lasted: "12 min", "3h 5m", "2 days".
func serviceDownFor(ms int64) string {
	mins := int(time.Duration(ms)*time.Millisecond/time.Minute + 0)
	switch {
	case mins < 1:
		return "under a minute"
	case mins < 60:
		return strconv.Itoa(mins) + " min"
	case mins < 48*60:
		return strconv.Itoa(mins/60) + "h " + strconv.Itoa(mins%60) + "m"
	}
	return strconv.Itoa(mins/(24*60)) + " days"
}
