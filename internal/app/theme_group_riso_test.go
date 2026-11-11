package app

import "testing"

// Riso: three print families in two halves. Text has to clear AA on both
// surfaces it can sit on, whatever the two inks do around it.
func TestRisoThemesFormTheRisoGroup(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	families := []string{"riso-pink-blue", "riso-green-orange", "riso-mimeograph"}
	for _, family := range families {
		if themeDescription(family+"-dark") == "" || len(themeDescriptions[family]) > 75 {
			t.Errorf("%s: description missing or too long", family)
		}
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc, ok := themes[id]
			if !ok {
				t.Fatalf("%s is missing", id)
			}
			meta := themeMetaFor(id, tc)
			if meta.Group != "riso" {
				t.Errorf("%s: group %q, want riso", id, meta.Group)
			}
			if meta.Character == "" {
				t.Errorf("%s: no material underneath", id)
			}
			for field, v := range map[string]string{"tp": tc.TextPrimary, "ts": tc.TextSecondary, "tt": tc.TextTertiary,
				"bg": tc.BackgroundPrimary, "bg2": tc.BackgroundSecondary, "accent": tc.AccentPrimary} {
				if _, ok := parseHexColor(v); !ok {
					t.Errorf("%s: %s %q is not a hex colour", id, field, v)
				}
			}
			bg, _ := parseHexColor(tc.BackgroundPrimary)
			bg2, _ := parseHexColor(tc.BackgroundSecondary)
			for name, hex := range map[string]string{"primary": tc.TextPrimary, "secondary": tc.TextSecondary, "tertiary": tc.TextTertiary,
				"accent": tc.AccentPrimary, "success": tc.AccentSuccess, "warning": tc.AccentWarning, "error": tc.AccentError} {
				fg, _ := parseHexColor(hex)
				for _, surface := range []srgbColor{bg, bg2} {
					if r := contrastRatio(fg, surface); r < 4.5 {
						t.Errorf("%s: %s text %s is %.2f:1 on a surface, want 4.5", id, name, hex, r)
					}
				}
			}
		}
	}
	count := 0
	for id := range themes {
		if themeGroupFor(id) == "riso" {
			count++
		}
	}
	if count != len(families)*2 {
		t.Errorf("%d themes in Riso, want %d", count, len(families)*2)
	}
}
