package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestGetDataRevisionChangesOnBookmarkWrite(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		dataDir:       dir,
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
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
		dataDir:       dir,
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
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

func TestGetDataRevisionIgnoresMtimeOnly(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	store := &FileStore{
		dataDir:       dir,
		settingsFile:  settingsPath,
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
	}
	store.ensureDataDir()
	if err := os.WriteFile(settingsPath, []byte(`{"language":"en"}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}

	before := store.GetDataRevision()
	past := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(settingsPath, past, past); err != nil {
		t.Fatalf("Chtimes: %v", err)
	}
	after := store.GetDataRevision()
	if before != after {
		t.Fatalf("expected revision unchanged after mtime-only touch (before=%q after=%q)", before, after)
	}
}

// A health check writes LastChecked / LastError into bookmarks-*.json, and the
// revision is hashed over those files. That made every ping bump the revision,
// which invalidated the client's page cache — so switching pages refetched
// everything every time, and the dashboard rebuilt itself on each switch.
// Status is not content: it must not move the revision.
func TestGetDataRevisionIgnoresStatusOnlyWrites(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		dataDir:       dir,
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
	}
	store.ensureDataDir()

	if err := store.AddBookmarkToPage(1, Bookmark{
		Name:        "Example",
		URL:         "https://example.com",
		CheckStatus: true,
	}); err != nil {
		t.Fatalf("AddBookmarkToPage: %v", err)
	}

	before := store.GetDataRevision()

	bookmarks := store.GetBookmarksByPage(1)
	if len(bookmarks) == 0 {
		t.Fatal("expected the bookmark just added")
	}
	bookmarks[0].LastChecked = time.Now().Unix()
	bookmarks[0].LastError = "some transient failure"
	if err := store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatalf("SaveBookmarksByPage: %v", err)
	}

	if after := store.GetDataRevision(); before != after {
		t.Fatalf("status-only write moved the revision (before=%q after=%q)", before, after)
	}
}

// The other half of the same rule: a real edit still has to move it, or the
// client would never learn about a change made on another device.
func TestGetDataRevisionStillChangesOnContentEdit(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		dataDir:       dir,
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
	}
	store.ensureDataDir()

	if err := store.AddBookmarkToPage(1, Bookmark{Name: "Example", URL: "https://example.com"}); err != nil {
		t.Fatalf("AddBookmarkToPage: %v", err)
	}
	before := store.GetDataRevision()

	bookmarks := store.GetBookmarksByPage(1)
	bookmarks[0].Name = "Renamed"
	if err := store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatalf("SaveBookmarksByPage: %v", err)
	}

	if after := store.GetDataRevision(); before == after {
		t.Fatalf("a content edit did not move the revision (before=%q after=%q)", before, after)
	}
}
