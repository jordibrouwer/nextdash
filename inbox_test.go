package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInboxAddDedupeAndDelete(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile: filepath.Join(dir, "settings.json"),
		colorsFile:   filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:      dir,
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

func TestInboxMaxItemsTrim(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile: filepath.Join(dir, "settings.json"),
		colorsFile:   filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:      dir,
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
