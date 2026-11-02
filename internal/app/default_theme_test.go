package app

import "testing"

// Tidal Slate is the theme a fresh install starts on, with its light half for auto dark
// mode. An install from before v1.22.0 is still moved onto Aurora Glass once (see
// aurora_glass_migration_test.go) and keeps whatever it chooses afterwards.
func TestTidalSlateIsTheDefaultTheme(t *testing.T) {
	if defaultThemeID != "tidal-slate-dark" || defaultThemeLightID != "tidal-slate-light" {
		t.Fatalf("defaults are %q / %q", defaultThemeID, defaultThemeLightID)
	}
	themes := getDefaultBuiltInThemes()
	for _, id := range []string{defaultThemeID, defaultThemeLightID, auroraGlassThemeID, auroraGlassThemeLightID} {
		if _, ok := themes[id]; !ok {
			t.Errorf("%s is not a built-in theme", id)
		}
	}

	if got := fontSettings(t, nil).Theme; got != defaultThemeID {
		t.Errorf("a fresh install starts on %q", got)
	}
	kept := gridSettings(t, gridFile(map[string]any{"theme": "slate-dark", "auroraGlassMigrated": true}))
	if kept.Theme != "slate-dark" {
		t.Errorf("an install that chose slate-dark after the move was moved to %q", kept.Theme)
	}
}
