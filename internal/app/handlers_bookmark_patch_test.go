package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A whole-page POST built from a list read a moment earlier puts back rows
// that were moved or deleted in between. PatchBookmarks touches only the rows
// it names, inside the store lock, so two writers no longer undo each other.

func patchTestHandlers(t *testing.T) (*Handlers, Store) {
	t.Helper()
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)
	store := NewStore()
	return NewHandlers(store, embeddedFiles), store
}

func doPatch(t *testing.T, h *Handlers, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPatch, "/api/bookmarks", bytes.NewReader(raw))
	rec := httptest.NewRecorder()
	h.PatchBookmarks(rec, req)
	return rec
}

func findByURL(list []Bookmark, url string) *Bookmark {
	for i := range list {
		if list[i].URL == url {
			return &list[i]
		}
	}
	return nil
}

func TestPatchBookmarksLeavesOtherRowsAlone(t *testing.T) {
	h, store := patchTestHandlers(t)
	if err := store.SaveBookmarksByPage(7, []Bookmark{
		{Name: "A", URL: "https://a.example/", Tags: []string{"old"}},
		{Name: "B", URL: "https://b.example/"},
	}); err != nil {
		t.Fatal(err)
	}
	// B is deleted by someone else after the client read the page.
	if err := store.DeleteBookmarkFromPage(7, Bookmark{URL: "https://b.example/"}); err != nil {
		t.Fatal(err)
	}

	rec := doPatch(t, h, map[string]any{
		"page": 7,
		"updates": []map[string]any{
			{"url": "https://a.example/", "addTags": []string{"New"}, "removeTags": []string{"old"}, "previewTitle": "Title A"},
			{"url": "https://b.example/", "addTags": []string{"x"}},
		},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	after := store.GetBookmarksByPage(7)
	if len(after) != 1 {
		t.Fatalf("rows = %d, want 1 (deleted row must not come back)", len(after))
	}
	a := findByURL(after, "https://a.example/")
	if a == nil {
		t.Fatal("row A missing")
	}
	if len(a.Tags) != 1 || a.Tags[0] != "new" {
		t.Fatalf("tags = %v, want [new]", a.Tags)
	}
	if a.PreviewTitle != "Title A" {
		t.Fatalf("previewTitle = %q", a.PreviewTitle)
	}

	var resp struct {
		Updated int      `json:"updated"`
		Missing []string `json:"missing"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Updated != 1 || len(resp.Missing) != 1 || resp.Missing[0] != "https://b.example/" {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestPatchBookmarksMergesConcurrentTagEdits(t *testing.T) {
	h, store := patchTestHandlers(t)
	if err := store.SaveBookmarksByPage(7, []Bookmark{{Name: "A", URL: "https://a.example/"}}); err != nil {
		t.Fatal(err)
	}
	doPatch(t, h, map[string]any{"page": 7, "updates": []map[string]any{{"url": "https://a.example/", "addTags": []string{"one"}}}})
	doPatch(t, h, map[string]any{"page": 7, "updates": []map[string]any{{"url": "https://a.example/", "addTags": []string{"two"}}}})
	a := findByURL(store.GetBookmarksByPage(7), "https://a.example/")
	if a == nil || len(a.Tags) != 2 {
		t.Fatalf("tags = %v, want both", a)
	}
}

func TestPatchBookmarksRejectsMissingPage(t *testing.T) {
	h, _ := patchTestHandlers(t)
	rec := doPatch(t, h, map[string]any{"updates": []map[string]any{{"url": "https://a.example/"}}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPatchBookmarksSetsTheIcon(t *testing.T) {
	h, store := patchTestHandlers(t)
	if err := store.SaveBookmarksByPage(7, []Bookmark{{Name: "A", URL: "https://a.example/"}, {Name: "B", URL: "https://b.example/"}}); err != nil {
		t.Fatal(err)
	}
	rec := doPatch(t, h, map[string]any{"page": 7, "updates": []map[string]any{{"url": "https://b.example/", "icon": "icon-b.png"}}})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	rows := store.GetBookmarksByPage(7)
	if rows[0].Icon != "" || rows[1].Icon != "icon-b.png" {
		t.Fatalf("icons = %q %q", rows[0].Icon, rows[1].Icon)
	}
}

func TestPatchBookmarksPutsAURLBack(t *testing.T) {
	h, store := patchTestHandlers(t)
	if err := store.SaveBookmarksByPage(7, []Bookmark{{Name: "New", URL: "https://new.example/", Note: "Was: https://old.example/", LastError: "HTTP 500", LastChecked: 5}}); err != nil {
		t.Fatal(err)
	}
	rec := doPatch(t, h, map[string]any{"page": 7, "updates": []map[string]any{{
		"url": "https://new.example/", "setUrl": "https://old.example/", "name": "Old", "note": "",
	}}})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	row := store.GetBookmarksByPage(7)[0]
	if row.URL != "https://old.example/" || row.Name != "Old" || row.Note != "" || row.LastChecked != 0 || row.LastError != "" {
		t.Fatalf("row = %+v", row)
	}
	if rec := doPatch(t, h, map[string]any{"page": 7, "updates": []map[string]any{{"url": "https://old.example/", "setUrl": "javascript:alert(1)"}}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad setUrl status = %d", rec.Code)
	}
}
