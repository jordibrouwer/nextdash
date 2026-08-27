package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/*
The button bar defaults to the bottom-right corner.

It used to sit centred above the bookmarks, floating over the thing people came
to look at. The corner dock keeps the same buttons out of the way.

Two facts, and the second is the one worth guarding: a reader who chose the
centred bar keeps it. The default only fills in for a file that never named a
position, so changing it must not quietly move anyone's bar.
*/
func TestButtonBarDefaultsToBottomRight(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	store := NewStore()

	if got := store.GetSettings().ButtonBarPosition; got != "bottom-right" {
		t.Errorf("fresh install = %q, want bottom-right", got)
	}
}

func TestButtonBarKeepsAChosenPosition(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	// A file that names the centred bar: somebody picked it.
	writeSettingsWith(t, dir, map[string]any{"buttonBarPosition": "bottom"})

	store := NewStore()
	if got := store.GetSettings().ButtonBarPosition; got != "bottom" {
		t.Errorf("chosen position = %q, want it left alone", got)
	}
}

// A file written before the key existed has no choice recorded, so it takes the
// new default rather than being pinned to the old one for ever.
func TestButtonBarFillsInTheDefaultWhenTheKeyIsAbsent(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	writeSettingsWith(t, dir, map[string]any{"theme": "dark"})

	store := NewStore()
	if got := store.GetSettings().ButtonBarPosition; got != "bottom-right" {
		t.Errorf("absent key = %q, want the default", got)
	}
}

// A value the server does not accept is rewritten rather than kept.
func TestButtonBarRewritesAnUnknownPosition(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	writeSettingsWith(t, dir, map[string]any{"buttonBarPosition": "somewhere-else"})

	store := NewStore()
	if got := store.GetSettings().ButtonBarPosition; got != "bottom-right" {
		t.Errorf("unknown position = %q, want the default", got)
	}
}

func writeSettingsWith(t *testing.T, dir string, values map[string]any) {
	t.Helper()
	data, err := json.Marshal(values)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), data, 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
}
