package app

import (
	"testing"
)

func TestStoreReadCacheHitsUntilMutation(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile: dir + "/settings.json",
		dataDir:      dir,
		readCache:    newStoreReadCache(),
	}
	store.initializeDefaultFiles()

	before := store.GetSettings().Theme
	store.readCache.settingsOK = true
	store.readCache.settings = store.GetSettings()
	store.readCache.settings.Theme = "cached-theme"

	if got := store.GetSettings().Theme; got != "cached-theme" {
		t.Fatalf("cached theme = %q, want cached-theme", got)
	}

	store.SaveSettings(Settings{Theme: before})
	if got := store.GetSettings().Theme; got == "cached-theme" {
		t.Fatalf("theme still cached after SaveSettings")
	}
}

// A write to one page used to invalidate the read cache for every page,
// settings, colors, finders — the works — because noteDataMutation had no
// concept of scope. Saving page 1 now leaves page 2's cached bookmarks and
// categories alone; GetAllBookmarks/GetPages/GetPageOrder still invalidate on
// every write regardless of scope, since their contents can depend on any
// page's file (see the comment on noteDataMutation).
func TestScopedMutationLeavesOtherPagesCached(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	if err := store.SaveBookmarksByPage(1, []Bookmark{{Name: "Page1", URL: "https://one.example.com"}}); err != nil {
		t.Fatalf("save page 1: %v", err)
	}
	if err := store.SaveBookmarksByPage(2, []Bookmark{{Name: "Page2", URL: "https://two.example.com"}}); err != nil {
		t.Fatalf("save page 2: %v", err)
	}

	fs := store.(*FileStore)

	// Prime both pages' caches, then poison page 2's cached entry so a real
	// cache hit is unmistakable from a fallthrough to disk.
	if got := store.GetBookmarksByPage(2); len(got) != 1 {
		t.Fatalf("priming page 2: len = %d, want 1", len(got))
	}
	fs.mutex.Lock()
	fs.readCache.bookmarks[2] = []Bookmark{{Name: "Poisoned", URL: "https://poisoned.example.com"}}
	fs.mutex.Unlock()

	// A page-1-scoped write must not touch page 2's cache entry.
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "Page1", URL: "https://one.example.com"},
		{Name: "Page1b", URL: "https://one-b.example.com"},
	}); err != nil {
		t.Fatalf("save page 1 again: %v", err)
	}

	got := store.GetBookmarksByPage(2)
	if len(got) != 1 || got[0].Name != "Poisoned" {
		t.Fatalf("page 2 cache = %+v, want the still-poisoned entry (unscoped write leaked into it)", got)
	}
}

// The control for the test above: a write with no single-page scope (page
// create/delete, settings, page order, ...) must still invalidate everything,
// matching the pre-scoping behavior. Falsifies the same way: if
// noteDataMutation's pageID<=0 branch stopped calling invalidateReadCache,
// this would start seeing the poisoned entry too.
func TestUnscopedMutationStillInvalidatesEverything(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	if err := store.SaveBookmarksByPage(1, []Bookmark{{Name: "Page1", URL: "https://one.example.com"}}); err != nil {
		t.Fatalf("save page 1: %v", err)
	}

	fs := store.(*FileStore)
	if got := store.GetBookmarksByPage(1); len(got) != 1 {
		t.Fatalf("priming page 1: len = %d, want 1", len(got))
	}
	fs.mutex.Lock()
	fs.readCache.bookmarks[1] = []Bookmark{{Name: "Poisoned", URL: "https://poisoned.example.com"}}
	fs.mutex.Unlock()

	// SaveSettings has no page scope — it must still wipe the whole cache.
	if err := store.SaveSettings(store.GetSettings()); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	got := store.GetBookmarksByPage(1)
	if len(got) != 1 || got[0].Name != "Page1" {
		t.Fatalf("page 1 cache = %+v, want the real entry (unscoped write did not invalidate)", got)
	}
}

// GetAllBookmarks/GetPages must stay correct after a scoped write even though
// bookmarks[otherPageID] is left cached — both aggregate across pages, and a
// page-1-scoped write changing page 1's bookmark count is exactly the kind of
// cross-page effect that must not be missed.
func TestScopedMutationStillInvalidatesCrossPageAggregates(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	if err := store.SaveBookmarksByPage(1, []Bookmark{{Name: "Page1", URL: "https://one.example.com"}}); err != nil {
		t.Fatalf("save page 1: %v", err)
	}
	if err := store.SaveBookmarksByPage(2, []Bookmark{{Name: "Page2", URL: "https://two.example.com"}}); err != nil {
		t.Fatalf("save page 2: %v", err)
	}

	if got := len(store.GetAllBookmarks()); got != 2 {
		t.Fatalf("GetAllBookmarks before = %d, want 2", got)
	}

	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "Page1", URL: "https://one.example.com"},
		{Name: "Page1b", URL: "https://one-b.example.com"},
	}); err != nil {
		t.Fatalf("save page 1 again: %v", err)
	}

	if got := len(store.GetAllBookmarks()); got != 3 {
		t.Fatalf("GetAllBookmarks after = %d, want 3 — stale aggregate cache after a scoped write", got)
	}
}

func TestPrecomputedAssetHashesMatchRuntime(t *testing.T) {
	if len(precomputedAssetHashes) == 0 {
		t.Fatal("precomputedAssetHashes is empty; run go generate")
	}
	initAssetHashing(nil)
	for rel, want := range precomputedAssetHashes {
		if got := assetHash(rel); got != want {
			t.Fatalf("assetHash(%q) = %q, want precomputed %q", rel, got, want)
		}
	}
}
