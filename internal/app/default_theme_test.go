package app

import "testing"

// Berry is the theme a fresh install starts on, with its light half for auto
// dark mode. An install that already has a theme keeps it.
func TestBerryIsTheDefaultTheme(t *testing.T) {
	if defaultThemeID != "look-berry-dark" || defaultThemeLightID != "look-berry-light" {
		t.Fatalf("defaults are %q / %q", defaultThemeID, defaultThemeLightID)
	}
	themes := getDefaultBuiltInThemes()
	for _, id := range []string{defaultThemeID, defaultThemeLightID} {
		if _, ok := themes[id]; !ok {
			t.Errorf("%s is not a built-in theme", id)
		}
	}

	if got := fontSettings(t, nil).Theme; got != defaultThemeID {
		t.Errorf("a fresh install starts on %q", got)
	}
	kept := gridSettings(t, gridFile(map[string]any{"theme": "slate-dark"}))
	if kept.Theme != "slate-dark" {
		t.Errorf("an install on slate-dark moved to %q", kept.Theme)
	}
}
