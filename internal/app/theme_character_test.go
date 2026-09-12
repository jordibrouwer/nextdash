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
			// Not "as today" for the two glass fields any more. Both used to
			// fall back to the value that means "not glass at all", which made
			// the glass depth step do nothing on the 218 built-in themes that
			// never mention it. A theme with no opinion gets the step's own
			// glass now; see TestGlassHasADefaultOnThemesThatNeverMentionedIt.
			name:  "unset renders as today, except that glass is glass",
			theme: ThemeColors{},
			want: []string{
				"--theme-surface-alpha: 0.72;",
				"--theme-surface-blur: 18px;",
				"--theme-surface-glow: 0;", // geen palet om iets uit af te leiden
				"--theme-glow-lift: 1;",    // en een onleesbare pagina telt als donker
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
	if neon > 0.60 {
		t.Errorf("a derived glow should stay under what a theme can declare, got %.2f", neon)
	}

	// A light page glows too, as a tinted shadow rather than a halo, and it
	// stays under what the same accent would do on a dark page. The whole
	// point of the second branch is that 109 light themes were flat by
	// omission rather than by choice.
	if paper == 0 {
		t.Error("a light theme should pick up a glow of its own")
	}
	if paper > 0.35 {
		t.Errorf("a light page should stay quiet, got %.2f", paper)
	}
	sameAccentDark := glowOf(ThemeColors{AccentPrimary: "#2F6F5E", BackgroundPrimary: "#0B1020"})
	sameAccentLight := glowOf(ThemeColors{AccentPrimary: "#2F6F5E", BackgroundPrimary: "#FBFAF7"})
	if sameAccentLight >= sameAccentDark && sameAccentDark > 0 {
		t.Errorf("the light branch should stay below the dark one for one accent: light %.2f, dark %.2f",
			sameAccentLight, sameAccentDark)
	}

	// Nothing is flat by accident. A theme that means silence says so.
	silent := map[string]bool{
		"nocturne-ink-dark": true, "nocturne-ink-light": true,
		"porcelain-dark": true, "porcelain-light": true,
		"paper-ink-dark": true, "paper-ink-light": true,
		"bone-china-dark": true, "bone-china-light": true,
		"salt-flat-dark": true, "salt-flat-light": true,
	}
	for id, tc := range getDefaultBuiltInThemes() {
		got := glowOf(tc)
		if silent[id] {
			if got != 0 {
				t.Errorf("%s declared no glow and got %.2f", id, got)
			}
			continue
		}
		if got == 0 {
			t.Errorf("%s derives to no glow at all, which only a declared -1 should do", id)
		}
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

// TestGlowLiftIsOneOfTwoNumbers guards the token that decides the geometry: a
// halo on a dark page, a tinted shadow on a light one, and never a third thing
// the stylesheet would have to interpolate past.
func TestGlowLiftIsOneOfTwoNumbers(t *testing.T) {
	for id, tc := range getDefaultBuiltInThemes() {
		lift := themeGlowLift(tc)
		if lift != "0" && lift != "1" {
			t.Fatalf("%s produced a glow lift of %q", id, lift)
		}
		pageLightness, _, ok := hexOklch(tc.BackgroundPrimary)
		if !ok {
			continue
		}
		wantLift := "1"
		if pageLightness >= lightPageThreshold {
			wantLift = "0"
		}
		if lift != wantLift {
			t.Errorf("%s has a page lightness of %.2f and a glow lift of %s", id, pageLightness, lift)
		}
	}

	// A background nothing can read is treated as dark, where the glow is zero
	// anyway, so the geometry is never spent.
	if got := themeGlowLift(ThemeColors{BackgroundPrimary: "not a colour"}); got != "1" {
		t.Errorf("an unreadable background should fall back to a halo, got %s", got)
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

/*
The glass depth step has to mean something on every theme, not on four.

--theme-surface-alpha and --theme-surface-blur are read only under
body[data-depth="glass"], and both used to fall back to the value that means
"not glass at all": fully solid, no blur. Four of the 222 built-in themes
declare an alpha and two declare a blur, so on the other 218 picking glass
produced a dashboard indistinguishable from rich -- a setting that did nothing,
which is worse than a setting that is not offered.

A theme with an opinion still wins, and a theme that means solid says so with a
negative rather than by omission.
*/
func TestGlassHasADefaultOnThemesThatNeverMentionedIt(t *testing.T) {
	t.Run("a theme that says nothing gets the step's own glass", func(t *testing.T) {
		alpha := themeSurfaceAlpha(ThemeColors{})
		blur := themeSurfaceBlur(ThemeColors{})
		if alpha == "1" {
			t.Errorf("glass is solid on a theme with no opinion: alpha %q", alpha)
		}
		if blur == "0" {
			t.Errorf("glass has no blur on a theme with no opinion: blur %q", blur)
		}
	})

	t.Run("a theme with an opinion keeps it", func(t *testing.T) {
		aurora := ThemeColors{SurfaceAlpha: 0.58, SurfaceBlur: 20}
		if got := themeSurfaceAlpha(aurora); got != "0.58" {
			t.Errorf("Aurora Glass lost its own alpha: %q", got)
		}
		if got := themeSurfaceBlur(aurora); got != "20" {
			t.Errorf("Aurora Glass lost its own blur: %q", got)
		}

		// Near-solid is an opinion too, and the one most likely to be mistaken
		// for silence: 0.9 is a deliberate sheet of glass you can almost not
		// see through, and it must not be read as "no value given".
		if got := themeSurfaceAlpha(ThemeColors{SurfaceAlpha: 0.9}); got != "0.9" {
			t.Errorf("a near-solid theme was overridden: %q", got)
		}
	})

	t.Run("a theme that means solid says so with a negative", func(t *testing.T) {
		if got := themeSurfaceAlpha(ThemeColors{SurfaceAlpha: -1}); got != "1" {
			t.Errorf("a theme asking for solid surfaces got glass: %q", got)
		}
		if got := themeSurfaceBlur(ThemeColors{SurfaceBlur: -1}); got != "0" {
			t.Errorf("a theme asking for no blur got one: %q", got)
		}
	})

	t.Run("the values still clamp", func(t *testing.T) {
		if got := themeSurfaceAlpha(ThemeColors{SurfaceAlpha: 4}); got != "1" {
			t.Errorf("an alpha above the range was not clamped: %q", got)
		}
		if got := themeSurfaceBlur(ThemeColors{SurfaceBlur: 900}); got != "32" {
			t.Errorf("a blur above the range was not clamped: %q", got)
		}
	})

	t.Run("and the default theme is one of the 218", func(t *testing.T) {
		// Which is what makes this visible rather than theoretical: a fresh
		// install starts on a theme that never mentions glass.
		themes := getDefaultBuiltInThemes()
		def := themes[defaultThemeID]
		if def.SurfaceAlpha != 0 || def.SurfaceBlur != 0 {
			t.Skip("the default theme now declares glass of its own")
		}
		if themeSurfaceAlpha(def) == "1" || themeSurfaceBlur(def) == "0" {
			t.Errorf("glass does nothing on the theme a fresh install starts on")
		}
	})
}
