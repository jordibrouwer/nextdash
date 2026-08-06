package main

import (
	"encoding/json"
	"errors"
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
