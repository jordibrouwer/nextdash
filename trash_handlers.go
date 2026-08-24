package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

func (h *Handlers) GetTrash(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	items := h.store.GetTrashItems()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"items":         items,
		"count":         len(items),
		"retentionDays": int(trashRetention.Hours() / 24),
		"maxItems":      trashMaxItems,
	})
}

// AddTrashItems records bookmarks the client has just deleted.
//
// The dashboard deletes by rewriting the whole page through SaveBookmarksByPage,
// not through DELETE /api/bookmarks, so the server never sees an individual
// delete and cannot capture the trash entry itself. The client therefore reports
// what it removed. That also keeps one code path for single, bulk and
// tag-filter deletes, which all end in the same page rewrite.
func (h *Handlers) AddTrashItems(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var request struct {
		Source string            `json:"source"`
		Items  []TrashedBookmark `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if len(request.Items) == 0 {
		http.Error(w, "No items", http.StatusBadRequest)
		return
	}

	pageNames := make(map[int]string)
	for _, page := range h.store.GetPages() {
		pageNames[page.ID] = page.Name
	}

	source := strings.TrimSpace(request.Source)
	entries := make([]TrashedBookmark, 0, len(request.Items))
	for _, item := range request.Items {
		if item.PageName == "" {
			item.PageName = pageNames[item.PageID]
		}
		if item.Source == "" {
			item.Source = source
		}
		// Pages are captured server-side in DeletePage, where the data still
		// exists. Accepting one here would let a client write an arbitrary page
		// into the trash and then "restore" it into being.
		if trashKindOf(item) == TrashKindPage {
			http.Error(w, "Pages are recorded by the delete endpoint", http.StatusBadRequest)
			return
		}
		if trashKindOf(item) == TrashKindCategory && item.TrashedCategory == nil {
			http.Error(w, "Category entry is missing its category data", http.StatusBadRequest)
			return
		}
		// A bookmark recorded here is stored verbatim and spliced straight back
		// onto the page by RestoreTrashItem, so it has to clear the same bar as
		// the add path -- the same hole PutInboxItem closed for the inbox.
		// Without this, trash-then-restore is the one route that can store a
		// javascript: URL, a private address under allowLocalBookmarks:false, or
		// a client-chosen Icon path.
		if trashKindOf(item) == TrashKindBookmark {
			trimmedURL := strings.TrimSpace(item.Bookmark.URL)
			if err := h.validateBookmarkURL(trimmedURL); err != nil {
				http.Error(w, fmt.Sprintf("Invalid URL: %v", err), http.StatusBadRequest)
				return
			}
			item.Bookmark.URL = trimmedURL
			item.Bookmark.Icon = sanitizeBookmarkIcon(item.Bookmark.Icon)
		}
		entries = append(entries, item)
	}

	if !respondStorePersistError(w, h.store.AddTrashedBookmarks(entries)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"status": "success", "count": len(entries)})
}

// RestoreTrashItem puts a bookmark back on its page and drops it from the trash.
//
// The item is taken out of the trash first, then written back to the page. If
// the page write fails the item is returned to the trash, so a failure never
// destroys the only copy.
func (h *Handlers) RestoreTrashItem(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var request struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	id := strings.TrimSpace(request.ID)
	if id == "" {
		http.Error(w, "Missing id", http.StatusBadRequest)
		return
	}

	// A page that no longer exists is caught by the restore write below, which
	// fails with ErrBookmarkNotFound and returns the item to the trash.
	item, err := h.store.TakeTrashItem(id)
	if err != nil {
		if errors.Is(err, ErrTrashItemNotFound) {
			http.Error(w, "Trash item not found", http.StatusNotFound)
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		return
	}

	switch trashKindOf(item) {
	case TrashKindPage:
		h.restoreTrashedPage(w, r, item)
		return
	case TrashKindCategory:
		h.restoreTrashedCategory(w, r, item)
		return
	}

	restoreErr := h.store.MutateBookmarksOnPage(item.PageID, func(bookmarks []Bookmark) ([]Bookmark, error) {
		// The stored index is a hint from delete time; clamp it rather than
		// trusting it, since the page has been writable in between.
		at := item.Index
		if at < 0 || at > len(bookmarks) {
			at = len(bookmarks)
		}
		restored := make([]Bookmark, 0, len(bookmarks)+1)
		restored = append(restored, bookmarks[:at]...)
		restored = append(restored, item.Bookmark)
		restored = append(restored, bookmarks[at:]...)
		return restored, nil
	})

	if restoreErr != nil {
		// Put it back so a failed restore is not a second deletion.
		_ = h.store.AddTrashedBookmarks([]TrashedBookmark{item})
		if errors.Is(restoreErr, ErrBookmarkNotFound) {
			http.Error(w, "Original page no longer exists", http.StatusConflict)
			return
		}
		if !respondStorePersistError(w, restoreErr) {
			return
		}
		return
	}

	logBookmarkRestore(item, r)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":   "success",
		"bookmark": item.Bookmark,
		"pageId":   item.PageID,
	})
}

// restoreTrashedPage recreates a deleted page at its original id, with the
// categories and bookmarks it had.
//
// The id matters: every bookmark's pageId points at it, and the page order and
// per-page settings key off it too. Restoring under a fresh id would produce a
// page that looks right and is referenced by nothing.
//
// The item has already been taken out of the trash by the caller, so every
// failure path puts it back.
func (h *Handlers) restoreTrashedPage(w http.ResponseWriter, r *http.Request, item TrashedBookmark) {
	snapshot := item.TrashedPage
	if snapshot == nil {
		// A page entry with no payload cannot be restored and would otherwise be
		// silently consumed. Put it back and say so.
		_ = h.store.AddTrashedBookmarks([]TrashedBookmark{item})
		http.Error(w, "Trash entry is missing its page data", http.StatusUnprocessableEntity)
		return
	}

	if err := h.store.RestorePage(*snapshot); err != nil {
		_ = h.store.AddTrashedBookmarks([]TrashedBookmark{item})
		if errors.Is(err, ErrPageExists) {
			http.Error(w, "A page with that id already exists", http.StatusConflict)
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		return
	}

	logPageRestore(item, r)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":    "success",
		"kind":      TrashKindPage,
		"pageId":    snapshot.Page.ID,
		"page":      snapshot.Page,
		"bookmarks": len(snapshot.Bookmarks),
	})
}

// restoreTrashedCategory puts a category definition back on its page.
//
// Its bookmarks were never removed — deleting a category leaves them on the
// page under "unknown category" — so this only writes the definition back, at
// the position it held.
func (h *Handlers) restoreTrashedCategory(w http.ResponseWriter, r *http.Request, item TrashedBookmark) {
	snapshot := item.TrashedCategory
	if snapshot == nil {
		_ = h.store.AddTrashedBookmarks([]TrashedBookmark{item})
		http.Error(w, "Trash entry is missing its category data", http.StatusUnprocessableEntity)
		return
	}

	// A page that is gone cannot hold the category. Refuse rather than recreate
	// the page as a side effect of a category restore.
	pageExists := false
	for _, page := range h.store.GetPages() {
		if page.ID == item.PageID {
			pageExists = true
			break
		}
	}
	if !pageExists {
		_ = h.store.AddTrashedBookmarks([]TrashedBookmark{item})
		http.Error(w, "Original page no longer exists", http.StatusConflict)
		return
	}

	existing := h.store.GetCategoriesByPage(item.PageID)
	for _, category := range existing {
		if category.ID == snapshot.Category.ID {
			// Already back — most likely the 8s undo won the race. Consuming the
			// entry is correct: the category is present, which is what was asked.
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"status":   "success",
				"kind":     TrashKindCategory,
				"pageId":   item.PageID,
				"category": snapshot.Category,
			})
			return
		}
	}

	at := snapshot.Index
	if at < 0 || at > len(existing) {
		at = len(existing)
	}
	restored := make([]Category, 0, len(existing)+1)
	restored = append(restored, existing[:at]...)
	restored = append(restored, snapshot.Category)
	restored = append(restored, existing[at:]...)

	if err := h.store.SaveCategoriesByPage(item.PageID, restored); err != nil {
		_ = h.store.AddTrashedBookmarks([]TrashedBookmark{item})
		if !respondStorePersistError(w, err) {
			return
		}
		return
	}

	logCategoryRestore(item, r)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":   "success",
		"kind":     TrashKindCategory,
		"pageId":   item.PageID,
		"category": snapshot.Category,
	})
}

// DeleteTrashItem permanently removes one item, or the whole trash when the
// request asks to empty it.
func (h *Handlers) DeleteTrashItem(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var request struct {
		ID  string `json:"id"`
		All bool   `json:"all"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if request.All {
		count, err := h.store.EmptyTrash()
		if !respondStorePersistError(w, err) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "success", "count": count})
		return
	}

	id := strings.TrimSpace(request.ID)
	if id == "" {
		http.Error(w, "Missing id", http.StatusBadRequest)
		return
	}
	if err := h.store.DeleteTrashItem(id); err != nil {
		if errors.Is(err, ErrTrashItemNotFound) {
			http.Error(w, "Trash item not found", http.StatusNotFound)
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"status": "success", "count": 1})
}
