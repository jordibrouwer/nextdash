package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInboxAddDedupeAndDelete(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	store.initializeDefaultFiles()

	link := InboxLink{URL: "https://example.com/article", Source: "test"}
	created, err := store.AddInboxLink(link, true, 500)
	if err != nil {
		t.Fatalf("AddInboxLink: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected generated id")
	}
	if created.Domain != "example.com" {
		t.Fatalf("domain = %q", created.Domain)
	}

	_, err = store.AddInboxLink(InboxLink{URL: "https://example.com/article"}, true, 500)
	if err != ErrInboxDuplicateURL {
		t.Fatalf("expected duplicate error, got %v", err)
	}

	items := store.GetInboxItems()
	if len(items) != 1 {
		t.Fatalf("items len = %d", len(items))
	}

	if err := store.DeleteInboxLink(created.ID); err != nil {
		t.Fatalf("DeleteInboxLink: %v", err)
	}
	if len(store.GetInboxItems()) != 0 {
		t.Fatal("expected empty inbox after delete")
	}
}

// The inbox stores a favicon filename on each item (like Bookmark.Icon) so the
// inbox can show real site icons like the health view. This checks the Icon field
// round-trips through UpdateInboxLink and persists across a reload.
func TestInboxIconPersists(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	store.initializeDefaultFiles()

	created, err := store.AddInboxLink(InboxLink{URL: "https://example.com/article"}, true, 500)
	if err != nil {
		t.Fatalf("AddInboxLink: %v", err)
	}
	if created.Icon != "" {
		t.Fatalf("new item should have no icon yet, got %q", created.Icon)
	}

	updated, err := store.UpdateInboxLink(created.ID, func(link *InboxLink) error {
		link.Icon = "icon-abc123.png"
		return nil
	})
	if err != nil {
		t.Fatalf("UpdateInboxLink: %v", err)
	}
	if updated.Icon != "icon-abc123.png" {
		t.Fatalf("icon = %q, want icon-abc123.png", updated.Icon)
	}

	// Reload from disk: a fresh store reading the same data dir must see the icon.
	reloaded := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	items := reloaded.GetInboxItems()
	if len(items) != 1 || items[0].Icon != "icon-abc123.png" {
		t.Fatalf("reloaded icon = %+v, want icon-abc123.png", items)
	}
}

// Deleting or promoting an inbox item should not leave its favicon file behind,
// unless another bookmark or inbox item still uses that same filename.
func TestRemoveUnusedIconFile(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	store.initializeDefaultFiles()

	iconsDir := filepath.Join(dir, "icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		t.Fatalf("mkdir icons: %v", err)
	}
	writeIcon := func(name string) string {
		p := filepath.Join(iconsDir, name)
		if err := os.WriteFile(p, []byte("png"), 0644); err != nil {
			t.Fatalf("write icon: %v", err)
		}
		return p
	}

	// Case 1: an orphaned icon (no references left) is removed.
	orphan := writeIcon("icon-orphan.png")
	store.removeUnusedIconFile("icon-orphan.png")
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("orphan icon should have been removed, stat err = %v", err)
	}

	// Case 2: an icon still used by a bookmark is kept.
	shared := writeIcon("icon-shared.png")
	created, err := store.AddInboxLink(InboxLink{URL: "https://b.example.com"}, true, 500)
	if err != nil {
		t.Fatalf("AddInboxLink: %v", err)
	}
	if err := store.AddBookmarkToPage(1, Bookmark{Name: "B", URL: "https://b.example.com", Icon: "icon-shared.png"}); err != nil {
		t.Fatalf("AddBookmarkToPage: %v", err)
	}
	// The inbox item is deleted, but the bookmark still references the icon.
	if err := store.DeleteInboxLink(created.ID); err != nil {
		t.Fatalf("DeleteInboxLink: %v", err)
	}
	store.removeUnusedIconFile("icon-shared.png")
	if _, err := os.Stat(shared); err != nil {
		t.Fatalf("shared icon should have been kept, stat err = %v", err)
	}

	// A URL-style icon value is never treated as a deletable file.
	store.removeUnusedIconFile("https://cdn.example.com/logo.png") // must not panic or error
}

func TestInboxMaxItemsTrim(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	store.initializeDefaultFiles()

	for i := 0; i < 5; i++ {
		_, err := store.AddInboxLink(InboxLink{
			URL: "https://example.com/" + string(rune('a'+i)),
		}, false, 3)
		if err != nil {
			t.Fatalf("add %d: %v", i, err)
		}
	}
	if len(store.GetInboxItems()) != 3 {
		t.Fatalf("expected trim to 3, got %d", len(store.GetInboxItems()))
	}
	if _, err := os.Stat(filepath.Join(dir, "inbox.json")); err != nil {
		t.Fatalf("inbox.json missing: %v", err)
	}
}

func TestInboxRestoreLink(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	store.initializeDefaultFiles()

	original := InboxLink{
		ID:      "inl_restore1",
		URL:     "https://example.com/restore",
		Title:   "Restore me",
		AddedAt: 123,
		Source:  "test",
	}
	created, err := store.AddInboxLink(original, false, 500)
	if err != nil {
		t.Fatalf("AddInboxLink: %v", err)
	}
	if err := store.DeleteInboxLink(created.ID); err != nil {
		t.Fatalf("DeleteInboxLink: %v", err)
	}
	restored, err := store.RestoreInboxLink(created, 500)
	if err != nil {
		t.Fatalf("RestoreInboxLink: %v", err)
	}
	if restored.ID != created.ID {
		t.Fatalf("id = %q", restored.ID)
	}
	items := store.GetInboxItems()
	if len(items) != 1 || items[0].URL != created.URL {
		t.Fatalf("unexpected items after restore: %+v", items)
	}
	again, err := store.RestoreInboxLink(created, 500)
	if err != nil {
		t.Fatalf("RestoreInboxLink second: %v", err)
	}
	if again.ID != created.ID {
		t.Fatal("expected existing item on second restore")
	}
	if len(store.GetInboxItems()) != 1 {
		t.Fatal("expected single item after duplicate restore")
	}
}

func TestNormalizePasteDestination(t *testing.T) {
	if normalizePasteDestination("bookmark") != "bookmark" {
		t.Fatal("bookmark")
	}
	if normalizePasteDestination("INBOX") != "inbox" {
		t.Fatal("inbox")
	}
	if normalizePasteDestination("weird") != "ask" {
		t.Fatal("ask fallback")
	}
}
