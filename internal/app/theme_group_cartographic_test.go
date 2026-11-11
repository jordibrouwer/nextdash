package app

import (
	"regexp"
	"testing"
)

var cartographicFamilies = []string{"atlas", "nautical", "subway"}

// Both halves of every family exist, file under the group, wear a real
// material and have a line in the theme browser.
func TestCartographicThemesFormTheGroup(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range cartographicFamilies {
		id := "cartographic-" + family
		if themeDescriptions[id] == "" {
			t.Errorf("%s has no description", id)
		}
		for _, half := range []string{"-dark", "-light"} {
			tc, ok := themes[id+half]
			if !ok {
				t.Fatalf("%s is missing", id+half)
			}
			meta := themeMetaFor(id+half, tc)
			if meta.Group != "cartographic" {
				t.Errorf("%s: group %q, want cartographic", id+half, meta.Group)
			}
			if _, known := themeArchetypes[tc.Character]; !known {
				t.Errorf("%s: character %q is not an archetype", id+half, tc.Character)
			}
			if tc.Backdrop == "" || themeBackdropRecipeIndex(tc.Backdrop) < 0 {
				t.Errorf("%s: backdrop %q is not a recipe", id+half, tc.Backdrop)
			}
		}
	}
	count := 0
	for id := range themes {
		if themeGroupFor(id) == "cartographic" {
			count++
		}
	}
	if count != len(cartographicFamilies)*2 {
		t.Errorf("%d themes in Cartographic, want %d", count, len(cartographicFamilies)*2)
	}
}

// Text and accent are all drawn as text somewhere (links, focus labels,
// coordinates), so each must clear AA on the page and on the raised surface.
func TestCartographicPalettesAreLegible(t *testing.T) {
	hex := regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	for id, tc := range cartographicGroupThemes() {
		fields := map[string]string{
			"text": tc.TextPrimary, "text2": tc.TextSecondary, "text3": tc.TextTertiary,
			"accent": tc.AccentPrimary, "ok": tc.AccentSuccess, "warn": tc.AccentWarning, "err": tc.AccentError,
			"bg": tc.BackgroundPrimary, "bg2": tc.BackgroundSecondary, "dots": tc.BackgroundDots,
			"border": tc.BorderPrimary, "border2": tc.BorderSecondary,
		}
		for name, v := range fields {
			if !hex.MatchString(v) {
				t.Errorf("%s.%s = %q, want #RRGGBB", id, name, v)
			}
		}
		bg, _ := parseHexColor(tc.BackgroundPrimary)
		bg2, _ := parseHexColor(tc.BackgroundSecondary)
		for _, name := range []string{"text", "text2", "text3", "accent", "ok", "warn", "err"} {
			fg, ok := parseHexColor(fields[name])
			if !ok {
				continue
			}
			for label, ground := range map[string]srgbColor{"page": bg, "surface": bg2} {
				if r := contrastRatio(fg, ground); r < 4.5 {
					t.Errorf("%s: %s on %s is %.2f:1, below AA 4.5", id, name, label, r)
				}
			}
		}
	}
}
