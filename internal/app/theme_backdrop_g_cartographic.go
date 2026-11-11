package app

import (
	"fmt"
	"strings"
)

// Backdrop recipes of the cartographic theme group; see theme_groups.go. Each one is drawn for one family:
// it has to fit that theme's name, shape and colours.

// themeBackdropMetroLines is a transit network diagram: parallel coloured lines that only turn in
// 45-degree steps, a dot at every station and a ring where two lines meet. It is the Subway Map's
// own page. Every line leaves the tile at the height or column it enters at, so the tile repeats
// as one continuous network; the strokes are calm (low opacity) so the rows on top stay readable.
func themeBackdropMetroLines(k backdropKit) []backdropLayer {
	h := k.hex
	lineOp := k.op(.34, .38)
	type metro struct{ colour, path string }
	lines := []metro{
		{h.accent, "M0 100H180L260 180H460L540 100H720"},
		{h.second, "M0 330H120L200 410H400L480 330H720"},
		{h.warm, "M610 0V320L560 370V420L610 470V540"},
		{h.cool, "M330 0V300L370 340V420L330 460V540"},
	}
	var sb strings.Builder
	for _, l := range lines {
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='7' stroke-linejoin='round' stroke-linecap='round' opacity='%s'/>", l.path, backdropHexOr(l.colour), lineOp))
	}
	// Stations sit on the straight stretches, clear of the bends and the interchanges.
	type stop struct {
		x, y   int
		colour string
	}
	stops := []stop{
		{50, 100, h.accent}, {120, 100, h.accent}, {320, 180, h.accent}, {410, 180, h.accent}, {660, 100, h.accent},
		{60, 330, h.second}, {440, 410, h.second}, {250, 410, h.second}, {680, 330, h.second},
		{610, 80, h.warm}, {610, 220, h.warm}, {560, 395, h.warm}, {610, 500, h.warm},
		{330, 60, h.cool}, {330, 250, h.cool}, {370, 380, h.cool}, {330, 500, h.cool},
	}
	dotOp := k.op(.55, .6)
	for _, s := range stops {
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='5' fill='%s' stroke='%s' stroke-width='2.5' opacity='%s'/>", s.x, s.y, backdropHexOr(h.ground), backdropHexOr(s.colour), dotOp))
	}
	// Interchanges: a bigger ring in the ink of the page, where two lines cross.
	ink := "#1b1b1b"
	if k.dark {
		ink = "#f2f2ee"
	}
	for _, p := range [][2]int{{610, 100}, {330, 180}, {600, 330}, {370, 410}} {
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='10' fill='%s' stroke='%s' stroke-width='3.5' opacity='%s'/>", p[0], p[1], backdropHexOr(h.ground), ink, k.op(.45, .5)))
	}
	return []backdropLayer{svgTile(k, 720, 540, sb.String()), backdropGround(k)}
}
