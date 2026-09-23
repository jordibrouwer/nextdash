package app

import (
	"strings"
	"testing"
)

// A dark palette and a light one, so the tests that care about the page have
// both to hand. Deliberately ordinary: nothing here should depend on a
// particular hue.
var (
	darkPalette = ThemeColors{
		TextPrimary:       "#E9EDFC",
		BackgroundPrimary: "#0B1020",
		BackgroundDots:    "#1E2748",
		AccentPrimary:     "#7DA2FF",
		AccentSuccess:     "#46D399",
	}
	lightPalette = ThemeColors{
		TextPrimary:       "#1A1F2B",
		BackgroundPrimary: "#F6F7FB",
		BackgroundDots:    "#DFE3EF",
		AccentPrimary:     "#3355CC",
		AccentSuccess:     "#1B9E6B",
	}
)

func withCharacter(tc ThemeColors, name string) ThemeColors {
	tc.Character = name
	return tc
}

// The catalogue and the order it is shown in have to name the same set. They
// are two literals in one file, which is exactly the pair that drifts.
func TestArchetypeOrderMatchesCatalogue(t *testing.T) {
	if len(themeArchetypeOrder) != len(themeArchetypes) {
		t.Fatalf("order lists %d archetypes, catalogue has %d",
			len(themeArchetypeOrder), len(themeArchetypes))
	}
	seen := map[string]bool{}
	for _, name := range themeArchetypeOrder {
		if _, ok := themeArchetypes[name]; !ok {
			t.Errorf("order names %q, which the catalogue does not define", name)
		}
		if seen[name] {
			t.Errorf("order names %q twice", name)
		}
		seen[name] = true
	}
}

// The whole arrangement rests on this: an archetype fills in blanks and never
// overrules a theme that spoke for itself.
func TestExplicitFieldsBeatTheArchetype(t *testing.T) {
	tc := withCharacter(darkPalette, "terminal") // radius 0.05, sheen 0
	tc.RadiusScale = 1.4
	tc.Sheen = 0.9
	tc.LabelWeight = 400

	if got := archetypeRadius(tc); got != 1.4 {
		t.Errorf("radius: the theme said 1.4, archetype gave %v", got)
	}
	if got := archetypeSheen(tc); got != 0.9 {
		t.Errorf("sheen: the theme said 0.9, archetype gave %v", got)
	}
	if _, _, weight := archetypeLabel(tc); weight != 400 {
		t.Errorf("label weight: the theme said 400, archetype gave %v", weight)
	}
}

// A theme file from somewhere else cannot invent an archetype by misspelling
// one: an unknown word has to behave exactly like no word at all.
func TestUnknownArchetypeIsNoArchetype(t *testing.T) {
	plain := darkPalette
	odd := withCharacter(darkPalette, "lacqeur") // misspelled on purpose

	if archetypeSheen(odd) != archetypeSheen(plain) {
		t.Errorf("an unknown archetype changed the sheen")
	}
	if archetypeRadius(odd) != archetypeRadius(plain) {
		t.Errorf("an unknown archetype changed the radius")
	}
	if themeSurfaceAlpha(odd) != themeSurfaceAlpha(plain) {
		t.Errorf("an unknown archetype changed the alpha")
	}
	if isKnownArchetype("lacqeur") {
		t.Errorf("isKnownArchetype accepted a misspelling")
	}
	if !isKnownArchetype("  LACQUER ") {
		t.Errorf("isKnownArchetype rejected a known name with case and spaces")
	}
}

// A theme that names no archetype must render exactly as it did before this
// file existed. This is the guarantee for the 218 entries nobody has touched.
func TestNoCharacterLeavesEveryTokenAlone(t *testing.T) {
	for _, tc := range []ThemeColors{darkPalette, lightPalette} {
		if got, want := themeSurfaceAlpha(tc), formatFloat(derivedSurfaceAlpha(tc)); got != want {
			t.Errorf("alpha drifted without an archetype: %s, want %s", got, want)
		}
		if archetypeSheen(tc) != 0 {
			t.Errorf("sheen without an archetype should be 0")
		}
		if archetypeRadius(tc) != 1 {
			t.Errorf("radius without an archetype should be 1")
		}
		if _, scale := archetypeGrain(tc); scale != 0 {
			t.Errorf("grain without an archetype should be 0")
		}
	}
}

// Glass lets more of the page through than the same palette does bare, and
// blurs more because of it -- the blur follows the alpha that is drawn.
func TestGlassIsMoreTransparentAndMoreBlurred(t *testing.T) {
	plain := darkPalette
	glass := withCharacter(darkPalette, "glass")

	bare := derivedSurfaceAlpha(plain)
	got := archetypeScaleAlpha(glass, bare)
	if got >= bare {
		t.Errorf("glass alpha %v is not below the bare %v", got, bare)
	}
	if themeSurfaceBlur(glass) == themeSurfaceBlur(plain) {
		t.Errorf("glass blurs the same as a theme with no archetype")
	}
}

// Paper, terminal and ink are the archetypes that refuse. None of them may
// come out translucent or blurred, whatever the palette would have derived.
func TestMatteArchetypesRefuseBlurAndTransparency(t *testing.T) {
	for _, name := range []string{"paper", "terminal", "ink"} {
		for _, palette := range []ThemeColors{darkPalette, lightPalette} {
			tc := withCharacter(palette, name)
			if got := themeSurfaceBlur(tc); got != "0" {
				t.Errorf("%s: blur is %s, want 0", name, got)
			}
			if got := archetypeSheen(tc); got != 0 {
				t.Errorf("%s: sheen is %v, want 0", name, got)
			}
		}
	}
}

// The two archetypes with an opinion about geometry have to keep it on a page
// that would otherwise decide the other way.
func TestGlowLiftIsForcedWhereTheArchetypeInsists(t *testing.T) {
	if got := themeGlowLift(withCharacter(lightPalette, "neon")); got != "1" {
		t.Errorf("neon on a light page: glow lift %s, want 1 (a halo)", got)
	}
	if got := themeGlowLift(withCharacter(darkPalette, "velvet")); got != "0" {
		t.Errorf("velvet on a dark page: glow lift %s, want 0 (a shadow)", got)
	}
	// And an archetype with no opinion still leaves it to the page.
	if got := themeGlowLift(withCharacter(lightPalette, "lacquer")); got != "0" {
		t.Errorf("lacquer on a light page: glow lift %s, want 0", got)
	}
	if got := themeGlowLift(withCharacter(darkPalette, "lacquer")); got != "1" {
		t.Errorf("lacquer on a dark page: glow lift %s, want 1", got)
	}
}

// Only two archetypes weave or brush; every other one has to come out with
// nothing, or the token would be drawn across the whole collection.
func TestOnlyBrushedAndCarbonCarryGrain(t *testing.T) {
	want := map[string]bool{"brushed": true, "carbon": true}
	for _, name := range themeArchetypeOrder {
		_, scale := archetypeGrain(withCharacter(darkPalette, name))
		if want[name] && scale <= 0 {
			t.Errorf("%s: grain scale %v, want above 0", name, scale)
		}
		if !want[name] && scale != 0 {
			t.Errorf("%s: grain scale %v, want 0", name, scale)
		}
	}
}

// An angle somebody did arithmetic on wraps rather than being refused.
func TestGrainAngleWraps(t *testing.T) {
	tc := darkPalette
	tc.GrainAngle = 370
	tc.GrainScale = 0.5
	if angle, _ := archetypeGrain(tc); angle != 10 {
		t.Errorf("370 degrees came out as %v, want 10", angle)
	}
	tc.GrainAngle = -20
	if angle, _ := archetypeGrain(tc); angle != 340 {
		t.Errorf("-20 degrees came out as %v, want 340", angle)
	}
}

// No archetype may push a token past what a theme could have asked for by
// hand. The scales multiply, so this is the one that catches an arithmetic
// slip in the catalogue.
func TestArchetypesStayInsideTheClamps(t *testing.T) {
	for _, name := range themeArchetypeOrder {
		for _, palette := range []ThemeColors{darkPalette, lightPalette} {
			tc := withCharacter(palette, name)

			alpha := archetypeScaleAlpha(tc, derivedSurfaceAlpha(tc))
			if alpha < 0.3 || alpha > 1 {
				t.Errorf("%s: alpha %v outside 0.3-1", name, alpha)
			}
			if sheen := archetypeSheen(tc); sheen < 0 || sheen > 1 {
				t.Errorf("%s: sheen %v outside 0-1", name, sheen)
			}
			if radius := archetypeRadius(tc); radius < 0.05 || radius > 1.6 {
				t.Errorf("%s: radius %v outside 0.05-1.6", name, radius)
			}
			if _, scale := archetypeGrain(tc); scale < 0 || scale > 1 {
				t.Errorf("%s: grain %v outside 0-1", name, scale)
			}
		}
	}
}

// The rendered block has to carry the new tokens, or none of the above
// reaches a browser.
func TestRenderedBlockCarriesTheGrainTokens(t *testing.T) {
	css := renderThemeCSSBlock("demo", withCharacter(darkPalette, "brushed"))
	for _, want := range []string{"--theme-grain-angle:", "--theme-grain-scale:"} {
		if !strings.Contains(css, want) {
			t.Errorf("the rendered block has no %s", want)
		}
	}
	if strings.Contains(css, "--theme-grain-scale: 0;") {
		t.Errorf("brushed rendered with no grain")
	}
}

// The one archetype about the page binds a recipe, and a theme's own choice
// still beats it.
func TestAuroraBindsABackdropRecipe(t *testing.T) {
	if got := archetypeBackdrop(withCharacter(darkPalette, "aurora")); got != "blooms" {
		t.Errorf("aurora bound %q, want blooms", got)
	}
	tc := withCharacter(darkPalette, "aurora")
	tc.Backdrop = "scanlines"
	if got := archetypeBackdrop(tc); got != "scanlines" {
		t.Errorf("the theme said scanlines, archetype gave %q", got)
	}
	if got := archetypeBackdrop(darkPalette); got != "" {
		t.Errorf("no archetype should bind no recipe, got %q", got)
	}
}
