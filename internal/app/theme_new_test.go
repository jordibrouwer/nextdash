package app

import "testing"

// The families added in this collection say so, both halves, and nothing
// older does -- the browser searches on it.
func TestNewThemesAreMarkedNew(t *testing.T) {
	colors := getDefaultBuiltInThemes()
	for _, id := range []string{"tidepool-lens-dark", "tidepool-lens-light", "matrix-rain-dark", "vermilion-seal-light"} {
		if !themeMetaFor(id, colors[id]).New {
			t.Errorf("%s is not marked new", id)
		}
	}
	for _, id := range []string{"sea-glass-dark", "tarnished-brass-light", "gloss-obsidian-mirror-dark"} {
		if themeMetaFor(id, colors[id]).New {
			t.Errorf("%s is marked new", id)
		}
	}
	// Every family on the list exists, in both halves.
	for family := range themeNewFamilies {
		for _, half := range []string{"-dark", "-light"} {
			if _, ok := colors[family+half]; !ok {
				t.Errorf("new family %s has no %s theme", family, half)
			}
		}
	}
}
