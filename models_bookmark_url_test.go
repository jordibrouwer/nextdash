package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestBookmarkURLExistsUsesCanonicalURL(t *testing.T) {
	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

	page := PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Bookmarks: []Bookmark{
			{Name: "Example", URL: "https://Example.com"},
		},
	}
	data, err := json.MarshalIndent(page, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll("data", 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join("data", "bookmarks-1.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	fs := &FileStore{dataDir: "data"}
	if !fs.BookmarkURLExists("https://example.com/") {
		t.Fatal("expected trailing-slash variant to match bookmark")
	}
	if !fs.BookmarkURLExists("https://example.com#section") {
		t.Fatal("expected hash variant to match bookmark")
	}
	if fs.BookmarkURLExists("https://other.test") {
		t.Fatal("unexpected match for different host")
	}
}
