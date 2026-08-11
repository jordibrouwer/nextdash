package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

/*
Accepting drift: telling the watcher that the page's new shape is the right one.

Drift detection deliberately refuses to re-baseline itself. evaluateDrift fills
the baseline fields only on its no-baseline branch, so a page that drifted keeps
comparing against what it used to be — otherwise a parking page would be
reported once and then quietly become "normal", which is the one outcome that
makes the whole feature useless.

That leaves the operator holding the only judgement the machine cannot make:
whether this particular change was wanted. A site-wide rebrand, a docs
reorganisation, a deliberate move to a new domain — all three trip every
watching bookmark at once, and all three are fine. Without a way to say so, the
finding sits on the row forever and the drift filter stops meaning anything.

Accepting is therefore two things in one write: clear the finding, and record
the page as it is now so the *next* real change is measured from here. Doing
only the first would re-report the same drift on the next check.

The baseline cannot be recomputed from stored state — DriftURL and friends are
the old values by definition — so acceptance clears them and lets the next check
establish a fresh baseline through the ordinary no-baseline path. One check of
latency in exchange for not duplicating evaluateDrift's baseline logic here.
*/

// driftAcceptTarget names one bookmark whose drift finding is being accepted.
// Carries the URL alongside the index for the same reason every other health
// write does: the index came from a report that may be minutes old.
type driftAcceptTarget struct {
	PageID int    `json:"pageId"`
	Index  int    `json:"index"`
	URL    string `json:"url"`
}

// acceptDrift clears a bookmark's drift finding and its now-stale baseline.
//
// Returns false when there was nothing to accept, so a caller can report an
// accurate count rather than claiming to have changed rows it left alone.
//
// Split out as a pure-ish helper for the same reason applyCheckMode is: the
// single and bulk paths must not drift into disagreeing about what accepting
// means.
func acceptDrift(bm *Bookmark) bool {
	if bm == nil {
		return false
	}
	// Nothing reported and no baseline to refresh: accepting is a no-op rather
	// than an error, since a row can lose its finding to a re-check between the
	// report being drawn and the click arriving.
	if bm.DriftNoticed == "" && bm.DriftURL == "" && bm.DriftFingerprint == "" {
		return false
	}

	bm.DriftNoticed = ""
	bm.DriftReason = ""
	bm.DriftSince = 0
	// The baseline goes too, not just the finding. These fields describe the
	// page as it was before the change that was just accepted, so keeping them
	// would re-report the identical drift on the very next check. Cleared, the
	// next check takes evaluateDrift's no-baseline branch and records what the
	// page is now.
	bm.DriftURL = ""
	bm.DriftTitle = ""
	bm.DriftFingerprint = ""
	return true
}

// AcceptDrift clears drift findings for an explicit list of bookmarks.
//
// Bulk-only by design. Accepting one row at a time is already possible through
// the row menu, but the situation that produces drift findings is rarely one
// row: a rebrand or a docs move trips everything pointing at that site in the
// same sweep, and clearing them individually is the tedium this exists to
// remove.
//
// There is no "accept everything" mode without a target list, deliberately —
// unlike turning checks off, accepting drift discards evidence. The caller must
// name every bookmark it clears, so the blast radius is always something the
// user could see on screen.
func (h *Handlers) AcceptDrift(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		Targets []driftAcceptTarget `json:"targets"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if len(req.Targets) == 0 {
		http.Error(w, "targets is required", http.StatusBadRequest)
		return
	}

	byPage := map[int][]driftAcceptTarget{}
	skipped := 0
	for _, t := range req.Targets {
		if t.PageID <= 0 || t.Index < 0 || strings.TrimSpace(t.URL) == "" {
			skipped++
			continue
		}
		byPage[t.PageID] = append(byPage[t.PageID], t)
	}

	accepted := 0
	for pageID, pageTargets := range byPage {
		err := h.store.MutateBookmarksOnPage(pageID, func(current []Bookmark) ([]Bookmark, error) {
			for _, t := range pageTargets {
				// Stale rows are skipped rather than failing the batch: with a
				// list of dozens, one bookmark having moved should not discard
				// the rest of the work.
				if t.Index >= len(current) {
					skipped++
					continue
				}
				if canonicalBookmarkURLKey(current[t.Index].URL) != canonicalBookmarkURLKey(t.URL) {
					skipped++
					continue
				}
				if acceptDrift(&current[t.Index]) {
					accepted++
				} else {
					skipped++
				}
			}
			return current, nil
		})
		if err != nil {
			log.Printf("drift-accept: failed to update page %d: %v", pageID, err)
			http.Error(w, "Failed to update bookmarks", http.StatusInternalServerError)
			return
		}
	}

	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"accepted": accepted,
		"skipped":  skipped,
	})
}
