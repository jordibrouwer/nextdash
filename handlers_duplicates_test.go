package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCanonicalBookmarkURLKeyTrailingSlash(t *testing.T) {
	t.Parallel()

	cases := []struct {
		a, b string
	}{
		{"https://example.com", "https://example.com/"},
		{"https://Example.com/path", "https://example.com/path/"},
		{"https://example.com/page#section", "https://example.com/page"},
	}
	for _, tc := range cases {
		if gotA, gotB := canonicalBookmarkURLKey(tc.a), canonicalBookmarkURLKey(tc.b); gotA != gotB {
			t.Fatalf("%q and %q => %q vs %q", tc.a, tc.b, gotA, gotB)
		}
	}
}

func TestFindURLDuplicateGroupsUsesCanonicalKey(t *testing.T) {
	t.Parallel()

	pages := []Page{{ID: 1, Name: "main"}}
	bookmarks := map[int][]Bookmark{
		1: {
			{Name: "A", URL: "https://example.com"},
			{Name: "B", URL: "https://example.com/"},
			{Name: "C", URL: "https://other.test"},
		},
	}

	groups := findURLDuplicateGroups(pages, func(pageID int) []Bookmark {
		return bookmarks[pageID]
	})
	if len(groups) != 1 {
		t.Fatalf("len = %d, want 1 duplicate group", len(groups))
	}
	if groups[0].URL != "https://example.com" {
		t.Fatalf("group URL = %q, want canonical form", groups[0].URL)
	}
	if len(groups[0].Bookmarks) != 2 {
		t.Fatalf("bookmark refs = %d, want 2", len(groups[0].Bookmarks))
	}
}

func TestSaveBookmarksRejectsDuplicateURLsInPayload(t *testing.T) {
	t.Parallel()

	h := NewHandlers(NewStore(), embeddedFiles)
	bookmarks := []Bookmark{
		{Name: "A", URL: "https://example.com"},
		{Name: "B", URL: "https://example.com/"},
	}
	body, _ := json.Marshal(bookmarks)
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks?page=1", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.SaveBookmarks(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}
