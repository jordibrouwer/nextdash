package app

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
)

// errCheckModeGone reports that a bookmark moved or changed between the time the
// health report was built and the time the write landed. Surfaced as 409 so the
// client reloads rather than retrying against the same stale index.
var errCheckModeGone = errors.New("bookmark no longer matches the requested reference")

// checkModeResult reports what a bulk check-mode change actually did.
type checkModeResult struct {
	Changed  int `json:"changed"`
	Periodic int `json:"periodic"` // bookmarks that had checkStatus on
	Monitor  int `json:"monitor"`  // bookmarks that had monitor on
}

// countCheckedBookmarks reports how many bookmarks currently have any form of
// availability checking enabled. Used to decide whether the bulk control is
// offered at all — "turn everything off" on an empty set is a no-op that should
// not be clickable.
func (h *Handlers) countCheckedBookmarks() checkModeResult {
	var res checkModeResult
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if bm.Monitor {
				res.Monitor++
			}
			if bm.CheckStatus {
				res.Periodic++
			}
			if bm.Monitor || bm.CheckStatus {
				res.Changed++
			}
		}
	}
	return res
}

// SetAllCheckModes turns availability checking off for every bookmark at once.
//
// Only "off" is supported in bulk. Turning checking *on* for everything would
// point the scheduler at the entire collection, which is exactly the pattern the
// per-bookmark opt-in exists to prevent; switching it off is the safe direction
// and the one people actually need when a monitor batch gets noisy.
//
// History is deliberately left alone: the monitor sweep reclaims it once the
// bookmarks are no longer monitored, and dropping it here would destroy uptime
// records on what may have been a misclick.
func (h *Handlers) SetAllCheckModes(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		Mode    string            `json:"mode"`
		Targets []checkModeTarget `json:"targets"`
		// Optional, and only meaningful with mode=monitor: the cadence to give
		// every named target. Zero leaves each bookmark's existing interval alone.
		MonitorIntervalMinutes int `json:"monitorIntervalMinutes"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	// With an explicit target list, any mode is allowed: the caller has named
	// every bookmark it touches, so "on" cannot escape the set the user can see.
	// Without one the request means "everything", and only off stays available —
	// enabling checks collection-wide is exactly what the per-bookmark opt-in
	// exists to prevent.
	if len(req.Targets) > 0 {
		h.setCheckModeForTargets(w, req.Mode, req.Targets, req.MonitorIntervalMinutes)
		return
	}
	if mode := strings.TrimSpace(strings.ToLower(req.Mode)); mode != "" && mode != "off" {
		http.Error(w, "only mode=off is supported without an explicit target list", http.StatusBadRequest)
		return
	}

	before := h.countCheckedBookmarks()

	for _, page := range h.store.GetPages() {
		// Skip pages with nothing to change so a large collection does not get
		// rewritten page by page for no reason.
		relevant := false
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if bm.Monitor || bm.CheckStatus {
				relevant = true
				break
			}
		}
		if !relevant {
			continue
		}

		err := h.store.MutateBookmarksOnPage(page.ID, func(current []Bookmark) ([]Bookmark, error) {
			for i := range current {
				current[i].Monitor = false
				current[i].CheckStatus = false
				current[i].MonitorIntervalMinutes = 0
			}
			return current, nil
		})
		if err != nil {
			log.Printf("check-mode: failed to update page %d: %v", page.ID, err)
			http.Error(w, "Failed to update bookmarks", http.StatusInternalServerError)
			return
		}
	}

	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"changed":  before.Changed,
		"periodic": before.Periodic,
		"monitor":  before.Monitor,
	})
}
