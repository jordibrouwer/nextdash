package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Name/Category/Note were stored verbatim while Tags/Icon were already
// trimmed/normalized at the same call sites — a copy-pasted URL with
// surrounding whitespace in the name field would persist with it.

func TestAddBookmarkTrimsTextFields(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	body, _ := json.Marshal(map[string]any{
		"page": 1,
		"bookmark": map[string]any{
			"name":     "  Padded Name  ",
			"url":      "https://example.com/trim-add",
			"category": "  work  ",
			"note":     "  a note  ",
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/add", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.AddBookmark(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	bookmarks := store.GetBookmarksByPage(1)
	var found *Bookmark
	for i := range bookmarks {
		if bookmarks[i].URL == "https://example.com/trim-add" {
			found = &bookmarks[i]
			break
		}
	}
	if found == nil {
		t.Fatal("bookmark not found after add")
	}
	if found.Name != "Padded Name" {
		t.Fatalf("Name = %q, want trimmed", found.Name)
	}
	if found.Category != "work" {
		t.Fatalf("Category = %q, want trimmed", found.Category)
	}
	if found.Note != "a note" {
		t.Fatalf("Note = %q, want trimmed", found.Note)
	}
}

func TestSaveBookmarksTrimsTextFields(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	body, _ := json.Marshal([]map[string]any{
		{
			"name":     " Padded Save ",
			"url":      "https://example.com/trim-save",
			"category": " work ",
			"note":     " noted ",
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks?page=1", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.SaveBookmarks(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	bookmarks := store.GetBookmarksByPage(1)
	if len(bookmarks) != 1 {
		t.Fatalf("bookmarks = %+v, want 1", bookmarks)
	}
	if bookmarks[0].Name != "Padded Save" {
		t.Fatalf("Name = %q, want trimmed", bookmarks[0].Name)
	}
	if bookmarks[0].Category != "work" {
		t.Fatalf("Category = %q, want trimmed", bookmarks[0].Category)
	}
	if bookmarks[0].Note != "noted" {
		t.Fatalf("Note = %q, want trimmed", bookmarks[0].Note)
	}
}
