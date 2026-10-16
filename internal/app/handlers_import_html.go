package app

import (
	"encoding/json"
	"fmt"
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
		preview := h.previewImport(pageID, rows)
		preview.Inbox = h.previewInboxImport(rows)
		writeJSON(w, preview)
		return
	}

	if importToInbox(r) {
		h.importRowsToInbox(w, r, rows)
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
	// The same rows counted against the inbox, so the question "onto the
	// page or into the inbox?" can say what each answer would do. Only on a
	// dry run.
	Inbox *ImportPreview `json:"inbox,omitempty"`
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

/*
importToInbox says whether the reader sent this import to the inbox rather
than onto a page. Every import asks (a backup restore does not), and the answer
travels as ?inbox=1 on whichever route did the reading.
*/
func importToInbox(r *http.Request) bool {
	return r.URL.Query().Get("inbox") == "1"
}

/*
inboxKnownURLs is what an import into the inbox counts as "already here": the
inbox itself and the whole dashboard. The inbox is where links wait to be
sorted onto a page, and one the dashboard already holds has nowhere left to go.
*/
func (h *Handlers) inboxKnownURLs() map[string]struct{} {
	bookmarks := h.store.GetAllBookmarks()
	items := h.store.GetInboxItems()
	known := make(map[string]struct{}, len(bookmarks)+len(items))
	for _, b := range bookmarks {
		known[canonicalBookmarkURLKey(b.URL)] = struct{}{}
	}
	for _, it := range items {
		known[canonicalBookmarkURLKey(it.URL)] = struct{}{}
	}
	return known
}

// previewInboxImport is previewImport for the inbox answer. Folders stay zero:
// in the inbox they become tags, not categories.
func (h *Handlers) previewInboxImport(rows []ImportedRow) *ImportPreview {
	known := h.inboxKnownURLs()
	preview := ImportPreview{Total: len(rows)}
	for _, row := range rows {
		key := canonicalBookmarkURLKey(row.URL)
		if _, dup := known[key]; dup {
			preview.Duplicates++
			continue
		}
		known[key] = struct{}{}
		preview.New++
	}
	return &preview
}

/*
inboxLinkFromRow turns an imported row into an inbox link.

The inbox has no categories -- a link gets one when it is filed onto a page --
so the folder the file kept it in becomes a tag, and the reader sorting the
inbox still sees where it used to live.
*/
func inboxLinkFromRow(row ImportedRow) InboxLink {
	tags := append([]string(nil), row.Tags...)
	if folder := strings.TrimSpace(row.Category); folder != "" {
		tags = append(tags, strings.Join(strings.Fields(folder), "-"))
	}
	return InboxLink{
		URL:    strings.TrimSpace(row.URL),
		Title:  strings.TrimSpace(row.Name),
		Note:   strings.TrimSpace(row.Note),
		Tags:   tags,
		Source: "import",
	}
}

/*
importRowsToInbox is importRows for the inbox answer, with the same reply.

No preview is fetched per link, as a single add does: a file of a few thousand
would start a few thousand fetches at once. The startup backfill fetches the
icons later, as it does for any item that has none.
*/
func (h *Handlers) importRowsToInbox(w http.ResponseWriter, r *http.Request, rows []ImportedRow) {
	known := h.inboxKnownURLs()
	links := make([]InboxLink, 0, len(rows))
	invalid, skipped := 0, 0
	for _, row := range rows {
		url := strings.TrimSpace(row.URL)
		if url == "" || h.validateBookmarkURL(url) != nil || inboxURLTooLong(url) {
			invalid++
			continue
		}
		key := canonicalBookmarkURLKey(url)
		if _, dup := known[key]; dup {
			skipped++
			continue
		}
		known[key] = struct{}{}
		links = append(links, inboxLinkFromRow(row))
	}

	added, err := h.store.AddInboxLinks(links)
	if !respondStorePersistError(w, err) {
		return
	}
	// Added to the inbox since it was read: already there, as a skip is.
	skipped += len(links) - len(added)

	events := make([]InboxEvent, 0, len(added))
	for _, link := range added {
		events = append(events, InboxEvent{Type: inboxEventAdded, Source: link.Source, AtMs: link.AddedAt})
	}
	h.store.RecordInboxEvents(events)

	writeJSON(w, map[string]int{"imported": len(added), "skipped": skipped, "invalid": invalid})
	logActivity(activityCategoryMutate, "bookmark.import_inbox", mergeActivityFields(activityFieldsFromRequest(r), map[string]any{
		"imported": len(added),
		"skipped":  skipped,
	}), fmt.Sprintf("imported %d bookmarks into the inbox, %d skipped", len(added), skipped))
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
