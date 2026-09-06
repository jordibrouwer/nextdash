package app

import (
	"strconv"
	"strings"
	"testing"
)

/*
The character fields are the one place a theme gets to say something that is
not a colour, so they are the one place where a bad value could reach the
stylesheet as text. Nothing here parses CSS: every field is a number that gets
clamped or a word from a fixed list, and these tests are what says so.

The other half of the promise is that an unset field renders as today's
behaviour. A theme written before these existed -- which is 214 of them -- must
come out of renderThemeCSSBlock looking exactly as it did.
*/

func TestCharacterFieldsClampToTheirRange(t *testing.T) {
	cases := []struct {
		name  string
		theme ThemeColors
		want  []string
	}{
		{
			name:  "unset renders as today",
			theme: ThemeColors{},
			want: []string{
				"--theme-surface-alpha: 1;",
				"--theme-surface-blur: 0px;",
				"--theme-surface-glow: 0;", // geen palet om iets uit af te leiden
				"--theme-radius-scale: 1;",
				"--theme-label-transform: none;",
				"--theme-label-spacing: normal;",
				"--theme-label-weight: 700;",
			},
		},
		{
			name: "a negative glow means the theme wants none",
			theme: ThemeColors{
				SurfaceGlow: -1, AccentPrimary: "#39FF6A", BackgroundPrimary: "#050705",
			},
			want: []string{"--theme-surface-glow: 0;"},
		},
		{
			name: "out of range is pulled back in",
			theme: ThemeColors{
				SurfaceAlpha: 4, SurfaceBlur: 900, SurfaceGlow: 7,
				RadiusScale: 40, LabelWeight: 1200, LabelSpacing: "9em",
			},
			want: []string{
				"--theme-surface-alpha: 1;",
				"--theme-surface-blur: 32px;",
				"--theme-surface-glow: 1;",
				"--theme-radius-scale: 1.6;",
				"--theme-label-weight: 700;",
				"--theme-label-spacing: 0.25em;",
			},
		},
		{
			name: "negatives do not become negative CSS",
			theme: ThemeColors{
				SurfaceAlpha: -3, SurfaceBlur: -10, SurfaceGlow: -1,
				RadiusScale: -2, LabelSpacing: "-9em", LabelWeight: -400,
			},
			want: []string{
				"--theme-surface-alpha: 1;",
				"--theme-surface-blur: 0px;",
				"--theme-radius-scale: 1;",
				"--theme-label-spacing: -0.05em;",
				"--theme-label-weight: 700;",
			},
		},
		{
			name:  "a spacing in the wrong unit is refused, not converted",
			theme: ThemeColors{LabelSpacing: "14px"},
			want:  []string{"--theme-label-spacing: normal;"},
		},
		{
			name:  "and so is one that is not a length at all",
			theme: ThemeColors{LabelSpacing: "0.2em; color: red"},
			want:  []string{"--theme-label-spacing: normal;"},
		},
		{
			name: "what a theme legitimately asks for, it gets",
			theme: ThemeColors{
				SurfaceAlpha: 0.58, SurfaceBlur: 20, SurfaceGlow: 1,
				RadiusScale: 1.4, LabelTransform: "uppercase",
				LabelSpacing: "0.14em", LabelWeight: 600,
			},
			want: []string{
				"--theme-surface-alpha: 0.58;",
				"--theme-surface-blur: 20px;",
				"--theme-surface-glow: 1;",
				"--theme-radius-scale: 1.4;",
				"--theme-label-transform: uppercase;",
				"--theme-label-spacing: 0.14em;",
				"--theme-label-weight: 600;",
			},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			block := renderThemeCSSBlock("probe", c.theme)
			for _, want := range c.want {
				if !strings.Contains(block, want) {
					t.Errorf("missing %q in:\n%s", want, block)
				}
			}
		})
	}
}

// TestNoThemeCanCloseItsOwnBlock is the property that matters most: whatever a
// theme puts in these fields, it stays inside the declaration it belongs to.
func TestNoThemeCanCloseItsOwnBlock(t *testing.T) {
	hostile := ThemeColors{
		LabelTransform: "uppercase} html { display: none } .x {",
		LabelSpacing:   "1em} body { opacity: 0 } .y {",
		Name:           "*/ body { display: none } /*",
	}
	block := renderThemeCSSBlock("probe", hostile)
	if strings.Count(block, "{") != 1 || strings.Count(block, "}") != 1 {
		t.Errorf("a theme reached outside its own block:\n%s", block)
	}
	if strings.Contains(block, "display: none") || strings.Contains(block, "opacity: 0") {
		t.Errorf("theme text was rendered verbatim:\n%s", block)
	}
}

/*
The derived glow, checked at the two ends and in the middle.

The point of deriving is that a neon theme on black ends up brighter than a
paper theme in daylight without anybody deciding that per theme, and that no
derived value ever reaches the strength a theme can ask for by hand.
*/
func TestDerivedGlowFollowsThePalette(t *testing.T) {
	glowOf := func(tc ThemeColors) float64 {
		value := themeSurfaceGlow(tc)
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			t.Fatalf("themeSurfaceGlow returned %q, which is not a number", value)
		}
		return parsed
	}

	neon := glowOf(ThemeColors{AccentPrimary: "#4ADE80", BackgroundPrimary: "#030705"})
	muted := glowOf(ThemeColors{AccentPrimary: "#A8A29E", BackgroundPrimary: "#171717"})
	paper := glowOf(ThemeColors{AccentPrimary: "#2F6F5E", BackgroundPrimary: "#FBFAF7"})

	if neon <= muted {
		t.Errorf("a neon accent should out-glow a grey one: neon %.2f, muted %.2f", neon, muted)
	}
	if paper != 0 {
		t.Errorf("a light page should not glow at all, got %.2f", paper)
	}
	if neon > 0.45 {
		t.Errorf("a derived glow should stay well under what a theme can declare, got %.2f", neon)
	}

	// Declared beats derived, in both directions.
	if got := glowOf(ThemeColors{SurfaceGlow: 1, AccentPrimary: "#A8A29E", BackgroundPrimary: "#171717"}); got != 1 {
		t.Errorf("a declared glow of 1 came out as %.2f", got)
	}
	if got := glowOf(ThemeColors{SurfaceGlow: -1, AccentPrimary: "#4ADE80", BackgroundPrimary: "#030705"}); got != 0 {
		t.Errorf("a theme that asked for no glow got %.2f", got)
	}

	// And the same theme id always lands on the same number.
	first := glowOf(getDefaultBuiltInThemes()["retro-crt-dark"])
	if second := glowOf(getDefaultBuiltInThemes()["retro-crt-dark"]); first != second {
		t.Errorf("the derivation is not stable: %.2f then %.2f", first, second)
	}
	if first == 0 {
		t.Error("the packaged terminal theme should have picked up a glow of its own")
	}
}

// TestTheFourCharacterThemesShip guards the register entry itself: these four
// are the reason the fields exist, and a rename or a dropped line should be
// noticed here rather than in somebody's theme picker.
func TestTheFourCharacterThemesShip(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, id := range []string{
		"aurora-glass-dark", "aurora-glass-light",
		"nocturne-ink-dark", "nocturne-ink-light",
		"retro-crt-mk2-dark", "retro-crt-mk2-light",
		"porcelain-dark", "porcelain-light",
	} {
		theme, ok := themes[id]
		if !ok {
			t.Errorf("%s is missing from the register", id)
			continue
		}
		if theme.Name == "" {
			t.Errorf("%s has no name, so the picker has nothing to show", id)
		}
		if theme.AccentPrimary == "" {
			t.Errorf("%s has no accent of its own", id)
		}
	}

	// Aurora is the one that has to be glass, or the fields are decoration.
	if aurora := themes["aurora-glass-dark"]; aurora.SurfaceAlpha >= 1 || aurora.SurfaceBlur == 0 {
		t.Errorf("Aurora Glass is not glass: alpha %v, blur %v", aurora.SurfaceAlpha, aurora.SurfaceBlur)
	}
	// And the terminal has to be square and shouting.
	if crt := themes["retro-crt-mk2-dark"]; crt.RadiusScale > 0.2 || crt.LabelTransform != "uppercase" {
		t.Errorf("Retro CRT Mk II lost its shape: radius %v, transform %q", crt.RadiusScale, crt.LabelTransform)
	}
	// The default theme must not have moved.
	if defaultThemeID != "retro-crt-dark" {
		t.Errorf("a new theme changed what a fresh install starts on: %q", defaultThemeID)
	}
}
