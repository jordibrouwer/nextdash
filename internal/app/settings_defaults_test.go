package app

import (
	"os"
	"path/filepath"
	"testing"
)

// A settings file written before a boolean field existed decodes to the zero
// value, which for a bool is off — so without an explicit heal an install that
// never made a choice would get the opposite of the default a fresh one gets.
func TestAbsentBooleanSettingsTakeTheirDefault(t *testing.T) {
	dir := t.TempDir()
	settingsFile := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsFile, []byte(`{"theme":"dark"}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	store := &FileStore{settingsFile: settingsFile, dataDir: dir}

	settings := store.GetSettings()
	if !settings.GlobalShortcuts {
		t.Error("globalShortcuts = false, want true when the key is absent")
	}
	if !settings.SearchUnsorted {
		t.Error("searchUnsorted = false, want true when the key is absent")
	}
	if !settings.UnsortedEnabled {
		t.Error("unsortedEnabled = false, want true when the key is absent")
	}
}

// A stored false is a choice, not a gap, and survives the heal above.
func TestStoredFalseSettingsAreKept(t *testing.T) {
	dir := t.TempDir()
	settingsFile := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsFile,
		[]byte(`{"globalShortcuts":false,"searchUnsorted":false}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	store := &FileStore{settingsFile: settingsFile, dataDir: dir}

	settings := store.GetSettings()
	if settings.GlobalShortcuts {
		t.Error("globalShortcuts = true, want the stored false")
	}
	if settings.SearchUnsorted {
		t.Error("searchUnsorted = true, want the stored false")
	}
}

// The reserved page is hidden by its id, whoever wrote its file first: adding a
// bookmark to it creates the record before EnsureUnsortedPage ever runs.
func TestUnsortedPageIsHiddenEvenWhenItsFileDoesNotSaySo(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{settingsFile: filepath.Join(dir, "settings.json"), dataDir: dir}

	if err := store.AddBookmarkToPage(unsortedPageID, Bookmark{
		Name: "kept", URL: "https://kept.example",
	}); err != nil {
		t.Fatalf("add bookmark: %v", err)
	}

	for _, page := range store.GetPages() {
		if page.ID != unsortedPageID {
			continue
		}
		if !page.Hidden {
			t.Error("the unsorted page is visible, want hidden")
		}
		if page.Name != "Unsorted" {
			t.Errorf("name = %q, want \"Unsorted\"", page.Name)
		}
		return
	}
	t.Fatal("the unsorted page is missing from GetPages")
}
