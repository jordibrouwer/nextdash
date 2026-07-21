package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

// Check modes as they travel over the wire. These mirror the three-state control
// in the UI rather than the two booleans on the bookmark: "periodic" and
// "monitor" are mutually exclusive choices, not flags to combine.
const (
	checkModeOff      = "off"
	checkModePeriodic = "periodic"
	checkModeMonitor  = "monitor"
)

// applyCheckMode writes one of the three modes onto a bookmark. Kept separate so
// the single and bulk paths cannot drift into disagreeing about what "monitor"
// means.
//
// A bookmark switched to monitor without an interval gets the default written
// out explicitly, matching the inline editor: a stored bookmark should state its
// own cadence rather than silently inheriting one.
func applyCheckMode(bm *Bookmark, mode string) {
	switch mode {
	case checkModePeriodic:
		bm.CheckStatus = true
		bm.Monitor = false
		bm.MonitorIntervalMinutes = 0
	case checkModeMonitor:
		bm.CheckStatus = false
		bm.Monitor = true
		if bm.MonitorIntervalMinutes == 0 {
			bm.MonitorIntervalMinutes = defaultMonitorIntervalMinutes
		}
	default: // off
		bm.CheckStatus = false
		bm.Monitor = false
		bm.MonitorIntervalMinutes = 0
	}
}

// normalizeCheckMode maps a request value onto one of the three modes, reporting
// whether it was recognised at all. An empty mode is not defaulted: silently
// treating a typo as "off" would turn checking off on a bookmark the caller
// meant to enable.
func normalizeCheckMode(raw string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case checkModeOff:
		return checkModeOff, true
	case checkModePeriodic:
		return checkModePeriodic, true
	case checkModeMonitor:
		return checkModeMonitor, true
	}
	return "", false
}

// checkModeFor reports the mode a bookmark is currently in, so the client can
// render the active option without duplicating the flag logic.
func checkModeFor(bm Bookmark) string {
	if bm.Monitor {
		return checkModeMonitor
	}
	if bm.CheckStatus {
		return checkModePeriodic
	}
	return checkModeOff
}

// checkModeTarget names one bookmark in a bulk request. The URL travels with the
// index for the same reason as in the single-bookmark path: the index alone is
// only as fresh as the health report it came from.
type checkModeTarget struct {
	PageID int    `json:"pageId"`
	Index  int    `json:"index"`
	URL    string `json:"url"`
}

// setCheckModeForTargets applies one mode to an explicit list of bookmarks.
//
// Targets are grouped per page so a batch spanning one page costs one write
// rather than one per bookmark. Stale entries are skipped rather than failing
// the whole batch: with a list of dozens, one bookmark having moved should not
// discard the other changes. The response reports both counts so the caller can
// say what actually happened.
func (h *Handlers) setCheckModeForTargets(w http.ResponseWriter, rawMode string, targets []checkModeTarget) {
	mode, ok := normalizeCheckMode(rawMode)
	if !ok {
		http.Error(w, "mode must be off, periodic or monitor", http.StatusBadRequest)
		return
	}

	byPage := map[int][]checkModeTarget{}
	skipped := 0
	for _, t := range targets {
		if t.PageID <= 0 || t.Index < 0 || strings.TrimSpace(t.URL) == "" {
			skipped++
			continue
		}
		byPage[t.PageID] = append(byPage[t.PageID], t)
	}

	changed := 0
	for pageID, pageTargets := range byPage {
		err := h.store.MutateBookmarksOnPage(pageID, func(current []Bookmark) ([]Bookmark, error) {
			for _, t := range pageTargets {
				if t.Index >= len(current) {
					skipped++
					continue
				}
				if canonicalBookmarkURLKey(current[t.Index].URL) != canonicalBookmarkURLKey(t.URL) {
					skipped++
					continue
				}
				applyCheckMode(&current[t.Index], mode)
				changed++
			}
			return current, nil
		})
		if err != nil {
			log.Printf("check-mode: failed to update page %d: %v", pageID, err)
			http.Error(w, "Failed to update bookmarks", http.StatusInternalServerError)
			return
		}
	}

	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"mode":    mode,
		"changed": changed,
		"skipped": skipped,
	})
}

// SetBookmarkCheckMode changes availability checking for a single bookmark.
//
// This exists so the health view can switch a bookmark between off, periodic and
// monitor in place. Before it, the only route was a deep link into the dashboard
// inline editor, which discarded the view's filter, search, scroll position and
// keyboard selection.
//
// The URL is required alongside the index and must still match. The health
// report is served from a cache that can be up to a few minutes old, so an index
// taken from it may point at a different bookmark by the time the click arrives;
// without the check, a stale row would silently rewrite the wrong bookmark.
func (h *Handlers) SetBookmarkCheckMode(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		PageID int    `json:"pageId"`
		Index  int    `json:"index"`
		URL    string `json:"url"`
		Mode   string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 || req.Index < 0 {
		http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
		return
	}
	mode, ok := normalizeCheckMode(req.Mode)
	if !ok {
		http.Error(w, "mode must be off, periodic or monitor", http.StatusBadRequest)
		return
	}
	wantURL := canonicalBookmarkURLKey(strings.TrimSpace(req.URL))
	if wantURL == "" {
		http.Error(w, "url is required", http.StatusBadRequest)
		return
	}

	existing := h.store.GetBookmarksByPage(req.PageID)
	if req.Index >= len(existing) {
		http.Error(w, "Bookmark index out of range", http.StatusNotFound)
		return
	}
	if canonicalBookmarkURLKey(existing[req.Index].URL) != wantURL {
		http.Error(w, "Bookmark has changed; reload the health report", http.StatusConflict)
		return
	}

	var applied Bookmark
	err := h.store.MutateBookmarksOnPage(req.PageID, func(current []Bookmark) ([]Bookmark, error) {
		// Re-check under the store lock: the slice read above is a snapshot, and
		// the bookmark may have moved between that read and this mutation.
		if req.Index >= len(current) {
			return nil, errCheckModeGone
		}
		if canonicalBookmarkURLKey(current[req.Index].URL) != wantURL {
			return nil, errCheckModeGone
		}
		applyCheckMode(&current[req.Index], mode)
		applied = current[req.Index]
		return current, nil
	})
	if err == errCheckModeGone {
		http.Error(w, "Bookmark has changed; reload the health report", http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, "Failed to update bookmark", http.StatusInternalServerError)
		return
	}

	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"mode":                   checkModeFor(applied),
		"monitorIntervalMinutes": applied.MonitorIntervalMinutes,
	})
}
