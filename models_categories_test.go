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

// Dropping a category without OriginalID used to fall back to matching by
// array position, so removing a middle category shifted every later index by
// one and silently reassigned the next category's ID onto the deleted
// category's bookmarks — moving them into a category they were never in,
// not just leaving them orphaned.
func TestSaveCategoriesByPageDropWithoutOriginalIDDoesNotMisfileByPosition(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	initial := PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Categories: []Category{
			{ID: "a", Name: "A"},
			{ID: "b", Name: "B"},
			{ID: "c", Name: "C"},
		},
		Bookmarks: []Bookmark{
			{URL: "https://a.example.com", Category: "a"},
			{URL: "https://b.example.com", Category: "b"},
			{URL: "https://c.example.com", Category: "c"},
		},
	}
	data, err := json.MarshalIndent(initial, "", "  ")
	if err != nil {
		t.Fatalf("marshal initial: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), data, 0644); err != nil {
		t.Fatalf("write initial: %v", err)
	}

	// Category "b" dropped, "a" and "c" kept as-is — no OriginalID on either,
	// as a client that doesn't track renames might send.
	if err := store.SaveCategoriesByPage(1, []Category{
		{ID: "a", Name: "A"},
		{ID: "c", Name: "C"},
	}); err != nil {
		t.Fatalf("SaveCategoriesByPage: %v", err)
	}

	bookmarks := store.GetBookmarksByPage(1)
	byURL := map[string]string{}
	for _, b := range bookmarks {
		byURL[b.URL] = b.Category
	}
	if byURL["https://a.example.com"] != "a" {
		t.Fatalf("a.example.com category = %q, want \"a\" unchanged", byURL["https://a.example.com"])
	}
	if byURL["https://c.example.com"] != "c" {
		t.Fatalf("c.example.com category = %q, want \"c\" unchanged", byURL["https://c.example.com"])
	}
	if byURL["https://b.example.com"] == "c" {
		t.Fatal("b.example.com was repointed at category \"c\" by positional drift — it should stay \"b\" (orphaned), not move to a category it was never in")
	}
	if byURL["https://b.example.com"] != "b" {
		t.Fatalf("b.example.com category = %q, want \"b\" (orphaned, unchanged)", byURL["https://b.example.com"])
	}
}

// The normal rename path: every client sends originalId on every category,
// even unchanged ones, so this is the case that must keep working.
func TestSaveCategoriesByPageRenameWithOriginalIDRemapsBookmarks(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	initial := PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Categories: []Category{
			{ID: "work", Name: "Work"},
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

	if err := store.SaveCategoriesByPage(1, []Category{
		{ID: "job", Name: "Job", OriginalID: "work"},
	}); err != nil {
		t.Fatalf("SaveCategoriesByPage: %v", err)
	}

	bookmarks := store.GetBookmarksByPage(1)
	if len(bookmarks) != 1 || bookmarks[0].Category != "job" {
		t.Fatalf("bookmarks = %+v, want category \"job\"", bookmarks)
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
