package app

import "testing"

var tactileFamilies = []string{"tactile-label-maker", "tactile-keycap", "tactile-rack-unit"}

func TestTactileThemesFormTheTactileGroup(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range tactileFamilies {
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc, ok := themes[id]
			if !ok {
				t.Fatalf("%s is missing", id)
			}
			meta := themeMetaFor(id, tc)
			if meta.Group != "tactile" {
				t.Errorf("%s: group %q, want tactile", id, meta.Group)
			}
			if meta.Character == "" {
				t.Errorf("%s: no material underneath", id)
			}
			if d := themeDescription(id); d == "" || len(d) > 75 {
				t.Errorf("%s: description %q should exist and stay short", id, d)
			}
		}
	}
	n := 0
	for id := range themes {
		if themeGroupFor(id) == "tactile" {
			n++
		}
	}
	if n != len(tactileFamilies)*2 {
		t.Errorf("%d themes in Tactile, want %d", n, len(tactileFamilies)*2)
	}
}

// Text and every status colour must read on both page colours, since rows are
// painted on the page or on a surface close to it.
func TestTactilePalettesAreLegible(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range tactileFamilies {
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc := themes[id]
			bgs := []string{tc.BackgroundPrimary, tc.BackgroundSecondary}
			fgs := map[string]string{
				"text-primary": tc.TextPrimary, "text-secondary": tc.TextSecondary, "text-tertiary": tc.TextTertiary,
				"accent": tc.AccentPrimary, "success": tc.AccentSuccess, "warning": tc.AccentWarning, "error": tc.AccentError,
			}
			for _, bgHex := range bgs {
				bg, ok := parseHexColor(bgHex)
				if !ok {
					t.Fatalf("%s: bad background %q", id, bgHex)
				}
				for name, hex := range fgs {
					fg, ok := parseHexColor(hex)
					if !ok {
						t.Fatalf("%s: %s is not a hex colour: %q", id, name, hex)
					}
					if r := contrastRatio(fg, bg); r < 4.5 {
						t.Errorf("%s: %s %s on %s is %.2f, want 4.5", id, name, hex, bgHex, r)
					}
				}
			}
		}
	}
}
