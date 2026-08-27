package app

import (
	"testing"
	"time"
)

// The starter bookmarks used to be written with CreatedAt left at zero, which
// every surface reading that field — "Recently added", the age column, the
// cleanup filters — had to treat as unknown. A fresh install should have a
// usable value from the first run.
func TestDefaultBookmarksCarryCreatedAt(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile: dir + "/settings.json",
		dataDir:      dir,
		readCache:    newStoreReadCache(),
	}

	before := time.Now().UnixMilli()
	store.initializeDefaultFiles()
	after := time.Now().UnixMilli()

	bookmarks := store.GetAllBookmarks()
	if len(bookmarks) == 0 {
		t.Fatal("expected the default install to seed bookmarks")
	}

	for _, b := range bookmarks {
		if b.CreatedAt == 0 {
			t.Errorf("bookmark %q has no CreatedAt", b.Name)
			continue
		}
		// The stamps fan out by a millisecond each, so allow for the spread.
		if b.CreatedAt < before || b.CreatedAt > after+int64(len(bookmarks)) {
			t.Errorf("bookmark %q has CreatedAt %d, outside the seeding window %d..%d",
				b.Name, b.CreatedAt, before, after)
		}
	}
}

// "Recently added" sorts on CreatedAt, so identical stamps would leave the
// starter list without a defined order.
func TestDefaultBookmarkCreatedAtIsDistinct(t *testing.T) {
	bookmarks := []Bookmark{{Name: "one"}, {Name: "two"}, {Name: "three"}}
	stampDefaultBookmarkCreatedAt(bookmarks, time.Now())

	seen := map[int64]string{}
	for _, b := range bookmarks {
		if prev, dup := seen[b.CreatedAt]; dup {
			t.Errorf("%q and %q share CreatedAt %d", prev, b.Name, b.CreatedAt)
		}
		seen[b.CreatedAt] = b.Name
	}

	// Written order is preserved: earlier entries are older.
	for i := 1; i < len(bookmarks); i++ {
		if bookmarks[i].CreatedAt <= bookmarks[i-1].CreatedAt {
			t.Errorf("entry %d is not newer than entry %d", i, i-1)
		}
	}
}

// The project's own site is one of the starter bookmarks: a new install should
// find nextdash.cc on the dashboard rather than only behind a button in About,
// and Fresh needs a feed to count before anyone has added one.
func TestDefaultBookmarksIncludeTheProjectSite(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile: dir + "/settings.json",
		dataDir:      dir,
		readCache:    newStoreReadCache(),
	}
	store.initializeDefaultFiles()

	var site *Bookmark
	for i, b := range store.GetAllBookmarks() {
		if b.URL == "https://nextdash.cc/" {
			site = &store.GetAllBookmarks()[i]
			break
		}
	}
	if site == nil {
		t.Fatal("the default install does not seed https://nextdash.cc/")
	}
	if site.Category != "development" {
		t.Errorf("nextdash.cc is filed under %q, want development", site.Category)
	}
	if len(site.Tags) == 0 {
		t.Error("nextdash.cc carries no tags")
	}

	// A shortcut that another starter row already claims makes both unreachable
	// by key, which is exactly what the health view calls a conflict.
	seen := map[string]string{}
	for _, b := range store.GetAllBookmarks() {
		if b.Shortcut == "" {
			continue
		}
		if other, clash := seen[b.Shortcut]; clash {
			t.Errorf("shortcut %q is claimed by both %q and %q", b.Shortcut, other, b.Name)
		}
		seen[b.Shortcut] = b.Name
	}
}
