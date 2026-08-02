package main

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
