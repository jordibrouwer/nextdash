package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

var spatialFamilies = []string{"spatial-diorama", "spatial-lightbox", "spatial-orbit"}

var spatialSurfaces = map[string][]string{
	"spatial-diorama-dark":   {"#3A2E21", "#2C3A31", "#3D2C37"},
	"spatial-diorama-light":  {"#FBF6EA", "#EBD5AE", "#D9E1C5"},
	"spatial-lightbox-dark":  {"#15151C"},
	"spatial-lightbox-light": {"#FBF8EE"},
	"spatial-orbit-dark":     {"#0C0720"},
	"spatial-orbit-light":    {"#FAF7FF"},
}

// These families are drawn structurally, not as glass: the Character
// underneath must be a flat, opaque one, or the glass look comes back.
func TestSpatialIsNotGlass(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range spatialFamilies {
		for _, half := range []string{"-dark", "-light"} {
			tc := themes[family+half]
			switch tc.Character {
			case "glass", "frost", "aurora", "lacquer", "velvet":
				t.Errorf("%s: character %q is a see-through material", family+half, tc.Character)
			}
			if tc.SurfaceAlpha != 0 && tc.SurfaceAlpha < 1 {
				t.Errorf("%s: surfaceAlpha %v makes cards translucent", family+half, tc.SurfaceAlpha)
			}
		}
	}
}

func TestSpatialThemesAreWhole(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range spatialFamilies {
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc, ok := themes[id]
			if !ok {
				t.Fatalf("%s is missing", id)
			}
			if g := themeMetaFor(id, tc).Group; g != "spatial" {
				t.Errorf("%s: group %q, want spatial", id, g)
			}
			if _, known := themeArchetypes[tc.Character]; !known {
				t.Errorf("%s: character %q is not an archetype", id, tc.Character)
			}
			if tc.Backdrop == "" || tc.Surface == "" || tc.Depth == "" {
				t.Errorf("%s: backdrop/surface/depth must be stated", id)
			}
			known := false
			for _, r := range themeBackdropRecipes {
				if r == tc.Backdrop {
					known = true
				}
			}
			if !known {
				t.Errorf("%s: unknown backdrop recipe %q", id, tc.Backdrop)
			}
			if !strings.HasSuffix(tc.Name, "["+strings.TrimPrefix(half, "-")+"]") {
				t.Errorf("%s: name %q does not carry its half", id, tc.Name)
			}
		}
	}
	n := 0
	for id := range themes {
		if themeGroupFor(id) == "spatial" {
			n++
		}
	}
	if n != len(spatialFamilies)*2 {
		t.Errorf("%d themes in Spatial, want %d", n, len(spatialFamilies)*2)
	}
}

func TestSpatialFamiliesDescribed(t *testing.T) {
	for _, family := range spatialFamilies {
		d := themeDescription(family + "-dark")
		if d == "" || d != themeDescription(family+"-light") {
			t.Errorf("%s: description %q", family, d)
		}
		if utf8.RuneCountInString(d) > 75 {
			t.Errorf("%s: description is %d characters", family, utf8.RuneCountInString(d))
		}
	}
}

func TestSpatialPalettesAreLegible(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range spatialFamilies {
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
			// The surfaces theme-group-spatial.css actually paints under the text:
			// Diorama's three papers, Lightbox's film. Keep in step with the CSS.
			for i, hex := range spatialSurfaces[id] {
				bgs["surface"+string(rune('0'+i))] = parse("surface", hex)
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
		}
	}
}
