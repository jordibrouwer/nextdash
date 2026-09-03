package app

import (
	"testing"
)

// The whole-data revision changes when settings.json does, and the client's
// poll only ever reloaded bookmarks, inbox and health on that change — so a
// second device kept showing stale chrome after every config change while
// paying for the poll that knew. A separate fingerprint lets the poll tell the
// two apart.
func TestSettingsRevisionMovesOnlyWithSettings(t *testing.T) {
	tmp := t.TempDir()
	// t.Chdir alone does not isolate this: ResolveDataDir prefers
	// NEXTDASH_DATA_DIR, which TestMain sets for the whole suite, so without
	// this the test shared one directory with every other test and read
	// whatever they had left in bookmarks-1.json.
	t.Setenv("NEXTDASH_DATA_DIR", tmp)
	t.Chdir(tmp)
	store := NewStore()

	before := store.GetSettingsRevision()
	if before == "" {
		t.Fatal("settings revision is empty")
	}

	// A bookmark write moves the data revision and must leave this one alone.
	dataBefore := store.GetDataRevision()
	if err := store.SaveBookmarksByPage(1, []Bookmark{{Name: "A", URL: "https://a.test"}}); err != nil {
		t.Fatal(err)
	}
	if store.GetDataRevision() == dataBefore {
		t.Fatal("data revision did not move on a bookmark write")
	}
	if got := store.GetSettingsRevision(); got != before {
		t.Fatalf("settings revision moved on a bookmark write: %q → %q", before, got)
	}

	settings := store.GetSettings()
	settings.ColumnsPerRow = settings.ColumnsPerRow + 1
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if got := store.GetSettingsRevision(); got == before {
		t.Fatal("settings revision did not move on a settings write")
	}
}
