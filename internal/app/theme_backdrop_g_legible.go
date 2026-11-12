package app

import (
	"fmt"
	"strings"
)

// Backdrop recipes of the legible theme group; see theme_groups.go. Each one is drawn for one family:
// it has to fit that theme's name, shape and colours. All three stay far below the opacity that
// would cost the text its AAA contrast: the busiest spot is still only a few percent off the page.

// themeBackdropSoftSquares is High Contrast Calm, the signage edition: the modular grid a sign
// panel is laid out on -- fine square module lines -- with a few solid modules filled in at the
// page edges like pictogram tiles on a wall. The id is older than the design; "softsquares" still
// describes squares, only no longer soft.
func themeBackdropSoftSquares(k backdropKit) []backdropLayer {
	c := "#000000"
	if k.dark {
		c = "#FFD400"
	}
	var tiles strings.Builder
	for _, t := range [][2]int{{0, 0}, {1, 0}, {0, 1}, {13, 0}, {14, 1}, {14, 0}, {0, 7}, {1, 8}, {13, 8}, {14, 7}, {14, 8}, {12, 8}} {
		tiles.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='96' height='96' fill='%s' opacity='%s'/>", t[0]*96, t[1]*96, c, k.op(.05, .07)))
	}
	grid := fmt.Sprintf("<path d='M96 0V96H0' fill='none' stroke='%s' stroke-width='1.5' opacity='%s'/>", c, k.op(.10, .12))
	return []backdropLayer{
		svgScene(1440, 864, "xMidYMid slice", tiles.String()),
		svgTile(k, 96, 96, grid),
		backdropGround(k),
	}
}

// themeBackdropAmberHorizon is Low Vision Amber: a low warm glow along the bottom and a few
// thin horizontal bands, amber on black or dark amber on warm white.
func themeBackdropAmberHorizon(k backdropKit) []backdropLayer {
	c := "#FFC400"
	if !k.dark {
		c = "#8A5A00"
	}
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + c + "' stop-opacity='0'/><stop offset='1' stop-color='" + c + "' stop-opacity='" + k.op(.16, .17) + "'/></linearGradient></defs>")
	sb.WriteString("<rect x='0' y='480' width='1400' height='320' fill='url(#g)'/>")
	for i, y := range []int{560, 612, 654, 688, 714} {
		sb.WriteString(fmt.Sprintf("<rect x='0' y='%d' width='1400' height='%d' fill='%s' opacity='%s'/>", y, 2+i/2, c, k.op(.10, .12)))
	}
	return []backdropLayer{svgScene(1400, 800, "xMidYMax slice", sb.String()), backdropGround(k)}
}

// themeBackdropShapeTiles is Colour-blind Safe: a faint, widely spaced field of the three status
// shapes -- circle, triangle, square -- in the blue and the orange of the pair.
func themeBackdropShapeTiles(k backdropKit) []backdropLayer {
	blue, orange := "#005AB5", "#A84300"
	if k.dark {
		blue, orange = "#6FB1FF", "#FF9A4D"
	}
	op := k.op(.10, .12)
	body := fmt.Sprintf("<g fill='none' stroke-width='3' opacity='%s'>"+
		"<circle cx='40' cy='40' r='14' stroke='%s'/>"+
		"<path d='M200 150l16 -28l16 28z' stroke='%s' stroke-linejoin='round'/>"+
		"<rect x='186' y='26' width='26' height='26' stroke='%s'/>"+
		"<path d='M28 164l14 -24l14 24z' stroke='%s' stroke-linejoin='round'/>"+
		"<circle cx='122' cy='100' r='12' stroke='%s'/>"+
		"</g>", op, blue, blue, orange, orange, orange)
	return []backdropLayer{svgTile(k, 260, 200, body), backdropGround(k)}
}
