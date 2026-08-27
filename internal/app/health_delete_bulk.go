package app

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
)

// Bulk delete from the health view.
//
// The single-row endpoint takes {pageId, index} and removes whatever currently
// sits at that position. That is safe enough for one row confirmed by name in a
// dialog, but not for a batch:
//
//   - Every delete shifts the indices of the rows after it, so the second delete
//     in a batch would land on the wrong bookmark if the caller sent indices it
//     read before the first one ran.
//   - The health report is cached and can be minutes old, so the indices may
//     already describe a different bookmark before the batch starts.
//
// So each item carries the URL the caller believes sits at that index, exactly
// as the check-mode endpoint already does. A row whose URL no longer matches is
// skipped and reported back rather than deleted, and the caller is told to
// reload. Within a page the deletes run highest index first, so removing one
// never invalidates the positions of those still to come.

type healthBulkDeleteItem struct {
	PageID int    `json:"pageId"`
	Index  int    `json:"index"`
	URL    string `json:"url"`
}

// healthBulkDeleteSkip names one row that was not deleted, so the client can say
// which of the selection survived and why.
type healthBulkDeleteSkip struct {
	PageID int    `json:"pageId"`
	Index  int    `json:"index"`
	URL    string `json:"url"`
	Reason string `json:"reason"`
}

const (
	healthBulkSkipStale       = "stale"
	healthBulkSkipOutOfRange  = "out-of-range"
	healthBulkSkipWriteFailed = "write-failed"
)

// DeleteHealthBookmarksBulk removes several bookmarks in one request.
func (h *Handlers) DeleteHealthBookmarksBulk(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		Items []healthBulkDeleteItem `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if len(req.Items) == 0 {
		http.Error(w, "No items", http.StatusBadRequest)
		return
	}

	byPage := make(map[int][]healthBulkDeleteItem)
	for _, item := range req.Items {
		if item.PageID <= 0 || item.Index < 0 {
			http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
			return
		}
		if canonicalBookmarkURLKey(strings.TrimSpace(item.URL)) == "" {
			http.Error(w, "url is required for every item", http.StatusBadRequest)
			return
		}
		byPage[item.PageID] = append(byPage[item.PageID], item)
	}

	pageNames := make(map[int]string)
	for _, page := range h.store.GetPages() {
		pageNames[page.ID] = page.Name
	}

	deleted := make([]Bookmark, 0, len(req.Items))
	trashed := make([]TrashedBookmark, 0, len(req.Items))
	skipped := make([]healthBulkDeleteSkip, 0)

	for pageID, items := range byPage {
		// Highest index first: removing a later entry never moves an earlier one,
		// so every remaining index in this page stays valid as we go.
		sort.Slice(items, func(a, b int) bool { return items[a].Index > items[b].Index })

		pageDeleted, pageSkipped := h.deleteHealthBookmarksOnPage(pageID, items)
		skipped = append(skipped, pageSkipped...)
		for _, entry := range pageDeleted {
			bm := entry.Bookmark
			bm.PageID = pageID
			deleted = append(deleted, bm)
			entry.PageName = pageNames[pageID]
			entry.Source = "health-bulk"
			trashed = append(trashed, entry)
		}
	}

	// Recorded after the page writes, so a delete that did not persist cannot
	// leave a phantom entry in the trash. Best-effort: a failed trash write costs
	// the undo window, not the delete the user asked for.
	if len(trashed) > 0 {
		_ = h.store.AddTrashedBookmarks(trashed)
	}
	if len(deleted) > 0 {
		h.invalidateHealthReportCache()
	}
	for _, bm := range deleted {
		logBookmarkDelete(bm, r)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "deleted",
		"deleted": len(deleted),
		"skipped": skipped,
	})
}

// deleteHealthBookmarksOnPage removes the verified items from one page in a
// single write, returning what it took out and what it refused to touch.
func (h *Handlers) deleteHealthBookmarksOnPage(
	pageID int,
	items []healthBulkDeleteItem,
) ([]TrashedBookmark, []healthBulkDeleteSkip) {
	removed := make([]TrashedBookmark, 0, len(items))
	skipped := make([]healthBulkDeleteSkip, 0)

	err := h.store.MutateBookmarksOnPage(pageID, func(current []Bookmark) ([]Bookmark, error) {
		// Re-checked under the store lock: the report the client read is a
		// snapshot, and the page may have been written since.
		removed = removed[:0]
		skipped = skipped[:0]
		next := current
		for _, item := range items {
			if item.Index >= len(next) {
				skipped = append(skipped, healthBulkDeleteSkip{
					PageID: pageID, Index: item.Index, URL: item.URL,
					Reason: healthBulkSkipOutOfRange,
				})
				continue
			}
			want := canonicalBookmarkURLKey(strings.TrimSpace(item.URL))
			if canonicalBookmarkURLKey(next[item.Index].URL) != want {
				skipped = append(skipped, healthBulkDeleteSkip{
					PageID: pageID, Index: item.Index, URL: item.URL,
					Reason: healthBulkSkipStale,
				})
				continue
			}
			removed = append(removed, TrashedBookmark{
				PageID:   pageID,
				Index:    item.Index,
				Bookmark: next[item.Index],
			})
			next = append(next[:item.Index], next[item.Index+1:]...)
		}
		return next, nil
	})

	if err != nil {
		// The page was never written, so nothing was deleted — report every item
		// as skipped rather than claiming removals that did not happen.
		failed := make([]healthBulkDeleteSkip, 0, len(items))
		for _, item := range items {
			failed = append(failed, healthBulkDeleteSkip{
				PageID: pageID, Index: item.Index, URL: item.URL,
				Reason: healthBulkSkipWriteFailed,
			})
		}
		return nil, failed
	}
	return removed, skipped
}
