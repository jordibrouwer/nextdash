package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Config → Bookmarks wrote whole pages from the list it had in memory, so a
// bookmark added elsewhere since was dropped by the next edit, and a move that
// the target refused left the rows on no page at all. These routes act on the
// named rows only, under the store lock.

func rowsReq(t *testing.T, fn http.HandlerFunc, method string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	fn(rec, httptest.NewRequest(method, "/", bytes.NewReader(raw)))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func seedPages(t *testing.T, store Store, pages map[int][]Bookmark) {
	t.Helper()
	for id, rows := range pages {
		if err := store.SaveBookmarksByPage(id, rows); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPatchFieldsKeepsARowAddedElsewhere(t *testing.T) {
	h, store := patchTestHandlers(t)
	seedPages(t, store, map[int][]Bookmark{7: {{Name: "A", URL: "https://a.example/"}}})
	// Added after the client read the page.
	if err := store.AddBookmarkToPage(7, Bookmark{Name: "New", URL: "https://new.example/"}); err != nil {
		t.Fatal(err)
	}
	rec, _ := rowsReq(t, h.PatchBookmarks, http.MethodPatch, map[string]any{
		"page": 7,
		"updates": []map[string]any{{"url": "https://a.example/", "fields": map[string]any{
			"name": "A2", "pinned": true, "tags": []string{"X", "y"}, "openCount": 99,
		}}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	rows := store.GetBookmarksByPage(7)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2 (the new row must survive)", len(rows))
	}
	a := findByURL(rows, "https://a.example/")
	if a.Name != "A2" || !a.Pinned || len(a.Tags) != 2 || a.Tags[0] != "x" {
		t.Fatalf("a = %+v", a)
	}
	if a.OpenCount != 0 {
		t.Fatalf("openCount = %d: server-owned fields are not the client's to set", a.OpenCount)
	}
}

func TestPatchFieldsRefusesATakenShortcutAndADuplicateURL(t *testing.T) {
	h, store := patchTestHandlers(t)
	seedPages(t, store, map[int][]Bookmark{
		7: {{Name: "A", URL: "https://a.example/"}, {Name: "B", URL: "https://b.example/"}},
		8: {{Name: "C", URL: "https://c.example/", Shortcut: "Q"}},
	})
	rec, out := rowsReq(t, h.PatchBookmarks, http.MethodPatch, map[string]any{
		"page": 7, "updates": []map[string]any{{"url": "https://a.example/", "fields": map[string]any{"shortcut": "q"}}},
	})
	if rec.Code != http.StatusConflict || out["error"] != "duplicate_shortcut" {
		t.Fatalf("shortcut: %d %v", rec.Code, out)
	}
	rec, out = rowsReq(t, h.PatchBookmarks, http.MethodPatch, map[string]any{
		"page": 7, "updates": []map[string]any{{"url": "https://a.example/", "fields": map[string]any{"url": "https://b.example/"}}},
	})
	if rec.Code != http.StatusConflict || out["error"] != "duplicate_url" {
		t.Fatalf("url: %d %v", rec.Code, out)
	}
	if a := findByURL(store.GetBookmarksByPage(7), "https://a.example/"); a == nil || a.Shortcut != "" {
		t.Fatalf("a changed by a refused patch: %+v", a)
	}
}

func TestDeleteBookmarksByURLGoesToTheTrash(t *testing.T) {
	h, store := patchTestHandlers(t)
	seedPages(t, store, map[int][]Bookmark{7: {{Name: "A", URL: "https://a.example/"}, {Name: "B", URL: "https://b.example/"}}})
	rec, out := rowsReq(t, h.DeleteHealthBookmarksBulk, http.MethodPost, map[string]any{
		"source": "config-bookmarks",
		"items":  []map[string]any{{"pageId": 7, "index": -1, "url": "https://b.example/"}},
	})
	if rec.Code != http.StatusOK || out["deleted"].(float64) != 1 || len(out["trashIds"].([]any)) != 1 {
		t.Fatalf("delete: %d %v", rec.Code, out)
	}
	if rows := store.GetBookmarksByPage(7); len(rows) != 1 || rows[0].Name != "A" {
		t.Fatalf("rows = %+v", rows)
	}
}

func TestMoveBookmarksIsAllOrNothingPerRow(t *testing.T) {
	h, store := patchTestHandlers(t)
	seedPages(t, store, map[int][]Bookmark{
		7: {{Name: "A", URL: "https://a.example/", Category: "c1"}, {Name: "B", URL: "https://b.example/"}},
		8: {{Name: "B on 8", URL: "https://b.example/"}},
	})
	rec, out := rowsReq(t, h.MoveBookmarks, http.MethodPost, map[string]any{
		"toPage": 8, "category": "c2",
		"items": []map[string]any{{"pageId": 7, "url": "https://a.example/"}, {"pageId": 7, "url": "https://b.example/"}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if len(out["moved"].([]any)) != 1 || len(out["skipped"].([]any)) != 1 {
		t.Fatalf("out = %v", out)
	}
	src := store.GetBookmarksByPage(7)
	dst := store.GetBookmarksByPage(8)
	if len(src) != 1 || src[0].Name != "B" {
		t.Fatalf("source = %+v: the refused row must stay where it was", src)
	}
	moved := findByURL(dst, "https://a.example/")
	if moved == nil || moved.Category != "c2" || len(dst) != 2 {
		t.Fatalf("target = %+v", dst)
	}
	first := out["moved"].([]any)[0].(map[string]any)
	if first["fromPage"].(float64) != 7 || first["category"] != "c1" {
		t.Fatalf("moved entry = %v: undo needs where it came from", first)
	}
}

func TestRewriteTagTouchesOnlyRowsWithIt(t *testing.T) {
	h, store := patchTestHandlers(t)
	seedPages(t, store, map[int][]Bookmark{
		7: {{Name: "A", URL: "https://a.example/", Tags: []string{"old", "keep"}}, {Name: "B", URL: "https://b.example/"}},
		8: {{Name: "C", URL: "https://c.example/", Tags: []string{"old"}}},
	})
	rec, out := rowsReq(t, h.RewriteTag, http.MethodPost, map[string]any{"from": "old", "to": "new"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	changed := out["changed"].([]any)
	if len(changed) != 2 {
		t.Fatalf("changed = %v", changed)
	}
	a := findByURL(store.GetBookmarksByPage(7), "https://a.example/")
	c := findByURL(store.GetBookmarksByPage(8), "https://c.example/")
	if len(a.Tags) != 2 || a.Tags[0] != "keep" || a.Tags[1] != "new" || c.Tags[0] != "new" {
		t.Fatalf("a=%v c=%v", a.Tags, c.Tags)
	}
	rowsReq(t, h.RewriteTag, http.MethodPost, map[string]any{"from": "new"})
	if c := findByURL(store.GetBookmarksByPage(8), "https://c.example/"); len(c.Tags) != 0 {
		t.Fatalf("delete left %v", c.Tags)
	}
}

func TestRowWritesReachTheSecondCopyOfAURL(t *testing.T) {
	h, store := patchTestHandlers(t)
	// Written straight to the store: the server no longer accepts this shape,
	// but a page from before it did can still hold it.
	seedPages(t, store, map[int][]Bookmark{7: {
		{Name: "First", URL: "https://dup.example/"},
		{Name: "Second", URL: "https://dup.example/"},
	}})
	rec, _ := rowsReq(t, h.PatchBookmarks, http.MethodPatch, map[string]any{
		"page": 7, "updates": []map[string]any{{"url": "https://dup.example/", "occurrence": 1, "fields": map[string]any{"note": "second"}}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("patch = %d %s", rec.Code, rec.Body.String())
	}
	rows := store.GetBookmarksByPage(7)
	if rows[0].Note != "" || rows[1].Note != "second" {
		t.Fatalf("notes = %q %q", rows[0].Note, rows[1].Note)
	}
	rowsReq(t, h.DeleteHealthBookmarksBulk, http.MethodPost, map[string]any{
		"items": []map[string]any{{"pageId": 7, "index": -1, "url": "https://dup.example/", "occurrence": 1}},
	})
	rows = store.GetBookmarksByPage(7)
	if len(rows) != 1 || rows[0].Name != "First" {
		t.Fatalf("after delete = %+v", rows)
	}
}
