package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// GetBookmarks used to answer a missing page/all param with a silent 200 []
// rather than an error, which reads identically to "this page has zero
// bookmarks" and can mask a typo'd query param.

func TestGetBookmarksRequiresPageOrAll(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
	rec := httptest.NewRecorder()
	h.GetBookmarks(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestGetBookmarksStillWorksWithPageParam(t *testing.T) {
	// The control: without this, the test above would pass just as well
	// against a handler that rejects every request, not only bad ones.
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks?page=1", nil)
	rec := httptest.NewRecorder()
	h.GetBookmarks(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
}

func TestGetBookmarksStillWorksWithAllParam(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks?all=true", nil)
	rec := httptest.NewRecorder()
	h.GetBookmarks(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
}
