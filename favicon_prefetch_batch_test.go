package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBookmarksNeedingIconsSkipsInvalidAndExisting(t *testing.T) {
	bookmarks := []Bookmark{
		{Name: "Has icon", URL: "https://github.com", Icon: "icon-a.png"},
		{Name: "Missing", URL: "https://google.com"},
		{Name: "Empty URL", URL: "  "},
		{Name: "Bad scheme", URL: "ftp://github.com"},
	}
	pending := bookmarksNeedingIcons(bookmarks, false)
	if len(pending) != 1 {
		t.Fatalf("expected 1 pending bookmark, got %d", len(pending))
	}
	if pending[0].url != "https://google.com" {
		t.Fatalf("unexpected pending url %q", pending[0].url)
	}
}

func TestPrefetchBookmarkIconsCountOnly(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	existing := len(bookmarksNeedingIcons(store.GetBookmarksByPage(1), false))
	if err := store.AddBookmarkToPage(1, Bookmark{Name: "Extra", URL: "https://stackoverflow.com"}); err != nil {
		t.Fatal(err)
	}
	want := existing + 1

	h := &Handlers{store: store}
	result := h.prefetchBookmarkIconsBatch(1, 4, true)
	if result.Total != want || result.Remaining != want || result.Done {
		t.Fatalf("countOnly result = %+v, want total=%d remaining=%d done=false", result, want, want)
	}
	if result.Attempted != 0 || result.Applied != 0 {
		t.Fatalf("countOnly should not attempt fetches: %+v", result)
	}
}

func TestPrefetchBookmarkIconsHandlerRequiresPageID(t *testing.T) {
	h := &Handlers{store: NewStore()}
	body := strings.NewReader(`{"pageId":0}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/prefetch-icons", body)
	rec := httptest.NewRecorder()
	h.PrefetchBookmarkIcons(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPrefetchBookmarkIconsHandlerCountOnlyJSON(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	want := len(bookmarksNeedingIcons(store.GetBookmarksByPage(1), false))

	h := &Handlers{store: store}
	body := strings.NewReader(`{"pageId":1,"countOnly":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/prefetch-icons", body)
	rec := httptest.NewRecorder()
	h.PrefetchBookmarkIcons(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var result prefetchIconsBatchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Total != want || result.Remaining != want {
		t.Fatalf("unexpected result %+v, want total=%d", result, want)
	}
}
