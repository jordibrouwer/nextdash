package app

import (
	"path/filepath"
	"testing"
)

// newDiscoveryHandlers is a handler set over a temporary data directory with
// the given bookmarks on page 1, for tests that fetch from local stub servers.
func newDiscoveryHandlers(t *testing.T, bookmarks []Bookmark) *Handlers {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	// The limiter is shared by the whole test binary; start each test empty.
	globalOutboundLimiter.reset()

	store := &FileStore{
		settingsFile: filepath.Join(dir, "settings.json"),
		dataDir:      dir,
		readCache:    newStoreReadCache(),
	}
	store.initializeDefaultFiles()

	settings := store.GetSettings()
	// The test servers live on 127.0.0.1, which the outbound guard refuses
	// unless an install has said local addresses are legitimate targets.
	settings.AllowLocalBookmarks = true
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	pages := store.GetPages()
	if len(pages) == 0 {
		t.Fatal("expected the default install to seed a page")
	}
	if err := store.SaveBookmarksByPage(pages[0].ID, bookmarks); err != nil {
		t.Fatal(err)
	}
	return &Handlers{store: store}
}
