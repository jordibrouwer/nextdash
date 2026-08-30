package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The shortcut label stopped being a yes/no.
//
// `showShortcuts` answered one question -- is the letter on screen -- and a
// third answer turned out to be the useful one: show it when the row is under
// the pointer or the keyboard selection, and give the width back to the name
// the rest of the time. A boolean has no room for that, so `shortcutDisplay`
// replaces it with "always" | "hover" | "never".
//
// The boolean stays in the struct as the thing to read on an upgrade. What
// these tests pin is the seam between the two: nobody's dashboard changes
// appearance because of the rename, and a fresh install gets the new default.
//
// No migration marker guards this, and it does not need one. The derivation
// only runs when `shortcutDisplay` is absent from the file, so the first save
// after the upgrade ends it permanently -- there is no later restart that can
// reach back and overrule a choice, which is the only thing a marker buys.

// Same idea as writeSettingsFile in settings_shortcut_mode_migration_test.go,
// but into the resolved data dir and from a map, which is what the store reads
// on an ordinary load.
func seedSettingsFile(t *testing.T, body map[string]any) {
	t.Helper()
	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
}

func TestFreshInstallDefaultsShortcutDisplayToAlways(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	settings := NewStore().GetSettings()

	// A new dashboard shows the letters. They are the reminder of what your own
	// shortcuts are, and a dashboard nobody has configured yet is exactly where
	// that reminder is worth its width.
	if settings.ShortcutDisplay != "always" {
		t.Fatalf("fresh install: shortcutDisplay = %q, want %q", settings.ShortcutDisplay, "always")
	}
}

func TestExistingInstallKeepsShortcutsOnScreen(t *testing.T) {
	t.Chdir(t.TempDir())

	// The overwhelming majority of upgrades: the boolean was on, whether the
	// user chose it or inherited it. Their rows must look the same tomorrow.
	seedSettingsFile(t, map[string]any{
		"currentPage":   1,
		"showShortcuts": true,
	})

	settings := NewStore().GetSettings()

	if settings.ShortcutDisplay != "always" {
		t.Fatalf("upgrade with shortcuts on: shortcutDisplay = %q, want %q",
			settings.ShortcutDisplay, "always")
	}
}

func TestExistingInstallWithShortcutsOffIsMigratedToAlways(t *testing.T) {
	t.Chdir(t.TempDir())

	// The old boolean said no, but it was never an answer to this question --
	// it predates the three-way setting. The one-time migration turns the
	// letters on, and records that it ran.
	seedSettingsFile(t, map[string]any{
		"currentPage":   1,
		"showShortcuts": false,
	})

	settings := NewStore().GetSettings()

	if settings.ShortcutDisplay != "always" {
		t.Fatalf("upgrade with shortcuts off: shortcutDisplay = %q, want %q",
			settings.ShortcutDisplay, "always")
	}
	if !settings.ShortcutDisplayAlwaysMigrated {
		t.Fatal("the migration did not record that it ran, so it would run again")
	}
}

func TestChoiceMadeAfterTheMigrationSurvives(t *testing.T) {
	t.Chdir(t.TempDir())

	// Someone turned the letters off after the migration ran. The marker is in
	// the file beside their choice, and neither may be undone by a restart.
	seedSettingsFile(t, map[string]any{
		"currentPage":                   1,
		"shortcutDisplay":               "never",
		"shortcutDisplayAlwaysMigrated": true,
	})

	settings := NewStore().GetSettings()

	if settings.ShortcutDisplay != "never" {
		t.Fatalf("choice after migration: shortcutDisplay = %q, want %q",
			settings.ShortcutDisplay, "never")
	}
}

func TestSettingsFilePredatingShortcutsReadsAlways(t *testing.T) {
	t.Chdir(t.TempDir())

	// Neither key. The boolean's own absent-default is true, so the letters
	// were on screen for this install too.
	seedSettingsFile(t, map[string]any{"currentPage": 1})

	settings := NewStore().GetSettings()

	if settings.ShortcutDisplay != "always" {
		t.Fatalf("settings file predating the setting: shortcutDisplay = %q, want %q",
			settings.ShortcutDisplay, "always")
	}
}

func TestStoredShortcutDisplayOutranksTheLegacyBool(t *testing.T) {
	t.Chdir(t.TempDir())

	// Someone upgraded, then picked "hover". The boolean is still in the file
	// -- nothing rewrites it -- and it must not drag the choice back.
	seedSettingsFile(t, map[string]any{
		"currentPage":     1,
		"showShortcuts":   true,
		"shortcutDisplay": "hover",
	})

	settings := NewStore().GetSettings()

	if settings.ShortcutDisplay != "hover" {
		t.Fatalf("explicit choice: shortcutDisplay = %q, want %q", settings.ShortcutDisplay, "hover")
	}
}

func TestUnknownShortcutDisplayFallsBackToAlways(t *testing.T) {
	t.Chdir(t.TempDir())

	seedSettingsFile(t, map[string]any{
		"currentPage":     1,
		"shortcutDisplay": "sometimes",
	})

	settings := NewStore().GetSettings()

	if settings.ShortcutDisplay != "always" {
		t.Fatalf("unreadable value: shortcutDisplay = %q, want %q", settings.ShortcutDisplay, "always")
	}
}
