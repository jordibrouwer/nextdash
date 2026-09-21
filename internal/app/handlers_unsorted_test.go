package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetUnsortedCreatesPageAndReturnsSortedBookmarks(t *testing.T) {
	h := newTestHandlers(t)

	page, err := h.store.EnsureUnsortedPage()
	if err != nil {
		t.Fatalf("EnsureUnsortedPage: %v", err)
	}
	older := Bookmark{Name: "older", URL: "https://a.example", CreatedAt: 1000}
	newer := Bookmark{Name: "newer", URL: "https://b.example", CreatedAt: 2000}
	if err := h.store.AddBookmarkToPage(page.ID, older); err != nil {
		t.Fatalf("AddBookmarkToPage older: %v", err)
	}
	if err := h.store.AddBookmarkToPage(page.ID, newer); err != nil {
		t.Fatalf("AddBookmarkToPage newer: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/unsorted", nil)
	rec := httptest.NewRecorder()
	h.GetUnsorted(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Page      Page       `json:"page"`
		Bookmarks []Bookmark `json:"bookmarks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Page.ID != unsortedPageID || !out.Page.Hidden {
		t.Fatalf("page = %+v", out.Page)
	}
	if len(out.Bookmarks) != 2 {
		t.Fatalf("bookmarks = %d, want 2", len(out.Bookmarks))
	}
	if out.Bookmarks[0].Name != "newer" || out.Bookmarks[1].Name != "older" {
		t.Fatalf("order = [%s, %s], want [newer, older]", out.Bookmarks[0].Name, out.Bookmarks[1].Name)
	}
}

// The page is created lazily -- a fresh install with nothing kept yet still
// gets a 200 with an empty list, not a 404.
func TestGetUnsortedCreatesPageOnFirstCall(t *testing.T) {
	h := newTestHandlers(t)

	req := httptest.NewRequest(http.MethodGet, "/api/unsorted", nil)
	rec := httptest.NewRecorder()
	h.GetUnsorted(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Page      Page       `json:"page"`
		Bookmarks []Bookmark `json:"bookmarks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Page.ID != unsortedPageID {
		t.Fatalf("page.id = %d, want %d", out.Page.ID, unsortedPageID)
	}
	if len(out.Bookmarks) != 0 {
		t.Fatalf("bookmarks = %d, want 0", len(out.Bookmarks))
	}
}
