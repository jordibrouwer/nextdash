package app

import (
	"math"
	"strconv"
	"strings"
	"testing"
)

/*
The floor theme-ink.css promises, checked against every theme that ships.

theme-ink.css derives --text-secondary and --text-tertiary from the surface
they sit on rather than from the page, so that contrast stops depending on how
a palette happened to be written. That promise is only worth something if it
keeps holding when somebody adds a theme, so this test walks the whole register
and re-does the arithmetic: build the surfaces the way theme-depth.css builds
them, derive the ink the way theme-ink.css derives it, and measure.

The lightness steps here (0.55 and 0.47) and the chroma scales (0.5 and 0.6)
are the values in theme-ink.css. Change one there and this test says what it
cost, in themes, before anybody sees it in a browser.
*/

const (
	inkGapSecondary = 0.55
	inkGapTertiary  = 0.47
	inkChromaSecond = 0.5
	inkChromaThird  = 0.6

	// WCAG AA for body text. The worst theme in the register measured 4.68:1
	// when this was written, so the margin is real but not generous — a new
	// theme that lands under this is telling you something.
	inkContrastFloor = 4.5
)

type srgbColor struct{ r, g, b float64 }

func parseHexColor(s string) (srgbColor, bool) {
	h := strings.TrimSpace(s)
	if !strings.HasPrefix(h, "#") {
		return srgbColor{}, false
	}
	h = h[1:]
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if len(h) != 6 {
		return srgbColor{}, false
	}
	channel := func(part string) (float64, bool) {
		v, err := strconv.ParseUint(part, 16, 16)
		if err != nil {
			return 0, false
		}
		return float64(v) / 255, true
	}
	r, okR := channel(h[0:2])
	g, okG := channel(h[2:4])
	b, okB := channel(h[4:6])
	if !okR || !okG || !okB {
		return srgbColor{}, false
	}
	return srgbColor{r, g, b}, true
}

func linearize(c float64) float64 {
	if c <= 0.04045 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

func delinearize(c float64) float64 {
	c = math.Max(0, math.Min(1, c))
	if c <= 0.0031308 {
		return c * 12.92
	}
	return 1.055*math.Pow(c, 1/2.4) - 0.055
}

func luminanceOf(c srgbColor) float64 {
	return 0.2126*linearize(c.r) + 0.7152*linearize(c.g) + 0.0722*linearize(c.b)
}

func contrastRatio(a, b srgbColor) float64 {
	la, lb := luminanceOf(a), luminanceOf(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

// mixSRGB is color-mix(in srgb, top p%, base) — the mix theme-depth.css uses.
func mixSRGB(base, top srgbColor, p float64) srgbColor {
	return srgbColor{
		base.r*(1-p) + top.r*p,
		base.g*(1-p) + top.g*p,
		base.b*(1-p) + top.b*p,
	}
}

type oklchColor struct{ l, c, h float64 }

func toOklch(c srgbColor) oklchColor {
	r, g, b := linearize(c.r), linearize(c.g), linearize(c.b)
	lp := math.Cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
	mp := math.Cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
	sp := math.Cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)
	l := 0.2104542553*lp + 0.7936177850*mp - 0.0040720468*sp
	a := 1.9779984951*lp - 2.4285922050*mp + 0.4505937099*sp
	bb := 0.0259040371*lp + 0.7827717662*mp - 0.8086757660*sp
	return oklchColor{l, math.Hypot(a, bb), math.Atan2(bb, a)}
}

func fromOklch(c oklchColor) srgbColor {
	a, b := c.c*math.Cos(c.h), c.c*math.Sin(c.h)
	lp := c.l + 0.3963377774*a + 0.2158037573*b
	mp := c.l - 0.1055613458*a - 0.0638541728*b
	sp := c.l - 0.0894841775*a - 1.2914855480*b
	l, m, s := lp*lp*lp, mp*mp*mp, sp*sp*sp
	return srgbColor{
		delinearize(4.0767416621*l - 3.3077115913*m + 0.2309699292*s),
		delinearize(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s),
		delinearize(-0.0041960863*l - 0.7034186147*m + 1.7076147010*s),
	}
}

// deriveInk is the oklch(from …) expression in theme-ink.css, in Go.
func deriveInk(surface srgbColor, gap, chromaScale, direction float64) srgbColor {
	c := toOklch(surface)
	c.l = math.Max(0, math.Min(1, c.l+gap*direction))
	c.c *= chromaScale
	return fromOklch(c)
}

/*
surfaceLadder rebuilds what theme-depth.css derives: three steps of
3/6/9 percent toward text-primary, scaled by the depth setting, then tinted
with the theme's own accent. Returned lowest first, page included, with
background-secondary on the end — text lands on that one too.
*/
func surfaceLadder(tc ThemeColors, depth, tint float64) ([]srgbColor, bool) {
	bg, okBG := parseHexColor(tc.BackgroundPrimary)
	text, okText := parseHexColor(tc.TextPrimary)
	accentSource := tc.AccentPrimary
	if accentSource == "" {
		accentSource = tc.AccentSuccess
	}
	accent, okAccent := parseHexColor(accentSource)
	if !okBG || !okText || !okAccent {
		return nil, false
	}
	ladder := []srgbColor{bg}
	for _, step := range []float64{0.03, 0.06, 0.09} {
		ladder = append(ladder, mixSRGB(mixSRGB(bg, text, step*depth), accent, tint))
	}
	// background-secondary is a declared colour, not a derived one, and a
	// handful of themes put it well above surface-3. Skipped when it is not
	// hex rather than failing the theme over a colour this cannot read.
	if second, okSecond := parseHexColor(tc.BackgroundSecondary); okSecond {
		ladder = append(ladder, second)
	}
	return ladder, true
}

func allShippedThemes() map[string]ThemeColors {
	themes := getDefaultBuiltInThemes()
	themes["light"] = getDefaultLightTheme()
	themes["dark"] = getDefaultDarkTheme()
	return themes
}

// TestDerivedInkClearsContrastFloor is the one that matters: for every theme
// that ships, on every surface a reader can meet, at both depth settings.
func TestDerivedInkClearsContrastFloor(t *testing.T) {
	depths := []struct {
		name  string
		depth float64
		tint  float64
	}{
		{"soft", 1.0, 0.03},
		{"rich", 1.5, 0.05},
	}
	inks := []struct {
		token  string
		gap    float64
		chroma float64
	}{
		{"--text-secondary", inkGapSecondary, inkChromaSecond},
		{"--text-tertiary", inkGapTertiary, inkChromaThird},
	}

	checked := 0
	for id, tc := range allShippedThemes() {
		direction := 1.0
		if themeInkDirection(tc.BackgroundPrimary) == "-1" {
			direction = -1
		}
		for _, d := range depths {
			ladder, ok := surfaceLadder(tc, d.depth, d.tint)
			if !ok {
				continue
			}
			checked++
			anchor := ladder[2] // surface-2, what theme-ink.css derives from
			for _, ink := range inks {
				colour := deriveInk(anchor, ink.gap, ink.chroma, direction)
				for level, surface := range ladder {
					if got := contrastRatio(colour, surface); got < inkContrastFloor {
						t.Errorf("%s at depth %q: %s reaches only %.2f:1 on surface level %d (floor %.2f)",
							id, d.name, ink.token, got, level, inkContrastFloor)
					}
				}
			}
		}
	}

	// A parse that silently stopped finding themes would make the loop above
	// pass by doing nothing at all.
	if checked < 400 {
		t.Fatalf("only checked %d theme/depth combinations; the register should give well over 400", checked)
	}
}

// TestThemeInkDirectionFollowsBackground covers the one value the stylesheet
// cannot work out for itself.
func TestThemeInkDirectionFollowsBackground(t *testing.T) {
	cases := []struct {
		background string
		want       string
		why        string
	}{
		{"#000000", "1", "black page: ink moves up"},
		{"#0B1020", "1", "deep navy page: ink moves up"},
		{"#282C34", "1", "the usual editor grey: still dark"},
		{"#FBFAF7", "-1", "paper: ink moves down"},
		{"#FFFFFF", "-1", "white page: ink moves down"},
		{"#F9FAFB", "-1", "the default light theme"},
		{"rgba(0, 0, 0, 0.8)", "1", "unparseable falls back to the dark direction"},
		{"", "1", "empty falls back to the dark direction"},
		{"rebeccapurple", "1", "named colours are not parsed, so they fall back"},
	}
	for _, c := range cases {
		if got := themeInkDirection(c.background); got != c.want {
			t.Errorf("themeInkDirection(%q) = %q, want %q — %s", c.background, got, c.want, c.why)
		}
	}
}

// TestRenderThemeCSSBlockCarriesInkDirection keeps the token in the generated
// stylesheet: without it every theme silently falls back to the dark direction,
// and light themes lose their faint text into the page.
func TestRenderThemeCSSBlockCarriesInkDirection(t *testing.T) {
	dark := renderThemeCSSBlock("dark", getDefaultDarkTheme())
	if !strings.Contains(dark, "--ink-dir: 1;") {
		t.Errorf("dark theme block is missing --ink-dir: 1\n%s", dark)
	}
	light := renderThemeCSSBlock("light", getDefaultLightTheme())
	if !strings.Contains(light, "--ink-dir: -1;") {
		t.Errorf("light theme block is missing --ink-dir: -1\n%s", light)
	}
}
