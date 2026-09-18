package app

import (
	"math"
	"strconv"
	"testing"
)

/*
The header, measured on every theme that ships.

The three-zone header draws its ink on surfaces theme_ink_test.go does not
walk: the destinations and the action buttons sit on --surface-glass-page,
which is background-secondary let through at the theme's own alpha over the
page, and the key printed on an action button is --text-secondary at 0.6 over
the page itself. Both are derived per theme, so "the same colour as the
buttons beside them" is a promise about 222 palettes rather than about the one
on screen.

Floors are WCAG 2.1: 4.5:1 for the text a reader has to read, 3:1 for a glyph
or a hint that only has to be seen. Failures name the theme and the number, so
a palette that lands under it says so before anybody opens a browser.
*/

const (
	headerGlyphFloor = 3.0
	headerTextFloor  = 4.5

	// theme-character.css: the two glass steps, as a share of the theme's alpha.
	glassPageShare = 0.70
	glassSlabShare = 0.88

	// dashboard.css: the key chip on an action button. Full strength since the
	// 0.6 it inherited from the button put 114 of the 224 themes under the
	// floor below.
	headerKeyOpacity = 1.0
)

// glassOver is color-mix(in srgb, background-secondary calc(alpha * share),
// transparent) painted over what stands behind it -- the header band shows the
// page, so that is the ground.
func glassOver(page, secondary srgbColor, alpha, share float64) srgbColor {
	return mixSRGB(page, secondary, alpha*share)
}

// themeAlpha is themeSurfaceAlpha() read back as a number, so the test uses
// the value the server actually writes into the stylesheet.
func themeAlpha(t *testing.T, tc ThemeColors) float64 {
	t.Helper()
	alpha, err := strconv.ParseFloat(themeSurfaceAlpha(tc), 64)
	if err != nil {
		t.Fatalf("themeSurfaceAlpha returned %q, which is not a number", themeSurfaceAlpha(tc))
	}
	return alpha
}

// headerInk derives --text-secondary / --text-tertiary the way theme-ink.css
// does, from the surface the ink is drawn on rather than from the page.
func headerInk(surface srgbColor, gap, chroma, direction float64) srgbColor {
	return deriveInk(surface, gap, chroma, direction)
}

/*
Every icon in the header, on every theme, at both depth settings.

The pages, inbox, health and config buttons and the eight action buttons are
one colour -- --text-tertiary -- on one surface: the glass step. A glyph is
not body text, so the floor is 3:1; what this catches is a palette whose
secondary background sits so close to its own ink that the header goes blank.
*/
func TestHeaderGlyphContrastAcrossThemes(t *testing.T) {
	depths := []struct {
		name  string
		depth float64
	}{{"soft", 1.0}, {"rich", 1.5}}

	checked := 0
	for id, tc := range allShippedThemes() {
		page, okPage := parseHexColor(tc.BackgroundPrimary)
		secondary, okSecond := parseHexColor(tc.BackgroundSecondary)
		if !okPage || !okSecond {
			// A palette that writes its backgrounds as rgba() rather than hex
			// is read by the browser and not by this test; theme_ink_test.go
			// makes the same allowance.
			continue
		}
		direction := 1.0
		if themeInkDirection(tc.BackgroundPrimary) == "-1" {
			direction = -1
		}
		alpha := themeAlpha(t, tc)

		for _, d := range depths {
			_ = d.depth // the glass step is not scaled by depth; both are walked for the record
			for _, surface := range []struct {
				name string
				bg   srgbColor
			}{
				{"--surface-glass-page", glassOver(page, secondary, alpha, glassPageShare)},
				{"--surface-glass-slab", glassOver(page, secondary, alpha, glassSlabShare)},
			} {
				ink := headerInk(surface.bg, inkGapTertiary, inkChromaThird, direction)
				ratio := contrastRatio(ink, surface.bg)
				if ratio < headerGlyphFloor {
					t.Errorf("%s (%s, %s): header glyph is %.2f:1, under %.1f:1",
						id, d.name, surface.name, ratio, headerGlyphFloor)
				}
				checked++
			}
		}
	}
	if checked == 0 {
		t.Fatal("no theme was measured")
	}
	t.Logf("%d header glyph measurements across %d themes", checked, len(allShippedThemes()))
}

/*
The key chips, which are text.

`+`, `>` and the rest are printed on the corner of the button they belong to,
in --text-secondary over --background-primary. They wore the button's old 0.6
for a while, and six tenths of a colour is six tenths of its distance from the
ground: 114 of the 224 themes measured under 3:1 that way, the worst at 2.16.
This is what stops that coming back.
*/
func TestHeaderKeyChipContrastAcrossThemes(t *testing.T) {
	worst := math.Inf(1)
	worstID := ""
	checked := 0

	for id, tc := range allShippedThemes() {
		page, okPage := parseHexColor(tc.BackgroundPrimary)
		if !okPage {
			continue
		}
		direction := 1.0
		if themeInkDirection(tc.BackgroundPrimary) == "-1" {
			direction = -1
		}
		// The chip paints --background-primary under itself, so the ink it
		// derives from and the ground it is composited over are the same.
		ink := headerInk(page, inkGapSecondary, inkChromaSecond, direction)
		shown := mixSRGB(page, ink, headerKeyOpacity)
		ratio := contrastRatio(shown, page)
		if ratio < worst {
			worst, worstID = ratio, id
		}
		if ratio < headerGlyphFloor {
			t.Errorf("%s: the key on an action button is %.2f:1, under %.1f:1",
				id, ratio, headerGlyphFloor)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no theme was measured")
	}
	t.Logf("worst key chip: %s at %.2f:1 (%d themes)", worstID, worst, checked)
}

/*
The page tabs and the view name.

The name is --text-primary on the page and a tab is --text-secondary on the
glass step, both of which a reader reads rather than glances at -- so these
carry the 4.5:1 floor.
*/
func TestHeaderTextContrastAcrossThemes(t *testing.T) {
	checked := 0
	for id, tc := range allShippedThemes() {
		page, okPage := parseHexColor(tc.BackgroundPrimary)
		secondary, okSecond := parseHexColor(tc.BackgroundSecondary)
		primaryInk, okInk := parseHexColor(tc.TextPrimary)
		if !okPage || !okSecond || !okInk {
			continue
		}
		direction := 1.0
		if themeInkDirection(tc.BackgroundPrimary) == "-1" {
			direction = -1
		}
		alpha := themeAlpha(t, tc)

		if ratio := contrastRatio(primaryInk, page); ratio < headerTextFloor {
			t.Errorf("%s: the view name is %.2f:1 on the page, under %.1f:1",
				id, ratio, headerTextFloor)
		}
		tabSurface := glassOver(page, secondary, alpha, glassPageShare)
		tabInk := headerInk(tabSurface, inkGapSecondary, inkChromaSecond, direction)
		if ratio := contrastRatio(tabInk, tabSurface); ratio < headerTextFloor {
			t.Errorf("%s: a page tab is %.2f:1 on the glass step, under %.1f:1",
				id, ratio, headerTextFloor)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no theme was measured")
	}
	t.Logf("%d themes measured for header text", checked)
}
