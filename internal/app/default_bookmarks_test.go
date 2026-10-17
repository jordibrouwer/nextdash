package app

import (
	"os"
	"testing"
	"time"
)

// The starter bookmarks used to be written with CreatedAt left at zero, which
// every surface reading that field — "Recently added", the age column, the
// cleanup filters — had to treat as unknown. A fresh install should have a
// usable value from the first run.
func TestDefaultBookmarksCarryCreatedAt(t *testing.T) {
	useDemoSeed(t)
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
	useDemoSeed(t)
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

// A fresh install gets the demo set: two pages, around a hundred links, the
// project listed twice (site and repository), no address twice, and Today on
// main only.
func TestFreshInstallSeedsTheDemoPages(t *testing.T) {
	useDemoSeed(t)
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	store := NewStore()

	pages := store.GetPages()
	if len(pages) != 2 || pages[0].ID != 1 || pages[1].ID != defaultNewsPageID {
		t.Fatalf("pages = %+v, want main and news", pages)
	}

	bookmarks := store.GetAllBookmarks()
	if n := len(bookmarks); n < 90 || n > 110 {
		t.Errorf("seeded %d bookmarks, want around a hundred", n)
	}
	perPage := map[int]int{}
	urls := map[string]string{}
	for _, b := range bookmarks {
		perPage[b.PageID]++
		if other, dup := urls[b.URL]; dup {
			t.Errorf("%q and %q share %s", other, b.Name, b.URL)
		}
		urls[b.URL] = b.Name
	}
	if perPage[1] == 0 || perPage[defaultNewsPageID] == 0 {
		t.Errorf("bookmarks per page = %v, want both pages filled", perPage)
	}
	for _, want := range []string{"https://nextdash.cc/", "https://github.com/jordibrouwer/nextdash"} {
		if _, ok := urls[want]; !ok {
			t.Errorf("the seed lacks %s", want)
		}
	}

	if got := store.GetSettings().SmartTodayPageIds; len(got) != 1 || got[0] != 1 {
		t.Errorf("Today pages = %v, want main only", got)
	}

	// Every bookmark's category exists on its own page.
	for _, page := range pages {
		known := map[string]bool{}
		for _, c := range store.GetCategoriesByPage(page.ID) {
			known[c.ID] = true
		}
		for _, b := range bookmarks {
			if b.PageID == page.ID && !known[b.Category] {
				t.Errorf("%q is filed under %q, not a category on page %d", b.Name, b.Category, page.ID)
			}
		}
	}
}

// A data directory that already has pages gets no second starter page, even
// with main's file gone.
func TestSeedLeavesExistingPagesAlone(t *testing.T) {
	useDemoSeed(t)
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if err := os.WriteFile(dir+"/bookmarks-2.json", []byte(`{"page":{"id":2,"name":"mine"},"bookmarks":[]}`), 0644); err != nil {
		t.Fatal(err)
	}
	store := NewStore()
	for _, page := range store.GetPages() {
		if page.ID == 2 && page.Name != "mine" {
			t.Errorf("page 2 was overwritten: %+v", page)
		}
	}
}

// The e2e suite's server keeps the one-page set its specs were written for.
func TestMinimalSeedIsOnePage(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Setenv("NEXTDASH_SEED", "minimal")
	store := NewStore()
	if pages := store.GetPages(); len(pages) != 1 {
		t.Errorf("pages = %+v, want main alone", pages)
	}
	if got := store.GetSettings().SmartTodayPageIds; len(got) != 0 {
		t.Errorf("Today pages = %v, want every page", got)
	}
}

// useDemoSeed undoes TestMain's NEXTDASH_SEED=minimal for one test.
func useDemoSeed(t *testing.T) {
	t.Helper()
	t.Setenv("NEXTDASH_SEED", "")
}
