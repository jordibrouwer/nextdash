package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// bookmarkPatch names one row by URL and the fields to change on it. Absent
// fields are left alone; tags are added and removed rather than replaced, so
// two edits to the same row made from lists read at different moments both
// land.
type bookmarkPatch struct {
	URL string `json:"url"`
	// Occurrence names the n-th row with this URL, for a page that still holds
	// the same link twice from before duplicates were refused.
	Occurrence   int      `json:"occurrence,omitempty"`
	AddTags      []string `json:"addTags,omitempty"`
	RemoveTags   []string `json:"removeTags,omitempty"`
	PreviewTitle *string  `json:"previewTitle,omitempty"`
	PreviewDesc  *string  `json:"previewDesc,omitempty"`
	PreviewImage *string  `json:"previewImage,omitempty"`
	Icon         *string  `json:"icon,omitempty"`
	// SetURL, Name and Note put a row back the way it was -- the undo of a
	// health fix that pointed it somewhere else. A new URL drops the check
	// result, which described the other address.
	SetURL *string `json:"setUrl,omitempty"`
	Name   *string `json:"name,omitempty"`
	Note   *string `json:"note,omitempty"`
	// Fields is any set of the row's own fields, merged in as given: what
	// Config's editors and bulk edits change, and what their undo puts back.
	// Fields the server keeps (counts, check results, drift) are ignored.
	Fields map[string]json.RawMessage `json:"fields,omitempty"`
}

// serverOwnedBookmarkFields are written by the server alone: opens, checks,
// drift and archive bookkeeping. A client's `fields` never sets them.
var serverOwnedBookmarkFields = map[string]bool{
	"pageId": true, "createdAt": true, "updatedAt": true, "lastOpened": true,
	"lastChecked": true, "lastError": true, "openCount": true, "brokenSince": true,
	"archiveDiedAt": true, "archiveSnapshotUrl": true, "archiveCheckedAt": true,
	"archiveJobId": true, "archiveJobAt": true, "driftUrl": true, "driftTitle": true,
	"driftFingerprint": true, "driftNoticed": true, "driftSince": true, "driftReason": true,
}

// bookmarkConflict is a patch the page cannot take: a URL already on it, or a
// shortcut another bookmark holds. Returned from inside the store mutation so
// nothing is written, and answered as a 409 naming what it collided with.
type bookmarkConflict struct {
	Kind     string
	URL      string
	Shortcut string
	With     Bookmark
}

func (c *bookmarkConflict) Error() string { return c.Kind }

func respondBookmarkConflict(w http.ResponseWriter, h *Handlers, c *bookmarkConflict) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusConflict)
	json.NewEncoder(w).Encode(map[string]any{
		"error":    c.Kind,
		"url":      c.URL,
		"shortcut": c.Shortcut,
		"conflict": map[string]any{
			"name":     c.With.Name,
			"url":      c.With.URL,
			"pageId":   c.With.PageID,
			"pageName": pageNameForID(h.store, c.With.PageID),
		},
	})
}

// mergeBookmarkFields overlays the allowed fields onto a copy of the row.
func mergeBookmarkFields(bookmark Bookmark, fields map[string]json.RawMessage) (Bookmark, error) {
	raw, err := json.Marshal(bookmark)
	if err != nil {
		return bookmark, err
	}
	merged := map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &merged); err != nil {
		return bookmark, err
	}
	for key, value := range fields {
		if serverOwnedBookmarkFields[key] {
			continue
		}
		merged[key] = value
	}
	out, err := json.Marshal(merged)
	if err != nil {
		return bookmark, err
	}
	var next Bookmark
	if err := json.Unmarshal(out, &next); err != nil {
		return bookmark, err
	}
	next.Tags = normalizeTags(next.Tags)
	next.Icon = sanitizeBookmarkIcon(next.Icon)
	next.Shortcut = normalizeShortcut(next.Shortcut)
	trimBookmarkTextFields(&next)
	if strings.TrimSpace(next.URL) == "" {
		next.URL = bookmark.URL
	}
	if strings.TrimSpace(next.Name) == "" {
		next.Name = bookmark.Name
	}
	return next, nil
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
	rowKey := func(url string, occurrence int) string {
		key := canonicalBookmarkURLKey(url)
		if key == "" || occurrence <= 0 {
			return key
		}
		return fmt.Sprintf("%s#%d", key, occurrence)
	}
	for _, update := range request.Updates {
		key := rowKey(update.URL, update.Occurrence)
		if key == "" {
			continue
		}
		if _, seen := byKey[key]; !seen {
			order = append(order, key)
		}
		byKey[key] = update
	}

	for _, update := range byKey {
		if update.SetURL != nil {
			if err := h.validateBookmarkURL(strings.TrimSpace(*update.SetURL)); err != nil {
				http.Error(w, "Invalid setUrl", http.StatusBadRequest)
				return
			}
		}
		if raw, ok := update.Fields["url"]; ok {
			var next string
			if json.Unmarshal(raw, &next) != nil || h.validateBookmarkURL(strings.TrimSpace(next)) != nil {
				http.Error(w, "Invalid url in fields", http.StatusBadRequest)
				return
			}
		}
	}
	// Read before the lock is taken: GetAllBookmarks takes it too. A shortcut
	// is checked against every other page, as SaveBookmarks does.
	otherPages := make([]Bookmark, 0)
	for _, existing := range h.store.GetAllBookmarks() {
		if existing.PageID != request.Page {
			otherPages = append(otherPages, existing)
		}
	}

	applied := make(map[string]bool, len(byKey))
	now := time.Now().UnixMilli()
	err := h.store.MutateBookmarksOnPage(request.Page, func(bookmarks []Bookmark) ([]Bookmark, error) {
		for k := range applied {
			delete(applied, k)
		}
		next := make([]Bookmark, len(bookmarks))
		copy(next, bookmarks)
		keys := make([]string, len(next))
		seen := make(map[string]int, len(next))
		for i := range next {
			base := canonicalBookmarkURLKey(next[i].URL)
			keys[i] = rowKey(next[i].URL, seen[base])
			seen[base]++
		}
		for i := range next {
			key := keys[i]
			update, ok := byKey[key]
			if !ok || applied[key] {
				continue
			}
			if len(update.Fields) > 0 {
				merged, err := mergeBookmarkFields(next[i], update.Fields)
				if err != nil {
					return nil, err
				}
				merged.UpdatedAt = now
				next[i] = merged
			}
			applyBookmarkPatch(&next[i], update)
			applied[key] = true
		}
		// The page as it would be written: one URL per page, one owner per
		// shortcut across the collection.
		// Only the rows this patch changed are held to it, so a page that
		// already carries an old duplicate can still be edited elsewhere.
		changed := func(i int) bool {
			return applied[keys[i]]
		}
		for i, row := range next {
			if !changed(i) {
				continue
			}
			// And only for what it changed: a name edit on a row that already
			// shares a shortcut is not the edit that made the clash.
			key := canonicalBookmarkURLKey(row.URL)
			if key == canonicalBookmarkURLKey(bookmarks[i].URL) {
				key = ""
			}
			sc := normalizeShortcut(row.Shortcut)
			if sc == normalizeShortcut(bookmarks[i].Shortcut) {
				sc = ""
			}
			for j, other := range next {
				if j == i {
					continue
				}
				if key != "" && canonicalBookmarkURLKey(other.URL) == key {
					return nil, &bookmarkConflict{Kind: "duplicate_url", URL: row.URL, With: other}
				}
				if sc != "" && normalizeShortcut(other.Shortcut) == sc {
					return nil, &bookmarkConflict{Kind: "duplicate_shortcut", URL: row.URL, Shortcut: sc, With: other}
				}
			}
			if hit := findShortcutConflictWithExisting(otherPages, sc); hit != nil {
				return nil, &bookmarkConflict{Kind: "duplicate_shortcut", URL: row.URL, Shortcut: sc, With: *hit}
			}
		}
		return next, nil
	})
	var conflict *bookmarkConflict
	if errors.As(err, &conflict) {
		respondBookmarkConflict(w, h, conflict)
		return
	}
	if !respondStorePersistError(w, err) {
		return
	}
	if len(applied) > 0 {
		h.invalidateHealthReportCache()
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
	if update.Icon != nil {
		bookmark.Icon = sanitizeBookmarkIcon(*update.Icon)
	}
	if update.Name != nil {
		bookmark.Name = strings.TrimSpace(*update.Name)
	}
	if update.Note != nil {
		bookmark.Note = strings.TrimSpace(*update.Note)
	}
	if update.SetURL != nil {
		next := strings.TrimSpace(*update.SetURL)
		if next != "" && next != bookmark.URL {
			bookmark.URL = next
			bookmark.LastChecked = 0
			bookmark.LastError = ""
		}
	}
}
