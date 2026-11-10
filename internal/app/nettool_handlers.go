package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// GetNetCapabilities tells the UI what network checks can do on this install.
func (h *Handlers) GetNetCapabilities(w http.ResponseWriter, r *http.Request) {
	s := h.store.GetSettings()
	icmp := "unknown"
	switch icmpState.Load() {
	case icmpWorks:
		icmp = "ok"
	case icmpBlocked:
		icmp = "blocked"
	}
	scheduled := 0
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			for _, c := range bm.Checks {
				if c.ID != "" && c.Enabled {
					scheduled++
				}
			}
		}
	}
	types := make([]string, 0, len(netTypesBuilt))
	for t, on := range netTypesBuilt {
		if on {
			types = append(types, t)
		}
	}
	sort.Strings(types)
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{
		"enabled":         s.NetToolsEnabled,
		"icmp":            icmp,
		"pingMode":        s.NetToolsPing,
		"allowCustomHost": s.NetToolsAllowCustomHost,
		"maxChecks":       s.NetToolsMaxChecks,
		"scheduled":       scheduled,
		"typesBuilt":      types,
	})
}

// netStateView is the newest sample of a check, as the UI reads it. Slow and
// via-TCP come from flags on the sample; a sample from before the flags existed
// of a ping or TCP check (whose detail is text of our own) is read from that
// text.
type netStateView struct {
	At   int64 `json:"at"`
	OK   bool  `json:"ok"`
	Slow bool  `json:"slow,omitempty"`
	Warn bool  `json:"warn,omitempty"`
	// Paused: the newest answer says nothing about the network (ping switched
	// off or forbidden, the address guard, the demo). It is not down, and it
	// does not alert.
	Paused    bool   `json:"paused,omitempty"`
	Ms        int    `json:"ms"`
	Class     string `json:"class,omitempty"`
	Detail    string `json:"detail,omitempty"`
	Secondary int    `json:"secondary,omitempty"`
	ViaTCP    bool   `json:"viaTcp,omitempty"`
}

// netCheckState derives a check's current state from its newest sample. The
// state is never stored on the check (it would be a second source that a stale
// tab could overwrite); nil when the check has not run yet.
func netCheckState(samples []HealthSample) *netStateView {
	if len(samples) == 0 {
		return nil
	}
	last := samples[len(samples)-1]
	return &netStateView{
		At:        last.T,
		OK:        last.Up,
		Slow:      last.Slow,
		Paused:    !last.Up && netClassNotAnOutage(last.Fail),
		Ms:        last.PingMs,
		Class:     last.Fail,
		Detail:    last.D,
		Secondary: last.L,
		ViaTCP:    last.ViaTCP,
	}
}

// netCheckStateFor is netCheckState with what only the check knows: a TLS check
// is "warn" (up, but nearly expired) when its newest sample is up and the days
// left it recorded (sample.L) are under the check's own threshold. The warning
// is not stored as a flag, so a changed MinDaysLeft applies to the last sample
// at once.
func netCheckStateFor(c NetCheck, samples []HealthSample) *netStateView {
	st := netCheckState(samples)
	if st == nil {
		return nil
	}
	if c.Type == netTypeTLS && st.OK && st.Secondary <= netTLSMinDays(c) {
		st.Warn = true
	}
	// Samples from before the flags: only a ping or TCP check has a detail that
	// is text of our own. The detail of the other types (a DNS record, a JSON
	// value) can say "slow" without meaning it.
	if last := samples[len(samples)-1]; !last.Slow && !last.ViaTCP && (c.Type == netTypePing || c.Type == netTypeTCP) {
		st.Slow = strings.Contains(last.D, "slow")
		st.ViaTCP = strings.Contains(last.D, "via TCP")
	}
	return st
}

// netCheckStats is the uptime, heartbeat and incidents of a check, through the
// same computation as a monitored bookmark. nil without samples.
func netCheckStats(samples []HealthSample, days []HealthDay, interval time.Duration, now time.Time) *MonitorStats {
	return buildMonitorStatsWithDays(samples, days, int(interval/time.Minute), now)
}

// netCheckView is a check with its derived state and, for one bookmark's list,
// its stats.
type netCheckView struct {
	NetCheck
	Display string        `json:"display,omitempty"` // the short name the UI shows
	State   *netStateView `json:"state,omitempty"`
	Stats   *MonitorStats `json:"stats,omitempty"`
}

func (h *Handlers) netCheckViews(bm Bookmark, history map[string][]HealthSample, days map[string][]HealthDay, now time.Time) []netCheckView {
	out := make([]netCheckView, 0, len(bm.Checks))
	for _, c := range bm.Checks {
		key := netHistoryKey(c.ID)
		samples := history[key]
		out = append(out, netCheckView{
			NetCheck: c,
			Display:  netCheckLabel(c, bm),
			State:    netCheckStateFor(c, samples),
			Stats:    netCheckStats(samples, days[key], netCheckInterval(c, bm), now),
		})
	}
	return out
}

var errNetBookmarkGone = errors.New("bookmark not found")

// errNetPageMoved: the page changed between reading what the other bookmarks
// hold and the write, so the row that was read is not the row that is there.
var errNetPageMoved = errors.New("the page changed while saving")

// netPutChecksHook is a test seam: it runs after PUT /api/net/checks has found
// its row and before it reads what the rest of the install holds.
var netPutChecksHook func()

// netCheckIDList is the IDs of a row's checks as one string, to tell whether a
// row is still the one that was read.
func netCheckIDList(checks []NetCheck) string {
	ids := make([]string, len(checks))
	for i, c := range checks {
		ids[i] = c.ID
	}
	return strings.Join(ids, ",")
}

// netInputError is a refusal of what the client sent (a 400), told apart from a
// failed write.
type netInputError struct{ err error }

func (e netInputError) Error() string { return e.err.Error() }
func (e netInputError) Unwrap() error { return e.err }

// netRowIndex is the index of the row with this URL key; occurrence counts the
// rows that share it (0 is the first), like the bookmark patch does.
func netRowIndex(list []Bookmark, key string, occurrence int) int {
	if occurrence < 0 {
		occurrence = 0
	}
	seen := 0
	for i, bm := range list {
		if canonicalBookmarkURLKey(bm.URL) != key {
			continue
		}
		if seen == occurrence {
			return i
		}
		seen++
	}
	return -1
}

func netWriteError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// GetNetChecks answers two shapes. With pageId and url: that bookmark's checks
// with state and stats. Without a query: every check of the install as a flat
// list for row badges, the rail and the bell.
func (h *Handlers) GetNetChecks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	history := h.readAllHealthHistory()
	now := time.Now()
	w.Header().Set("Cache-Control", "no-store")

	if q.Get("pageId") != "" || q.Get("url") != "" {
		var pageID int
		if _, err := fmt.Sscanf(q.Get("pageId"), "%d", &pageID); err != nil || pageID <= 0 {
			netWriteError(w, http.StatusBadRequest, "pageId is required")
			return
		}
		key := canonicalBookmarkURLKey(q.Get("url"))
		if key == "" {
			netWriteError(w, http.StatusBadRequest, "url is required")
			return
		}
		occurrence := 0
		_, _ = fmt.Sscanf(q.Get("occurrence"), "%d", &occurrence)
		list := h.store.GetBookmarksByPage(pageID)
		idx := netRowIndex(list, key, occurrence)
		if idx < 0 {
			netWriteError(w, http.StatusNotFound, "bookmark not found")
			return
		}
		writeJSON(w, map[string]any{"checks": h.netCheckViews(list[idx], history, h.readAllHealthDays(), now)})
		return
	}

	type item struct {
		PageID int    `json:"pageId"`
		URL    string `json:"url"`
		// Occurrence: which of the rows with this address on the page it is (0 is
		// the first), so a write after this list reaches the right row.
		Occurrence int           `json:"occurrence,omitempty"`
		Name       string        `json:"name"`
		CheckID    string        `json:"checkId"`
		Type       string        `json:"type"`
		Label      string        `json:"label"`
		Enabled    bool          `json:"enabled"`
		Muted      bool          `json:"muted"`
		State      *netStateView `json:"state,omitempty"`
		// Host is what the check talks to and Interval how often it runs, in
		// minutes: the Config overview table shows both.
		Host     string `json:"host,omitempty"`
		Interval int    `json:"intervalMinutes,omitempty"`
		// RecoveredAt (ms) is when the newest outage ended, set only while the
		// check is up again and that end lies within the last 24 hours. The bell
		// reads it for its "recovered" row.
		RecoveredAt int64 `json:"recoveredAt,omitempty"`
		// DriftDiff and DriftAt are a DNS check's unaccepted change; the bell
		// reads them for its "DNS changed" row.
		DriftDiff string `json:"driftDiff,omitempty"`
		DriftAt   int64  `json:"driftAt,omitempty"`
	}
	items := []item{}
	settings := h.store.GetSettings()
	counts := map[string]int{"scheduled": 0, "down": 0}
	for _, page := range h.store.GetPages() {
		seenURL := map[string]int{}
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			urlKey := canonicalBookmarkURLKey(bm.URL)
			occurrence := seenURL[urlKey]
			seenURL[urlKey]++
			for _, c := range bm.Checks {
				samples := history[netHistoryKey(c.ID)]
				state := netCheckStateFor(c, samples)
				host := ""
				if target, err := netCheckTarget(bm, c, settings); err == nil {
					host = target.Host
				}
				items = append(items, item{
					Host: host, Interval: int(netCheckInterval(c, bm) / time.Minute),
					PageID: page.ID, URL: bm.URL, Occurrence: occurrence, Name: bm.Name, CheckID: c.ID, Type: c.Type,
					Label: netCheckLabel(c, bm), Enabled: c.Enabled, Muted: c.Muted || bm.NotifyMuted, State: state,
					RecoveredAt: netRecoveredAt(samples, state, now),
					DriftDiff:   c.DriftDiff, DriftAt: c.DriftAt,
				})
				counts[c.Type]++
				if c.Enabled {
					counts["scheduled"]++
					if state != nil && !state.OK && !state.Paused {
						counts["down"]++
					}
				}
			}
		}
	}
	writeJSON(w, map[string]any{"items": items, "counts": counts})
}

// netRecoveredAt is the end of the newest outage of a check that is up again,
// when that end lies within the last 24 hours; 0 otherwise. Derived from the
// samples through deriveIncidents, never stored.
func netRecoveredAt(samples []HealthSample, state *netStateView, now time.Time) int64 {
	if state == nil || !state.OK {
		return 0
	}
	incidents := deriveIncidents(samples, now)
	if len(incidents) == 0 {
		return 0
	}
	last := incidents[len(incidents)-1]
	if last.Ongoing || last.End == 0 || now.UnixMilli()-last.End > 24*time.Hour.Milliseconds() {
		return 0
	}
	return last.End
}

// PutNetChecks replaces one bookmark's list of checks. The list is normalised
// (server-set IDs, limits, the install-wide cap) and saved through the page
// mutation, the only writer of checks besides the DNS baseline.
func (h *Handlers) PutNetChecks(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		PageID     int        `json:"pageId"`
		URL        string     `json:"url"`
		Occurrence int        `json:"occurrence"`
		Checks     []NetCheck `json:"checks"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		netWriteError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}
	key := canonicalBookmarkURLKey(req.URL)
	if req.PageID <= 0 || key == "" {
		netWriteError(w, http.StatusBadRequest, "pageId and url are required")
		return
	}
	settings := h.store.GetSettings()

	// One writer at a time decides the ceiling and the IDs. What the other
	// bookmarks hold is read before the page lock is taken (the readers take it
	// too), so inside the mutation the target row is checked to be the one that
	// was read; a page that changed in between starts the round again.
	h.netChecksMu.Lock()
	defer h.netChecksMu.Unlock()

	var saved []NetCheck
	var savedBM Bookmark
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		list := h.store.GetBookmarksByPage(req.PageID)
		target := netRowIndex(list, key, req.Occurrence)
		if target < 0 {
			netWriteError(w, http.StatusNotFound, "bookmark not found")
			return
		}
		readIDs := netCheckIDList(list[target].Checks)
		if netPutChecksHook != nil {
			netPutChecksHook()
		}
		taken, enabledElsewhere := netCheckLedger(h.store, req.PageID, target)
		err = h.store.MutateBookmarksOnPage(req.PageID, func(current []Bookmark) ([]Bookmark, error) {
			idx := netRowIndex(current, key, req.Occurrence)
			if idx < 0 {
				return nil, netInputError{errNetBookmarkGone}
			}
			if idx != target || netCheckIDList(current[idx].Checks) != readIDs {
				return nil, errNetPageMoved
			}
			out, err := normalizeNetChecks(req.Checks, current[idx].Checks, current[idx], settings, taken, enabledElsewhere)
			if err != nil {
				return nil, netInputError{err}
			}
			next := make([]Bookmark, len(current))
			copy(next, current)
			if len(out) == 0 {
				out = nil
			}
			next[idx].Checks = out
			saved, savedBM = out, next[idx]
			return next, nil
		})
		if !errors.Is(err, errNetPageMoved) {
			break
		}
	}
	if errors.Is(err, errNetPageMoved) {
		netWriteError(w, http.StatusConflict, "the page changed while saving; try again")
		return
	}
	var bad netInputError
	switch {
	case errors.Is(err, errNetCheckCap):
		netWriteError(w, http.StatusConflict, errNetCheckCap.Error())
		return
	case errors.As(err, &bad):
		status := http.StatusBadRequest
		if errors.Is(bad, errNetBookmarkGone) {
			status = http.StatusNotFound
		}
		netWriteError(w, status, bad.Error())
		return
	}
	if !respondStorePersistError(w, err) {
		return
	}
	logActivity(activityCategoryHealth, "net_checks_set", map[string]any{
		"url": activityURL(savedBM.URL), "count": len(saved),
	}, "")
	writeJSON(w, map[string]any{"checks": h.netCheckViews(savedBM, h.readAllHealthHistory(), h.readAllHealthDays(), time.Now())})
}

// GetNetHistory answers one check's samples over a range, the daily summaries
// beyond them, and the stats.
func (h *Handlers) GetNetHistory(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("check"))
	bm, _, chk, ok := findNetCheck(h.store, id)
	if !ok {
		netWriteError(w, http.StatusNotFound, "check not found")
		return
	}
	window := 24 * time.Hour
	rng := r.URL.Query().Get("range")
	switch rng {
	case "7d":
		window = 7 * 24 * time.Hour
	case "30d":
		window = 30 * 24 * time.Hour
	default:
		rng = "24h"
	}
	key := netHistoryKey(id)
	h.healthHistoryMu.Lock()
	file := readHealthHistoryFile()
	h.healthHistoryMu.Unlock()

	all := append([]HealthSample(nil), file.Samples[key]...)
	storedDays := append([]HealthDay(nil), file.Days[key]...)
	now := time.Now()
	cutoff := now.Add(-window).UnixMilli()
	samples := make([]HealthSample, 0, len(all))
	for _, s := range all {
		if s.T >= cutoff {
			samples = append(samples, s)
		}
	}
	days := foldSamplesIntoDays(append([]HealthDay(nil), storedDays...), all)
	if days == nil {
		days = []HealthDay{}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{
		"check":   id,
		"range":   rng,
		"samples": samples,
		"days":    days,
		"stats":   netCheckStats(all, storedDays, netCheckInterval(chk, bm), now),
	})
}
