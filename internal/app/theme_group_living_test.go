package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

var livingFamilies = []string{"living-tidewatch", "living-daydrift", "living-skywatch"}

func TestLivingThemesAreWhole(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range livingFamilies {
		for _, half := range []string{"dark", "light"} {
			id := family + "-" + half
			tc, ok := themes[id]
			if !ok {
				t.Fatalf("%s is missing", id)
			}
			if g := themeMetaFor(id, tc).Group; g != "living" {
				t.Errorf("%s: group %q, want living", id, g)
			}
			if _, known := themeArchetypes[tc.Character]; !known {
				t.Errorf("%s: character %q is not an archetype", id, tc.Character)
			}
			if tc.Backdrop == "" || tc.Surface == "" || tc.Depth == "" {
				t.Errorf("%s: backdrop/surface/depth must be stated", id)
			}
			if themeBackdropRecipeIndex(tc.Backdrop) < 0 {
				t.Errorf("%s: unknown backdrop recipe %q", id, tc.Backdrop)
			}
			if !strings.HasSuffix(tc.Name, "["+half+"]") {
				t.Errorf("%s: name %q does not carry its half", id, tc.Name)
			}
		}
	}
	n := 0
	for id := range themes {
		if themeGroupFor(id) == "living" {
			n++
		}
	}
	if n != len(livingFamilies)*2 {
		t.Errorf("%d themes in Living, want %d", n, len(livingFamilies)*2)
	}
}

func TestLivingFamiliesDescribed(t *testing.T) {
	for _, family := range livingFamilies {
		d := themeDescription(family + "-dark")
		if d == "" || d != themeDescription(family+"-light") {
			t.Errorf("%s: description %q", family, d)
		}
		if utf8.RuneCountInString(d) > 75 {
			t.Errorf("%s: description is %d characters", family, utf8.RuneCountInString(d))
		}
	}
}

func TestLivingPalettesAreLegible(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range livingFamilies {
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc := themes[id]
			parse := func(label, hex string) srgbColor {
				c, ok := parseHexColor(hex)
				if !ok {
					t.Fatalf("%s: %s %q is not a hex colour", id, label, hex)
				}
				return c
			}
			bgs := map[string]srgbColor{
				"page":  parse("backgroundPrimary", tc.BackgroundPrimary),
				"cards": parse("backgroundSecondary", tc.BackgroundSecondary),
			}
			fgs := map[string]string{
				"textPrimary": tc.TextPrimary, "textSecondary": tc.TextSecondary, "textTertiary": tc.TextTertiary,
				"accent": tc.AccentPrimary, "success": tc.AccentSuccess, "warning": tc.AccentWarning, "error": tc.AccentError,
			}
			for fname, hex := range fgs {
				fg := parse(fname, hex)
				for bname, bg := range bgs {
					if r := contrastRatio(fg, bg); r < 4.5 {
						t.Errorf("%s: %s on %s is %.2f:1, below AA", id, fname, bname, r)
					}
				}
			}
			for _, f := range []string{tc.BackgroundDots, tc.BorderPrimary, tc.BorderSecondary} {
				parse("decor", f)
			}
		}
	}
}

// Daydrift and Skywatch each own a backdrop that is drawn, not just a ground,
// and neither looks like the other nor like the one Tidewatch uses.
func TestLivingBackdropsAreTheirOwn(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	want := map[string]string{"living-daydrift": "sundial", "living-skywatch": "cloudstrata", "living-tidewatch": "swells"}
	seen := map[backdropLook]string{}
	for family, recipe := range want {
		for _, half := range []string{"-dark", "-light"} {
			tc := themes[family+half]
			if tc.Backdrop != recipe {
				t.Errorf("%s: backdrop %q, want %q", family+half, tc.Backdrop, recipe)
			}
			look := themeBackdropImage(family+half, tc)
			if prev, dup := seen[look]; dup {
				t.Errorf("%s draws the same backdrop as %s", family+half, prev)
			}
			seen[look] = family + half
			if len(look.Image) < 400 {
				t.Errorf("%s: backdrop looks like a bare ground (%d bytes)", family+half, len(look.Image))
			}
		}
	}
}
