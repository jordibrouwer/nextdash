package main

import (
	"encoding/json"
	"log"
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

// bulkExpectRequest names one field of an expectation per pointer, so a batch
// can set only what the caller asked about. A nil pointer means "leave this
// alone", which is what separates a bulk edit from the single-bookmark
// endpoint's everything-replaces-everything rule: muting twelve bookmarks
// during a known outage must not also clear the keyword checks they carry.
type bulkExpectRequest struct {
	Targets          []checkModeTarget `json:"targets"`
	ExpectStatus     *string           `json:"expectStatus,omitempty"`
	ExpectText       *string           `json:"expectText,omitempty"`
	ExpectTextAbsent *bool             `json:"expectTextAbsent,omitempty"`
	WatchDrift       *bool             `json:"watchDrift,omitempty"`
	NotifyMuted      *bool             `json:"notifyMuted,omitempty"`
}

// SetBookmarkExpectationsBulk applies one expectation change to a list of
// bookmarks.
//
// Check mode and monitor interval were the only per-bookmark health settings
// that could be set on several rows at once. Everything SetBookmarkExpectations
// writes — expected status, keyword, drift watching, muting — was strictly one
// bookmark per request, so muting twelve during a known outage, or allowing
// 200,401 on everything behind the same SSO proxy, was twelve dialogs. The
// settings you most want to apply to a group were the ones that could not be.
//
// Same shape as setCheckModeForTargets on purpose: grouped per page for one
// write each, stale entries skipped rather than failing the batch, and both
// counts reported so the caller can say what actually happened.
func (h *Handlers) SetBookmarkExpectationsBulk(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req bulkExpectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if len(req.Targets) == 0 {
		http.Error(w, "targets are required", http.StatusBadRequest)
		return
	}
	if req.ExpectStatus == nil && req.ExpectText == nil && req.ExpectTextAbsent == nil &&
		req.WatchDrift == nil && req.NotifyMuted == nil {
		http.Error(w, "nothing to change", http.StatusBadRequest)
		return
	}

	var (
		status string
		text   string
	)
	if req.ExpectStatus != nil {
		status = normalizeExpectStatus(*req.ExpectStatus)
	}
	if req.ExpectText != nil {
		text = strings.TrimSpace(*req.ExpectText)
		if len(text) > expectTextMaxLen {
			http.Error(w, "expectText is too long", http.StatusBadRequest)
			return
		}
	}

	byPage := map[int][]checkModeTarget{}
	skipped := 0
	for _, t := range req.Targets {
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
				bm := &current[t.Index]
				if req.ExpectStatus != nil {
					bm.ExpectStatus = status
				}
				if req.ExpectText != nil {
					bm.ExpectText = text
					// Absent-mode only means something with a keyword to look
					// for, exactly as the single-bookmark path enforces.
					if text == "" {
						bm.ExpectTextAbsent = false
					}
				}
				if req.ExpectTextAbsent != nil && bm.ExpectText != "" {
					bm.ExpectTextAbsent = *req.ExpectTextAbsent
				}
				if req.NotifyMuted != nil {
					bm.NotifyMuted = *req.NotifyMuted
				}
				if req.WatchDrift != nil {
					wasWatching := bm.WatchDrift
					bm.WatchDrift = *req.WatchDrift
					// Same rule as the single path: off clears the baseline and
					// the finding, and on starts from nothing rather than
					// resurrecting what was there before it was switched off.
					if !bm.WatchDrift || !wasWatching {
						bm.DriftURL = ""
						bm.DriftTitle = ""
						bm.DriftFingerprint = ""
						bm.DriftNoticed = ""
						bm.DriftReason = ""
						bm.DriftSince = 0
					}
				}
				// Clearing the expectation clears the failure it caused, so a
				// bookmark marked down for a keyword does not stay down with no
				// visible reason left.
				if bm.ExpectText == "" && bm.ExpectStatus == "" && isContentFailure(bm.LastError) {
					bm.LastError = ""
				}
				changed++
			}
			return current, nil
		})
		if err != nil {
			log.Printf("expectations: failed to update page %d: %v", pageID, err)
			http.Error(w, "Failed to update bookmarks", http.StatusInternalServerError)
			return
		}
	}

	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"changed": changed,
		"skipped": skipped,
	})
}
