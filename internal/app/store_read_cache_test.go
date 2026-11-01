package app

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
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
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

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
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

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
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

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

// Without pages.json the order is made up from the page files. It was taken
// from a map, so the tabs came back shuffled and were saved that way.
func TestDefaultPageOrderIsByID(t *testing.T) {
	dir := t.TempDir()
	for id := 1; id <= 9; id++ {
		page := fmt.Sprintf(`{"page":{"id":%d,"name":"P%d"},"bookmarks":[]}`, id, id)
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("bookmarks-%d.json", id)), []byte(page), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		dataDir:       dir,
		pageOrderFile: filepath.Join(dir, "pages.json"),
		readCache:     newStoreReadCache(),
	}
	pages := store.GetPages()
	for i, page := range pages {
		if page.ID != i+1 {
			t.Fatalf("pages = %+v, want ids 1..9 in order", pages)
		}
	}
	if order := store.GetPageOrder(); fmt.Sprint(order) != "[1 2 3 4 5 6 7 8 9]" {
		t.Fatalf("saved order = %v", order)
	}
}

// Every reference field of Settings must come back as the caller's own: a
// shared map written by one handler while another encodes it is a fatal
// error. Filling each field through reflection makes this fail as soon as a
// new map, slice or pointer field is added without a line in cloneSettings.
func TestCloneSettingsSharesNoReferences(t *testing.T) {
	var in Settings
	v := reflect.ValueOf(&in).Elem()
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		switch f.Kind() {
		case reflect.Map:
			f.Set(reflect.MakeMapWithSize(f.Type(), 1))
			f.SetMapIndex(reflect.Zero(f.Type().Key()), reflect.Zero(f.Type().Elem()))
		case reflect.Slice:
			f.Set(reflect.MakeSlice(f.Type(), 1, 1))
		case reflect.Pointer:
			f.Set(reflect.New(f.Type().Elem()))
		}
	}
	out := reflect.ValueOf(cloneSettings(in))
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		switch f.Kind() {
		case reflect.Map, reflect.Slice, reflect.Pointer:
			if f.UnsafePointer() == out.Field(i).UnsafePointer() {
				t.Errorf("Settings.%s is shared after cloneSettings", v.Type().Field(i).Name)
			}
		}
	}
	if (cloneSettings(Settings{}).DockerBookmarkLinks) != nil {
		t.Errorf("a nil map must stay nil")
	}
}

// The cache keeps its own map: a caller writing into what GetSettings gave it
// must not change what the next caller reads.
func TestGetSettingsMapIsTheCallersOwn(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{settingsFile: dir + "/settings.json", dataDir: dir, readCache: newStoreReadCache()}
	store.initializeDefaultFiles()
	store.readCache.settings = Settings{DockerBookmarkLinks: map[string]string{"a": "1"}}
	store.readCache.settingsOK = true
	first := store.GetSettings()
	first.DockerBookmarkLinks["b"] = "2"
	if got := store.GetSettings().DockerBookmarkLinks; len(got) != 1 {
		t.Fatalf("cached map changed by a caller: %v", got)
	}
}

// A settings.json that does not decode is not cached: once it is repaired,
// the next read sees the repair without a restart.
func TestUndecodableSettingsAreNotCached(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{settingsFile: dir + "/settings.json", dataDir: dir, readCache: newStoreReadCache()}
	if err := os.WriteFile(store.settingsFile, []byte(`{"theme":"x",`), 0o644); err != nil {
		t.Fatal(err)
	}
	store.GetSettings()
	if err := os.WriteFile(store.settingsFile, []byte(`{"dockerHiddenContainers":["repaired"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := store.GetSettings().DockerHiddenContainers; len(got) != 1 || got[0] != "repaired" {
		t.Fatalf("hidden = %v, want [repaired]", got)
	}
}
