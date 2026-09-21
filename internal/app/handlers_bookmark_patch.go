package app

import (
	"encoding/json"
	"net/http"
	"strings"
)

// bookmarkPatch names one row by URL and the fields to change on it. Absent
// fields are left alone; tags are added and removed rather than replaced, so
// two edits to the same row made from lists read at different moments both
// land.
type bookmarkPatch struct {
	URL          string   `json:"url"`
	AddTags      []string `json:"addTags,omitempty"`
	RemoveTags   []string `json:"removeTags,omitempty"`
	PreviewTitle *string  `json:"previewTitle,omitempty"`
	PreviewDesc  *string  `json:"previewDesc,omitempty"`
	PreviewImage *string  `json:"previewImage,omitempty"`
}

/*
PatchBookmarks changes named rows on one page in place.

POST /api/bookmarks replaces a whole page with a list the browser read a moment
earlier, which is right for an editor holding the page but wrong for a view
that only wants to tag a few rows or keep a fetched preview: anything written
in between -- a move, a delete, another tag -- is put back the way the browser
last saw it. This reads and writes inside the store lock and touches only the
rows it names. Rows that are gone are reported, not recreated.
*/
func (h *Handlers) PatchBookmarks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var request struct {
		Page    int             `json:"page"`
		Updates []bookmarkPatch `json:"updates"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if request.Page == 0 {
		http.Error(w, "Page ID is required", http.StatusBadRequest)
		return
	}

	byKey := make(map[string]bookmarkPatch, len(request.Updates))
	order := make([]string, 0, len(request.Updates))
	for _, update := range request.Updates {
		key := canonicalBookmarkURLKey(update.URL)
		if key == "" {
			continue
		}
		if _, seen := byKey[key]; !seen {
			order = append(order, key)
		}
		byKey[key] = update
	}

	applied := make(map[string]bool, len(byKey))
	err := h.store.MutateBookmarksOnPage(request.Page, func(bookmarks []Bookmark) ([]Bookmark, error) {
		for i := range bookmarks {
			key := canonicalBookmarkURLKey(bookmarks[i].URL)
			update, ok := byKey[key]
			if !ok || applied[key] {
				continue
			}
			applyBookmarkPatch(&bookmarks[i], update)
			applied[key] = true
		}
		return bookmarks, nil
	})
	if !respondStorePersistError(w, err) {
		return
	}

	missing := make([]string, 0)
	for _, key := range order {
		if !applied[key] {
			missing = append(missing, byKey[key].URL)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "success",
		"updated": len(applied),
		"missing": missing,
	})
}

func applyBookmarkPatch(bookmark *Bookmark, update bookmarkPatch) {
	if len(update.AddTags) > 0 || len(update.RemoveTags) > 0 {
		remove := make(map[string]struct{}, len(update.RemoveTags))
		for _, tag := range normalizeTags(update.RemoveTags) {
			remove[tag] = struct{}{}
		}
		kept := make([]string, 0, len(bookmark.Tags)+len(update.AddTags))
		for _, tag := range normalizeTags(bookmark.Tags) {
			if _, drop := remove[tag]; !drop {
				kept = append(kept, tag)
			}
		}
		bookmark.Tags = normalizeTags(append(kept, update.AddTags...))
	}
	if update.PreviewTitle != nil {
		bookmark.PreviewTitle = strings.TrimSpace(*update.PreviewTitle)
	}
	if update.PreviewDesc != nil {
		bookmark.PreviewDesc = strings.TrimSpace(*update.PreviewDesc)
	}
	if update.PreviewImage != nil {
		bookmark.PreviewImage = strings.TrimSpace(*update.PreviewImage)
	}
}
