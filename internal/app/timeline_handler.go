package app

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
GET /api/timeline: the sources gathered, linked and filtered.

Read-only, never cached, nothing in it that a token guards (no env, labels or
log lines), the same bar as /api/service.

The outages of monitors and network checks are derived from the health history,
a file of several megabytes that is rewritten every monitor round. Deriving them
parses all of it, so the derived incidents are kept until the file changes
(its size and modification time): a timeline that is open and refreshed does not
read the history again until a round wrote it.
*/

const (
	timelineDefaultLimit = 300
	timelineMaxLimit     = 1000
)

type timelineCoverage struct {
	OK     bool   `json:"ok"`
	Since  int64  `json:"since,omitempty"` // how far back this source reaches, unix ms
	Reason string `json:"reason,omitempty"`
}

type timelineResponse struct {
	GeneratedAt  int64                       `json:"generatedAt"`
	From         int64                       `json:"from"`
	To           int64                       `json:"to"`
	Events       []TimelineEvent             `json:"events"`
	Related      []TimelineEvent             `json:"related"` // causes of an outage above that the filters left out
	Coverage     map[string]timelineCoverage `json:"coverage"`
	Truncated    bool                        `json:"truncated,omitempty"`
	NextBefore   int64                       `json:"nextBefore,omitempty"`
	NextBeforeID string                      `json:"nextBeforeId,omitempty"`
}

type timelineParams struct {
	Days    int
	Sources map[string]bool // nil is all
	Only    string          // "" outages caused
	Limit   int
	Before  int64
	// BeforeID breaks a tie between events of the same millisecond: the page
	// after (Before, BeforeID) holds what sorts after it, newest first.
	BeforeID string
}

func parseTimelineParams(q url.Values) timelineParams {
	p := timelineParams{Days: 7, Limit: timelineDefaultLimit}
	switch q.Get("days") {
	case "1":
		p.Days = 1
	case "30":
		p.Days = 30
	}
	if raw := strings.TrimSpace(q.Get("sources")); raw != "" {
		p.Sources = map[string]bool{}
		for _, s := range strings.Split(raw, ",") {
			p.Sources[strings.TrimSpace(s)] = true
		}
	}
	if o := q.Get("only"); o == "outages" || o == "caused" {
		p.Only = o
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil && n > 0 {
		p.Limit = min(n, timelineMaxLimit)
	}
	p.Before, _ = strconv.ParseInt(q.Get("before"), 10, 64)
	p.BeforeID = q.Get("beforeId")
	return p
}

// timelineInputs is everything the sources hold, gathered; the pure part below
// turns it into an answer.
type timelineInputs struct {
	Events   []TimelineEvent
	Links    timelineLinks
	Coverage map[string]timelineCoverage
}

// buildTimeline links the causes over everything gathered, then filters. The
// filters come after the linking, so a cause from a source that is switched
// off in the view is still found.
func buildTimeline(in timelineInputs, p timelineParams, now time.Time) timelineResponse {
	from := now.Add(-time.Duration(p.Days) * 24 * time.Hour).UnixMilli()
	all := linkCauses(in.Events, in.Links)
	byID := make(map[string]TimelineEvent, len(all))
	for _, e := range all {
		byID[e.ID] = e
	}
	out := timelineResponse{
		GeneratedAt: now.UnixMilli(), From: from, To: now.UnixMilli(),
		Events: []TimelineEvent{}, Related: []TimelineEvent{}, Coverage: in.Coverage,
	}
	var kept []TimelineEvent
	for _, e := range all {
		if e.At < from {
			continue
		}
		if p.Before > 0 && (e.At > p.Before || (e.At == p.Before && e.ID >= p.BeforeID)) {
			continue
		}
		if p.Sources != nil && !p.Sources[e.Source] {
			continue
		}
		if p.Only != "" && !e.Outage {
			continue
		}
		if p.Only == "caused" && len(e.Causes) == 0 {
			continue
		}
		kept = append(kept, e)
	}
	sort.SliceStable(kept, func(i, j int) bool {
		if kept[i].At != kept[j].At {
			return kept[i].At > kept[j].At
		}
		return kept[i].ID > kept[j].ID
	})
	if len(kept) > p.Limit {
		kept = kept[:p.Limit]
		last := kept[len(kept)-1]
		out.Truncated, out.NextBefore, out.NextBeforeID = true, last.At, last.ID
	}
	out.Events = kept
	have := map[string]bool{}
	for _, e := range kept {
		have[e.ID] = true
	}
	for _, e := range kept {
		for _, c := range e.Causes {
			if !have[c.EventID] {
				have[c.EventID] = true
				out.Related = append(out.Related, byID[c.EventID])
			}
		}
	}
	return out
}

/* ── Gathering ─────────────────────────────────────────────────────────── */

type timelineHealthCache struct {
	mu        sync.Mutex
	path      string
	mtime     int64
	size      int64
	incidents map[string][]HealthIncident
	first     map[string]int64
}

var timelineHealth timelineHealthCache

// healthIncidents is every key's outages, derived once per version of the file.
func (h *Handlers) timelineHealthIncidents(now time.Time) (map[string][]HealthIncident, map[string]int64) {
	timelineHealth.mu.Lock()
	defer timelineHealth.mu.Unlock()
	var mtime, size int64
	if st, err := os.Stat(healthHistoryFilePath()); err == nil {
		mtime, size = st.ModTime().UnixNano(), st.Size()
	}
	path := healthHistoryFilePath()
	if timelineHealth.incidents != nil && timelineHealth.path == path && timelineHealth.mtime == mtime && timelineHealth.size == size {
		return timelineHealth.incidents, timelineHealth.first
	}
	samples, _ := h.readAllHealthHistoryAndDays()
	inc := make(map[string][]HealthIncident, len(samples))
	first := make(map[string]int64, len(samples))
	for key, s := range samples {
		if len(s) > 0 {
			first[key] = s[0].T
		}
		if d := deriveIncidents(s, now); len(d) > 0 {
			inc[key] = d
		}
	}
	timelineHealth.path, timelineHealth.mtime, timelineHealth.size = path, mtime, size
	timelineHealth.incidents, timelineHealth.first = inc, first
	return inc, first
}

func hostnameOf(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

func (h *Handlers) gatherTimeline(ctx context.Context, now time.Time) timelineInputs {
	lookback := now.Add(-(30*24*time.Hour + timelineCauseBefore))
	in := timelineInputs{Coverage: map[string]timelineCoverage{}, Links: timelineLinks{BookmarkContainer: map[string]string{}}}
	settings := h.store.GetSettings()

	// Containers and their updates, this machine only.
	updates := []dockerUpdateHistoryEntry{}
	dockerUpdateHistoryMu.Lock()
	all, err := readDockerUpdateHistory()
	dockerUpdateHistoryMu.Unlock()
	if err != nil {
		logWarn(logComponentMutate, "the update history could not be read: %v", err)
	}
	for _, u := range all {
		if u.At >= lookback.UnixMilli() {
			updates = append(updates, u)
		}
	}
	byName := map[string][]dockerTimelineEntry{}
	for _, name := range dockerTimelines.names() {
		byName[name] = dockerTimelines.forContainer(name)
	}
	in.Events = append(in.Events, dockerTimelineEvents(byName, updates)...)
	in.Events = append(in.Events, updateTimelineEvents(updates)...)
	in.Coverage[timelineSourceDocker] = timelineCoverage{OK: len(byName) > 0, Since: now.Add(-dockerTimelineMaxAge).UnixMilli()}
	if len(byName) == 0 {
		in.Coverage[timelineSourceDocker] = timelineCoverage{Reason: "nothing-recorded"}
	}
	in.Coverage[timelineSourceUpdate] = timelineCoverage{OK: true, Since: now.Add(-dockerTimelineMaxAge).UnixMilli()}

	// Monitors and network checks, from the health history.
	incidents, first := h.timelineHealthIncidents(now)
	var bookmarks []Bookmark
	seen := map[string]bool{}
	seenCheck := map[string]bool{}
	var healthEvents, checkEvents []TimelineEvent
	var healthSince, checkSince int64
	for _, pg := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(pg.ID) {
			key := canonicalBookmarkURLKey(bm.URL)
			if key == "" {
				continue
			}
			link := bookmarkLink(bm.URL, pg.ID)
			// The same address on two pages is one monitor, but each copy
			// may carry its own network checks.
			if !seen[key] {
				seen[key] = true
				bookmarks = append(bookmarks, bm)
				subject := TimelineSubject{Type: "bookmark", Name: bm.Name, Key: key}
				for _, inc := range incidents[key] {
					healthEvents = append(healthEvents, timelineOutageFromIncident(timelineSourceHealth, subject, link, inc, ""))
				}
				if t := first[key]; t > 0 && (healthSince == 0 || t < healthSince) {
					healthSince = t
				}
			}
			for _, c := range bm.Checks {
				if seenCheck[c.ID] {
					continue
				}
				seenCheck[c.ID] = true
				nk := netHistoryKey(c.ID)
				label := netCheckLabel(c, bm)
				cs := TimelineSubject{Type: "check", Name: label, Key: key}
				for _, inc := range incidents[nk] {
					checkEvents = append(checkEvents, timelineOutageFromIncident(timelineSourceCheck, cs, link, inc, ""))
				}
				if t := first[nk]; t > 0 && (checkSince == 0 || t < checkSince) {
					checkSince = t
				}
			}
		}
	}
	in.Events = append(in.Events, mergeTimelineFlaps(healthEvents)...)
	in.Events = append(in.Events, mergeTimelineFlaps(checkEvents)...)
	in.Coverage[timelineSourceHealth] = timelineCoverage{OK: healthSince > 0, Since: healthSince}
	in.Coverage[timelineSourceCheck] = timelineCoverage{OK: checkSince > 0, Since: checkSince}
	if healthSince == 0 {
		in.Coverage[timelineSourceHealth] = timelineCoverage{Reason: "nothing-recorded"}
	}
	if checkSince == 0 {
		in.Coverage[timelineSourceCheck] = timelineCoverage{Reason: "nothing-recorded"}
	}

	// Which bookmark is which container: the same matching the Containers view uses.
	in.Coverage["links"] = timelineCoverage{Reason: "docker-unreachable"}
	if api, _ := newDockerAPI(); api != nil {
		lctx, cancel := context.WithTimeout(ctx, 4*time.Second)
		list, lerr := api.listContainers(lctx)
		cancel()
		if lerr == nil {
			hidden := dockerHiddenSet()
			var rows []dockerViewContainer
			for _, c := range list {
				if hidden[c.name()] || dockerIsOwnHelper(c.Labels) {
					continue
				}
				rows = append(rows, toDockerViewOn(c, "", false))
			}
			idx := h.mcpLinkContainers(rows, bookmarks)
			for name, link := range idx.byContainer {
				if key := canonicalBookmarkURLKey(link.bookmark.URL); key != "" {
					in.Links.BookmarkContainer[key] = name
				}
			}
			in.Coverage["links"] = timelineCoverage{OK: true}
		}
	}

	// Glances: the stretches over a red line, kept per host in memory.
	cfgs := glancesHostConfigs()
	for _, cfg := range cfgs {
		if !cfg.configured() {
			continue
		}
		hs := glancesHostIfKnown(cfg.ID)
		if hs == nil {
			continue
		}
		name := cfg.Name
		if name == "" {
			name = "Glances"
		}
		list := hs.incidentsBetween(lookback.UnixMilli(), now.UnixMilli())
		in.Events = append(in.Events, glancesTimelineEvents(cfg.ID, name, list)...)
	}
	if len(cfgs) > 0 && glancesAnyConfigured(cfgs) {
		in.Coverage[timelineSourceGlances] = timelineCoverage{OK: true}
		gctx, cancel := context.WithTimeout(ctx, 4*time.Second)
		if ans := h.glancesDockerLink(gctx); ans.Same {
			in.Links.GlancesHost = ans.HostID
		}
		cancel()
	} else {
		in.Coverage[timelineSourceGlances] = timelineCoverage{Reason: "not-configured"}
	}

	// Unraid: what the watcher wrote down.
	if srv, ok := activeUnraidServer(settings); ok {
		in.Events = append(in.Events, unraidTimelineEvents(unraidEventsSince(lookback))...)
		in.Coverage[timelineSourceUnraid] = timelineCoverage{OK: true, Since: unraidRecordedSince(now).UnixMilli()}
		host := hostnameOf(srv.BaseURL)
		for _, v := range mcpViewHosts(settings) {
			if host != "" && strings.EqualFold(host, hostnameOf("http://"+v)) {
				in.Links.UnraidSameMachine = true
			}
		}
	} else {
		in.Coverage[timelineSourceUnraid] = timelineCoverage{Reason: "not-configured"}
	}
	return in
}

func glancesAnyConfigured(cfgs []GlancesConfig) bool {
	for _, c := range cfgs {
		if c.configured() {
			return true
		}
	}
	return false
}

// unraidRecordedSince is the oldest thing the watcher wrote down, or now when
// nothing yet: the log starts when nextDash first watched, not before.
func unraidRecordedSince(now time.Time) time.Time {
	unraidEventsMu.Lock()
	all := readUnraidEvents()
	unraidEventsMu.Unlock()
	if len(all) > 0 {
		return time.UnixMilli(all[0].At)
	}
	return now
}

// TimelineHandler answers GET /api/timeline.
func (h *Handlers) TimelineHandler(w http.ResponseWriter, r *http.Request) {
	if dockerLocalOnly(w, r) {
		return
	}
	now := time.Now()
	resp := buildTimeline(h.gatherTimeline(r.Context(), now), parseTimelineParams(r.URL.Query()), now)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, resp)
}
