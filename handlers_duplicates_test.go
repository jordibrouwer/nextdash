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

func TestMergeBookmarkMetadataCombinesUsageAndFields(t *testing.T) {
	t.Parallel()

	keeper := Bookmark{Name: "Keeper", URL: "https://example.com", OpenCount: 2, Tags: []string{"work"}}
	sources := []Bookmark{
		{OpenCount: 5, Pinned: true, Note: "extra", Tags: []string{"home", "work"}, Shortcut: "ex"},
		{Icon: "icon.png", PreviewTitle: "Preview", LastOpened: 9000},
	}
	mergeBookmarkMetadata(&keeper, sources)

	if keeper.OpenCount != 7 {
		t.Fatalf("OpenCount = %d, want 7", keeper.OpenCount)
	}
	if !keeper.Pinned {
		t.Fatal("expected pinned")
	}
	if keeper.Shortcut != "ex" {
		t.Fatalf("Shortcut = %q, want ex", keeper.Shortcut)
	}
	if keeper.Note != "extra" {
		t.Fatalf("Note = %q", keeper.Note)
	}
	if keeper.Icon != "icon.png" {
		t.Fatalf("Icon = %q", keeper.Icon)
	}
	if keeper.PreviewTitle != "Preview" {
		t.Fatalf("PreviewTitle = %q", keeper.PreviewTitle)
	}
	if keeper.LastOpened != 9000 {
		t.Fatalf("LastOpened = %d", keeper.LastOpened)
	}
	if len(keeper.Tags) != 2 {
		t.Fatalf("tags = %v, want [home work]", keeper.Tags)
	}
}

func TestMergeDuplicatesMergesIntoKeeperAndRemovesSources(t *testing.T) {
	t.Parallel()

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "Keeper", URL: "https://example.com", OpenCount: 2, Tags: []string{"work"}},
		{Name: "Dup", URL: "https://example.com/", OpenCount: 5, Pinned: true, Note: "from dup", Tags: []string{"home"}, Shortcut: "ex"},
	})
	store.SaveBookmarksByPage(2, []Bookmark{
		{Name: "Other", URL: "https://example.com", Icon: "icon.png", PreviewTitle: "Title"},
	})

	body, _ := json.Marshal(map[string]interface{}{
		"targetPageId":  1,
		"targetIndex":   0,
		"sourcePageIds": []int{1, 2},
		"sourceIndices": []int{1, 0},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/health/merge-duplicates", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.MergeDuplicates(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	page1 := store.GetBookmarksByPage(1)
	if len(page1) != 1 {
		t.Fatalf("page 1 len = %d, want 1", len(page1))
	}
	k := page1[0]
	if k.OpenCount != 7 {
		t.Fatalf("OpenCount = %d, want 7", k.OpenCount)
	}
	if !k.Pinned || k.Shortcut != "ex" || k.Icon != "icon.png" {
		t.Fatalf("merged keeper = %+v", k)
	}
	if len(store.GetBookmarksByPage(2)) != 0 {
		t.Fatal("expected page 2 bookmark removed")
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
