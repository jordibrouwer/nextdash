package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// CheckBookmarkHealthURL pings a single bookmark URL once and persists the result
// into the health cache, so a freshly-created bookmark (e.g. promoted from the
// inbox) shows an up-to-date status on the Health view without waiting for a full
// "Retest all" or the background recheck. If a stored bookmark matches the URL its
// LastChecked/LastError are updated too, mirroring runHealthRetest, so the report
// and the bookmark row stay in sync.
//
// The endpoint is a lightweight, best-effort companion to the promote flow: the
// caller fires it and forgets. It only records a result — it never creates or
// mutates bookmark structure.
func (h *Handlers) CheckBookmarkHealthURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	url := strings.TrimSpace(req.URL)
	if url == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}
	key := canonicalBookmarkURLKey(url)
	if key == "" {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}

	result := h.pingURLDetailed(r.Context(), url)
	errMsg := ""
	if result.Status != "online" {
		errMsg = result.ErrorDetail
		if errMsg == "" {
			errMsg = "Unreachable"
		}
	}
	lastChecked := time.Now().UnixMilli()

	// Persist the health-cache entry (what the Health view reads). This is the
	// primary effect; the per-bookmark field update below is best-effort.
	if err := h.mergeHealthCacheUpdates(map[string]HealthScanCache{
		key: {
			URL:         key,
			Status:      result.Status,
			PingMs:      result.PingMs,
			LastScanned: lastChecked,
			Error:       errMsg,
		},
	}); err != nil {
		http.Error(w, "Failed to persist health status", http.StatusInternalServerError)
		return
	}

	// Mirror the status onto the matching bookmark(s) so the report score and the
	// bookmark row agree. Missing/moved bookmarks are ignored — the cache entry
	// above already carries the result.
	for _, page := range h.store.GetPages() {
		matched := false
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if canonicalBookmarkURLKey(bm.URL) == key {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		_ = h.store.MutateBookmarksOnPage(page.ID, func(current []Bookmark) ([]Bookmark, error) {
			for i := range current {
				if canonicalBookmarkURLKey(current[i].URL) != key {
					continue
				}
				current[i].LastChecked = lastChecked
				current[i].LastError = errMsg
			}
			return current, nil
		})
	}

	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": result.Status,
		"pingMs": result.PingMs,
		"error":  errMsg,
	})
}
