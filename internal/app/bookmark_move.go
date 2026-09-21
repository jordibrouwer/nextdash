package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
)

// MutateBookmarkPages reads several pages under one lock, lets mutate change
// any of them, and writes back the ones it returns. A page that does not exist
// is handed over empty, and only written when mutate returns it.
func (fs *FileStore) MutateBookmarkPages(pageIDs []int, mutate func(map[int][]Bookmark) (map[int][]Bookmark, error)) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	pages := make(map[int]PageWithBookmarks, len(pageIDs))
	lists := make(map[int][]Bookmark, len(pageIDs))
	for _, id := range pageIDs {
		if _, seen := pages[id]; seen {
			continue
		}
		page, err := fs.readPageWithBookmarksLocked(id)
		if err != nil && !errors.Is(err, ErrBookmarkNotFound) {
			return err
		}
		if errors.Is(err, ErrBookmarkNotFound) {
			page = PageWithBookmarks{Page: Page{ID: id}}
		}
		pages[id] = page
		lists[id] = append([]Bookmark(nil), page.Bookmarks...)
	}
	changed, err := mutate(lists)
	if err != nil {
		return err
	}
	for id, list := range changed {
		page, ok := pages[id]
		if !ok {
			continue
		}
		page.Bookmarks = list
		if err := fs.writePageWithBookmarksLocked(id, page); err != nil {
			return err
		}
	}
	return nil
}

type bookmarkMoveItem struct {
	PageID     int    `json:"pageId"`
	URL        string `json:"url"`
	Occurrence int    `json:"occurrence,omitempty"`
	// Category, when set, overrides the request's: the undo of a move sends
	// each row back into the category it came from.
	Category *string `json:"category,omitempty"`
}

type bookmarkMoveSkip struct {
	PageID   int            `json:"pageId"`
	URL      string         `json:"url"`
	Reason   string         `json:"reason"`
	Conflict map[string]any `json:"conflict,omitempty"`
}

/*
MoveBookmarks moves rows to another page in one locked step.

Config moved a selection by writing the source pages without the rows, then the
target with them. A target that refused -- the same URL already there -- left
them on neither, and outside the trash. Here each row is checked against the
target first and only moved when it can land; one that cannot stays where it
was and is reported. The answer names where each moved row came from, so the
move can be undone.
*/
func (h *Handlers) MoveBookmarks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		ToPage   int                `json:"toPage"`
		Category *string            `json:"category"`
		Items    []bookmarkMoveItem `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.ToPage == 0 || len(req.Items) == 0 {
		http.Error(w, "toPage and items are required", http.StatusBadRequest)
		return
	}
	if !h.pageExists(req.ToPage) && req.ToPage != unsortedPageID {
		http.Error(w, "Page not found", http.StatusNotFound)
		return
	}
	for _, item := range req.Items {
		if item.PageID == 0 {
			http.Error(w, "pageId is required for every item", http.StatusBadRequest)
			return
		}
	}

	// A later copy of a URL moves before an earlier one, so taking it off its
	// page does not renumber the copy still to come.
	sort.SliceStable(req.Items, func(a, b int) bool {
		if canonicalBookmarkURLKey(req.Items[a].URL) != canonicalBookmarkURLKey(req.Items[b].URL) {
			return false
		}
		return req.Items[a].Occurrence > req.Items[b].Occurrence
	})
	ids := []int{req.ToPage}
	for _, item := range req.Items {
		ids = append(ids, item.PageID)
	}
	moved := make([]map[string]any, 0, len(req.Items))
	skipped := make([]bookmarkMoveSkip, 0)
	now := time.Now().UnixMilli()

	err := h.store.MutateBookmarkPages(ids, func(pages map[int][]Bookmark) (map[int][]Bookmark, error) {
		moved = moved[:0]
		skipped = skipped[:0]
		changed := make(map[int][]Bookmark)
		target := pages[req.ToPage]
		for _, item := range req.Items {
			key := canonicalBookmarkURLKey(strings.TrimSpace(item.URL))
			source := pages[item.PageID]
			at := locateBookmarkAt(source, -1, item.URL, item.Occurrence)
			if key == "" || at < 0 {
				skipped = append(skipped, bookmarkMoveSkip{PageID: item.PageID, URL: item.URL, Reason: "gone"})
				continue
			}
			if item.PageID == req.ToPage {
				// Same page: only the category moves.
				row := source[at]
				before := row.Category
				if cat := moveCategory(item, req.Category); cat != nil {
					row.Category = *cat
				}
				row.UpdatedAt = now
				source[at] = row
				pages[item.PageID] = source
				target = source
				changed[item.PageID] = source
				moved = append(moved, map[string]any{"fromPage": item.PageID, "url": row.URL, "category": before})
				continue
			}
			if clash := locateBookmark(target, -1, item.URL); clash >= 0 {
				skipped = append(skipped, bookmarkMoveSkip{
					PageID: item.PageID, URL: item.URL, Reason: "duplicate_url",
					Conflict: map[string]any{"name": target[clash].Name, "url": target[clash].URL, "pageId": req.ToPage},
				})
				continue
			}
			row := source[at]
			before := row.Category
			if cat := moveCategory(item, req.Category); cat != nil {
				row.Category = *cat
			}
			row.PageID = req.ToPage
			row.UpdatedAt = now
			source = append(source[:at:at], source[at+1:]...)
			pages[item.PageID] = source
			changed[item.PageID] = source
			target = append(target, row)
			changed[req.ToPage] = target
			moved = append(moved, map[string]any{"fromPage": item.PageID, "url": row.URL, "category": before})
		}
		pages[req.ToPage] = target
		if _, ok := changed[req.ToPage]; ok {
			changed[req.ToPage] = target
		}
		return changed, nil
	})
	if !respondStorePersistError(w, err) {
		return
	}
	if len(moved) > 0 {
		h.invalidateHealthReportCache()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "success",
		"moved":   moved,
		"skipped": skipped,
	})
}

func moveCategory(item bookmarkMoveItem, fallback *string) *string {
	if item.Category != nil {
		return item.Category
	}
	return fallback
}

/*
RewriteTag renames a tag, or removes it when `to` is empty, on every bookmark
that carries it.

Config did this by reading every page, changing the list in the browser and
writing every page back -- including the pages that never had the tag -- from a
copy that could already be out of date. This changes only the rows with the tag,
under the store lock, and says which rows those were and what they carried, so
the change can be undone.
*/
func (h *Handlers) RewriteTag(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	from := normalizeTags([]string{req.From})
	if len(from) == 0 {
		http.Error(w, "from is required", http.StatusBadRequest)
		return
	}
	to := normalizeTags([]string{req.To})

	pageIDs := make([]int, 0)
	seen := map[int]bool{}
	for _, b := range h.store.GetAllBookmarks() {
		if !seen[b.PageID] {
			seen[b.PageID] = true
			pageIDs = append(pageIDs, b.PageID)
		}
	}
	changedRows := make([]map[string]any, 0)
	now := time.Now().UnixMilli()
	err := h.store.MutateBookmarkPages(pageIDs, func(pages map[int][]Bookmark) (map[int][]Bookmark, error) {
		changedRows = changedRows[:0]
		out := make(map[int][]Bookmark)
		for id, list := range pages {
			touched := false
			for i := range list {
				tags := normalizeTags(list[i].Tags)
				has := false
				next := make([]string, 0, len(tags))
				for _, tag := range tags {
					if tag == from[0] {
						has = true
						continue
					}
					next = append(next, tag)
				}
				if !has {
					continue
				}
				changedRows = append(changedRows, map[string]any{
					"pageId": id, "url": list[i].URL, "tags": append([]string(nil), list[i].Tags...),
				})
				if len(to) > 0 {
					next = append(next, to[0])
				}
				list[i].Tags = normalizeTags(next)
				list[i].UpdatedAt = now
				touched = true
			}
			if touched {
				out[id] = list
			}
		}
		return out, nil
	})
	if !respondStorePersistError(w, err) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "success",
		"changed": changedRows,
	})
}
