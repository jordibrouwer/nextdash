package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

// SetBookmarkExpectations changes one bookmark's definition of healthy — the
// string its page must contain, which status codes count as reachable, and
// whether it watches for rot (a redirect elsewhere, a changed title, a body
// that no longer resembles what was saved).
//
// Separate from SetBookmarkCheckMode rather than folded into it: that endpoint
// answers "how often, if at all, is this checked", and this one "what does a
// good answer look like". Overloading it would have meant a caller changing a
// keyword had to send the mode as well, and get it right.
//
// The same stale-index guard applies: the health report is served from a cache
// that can be minutes old, so an index taken from it may point somewhere else by
// the time the click arrives. Without the URL check a stale row would quietly
// rewrite the wrong bookmark.
func (h *Handlers) SetBookmarkExpectations(w http.ResponseWriter, r *http.Request) {
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
		// All fields are sent together and replace what is stored, so clearing
		// one is an empty string rather than a separate call.
		ExpectText       string `json:"expectText"`
		ExpectTextAbsent bool   `json:"expectTextAbsent"`
		ExpectStatus     string `json:"expectStatus"`
		// WatchDrift is the fourth "what counts as a good answer" question this
		// endpoint already answers, not a new subsystem: where the check lands,
		// what the page is titled, roughly what it says.
		WatchDrift bool `json:"watchDrift"`
		// NotifyMuted rides along here rather than getting its own endpoint: it
		// is per-bookmark alerting policy, set from the same panel, and sending
		// it with the rest keeps the "all fields replace what is stored" rule
		// this handler already documents. A caller that omits it un-mutes, which
		// is the same wholesale-replace semantics as every other field above.
		NotifyMuted bool `json:"notifyMuted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 || req.Index < 0 {
		http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
		return
	}
	wantURL := canonicalBookmarkURLKey(strings.TrimSpace(req.URL))
	if wantURL == "" {
		http.Error(w, "url is required", http.StatusBadRequest)
		return
	}

	text := strings.TrimSpace(req.ExpectText)
	if len(text) > expectTextMaxLen {
		http.Error(w, "expectText is too long", http.StatusBadRequest)
		return
	}
	// A spec that parses to nothing is stored as empty, which restores the
	// default rule. Rejecting it instead would leave the user with a field they
	// cannot clear by typing something wrong into it.
	status := normalizeExpectStatus(req.ExpectStatus)

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
		// Re-checked under the store lock: the read above is a snapshot and the
		// bookmark may have moved since.
		if req.Index >= len(current) {
			return nil, errCheckModeGone
		}
		if canonicalBookmarkURLKey(current[req.Index].URL) != wantURL {
			return nil, errCheckModeGone
		}
		bm := &current[req.Index]
		bm.ExpectText = text
		bm.ExpectTextAbsent = req.ExpectTextAbsent && text != ""
		bm.ExpectStatus = status
		bm.NotifyMuted = req.NotifyMuted
		// Clearing the expectation clears the failure it caused. Without this a
		// bookmark marked down for a missing keyword would stay down until its
		// next check, with no visible reason left to explain it.
		if text == "" && status == "" && isContentFailure(bm.LastError) {
			bm.LastError = ""
		}
		wasWatching := bm.WatchDrift
		bm.WatchDrift = req.WatchDrift
		// Turning it off clears the baseline and any finding along with it. On,
		// it stays off until the next check establishes a fresh baseline — there
		// is nothing yet to compare, and turning it back on must not resurrect a
		// stale finding from before it was switched off.
		if !bm.WatchDrift || (bm.WatchDrift && !wasWatching) {
			bm.DriftURL = ""
			bm.DriftTitle = ""
			bm.DriftFingerprint = ""
			bm.DriftNoticed = ""
			bm.DriftReason = ""
			bm.DriftSince = 0
		}
		applied = *bm
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
		"status":           "success",
		"expectText":       applied.ExpectText,
		"expectTextAbsent": applied.ExpectTextAbsent,
		"expectStatus":     applied.ExpectStatus,
		"watchDrift":       applied.WatchDrift,
		"notifyMuted":      applied.NotifyMuted,
	})
}
