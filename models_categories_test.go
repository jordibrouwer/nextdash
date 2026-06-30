package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveCategoriesByPageRejectsEmptyWipeWhenBookmarksReferenceCategories(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	initial := PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Categories: []Category{
			{ID: "work", Name: "Work"},
			{ID: "personal", Name: "Personal"},
		},
		Bookmarks: []Bookmark{
			{URL: "https://example.com", Category: "work"},
		},
	}
	data, err := json.MarshalIndent(initial, "", "  ")
	if err != nil {
		t.Fatalf("marshal initial: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), data, 0644); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	if err := store.SaveCategoriesByPage(1, []Category{}); err != nil {
		t.Fatalf("SaveCategoriesByPage: %v", err)
	}

	got := store.GetCategoriesByPage(1)
	if len(got) != 2 {
		t.Fatalf("categories len = %d, want 2 preserved", len(got))
	}
	if got[0].ID != "work" || got[1].ID != "personal" {
		t.Fatalf("unexpected categories: %+v", got)
	}
}

func TestGetCategoriesByPageRecoversFromBookmarkRefs(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	initial := PageWithBookmarks{
		Page:       Page{ID: 1, Name: "main"},
		Categories: nil,
		Bookmarks: []Bookmark{
			{URL: "https://example.com", Category: "work"},
			{URL: "https://example.org", Category: "personal"},
		},
	}
	data, err := json.MarshalIndent(initial, "", "  ")
	if err != nil {
		t.Fatalf("marshal initial: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), data, 0644); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	got := store.GetCategoriesByPage(1)
	if len(got) != 2 {
		t.Fatalf("categories len = %d, want 2 recovered", len(got))
	}
	ids := map[string]bool{got[0].ID: true, got[1].ID: true}
	if !ids["work"] || !ids["personal"] {
		t.Fatalf("unexpected recovered ids: %+v", got)
	}
}

func TestSaveCategoriesByPageAllowsEmptyWhenNoBookmarkCategoryRefs(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	initial := PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Categories: []Category{
			{ID: "work", Name: "Work"},
		},
		Bookmarks: []Bookmark{
			{URL: "https://example.com", Category: ""},
		},
	}
	data, err := json.MarshalIndent(initial, "", "  ")
	if err != nil {
		t.Fatalf("marshal initial: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), data, 0644); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	if err := store.SaveCategoriesByPage(1, []Category{}); err != nil {
		t.Fatalf("SaveCategoriesByPage: %v", err)
	}

	got := store.GetCategoriesByPage(1)
	if len(got) != 0 {
		t.Fatalf("categories len = %d, want 0", len(got))
	}
}
