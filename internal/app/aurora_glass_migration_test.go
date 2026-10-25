package app

import "testing"

// Every existing install is moved onto Aurora Glass once, on the half it was on, and what it had
// is kept for the dialog that says so.
func TestExistingInstallMovesOntoAuroraGlass(t *testing.T) {
	for from, want := range map[string]string{
		"slate-dark": "aurora-glass-dark", "slate-light": "aurora-glass-light",
		"dark": "aurora-glass-dark", "light": "aurora-glass-light", "my-own-theme": "aurora-glass-dark",
	} {
		got := gridSettings(t, gridFile(map[string]any{"theme": from}))
		if got.Theme != want {
			t.Errorf("%s moved to %q, want %q", from, got.Theme, want)
		}
		if got.LookMigration == nil || !got.LookMigration.Pending || got.LookMigration.From != from {
			t.Errorf("%s: nothing was kept for the dialog: %+v", from, got.LookMigration)
		}
		if !got.AuroraGlassMigrated {
			t.Errorf("%s: no marker", from)
		}
	}
}

// An install already on Aurora Glass has nothing to explain.
func TestInstallOnAuroraGlassGetsNoDialog(t *testing.T) {
	got := gridSettings(t, gridFile(map[string]any{"theme": "aurora-glass-light"}))
	if got.Theme != "aurora-glass-light" || got.LookMigration != nil || !got.AuroraGlassMigrated {
		t.Errorf("an install on Aurora Glass was touched: %q %+v", got.Theme, got.LookMigration)
	}
}

// A fresh install starts on Aurora Glass with the marker, and is told nothing.
func TestFreshInstallIsNotToldAboutTheMove(t *testing.T) {
	got := gridSettings(t, nil)
	if got.Theme != defaultThemeID || got.LookMigration != nil || !got.AuroraGlassMigrated {
		t.Errorf("a fresh install: %q %+v marker %v", got.Theme, got.LookMigration, got.AuroraGlassMigrated)
	}
}

// The move happens once: a reader who goes back keeps the theme they chose.
func TestTheMoveHappensOnce(t *testing.T) {
	got := gridSettings(t, gridFile(map[string]any{"theme": "slate-dark", "auroraGlassMigrated": true}))
	if got.Theme != "slate-dark" || got.LookMigration != nil {
		t.Errorf("an answered install moved again: %q %+v", got.Theme, got.LookMigration)
	}
}
