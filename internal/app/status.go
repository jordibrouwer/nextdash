package app

import (
	"encoding/json"
	"net/http"
	"net/url"
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
	if bm, ok := h.findBookmarkByURL(urlParam); ok {
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
