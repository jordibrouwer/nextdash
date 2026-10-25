package app

import (
	"strings"
	"testing"
)

// The Looks collection: twenty-four families, each drawn for one colour
// recipe and one category surface. The recipe and the surface are what makes a
// look a look rather than a palette, so both halves have to agree on them.
func TestLooksCollection(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	families := map[string][2]ThemeColors{}
	for id, tc := range themes {
		if tc.Collection != "looks" {
			continue
		}
		family := themeFamilyOf(id)
		pair := families[family]
		switch {
		case strings.HasSuffix(id, "-dark"):
			pair[0] = tc
		case strings.HasSuffix(id, "-light"):
			pair[1] = tc
		default:
			t.Errorf("%s is in Looks but is neither a dark nor a light half", id)
		}
		families[family] = pair
	}
	if len(families) != 24 {
		t.Fatalf("%d families in Looks, want 24", len(families))
	}

	wantSurface := map[string]string{"look-polar": "open", "look-film": "card", "look-opal": "card"}
	recipes := map[string]int{}
	for family, pair := range families {
		dark, light := pair[0], pair[1]
		if dark.Name == "" || light.Name == "" {
			t.Errorf("%s is missing a half", family)
			continue
		}
		if dark.Backdrop != light.Backdrop || dark.Surface != light.Surface {
			t.Errorf("%s: the halves disagree (%s/%s against %s/%s)", family, dark.Backdrop, dark.Surface, light.Backdrop, light.Surface)
		}
		if themeBackdropRecipeIndex(dark.Backdrop) < 0 {
			t.Errorf("%s: %q is not a backdrop recipe", family, dark.Backdrop)
		}
		recipes[dark.Backdrop]++
		want := wantSurface[family]
		if want == "" {
			want = "glass"
		}
		if dark.Surface != want {
			t.Errorf("%s: surface %q, want %q", family, dark.Surface, want)
		}
		if _, ok := themeArchetypes[dark.Character]; !ok {
			t.Errorf("%s: %q is not an archetype", family, dark.Character)
		}
	}
	for recipe, want := range map[string]int{"burst": 5, "splash": 4, "oceanblue": 1, "mesh": 4, "aurora": 3, "leak": 4, "prism": 3} {
		if recipes[recipe] != want {
			t.Errorf("%d looks on %s, want %d", recipes[recipe], recipe, want)
		}
	}
}

// Loud is not the same as unreadable: both inks clear AA on the raised surface
// in every half.
func TestLooksTextClearsAA(t *testing.T) {
	checked := 0
	for id, tc := range getDefaultBuiltInThemes() {
		if tc.Collection != "looks" {
			continue
		}
		surface, ok := parseHexColor(tc.BackgroundSecondary)
		if !ok {
			t.Errorf("%s: background %q does not parse", id, tc.BackgroundSecondary)
			continue
		}
		for name, ink := range map[string]string{"primary": tc.TextPrimary, "secondary": tc.TextSecondary} {
			colour, ok := parseHexColor(ink)
			if !ok {
				t.Errorf("%s: %s text %q does not parse", id, name, ink)
				continue
			}
			if ratio := contrastRatio(colour, surface); ratio < 4.5 {
				t.Errorf("%s: %s text reaches %.2f:1, under 4.5", id, name, ratio)
			}
		}
		checked++
	}
	if checked != 48 {
		t.Errorf("checked %d looks, want 48", checked)
	}
}

// A look draws on glass with no glow and a pane that is mostly see-through, whatever the
// reader's other settings are: these are the three answers it brings with it. The velvet
// ones are the exception: flat in depth, with a soft glow.
func TestLooksBringGlassNoGlowAndFifthOpacity(t *testing.T) {
	n := 0
	for id, tc := range getDefaultBuiltInThemes() {
		if tc.Collection != "looks" {
			continue
		}
		n++
		wantDepth, wantGlow := "glass", "off"
		if tc.Character == "velvet" {
			wantDepth, wantGlow = "flat", "soft"
		}
		if tc.Depth != wantDepth {
			t.Errorf("%s: depth %q, want %s", id, tc.Depth, wantDepth)
		}
		if tc.Glow != wantGlow {
			t.Errorf("%s: glow %q, want %s", id, tc.Glow, wantGlow)
		}
		if tc.SurfaceAlpha != 0.2 {
			t.Errorf("%s: opacity %v, want 0.2", id, tc.SurfaceAlpha)
		}
	}
	if n != 48 {
		t.Errorf("%d looks, want 48", n)
	}
}

// Borealis Veil draws on glass, with no glow and a pane that is mostly
// see-through, in both halves.
func TestBorealisVeilIsGlassWithoutGlow(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, id := range []string{"borealis-veil-dark", "borealis-veil-light"} {
		tc, ok := themes[id]
		if !ok {
			t.Fatalf("%s is missing", id)
		}
		if tc.Glow != "off" || tc.SurfaceAlpha != 0.2 || tc.Surface != "glass" {
			t.Errorf("%s: glow %q opacity %v surface %q, want off, 0.2, glass", id, tc.Glow, tc.SurfaceAlpha, tc.Surface)
		}
	}
}
