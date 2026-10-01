package app

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// PingURL checks the status and response time of a bookmark URL
func (h *Handlers) PingURL(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	applyCORSHeaders(w, r)

	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.requireStatusPingRateLimit(w, r) {
		return
	}

	// Get URL from query parameter
	urlParam := r.URL.Query().Get("url")
	if urlParam == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "URL parameter is required",
			"status": "offline",
			"ping":   nil,
		})
		return
	}

	// Parse and validate URL
	if _, err := url.Parse(urlParam); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "Invalid URL",
			"status": "offline",
			"ping":   nil,
		})
		return
	}

	if !h.store.BookmarkURLExists(urlParam) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "URL is not a registered bookmark",
			"status": "offline",
			"ping":   nil,
		})
		return
	}

	expect := expectation{}
	if bm, ok := h.pingTarget(r, urlParam); ok {
		expect = expectationFor(bm).withSoftNotFound(softNotFoundEnabled(h.store.GetSettings()))
	}
	result := h.pingURLExpecting(r.Context(), urlParam, expect)
	force := strings.EqualFold(r.URL.Query().Get("refresh"), "1") ||
		strings.EqualFold(r.URL.Query().Get("refresh"), "true")
	logBookmarkStatus(urlParam, result, activitySourceFromRequest(r), force)
	if result.Status == "online" {
		w.WriteHeader(http.StatusOK)
		payload := map[string]interface{}{
			"status":      "online",
			"ping":        result.PingMs,
			"errorDetail": "",
		}
		// Reported on success too, so a manual re-check can record the same
		// status code the scheduler stores in its samples.
		if result.HTTPStatus > 0 {
			payload["httpStatus"] = result.HTTPStatus
		}
		json.NewEncoder(w).Encode(payload)
		return
	}

	payload := map[string]interface{}{
		"status":      "offline",
		"ping":        nil,
		"errorDetail": result.ErrorDetail,
	}
	if result.HTTPStatus > 0 {
		payload["httpStatus"] = result.HTTPStatus
	}
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(payload)
}

// pingTarget is the bookmark whose rules a ping uses. A re-check names its row
// (page and index), and the verdict is recorded on that row; taking the first
// copy of the URL across all pages checked one copy with another copy's rules.
// The URL guards the index, and without page and index the first copy answers.
func (h *Handlers) pingTarget(r *http.Request, rawURL string) (Bookmark, bool) {
	q := r.URL.Query()
	page, pageErr := strconv.Atoi(q.Get("page"))
	index, indexErr := strconv.Atoi(q.Get("index"))
	if pageErr == nil && indexErr == nil && index >= 0 {
		rows := h.store.GetBookmarksByPage(page)
		if index < len(rows) && canonicalBookmarkURLKey(rows[index].URL) == canonicalBookmarkURLKey(rawURL) {
			return rows[index], true
		}
	}
	return h.findBookmarkByURL(rawURL)
}
