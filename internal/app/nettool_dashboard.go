package app

import (
	"net/http"
	"strings"
	"time"
)

// netWidgetBeatSlices is how many slices of the last day a widget row's strip has.
const netWidgetBeatSlices = 24

// netDashboardRow is one check as the Network tests widget draws it: what the
// monitor loop last measured and the last day as a strip. Read from history
// only; nothing here connects anywhere.
type netDashboardRow struct {
	CheckID string `json:"checkId"`
	// Gone is a check id the widget still names that no bookmark has any more.
	Gone    bool          `json:"gone,omitempty"`
	PageID  int           `json:"pageId,omitempty"`
	URL     string        `json:"url,omitempty"`
	Name    string        `json:"name,omitempty"`
	Type    string        `json:"type,omitempty"`
	Label   string        `json:"label,omitempty"`
	Enabled bool          `json:"enabled"`
	Muted   bool          `json:"muted,omitempty"`
	State   *netStateView `json:"state,omitempty"`
	// Beat is the last 24 hours in equal slices: up, down, degraded, unknown.
	Beat []string `json:"beat,omitempty"`
	// DownSince is the start of the current outage (ms), 0 when up.
	DownSince int64 `json:"downSince,omitempty"`
	// Interval is how often the check runs, in minutes.
	Interval int `json:"intervalMinutes,omitempty"`
}

// parseNetDashboardIDs reads ?checks=id,id,... in the order given: valid ids
// only, no repeats, at most netWidgetMaxChecks.
func parseNetDashboardIDs(raw string) []string {
	ids := []string{}
	seen := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		id := strings.ToLower(strings.TrimSpace(part))
		if !validNetCheckID(id) || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
		if len(ids) >= netWidgetMaxChecks {
			break
		}
	}
	return ids
}

// GetNetDashboard answers GET /api/net/dashboard?checks=id,id,... for the
// Network tests widget: the newest state and the last day of each named check,
// in the order asked. It reads the history file and the bookmark lists, and
// never runs a check.
func (h *Handlers) GetNetDashboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	now := time.Now()
	if !h.store.GetSettings().NetToolsEnabled {
		writeJSON(w, map[string]any{"items": []netDashboardRow{}, "enabled": false, "fetchedAt": now.UnixMilli()})
		return
	}
	ids := parseNetDashboardIDs(r.URL.Query().Get("checks"))
	want := make(map[string]bool, len(ids))
	for _, id := range ids {
		want[id] = true
	}

	type found struct {
		pageID int
		bm     Bookmark
		check  NetCheck
	}
	wanted := map[string]found{}
	if len(ids) > 0 {
		for _, page := range h.store.GetPages() {
			for _, bm := range h.store.GetBookmarksByPage(page.ID) {
				for _, c := range bm.Checks {
					if !want[c.ID] {
						continue
					}
					if _, dup := wanted[c.ID]; !dup {
						wanted[c.ID] = found{pageID: page.ID, bm: bm, check: c}
					}
				}
			}
		}
	}

	var history map[string][]HealthSample
	if len(wanted) > 0 {
		history = h.readAllHealthHistory()
	}
	counts := map[string]int{"total": len(ids), "down": 0, "slow": 0, "warn": 0, "gone": 0}
	rows := make([]netDashboardRow, 0, len(ids))
	for _, id := range ids {
		f, ok := wanted[id]
		if !ok {
			counts["gone"]++
			rows = append(rows, netDashboardRow{CheckID: id, Gone: true})
			continue
		}
		samples := history[netHistoryKey(id)]
		state := netCheckStateFor(f.check, samples)
		interval := netCheckInterval(f.check, f.bm)
		row := netDashboardRow{
			CheckID: id, PageID: f.pageID, URL: f.bm.URL, Name: f.bm.Name, Type: f.check.Type,
			Label: netCheckLabel(f.check, f.bm), Enabled: f.check.Enabled, Muted: f.check.Muted || f.bm.NotifyMuted,
			State: state, Interval: int(interval / time.Minute),
		}
		if len(samples) > 0 {
			for _, b := range heartbeatBuckets(samples, 24*time.Hour, netWidgetBeatSlices, now) {
				row.Beat = append(row.Beat, b.State)
			}
			if stats := netCheckStats(samples, nil, interval, now); stats != nil {
				row.DownSince = stats.DownSince
			}
		}
		if f.check.Enabled && state != nil {
			switch {
			case state.Paused:
			case !state.OK:
				counts["down"]++
			case state.Warn:
				counts["warn"]++
			case state.Slow:
				counts["slow"]++
			}
		}
		rows = append(rows, row)
	}
	writeJSON(w, map[string]any{"items": rows, "counts": counts, "enabled": true, "fetchedAt": now.UnixMilli()})
}
