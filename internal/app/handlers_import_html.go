package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

/*
Import and export the file every browser and bookmark service speaks.

The browser used to parse the file and post {name, url, category}; the parser
now lives in netscape.go and the browser posts the file itself. That is the
whole difference, and it is why an import finally keeps the tags, the notes and
the dates the export always carried.

The old JSON route stays exactly as it was: the extension posts to it, and so
does the CSV import. Both feed the same importRows(), so a row arriving as
parsed HTML and a row arriving as JSON are written by identical code.
*/

// maxImportBytes bounds the upload. A bookmark file of a few thousand links is
// under a megabyte; ten is already a collection nobody has, and reading an
// unbounded body into memory is how a server falls over.
const maxImportBytes = 32 << 20

// ImportBookmarksHTML takes an exported bookmark file and writes what it holds.
func (h *Handlers) ImportBookmarksHTML(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	pageID, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("page")))
	if err != nil || pageID <= 0 {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	body := http.MaxBytesReader(w, r.Body, maxImportBytes)
	parsed, err := ParseNetscapeBookmarks(body)
	if err != nil {
		http.Error(w, "Could not read that bookmark file", http.StatusBadRequest)
		return
	}

	rows := make([]ImportedRow, 0, len(parsed))
	for _, bm := range parsed {
		row := ImportedRow{
			Name:      bm.Name,
			URL:       bm.URL,
			Category:  bm.Folder,
			Note:      bm.Note,
			Tags:      bm.Tags,
			CreatedAt: bm.CreatedAt,
			UpdatedAt: bm.UpdatedAt,
		}
		// nextDash has no read state, so TOREAD becomes a tag rather than a
		// field invented for one importer. It is the same answer linkding and
		// Karakeep give, and it is searchable the day it lands.
		if bm.ToRead {
			row.Tags = append(row.Tags, "toread")
		}
		rows = append(rows, row)
	}

	// A dry run answers what would happen and writes nothing. The confirm the
	// reader sees is built from this, so the number in it comes from the same
	// parse that will do the work rather than from a second one in the browser
	// -- and it can say how many are already here, which a total never could.
	if r.URL.Query().Get("dryRun") == "1" {
		writeJSON(w, h.previewImport(pageID, rows))
		return
	}

	h.importRows(w, r, pageID, rows)
}

// ImportPreview is what a dry run answers: what would happen, and nothing done.
type ImportPreview struct {
	New        int `json:"new"`
	Duplicates int `json:"duplicates"`
	Folders    int `json:"folders"`
	Total      int `json:"total"`
}

/*
previewImport counts a set of rows against what a page already holds.

Shared rather than inlined in the HTML handler, because every source in cluster A
owes the reader the same sentence before it writes anything -- and a second
implementation of "already here" is a second definition of it. Dedupe is on
canonicalBookmarkURLKey, the key the duplicate detection and the extension
already use, so "already here" means one thing everywhere.
*/
func (h *Handlers) previewImport(pageID int, rows []ImportedRow) ImportPreview {
	existing := h.store.GetBookmarksByPage(pageID)
	known := make(map[string]struct{}, len(existing))
	for _, b := range existing {
		known[canonicalBookmarkURLKey(b.URL)] = struct{}{}
	}

	preview := ImportPreview{Total: len(rows)}
	folders := map[string]struct{}{}
	for _, row := range rows {
		key := canonicalBookmarkURLKey(row.URL)
		if _, dup := known[key]; dup {
			preview.Duplicates++
			continue
		}
		// Counted as new only once: a file listing the same address twice
		// imports it once, so the preview must say so too.
		known[key] = struct{}{}
		preview.New++
		if row.Category != "" {
			folders[row.Category] = struct{}{}
		}
	}
	return preview
}

// writeJSON is the one-liner every handler here ends with.
func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

// ExportBookmarksHTML writes the whole collection back out in the same format.
//
// Grouped by page and then by category: a page is a bigger idea than a folder,
// so it becomes the outer name, and a reader importing the file elsewhere gets
// folders that mean what they meant here.
func (h *Handlers) ExportBookmarksHTML(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	var groups []NetscapeFolder
	for _, page := range h.store.GetPages() {
		byCategory := map[string][]NetscapeBookmark{}
		var order []string

		categoryNames := map[string]string{}
		for _, c := range h.store.GetCategoriesByPage(page.ID) {
			categoryNames[c.ID] = c.Name
		}

		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			name := categoryNames[bm.Category]
			if name == "" {
				name = bm.Category
			}
			label := page.Name
			if name != "" {
				label = page.Name + " / " + name
			}
			if _, seen := byCategory[label]; !seen {
				order = append(order, label)
			}
			byCategory[label] = append(byCategory[label], NetscapeBookmark{
				Name:      bm.Name,
				URL:       bm.URL,
				Tags:      bm.Tags,
				Note:      bm.Note,
				CreatedAt: bm.CreatedAt,
				UpdatedAt: bm.UpdatedAt,
			})
		}

		for _, label := range order {
			groups = append(groups, NetscapeFolder{Name: label, Bookmarks: byCategory[label]})
		}
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="nextdash-bookmarks.html"`)
	if err := WriteNetscapeBookmarks(w, groups); err != nil {
		// The header and the first bytes are already out, so a failure here can
		// only be recorded, never reported to the caller.
		logActivity(activityCategoryMutate, "bookmarks.export_html_failed", map[string]any{
			"error": err.Error(),
		}, "the bookmark export was cut short; the downloaded file is incomplete")
	}
}
