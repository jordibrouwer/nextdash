package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// A file that exists but cannot be read is not an empty page: caching the
// empty answer would let the next save replace the real data.
func TestGetCategoriesByPageDoesNotCacheFailedRead(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root reads files regardless of mode")
	}
	dir := t.TempDir()
	store := &FileStore{
		settingsFile: filepath.Join(dir, "settings.json"),
		dataDir:      dir,
		readCache:    newStoreReadCache(),
	}
	path := filepath.Join(dir, "bookmarks-1.json")
	page := PageWithBookmarks{
		Page:       Page{ID: 1, Name: "main"},
		Categories: []Category{{ID: "c1", Name: "Work"}},
		Bookmarks:  []Bookmark{},
	}
	raw, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}

	if err := os.Chmod(path, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o644) })
	if got := store.GetCategoriesByPage(1); len(got) != 0 {
		t.Fatalf("unreadable file should read as empty, got %+v", got)
	}

	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	got := store.GetCategoriesByPage(1)
	if len(got) != 1 || got[0].Name != "Work" {
		t.Fatalf("the failed read was cached; got %+v", got)
	}
}

func TestGetFindersAndColorsDoNotCacheFailedRead(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root reads files regardless of mode")
	}
	dir := t.TempDir()
	store := &FileStore{
		settingsFile: filepath.Join(dir, "settings.json"),
		colorsFile:   filepath.Join(dir, "colors.json"),
		dataDir:      dir,
		readCache:    newStoreReadCache(),
	}
	findersPath := filepath.Join(dir, "finders.json")
	if err := os.WriteFile(findersPath, []byte(`[{"name":"Mine","shortcut":"m","url":"https://x.example/?q={query}"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	colors := getDefaultColors()
	colors.Custom = map[string]ThemeColors{"mine": {}}
	raw, _ := json.Marshal(colors)
	if err := os.WriteFile(store.colorsFile, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{findersPath, store.colorsFile} {
		if err := os.Chmod(p, 0); err != nil {
			t.Fatal(err)
		}
		p := p
		t.Cleanup(func() { _ = os.Chmod(p, 0o644) })
	}
	_ = store.GetFinders()
	_ = store.GetColors()
	for _, p := range []string{findersPath, store.colorsFile} {
		if err := os.Chmod(p, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	found := false
	for _, f := range store.GetFinders() {
		if f.Name == "Mine" {
			found = true
		}
	}
	if !found {
		t.Error("finders: the failed read was cached")
	}
	if _, ok := store.GetColors().Custom["mine"]; !ok {
		t.Error("colors: the failed read was cached")
	}
}
