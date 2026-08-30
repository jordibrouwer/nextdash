package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// One write for a round of checks, keyed on the bookmark rather than on where
// it happened to sit.
//
// Opening the dashboard fired one POST /api/health/update-status per row that
// pinged -- measured at ten of them over seven seconds on a page of 115 rows.
// Each took the store's global lock and rewrote the whole page file, so a page
// load cost ten read-modify-write cycles over 49 KB before anyone had touched
// anything.
//
// The older route carried an `index`: the bookmark's position in the client's
// copy of the page at the moment the ping started. Positions are not
// identities. Anything that reorders the collection between the ping going out
// and the result coming back -- a delete, a move, a rename under a sort -- makes
// that number point at a different bookmark, and the check result lands on an
// innocent row. This route takes the URL, matched with canonicalBookmarkURLKey
// so it agrees with how the rest of the app decides two URLs are the same.
//
// The single-write route stays: the health view and the config view still use
// it for one-off rechecks, where there is no round to batch and the row is
// under the reader's eye.

type bookmarkStatusResult struct {
	URL    string `json:"url"`
	Status string `json:"status"`
	Error  string `json:"error"`
}

type bookmarkStatusBatch struct {
	PageID  int                    `json:"pageId"`
	Results []bookmarkStatusResult `json:"results"`
}

// UpdateBookmarkHealthStatuses records a whole round of check results in one
// pass. Unknown URLs are counted and skipped rather than failing the batch --
// a row can be deleted while its ping is in flight, and the other results in
// the same array are still worth keeping.
func (h *Handlers) UpdateBookmarkHealthStatuses(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req bookmarkStatusBatch
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 {
		http.Error(w, "Invalid page reference", http.StatusBadRequest)
		return
	}
	if len(req.Results) == 0 {
		http.Error(w, "No results to record", http.StatusBadRequest)
		return
	}

	// Last result wins for a URL that appears twice: a round should not probe
	// the same address more than once, and if it did, the later answer is the
	// more recent one.
	wanted := make(map[string]bookmarkStatusResult, len(req.Results))
	for _, res := range req.Results {
		key := canonicalBookmarkURLKey(res.URL)
		if key == "" {
			continue
		}
		wanted[key] = res
	}

	checkedAt := time.Now().UnixMilli()
	updated := 0

	err := h.store.MutateBookmarksOnPage(req.PageID, func(bookmarks []Bookmark) ([]Bookmark, error) {
		for i := range bookmarks {
			res, ok := wanted[canonicalBookmarkURLKey(bookmarks[i].URL)]
			if !ok {
				continue
			}
			detail := ""
			if strings.TrimSpace(res.Status) != "online" {
				detail = strings.TrimSpace(res.Error)
				if detail == "" {
					detail = "Unreachable"
				}
			}
			setBookmarkCheckResult(&bookmarks[i], checkedAt, detail)
			updated++
		}
		return bookmarks, nil
	})
	if !respondBookmarkMutationError(w, err) {
		return
	}
	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]int{
		"updated": updated,
		"skipped": len(wanted) - updated,
	})
}
