package main

import (
	"path/filepath"
	"testing"
)

func TestGetDataRevisionChangesOnBookmarkWrite(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		dataDir:      dir,
		settingsFile: filepath.Join(dir, "settings.json"),
		colorsFile:   filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
	}
	store.ensureDataDir()

	before := store.GetDataRevision()
	if err := store.AddBookmarkToPage(1, Bookmark{
		Name: "Example",
		URL:  "https://example.com",
	}); err != nil {
		t.Fatalf("AddBookmarkToPage: %v", err)
	}
	after := store.GetDataRevision()
	if before == after {
		t.Fatalf("expected revision to change after bookmark write (before=%q after=%q)", before, after)
	}
}

func TestGetDataRevisionStableWithoutWrites(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		dataDir:      dir,
		settingsFile: filepath.Join(dir, "settings.json"),
		colorsFile:   filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
	}
	store.ensureDataDir()

	first := store.GetDataRevision()
	second := store.GetDataRevision()
	if first == "" {
		t.Fatal("expected non-empty revision")
	}
	if first != second {
		t.Fatalf("expected stable revision without writes (first=%q second=%q)", first, second)
	}
}
