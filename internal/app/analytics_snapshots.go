package app

import (
	"encoding/json"
	"strconv"
	"sync"
	"time"
)

/*
The three feature snapshots beside content-snapshot: widgets, containers and
the list views (Health, Inbox, Bookmarks).

Raw values here, as with the content counts; the browser encodes every one of
them before it leaves (WIDGET_FIELDS and friends in umami-analytics.js), so the
rule -- booleans, small enums, numbers in buckets -- is stated in one place.
Nothing free-form is read at all: no container, widget or page names, no
addresses, no inbox text. Where a stored value is a name (a hidden container,
an inbox source), only a count or a yes/no about a fixed list goes out.

The containers snapshot reads settings and the environment only. It never asks
the Docker daemon: a page load must not wait on a socket, and how many
containers someone runs is not a question these events need answered.
*/

type analyticsSnapshots struct {
	Widgets    map[string]any `json:"widgets"`
	Containers map[string]any `json:"containers"`
	Views      map[string]any `json:"views"`
}

// analyticsInboxSources are the sources the inbox names in its own stats; any
// other value a client sent is counted under none of them.
var analyticsInboxSources = []string{"extension", "paste", "share", "import"}

// analyticsCertWarnDays is how close to expiry a certificate counts as due.
const analyticsCertWarnDays = 14

var analyticsSnapshotsCache = struct {
	sync.Mutex
	json string
	at   time.Time
}{}

// analyticsSnapshotsJSON returns the three snapshots as JSON for the page
// template, or "" when analytics is off -- not counted, as with the content.
// Cached for the same window as the content counts, and dropped with them.
func (h *Handlers) analyticsSnapshotsJSON(enabled bool) string {
	if !enabled {
		return ""
	}
	analyticsSnapshotsCache.Lock()
	defer analyticsSnapshotsCache.Unlock()
	if analyticsSnapshotsCache.json != "" && time.Since(analyticsSnapshotsCache.at) < analyticsContentTTL {
		return analyticsSnapshotsCache.json
	}
	encoded, err := json.Marshal(h.collectAnalyticsSnapshots())
	if err != nil {
		return ""
	}
	analyticsSnapshotsCache.json = string(encoded)
	analyticsSnapshotsCache.at = time.Now()
	return analyticsSnapshotsCache.json
}

func invalidateAnalyticsSnapshotsCache() {
	analyticsSnapshotsCache.Lock()
	defer analyticsSnapshotsCache.Unlock()
	analyticsSnapshotsCache.json = ""
}

func (h *Handlers) collectAnalyticsSnapshots() analyticsSnapshots {
	settings := h.store.GetSettings()
	return analyticsSnapshots{
		Widgets:    h.analyticsWidgets(),
		Containers: h.analyticsContainers(settings),
		Views:      h.analyticsViews(settings),
	}
}

// analyticsWidgets counts widgets per type across every page, with every known
// type present (a zero is an answer too) and nothing else: the register is
// closed, so a type name is one of a fixed list.
func (h *Handlers) analyticsWidgets() map[string]any {
	byType := map[string]int{}
	for widgetType := range knownWidgetTypes {
		byType[string(widgetType)] = 0
	}
	total, pages := 0, 0
	for _, page := range h.store.GetPages() {
		widgets, _ := h.store.GetPageBlocks(page.ID)
		if len(widgets) > 0 {
			pages++
		}
		for _, widget := range widgets {
			if _, known := knownWidgetTypes[widget.Type]; !known {
				continue
			}
			byType[string(widget.Type)]++
			total++
		}
	}
	return map[string]any{"total": total, "pages": pages, "byType": byType}
}

// analyticsContainers is how the Containers view is set up, from settings and
// the environment alone -- see the note at the top.
func (h *Handlers) analyticsContainers(settings Settings) map[string]any {
	imagesChecked, updatesWaiting := 0, 0
	for _, update := range h.dockerUpdateSnapshot() {
		if update == nil {
			continue
		}
		imagesChecked++
		if update.Status == "available" {
			updatesWaiting++
		}
	}
	return map[string]any{
		"socketSet":          dockerSocketPath() != "",
		"control":            dockerControlEnabled(),
		"writeToken":         writeAccessToken() != "",
		"runAsRoot":          envPath("NEXTDASH_RUN_AS_ROOT") == "1",
		"viewEnabled":        settings.DockerViewEnabled,
		"updateInterval":     settings.DockerUpdateInterval,
		"refreshSeconds":     strconv.Itoa(settings.DockerRefreshSeconds),
		"logLines":           strconv.Itoa(settings.DockerLogLines),
		"statsHistory":       settings.DockerStatsHistory,
		"confirmStopRestart": settings.DockerConfirmStopRestart,
		"hidden":             len(settings.DockerHiddenContainers),
		"customWebUIs":       len(settings.DockerWebUIs),
		"hostAddressSet":     settings.DockerHostAddress != "",
		"githubToken":        dockerGitHubToken() != "",
		"imagesChecked":      imagesChecked,
		"updatesWaiting":     updatesWaiting,
	}
}

// analyticsViews is Health, Inbox and the Bookmarks view: what they hold, in
// counts, and how they are set up, in the settings' own enums.
func (h *Handlers) analyticsViews(settings Settings) map[string]any {
	out := map[string]any{}

	// Health, from the last check's cache.
	cache := readHealthCacheFile()
	now := time.Now()
	down, errored, latest := 0, 0, int64(0)
	for _, entry := range cache.Cache {
		switch entry.Status {
		case "offline":
			down++
		case "error":
			errored++
		}
		if entry.LastScanned > latest {
			latest = entry.LastScanned
		}
	}
	certsDue, certsExpired := 0, 0
	for _, cert := range cache.Certificates {
		if cert.ExpiresAt <= 0 {
			continue
		}
		expires := time.UnixMilli(cert.ExpiresAt)
		switch {
		case expires.Before(now):
			certsExpired++
		case expires.Before(now.AddDate(0, 0, analyticsCertWarnDays)):
			certsDue++
		}
	}
	lastCheckHours := -1
	if latest > 0 {
		lastCheckHours = int(now.Sub(time.UnixMilli(latest)).Hours())
	}
	out["healthChecked"] = len(cache.Cache)
	out["healthDown"] = down
	out["healthErrors"] = errored
	out["certsDue"] = certsDue
	out["certsExpired"] = certsExpired
	out["lastCheckHours"] = lastCheckHours
	out["recheckHours"] = settings.HealthAutoRecheckIntervalHours

	// Inbox: what is waiting and how, and which of the known ways in were used.
	unread, snoozed, noted := 0, 0, 0
	nowMs := now.UnixMilli()
	for _, item := range h.store.GetInboxItems() {
		if item.ReadAt == 0 {
			unread++
		}
		if item.SnoozedUntil > nowMs {
			snoozed++
		}
		if item.Note != "" {
			noted++
		}
	}
	stats := h.store.GetInboxStats()
	out["inboxUnread"] = unread
	out["inboxSnoozed"] = snoozed
	out["inboxNoted"] = noted
	out["inboxKept"] = stats.TotalKept
	for _, source := range analyticsInboxSources {
		out["inboxFrom_"+source] = stats.BySource[source] > 0
	}
	out["inboxSort"] = settings.InboxViewSort
	out["inboxFilter"] = settings.InboxViewFilter
	out["inboxAddress"] = settings.InboxViewAddress
	out["inboxKeyLegend"] = settings.InboxViewKeyLegend
	out["inboxDeleteAfterPromote"] = settings.InboxDeleteAfterPromote

	// The Bookmarks view. Columns: -1 is "all" (never chosen), else how many.
	columns := -1
	if settings.BmViewColumns != nil {
		columns = len(settings.BmViewColumns)
	}
	out["bmColumns"] = columns
	out["bmGroup"] = settings.BmViewGroup
	out["bmAddress"] = settings.BmViewAddress
	out["bmPanelWidth"] = settings.BmViewPanelWidth
	out["bmRail"] = settings.BmViewRail
	out["bmRowColors"] = settings.BmViewRowColors
	return out
}
