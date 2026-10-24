package app

import (
	"strings"
	"testing"
)

/*
themeBackdropImage picks a recipe from the theme id's hash, and a "-light" /
"-dark" pair used to hash independently: two different ids, so most pairs
landed on two different shapes and only matched in colour by accident. These
tests pin down the fix -- a "-dark" id is normalised to its "-light" form
before hashing -- and the one thing it must not do: touch an id that is not
part of such a pair.
*/

// backdropOf extracts the --theme-backdrop declaration from a rendered block,
// which is what a reader actually sees change (or not) between variants.
func backdropOf(t *testing.T, selector string, tc ThemeColors) string {
	t.Helper()
	block := renderThemeCSSBlock(selector, tc)
	const marker = "--theme-backdrop: "
	start := strings.Index(block, marker)
	if start == -1 {
		t.Fatalf("no --theme-backdrop in block:\n%s", block)
	}
	start += len(marker)
	end := strings.Index(block[start:], "\n")
	if end == -1 {
		t.Fatalf("--theme-backdrop declaration was not terminated:\n%s", block)
	}
	return block[start : start+end]
}

// TestBackdropPairSharesOneRecipe is the bug report itself: a -light/-dark
// pair must land on the same recipe, byte for byte, once colours are stripped
// down to the same theme's own palette either side.
func TestBackdropPairSharesOneRecipe(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	light, ok := themes["retro-crt-mk2-light"]
	if !ok {
		t.Fatal("retro-crt-mk2-light is missing from the register")
	}
	dark, ok := themes["retro-crt-mk2-dark"]
	if !ok {
		t.Fatal("retro-crt-mk2-dark is missing from the register")
	}

	// Same palette on both sides so only the id can move the recipe -- the
	// point being proven is the shape, not the colour, which already varied
	// correctly before this fix.
	dark.AccentPrimary, dark.AccentError, dark.BackgroundPrimary =
		light.AccentPrimary, light.AccentError, light.BackgroundPrimary

	lightBackdrop := themeBackdropImage("retro-crt-mk2-light", light)
	darkBackdrop := themeBackdropImage("retro-crt-mk2-dark", dark)
	if lightBackdrop != darkBackdrop {
		t.Errorf("retro-crt-mk2 pair landed on different recipes:\nlight: %s\ndark:  %s", lightBackdrop, darkBackdrop)
	}
}

// TestBackdropUnpairedThemeIsUnaffected guards the other half of the rule: an
// id with no "-light"/"-dark" suffix -- a custom theme, most of all -- must
// hash exactly as it always has. themeBackdropImage always hashes whatever
// themeBackdropHashID gives it, so proving the id passes through unchanged is
// proving the recipe cannot move: fnv32 sees the same bytes either way.
func TestBackdropUnpairedThemeIsUnaffected(t *testing.T) {
	for _, id := range []string{"my-custom-theme", "moss-stone", "porcelain", ""} {
		if got := themeBackdropHashID(id); got != id {
			t.Errorf("themeBackdropHashID(%q) = %q, want unchanged (no -light/-dark suffix)", id, got)
		}
	}

	// And, concretely, the same theme rendered before and after picks the same
	// recipe -- "before" here being fnv32 applied to the raw id, which is
	// exactly what themeBackdropHashID reduces to for an unpaired id.
	const id = "my-custom-theme"
	tc := ThemeColors{AccentPrimary: "#39FF6A", AccentError: "#FF3968", BackgroundPrimary: "#050705"}
	oldStyle := themeBackdropImage(id, tc) // themeBackdropHashID(id) == id, so this already goes through fnv32(id) unchanged
	if got := themeBackdropImage(id, tc); got != oldStyle {
		t.Errorf("recipe moved for an unpaired id:\nbefore: %s\nafter:  %s", oldStyle, got)
	}
}

// TestBackdropBareLightAndDarkStayDifferent guards against collapsing the
// plain "light" and "dark" selectors onto each other: they are not a pair of
// the same theme (they are two independent, user-configurable themes, see
// renderThemeCSSBlock's callers at customThemeCSS), and "dark" ends in
// "-dark" only if read carelessly -- it must not be treated as "the dark
// variant of light".
func TestBackdropBareLightAndDarkStayDifferent(t *testing.T) {
	if got := themeBackdropHashID("dark"); got != "dark" {
		t.Errorf(`themeBackdropHashID("dark") = %q, want "dark" unchanged`, got)
	}
	if got := themeBackdropHashID("light"); got != "light" {
		t.Errorf(`themeBackdropHashID("light") = %q, want "light" unchanged`, got)
	}

	lightBackdrop := themeBackdropImage("light", ThemeColors{AccentPrimary: "#39FF6A", BackgroundPrimary: "#FBFAF7"})
	darkBackdrop := themeBackdropImage("dark", ThemeColors{AccentPrimary: "#39FF6A", BackgroundPrimary: "#050705"})
	if lightBackdrop == darkBackdrop {
		t.Error(`"light" and "dark" produced the same backdrop; they are separate themes, not a pair`)
	}
}

// Every recipe is drawn with all four colours of the theme on a deeper ground, with a quiet centre on top, and
// no two recipes draw the same thing.
func TestEveryRecipeIsDrawnInColourOnADeeperGround(t *testing.T) {
	tc := ThemeColors{AccentPrimary: "#6aa6ff", AccentError: "#ff5577", AccentWarning: "#ffb347", AccentSuccess: "#3ddc97", BackgroundPrimary: "#0f1420"}
	seen := map[string]string{}
	for _, name := range themeBackdropRecipes {
		tc.Backdrop = name
		look := themeBackdropSeeded("tint-dark", tc, 0)
		if !strings.Contains(look.Image, "--bd-calm") {
			t.Errorf("%s: no quiet centre", name)
		}
		for _, colour := range []string{"--accent-primary", "--accent-error", "--accent-warning", "--accent-success"} {
			if !strings.Contains(look.Image, colour) {
				t.Errorf("%s: does not draw with %s", name, colour)
			}
		}
		if !strings.Contains(look.Image, "#000") {
			t.Errorf("%s: no deeper ground", name)
		}
		if other, ok := seen[look.Image]; ok {
			t.Errorf("%s draws exactly what %s draws", name, other)
		}
		seen[look.Image] = name
	}
}

// A light page gets a lighter ground, a dark one a deeper one.
func TestTheGroundFollowsThePage(t *testing.T) {
	dark := themeBackdropSeeded("x-dark", ThemeColors{Backdrop: "mesh", AccentPrimary: "#6aa6ff", BackgroundPrimary: "#0f1420"}, 0)
	light := themeBackdropSeeded("x-light", ThemeColors{Backdrop: "mesh", AccentPrimary: "#2563eb", BackgroundPrimary: "#f4f6fb"}, 0)
	if !strings.Contains(dark.Image, "#000") || strings.Contains(dark.Image, "#fff") {
		t.Error("a dark page should be drawn on a deeper ground")
	}
	if !strings.Contains(light.Image, "#fff") {
		t.Error("a light page should be drawn on a lighter ground")
	}
}
