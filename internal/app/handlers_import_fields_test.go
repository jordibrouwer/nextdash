package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The CSV import sends tags, a note and a shortcut per row -- it always has,
// and MANUAL names exactly that as the reason to use it over the browser file:
// "unlike the browser-HTML import this route carries tags and notes".
//
// The request struct on the server carried three fields, so encoding/json threw
// the rest away without a word. A spreadsheet round-trip -- export, bulk-add
// tags, import -- came back with none of them, and nothing reported a failure
// because nothing had failed: the fields were simply never read.
func TestImportBrowserBookmarksKeepsTagsNoteAndShortcut(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	body, _ := json.Marshal(map[string]any{
		"pageId": 1,
		"bookmarks": []map[string]any{{
			"name":     "Spreadsheet row",
			"url":      "https://import-fields.example.com/",
			"category": "Development",
			// Deliberately untidy, so the assertions below prove the row goes
			// through the same normalisers a typed bookmark does rather than
			// being stored verbatim.
			"tags":     []string{"Alpha", " beta ", "alpha", ""},
			"note":     "  a note from the spreadsheet  ",
			"shortcut": " cp ",
		}},
	})

	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/import-browser", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ImportBrowserBookmarks(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import status = %d, want 200", rec.Code)
	}

	var stored *Bookmark
	for i, bm := range store.GetBookmarksByPage(1) {
		if bm.URL == "https://import-fields.example.com/" {
			stored = &store.GetBookmarksByPage(1)[i]
			break
		}
	}
	if stored == nil {
		t.Fatal("the imported bookmark is not on page 1")
	}

	if got := len(stored.Tags); got != 2 {
		t.Fatalf("tags = %v, want two normalized tags", stored.Tags)
	}
	if stored.Tags[0] != "alpha" || stored.Tags[1] != "beta" {
		t.Errorf("tags = %v, want [alpha beta] -- lowercased, trimmed, de-duplicated", stored.Tags)
	}
	if stored.Note != "a note from the spreadsheet" {
		t.Errorf("note = %q, want it trimmed and kept", stored.Note)
	}
	if stored.Shortcut != "CP" {
		t.Errorf("shortcut = %q, want %q", stored.Shortcut, "CP")
	}
}

// A row that carries none of them must not gain empty values: an absent tag
// list is nil, not an empty array, or every import would write a field the
// bookmark did not have.
func TestImportBrowserBookmarksLeavesAbsentFieldsAlone(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	body, _ := json.Marshal(map[string]any{
		"pageId": 1,
		"bookmarks": []map[string]any{{
			"name": "Bare row",
			"url":  "https://import-bare.example.com/",
		}},
	})

	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/import-browser", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ImportBrowserBookmarks(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import status = %d, want 200", rec.Code)
	}

	for _, bm := range store.GetBookmarksByPage(1) {
		if bm.URL != "https://import-bare.example.com/" {
			continue
		}
		if len(bm.Tags) != 0 {
			t.Errorf("tags = %v, want none", bm.Tags)
		}
		if bm.Note != "" || bm.Shortcut != "" {
			t.Errorf("note = %q, shortcut = %q, want both empty", bm.Note, bm.Shortcut)
		}
		return
	}
	t.Fatal("the imported bookmark is not on page 1")
}
