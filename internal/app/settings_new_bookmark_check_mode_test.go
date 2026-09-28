package app

import "testing"

// A new bookmark starts on Periodic since v1.15.0. Off was the default before
// it, and every install that ever saved its settings wrote that Off down, so
// the new default reached fresh installs only. A stored Off moves once; a mode
// chosen after that stays.

func TestStoredOffCheckModeMovesToPeriodicOnce(t *testing.T) {
	cases := []map[string]any{
		{"currentPage": 1, "newBookmarkCheckMode": "off"},
		{"currentPage": 1},
	}
	for _, seed := range cases {
		t.Chdir(t.TempDir())
		seedSettingsFile(t, seed)

		settings := NewStore().GetSettings()
		if settings.NewBookmarkCheckMode != "periodic" {
			t.Fatalf("upgrade from %v: newBookmarkCheckMode = %q, want periodic", seed, settings.NewBookmarkCheckMode)
		}
		if !settings.NewBookmarkPeriodicMigrated {
			t.Fatalf("upgrade from %v: migration marker not set", seed)
		}
	}
}

func TestChosenCheckModesAreNotMoved(t *testing.T) {
	cases := []map[string]any{
		// Monitor was never a default, so it was chosen.
		{"currentPage": 1, "newBookmarkCheckMode": "monitor"},
		// Off chosen after the migration ran.
		{"currentPage": 1, "newBookmarkCheckMode": "off", "newBookmarkPeriodicMigrated": true},
	}
	for _, seed := range cases {
		t.Chdir(t.TempDir())
		seedSettingsFile(t, seed)

		want := seed["newBookmarkCheckMode"].(string)
		if got := NewStore().GetSettings().NewBookmarkCheckMode; got != want {
			t.Fatalf("seed %v: newBookmarkCheckMode = %q, want %q", seed, got, want)
		}
	}
}
