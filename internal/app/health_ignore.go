package app

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
)

/*
Ignoring a health condition on a bookmark.

Some rows are only ever going to read badly and the reader knows why: an archive
page that is allowed to sit unopened for a year, a link behind a bot wall that
answers 403 to every check, a deliberate duplicate. Until now the only ways to
stop those from filling a filter were to delete the bookmark or to stop checking
it — one throws away the link, the other throws away the checking.

An ignore is per condition rather than per bookmark, so telling the report to
stop reporting a page as stale does not also silence it the year the domain
lapses. And a snooze is the same record with a date on it: the condition comes
back on its own, which is what most "ignore" clicks actually mean.

Two endpoints, in the shape the health view already speaks: one bookmark, or a
list of them. Both replace the flags they are given for the bookmarks they name
and leave every other bookmark alone.
*/

// healthIgnoreTarget is one bookmark, named the way every health write names
// one: page, index, and the URL that index must still hold.
type healthIgnoreTarget = checkModeTarget

type healthIgnoreRequest struct {
	Targets []healthIgnoreTarget `json:"targets"`
	// Add and Remove are separate lists rather than one replacing set, because
	// the caller is acting on a filter: "ignore stale for these twelve" must not
	// clear whatever else those twelve were already ignoring.
	Add    []string `json:"add,omitempty"`
	Remove []string `json:"remove,omitempty"`
	// Clear empties the list for the named bookmarks, which is the "stop
	// ignoring everything" button in the Ignored list.
	Clear bool `json:"clear,omitempty"`
	// UntilMs dates the entries in Add: zero is for good, a timestamp is a
	// snooze. Sent as an absolute moment rather than a duration so the server
	// and the browser cannot disagree about when it started.
	UntilMs int64 `json:"untilMs,omitempty"`
}

/*
SetBookmarkHealthIgnores applies one ignore change to a list of bookmarks.

One endpoint for one row and for forty: the health view sends a single target
from the row menu and the whole selection from the bulk bar, and a second
endpoint for the single case would be the same code with a different door.

Stale entries are skipped rather than failing the batch — with a list of dozens,
one bookmark having moved should not discard the other changes — and both counts
come back so the caller can say what actually happened.
*/
func (h *Handlers) SetBookmarkHealthIgnores(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req healthIgnoreRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if len(req.Targets) == 0 {
		http.Error(w, "targets is required", http.StatusBadRequest)
		return
	}

	add := normalizeHealthFlagList(req.Add)
	remove := normalizeHealthFlagList(req.Remove)
	if len(add) == 0 && len(remove) == 0 && !req.Clear {
		http.Error(w, "add, remove or clear is required", http.StatusBadRequest)
		return
	}

	now := time.Now()
	byPage := map[int][]healthIgnoreTarget{}
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
				// The report is served from a cache that can be minutes old, so
				// an index taken from it may point elsewhere by the time the
				// click arrives. Without this a stale row would silence a
				// different bookmark.
				if canonicalBookmarkURLKey(current[t.Index].URL) != canonicalBookmarkURLKey(t.URL) {
					skipped++
					continue
				}
				current[t.Index].HealthIgnored = applyHealthIgnores(
					current[t.Index].HealthIgnored, add, remove, req.Clear, req.UntilMs, now)
				changed++
			}
			return current, nil
		})
		if err != nil {
			log.Printf("health-ignore: failed to update page %d: %v", pageID, err)
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

// normalizeHealthFlagList keeps the names the report actually produces. A flag
// nobody recognises is dropped here rather than stored, so a typo cannot sit in
// the file hiding nothing and explaining nothing.
func normalizeHealthFlagList(flags []string) []string {
	out := make([]string, 0, len(flags))
	seen := map[string]bool{}
	for _, raw := range flags {
		flag := strings.ToLower(strings.TrimSpace(raw))
		if !knownHealthFlags[flag] || seen[flag] {
			continue
		}
		seen[flag] = true
		out = append(out, flag)
	}
	return out
}

/*
applyHealthIgnores folds one change into what a bookmark already ignores.

Clear wins over both lists: "stop ignoring everything" is a whole answer, and a
caller sending it alongside an add is contradicting itself. Otherwise removes
are applied before adds, so a request that both un-snoozes and re-ignores a
condition ends with the newer intent.
*/
func applyHealthIgnores(current []HealthIgnore, add, remove []string, clear bool, untilMs int64, now time.Time) []HealthIgnore {
	if clear {
		return nil
	}
	kept := make([]HealthIgnore, 0, len(current)+len(add))
	dropped := map[string]bool{}
	for _, flag := range remove {
		dropped[flag] = true
	}
	replaced := map[string]bool{}
	for _, flag := range add {
		replaced[flag] = true
	}
	for _, entry := range current {
		flag := strings.ToLower(strings.TrimSpace(entry.Flag))
		if dropped[flag] || replaced[flag] {
			continue
		}
		kept = append(kept, entry)
	}
	// A snooze in the past is a request to ignore nothing, so it is dropped by
	// normalisation rather than stored as an entry that never applies.
	for _, flag := range add {
		kept = append(kept, HealthIgnore{Flag: flag, Until: untilMs})
	}
	return normalizeHealthIgnores(kept, now)
}
