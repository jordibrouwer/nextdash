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
	// Same guard every other endpoint that fetches a caller-supplied URL uses.
	// Without it this was the one unrated outbound-fetch path, and
	// requireWriteAccess waves everything through when NEXTDASH_WRITE_TOKEN is
	// unset -- which is the default.
	if !h.requireSSRFAPIRateLimit(w, r) {
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

	expect := expectation{}
	if bm, ok := h.findBookmarkByURL(url); ok {
		expect = expectationFor(bm).withSoftNotFound(softNotFoundEnabled(h.store.GetSettings()))
	}
	result := h.pingURLExpecting(r.Context(), url, expect)
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
				setBookmarkCheckResult(&current[i], lastChecked, errMsg)
				if result.CertHost != "" {
					current[i].CertHost = result.CertHost
				}
				applyDriftResult(&current[i], result, lastChecked)
			}
			return current, nil
		})
	}

	// The handshake this check already made knows when the certificate expires,
	// so record it here too rather than only in the monitor sweep — otherwise a
	// bookmark that is only ever checked on demand never contributes one.
	if result.CertExpiry > 0 && result.CertHost != "" {
		h.recordMonitorCertificates([]PingResult{result})
	}

	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": result.Status,
		"pingMs": result.PingMs,
		"error":  errMsg,
	})
}
