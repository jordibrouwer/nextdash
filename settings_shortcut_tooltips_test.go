package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The toolbar shortcut hints are off for everyone, not only for new installs.
//
// The setting has been on since it existed and is written into every stored
// settings file, so a default change alone would have left every current
// dashboard exactly as it was. This is the one-time migration that reaches
// them — and the marker is what keeps it one-time, because a flip that ran on
// every start would be a choice taken away rather than a default changed.
func TestShortcutTooltipsDefaultOffEverywhere(t *testing.T) {
	t.Run("fresh install", func(t *testing.T) {
		t.Chdir(t.TempDir())
		if got := NewStore().GetSettings().ShowShortcutTooltips; got {
			t.Fatalf("fresh install: showShortcutTooltips = %v, want false", got)
		}
	})

	t.Run("existing install that had them on", func(t *testing.T) {
		dir := t.TempDir()
		t.Chdir(dir)
		if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
			t.Fatal(err)
		}
		body, _ := json.Marshal(map[string]any{"currentPage": 1, "showShortcutTooltips": true})
		if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
			t.Fatal(err)
		}

		if got := NewStore().GetSettings().ShowShortcutTooltips; got {
			t.Fatalf("existing install: showShortcutTooltips = %v, want false", got)
		}

		// And the migration recorded that it ran.
		raw, err := os.ReadFile(filepath.Join(ResolveDataDir(), "settings.json"))
		if err != nil {
			t.Fatal(err)
		}
		var stored map[string]any
		if err := json.Unmarshal(raw, &stored); err != nil {
			t.Fatal(err)
		}
		if stored["shortcutTooltipsOffMigrated"] != true {
			t.Fatalf("marker = %v, want true", stored["shortcutTooltipsOffMigrated"])
		}
	})

	t.Run("switching them back on sticks", func(t *testing.T) {
		dir := t.TempDir()
		t.Chdir(dir)
		if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
			t.Fatal(err)
		}
		// A file that has already been migrated and then turned back on by hand.
		body, _ := json.Marshal(map[string]any{
			"currentPage":                 1,
			"showShortcutTooltips":        true,
			"shortcutTooltipsOffMigrated": true,
		})
		if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
			t.Fatal(err)
		}
		if got := NewStore().GetSettings().ShowShortcutTooltips; !got {
			t.Fatal("a deliberate re-enable was overwritten by the migration")
		}
	})
}
