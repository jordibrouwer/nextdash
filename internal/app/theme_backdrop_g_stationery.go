package app

import (
	"fmt"
	"strings"
)

// Backdrop recipes of the stationery theme group; see theme_groups.go. Each one is drawn for one family:
// it has to fit that theme's name, shape and colours.

// stationeryInk is the neutral the drawings are made in: paper-white on a dark page, near-black on a light one.
func stationeryInk(k backdropKit) string {
	if k.dark {
		return "#e8e4d8"
	}
	return "#1f1d1a"
}

// themeBackdropGalleryWall is the "gallerywall" recipe, now the ground of the Swiss poster theme
// (the id is older than the design): a modular grid of four columns drawn as hairlines with a
// registration cross at the crossings, one huge solid circle in the accent cropped by the lower
// right corner, and a quarter ring echoing it. Flat, geometric and large; nothing near the size of text.
func themeBackdropGalleryWall(k backdropKit) []backdropLayer {
	h := k.hex
	ink := stationeryInk(k)
	var sb strings.Builder
	for i := 1; i < 4; i++ {
		x := i * 350
		sb.WriteString(fmt.Sprintf("<path d='M%d 0V900' stroke='%s' stroke-width='1' opacity='%s'/>", x, ink, k.op(.09, .1)))
		for y := 150; y < 900; y += 300 {
			sb.WriteString(fmt.Sprintf("<path d='M%d %dh16M%d %dv16M%d %dh-16M%d %dv-16' stroke='%s' stroke-width='1.5' opacity='%s'/>", x-8, y, x, y-8, x+8, y, x, y+8, ink, k.op(.28, .3)))
		}
	}
	sb.WriteString(fmt.Sprintf("<circle cx='1180' cy='820' r='430' fill='%s' opacity='%s'/>", h.accent, k.op(.08, .1)))
	sb.WriteString(fmt.Sprintf("<path d='M0 0A560 560 0 0 1 560 560' fill='none' stroke='%s' stroke-width='36' opacity='%s' transform='translate(-300 -300)'/>", h.accent, k.op(.07, .09)))
	sb.WriteString(fmt.Sprintf("<rect x='0' y='0' width='1400' height='10' fill='%s' opacity='%s'/>", h.accent, k.op(.5, .55)))
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		backdropGround(k),
	}
}

// themeBackdropTypeSheet is the "typesheet" recipe: a pile of typing paper seen from above. Three
// big sheets lie one on another, each turned a little off square so their corners fan out; the top
// sheet carries a red margin line, and the platen of the machine is a dark bar across the top edge.
// Pale and large: the cards on top are the text.
func themeBackdropTypeSheet(k backdropKit) []backdropLayer {
	h := k.hex
	ink := stationeryInk(k)
	var sb strings.Builder
	sheet := func(rot float64, fill, fillOp, strokeOp string) {
		sb.WriteString(fmt.Sprintf("<g transform='rotate(%.1f 700 450)'><rect x='140' y='-40' width='1120' height='1000' fill='%s' fill-opacity='%s' stroke='%s' stroke-opacity='%s' stroke-width='2'/></g>", rot, fill, fillOp, ink, strokeOp))
	}
	sheet(-3.2, ink, k.op(.04, .06), k.op(.16, .24))
	sheet(2.2, ink, k.op(.04, .06), k.op(.16, .24))
	sheet(0, h.ground, "0.5", k.op(.22, .3))
	sb.WriteString(fmt.Sprintf("<path d='M300 0V900' stroke='%s' stroke-width='2' opacity='%s'/>", h.accent, k.op(.32, .3)))
	// Platen.
	sb.WriteString(fmt.Sprintf("<defs><linearGradient id='t' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%s' stop-opacity='%s'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient></defs><rect x='0' y='0' width='1400' height='70' fill='url(#t)'/>", ink, k.op(.16, .22), ink))
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		backdropGround(k),
	}
}

// themeBackdropZenWash is the "zenwash" recipe: a raked gravel garden from above. Fine parallel
// furrows run across the page, bending in rings round three stones; the stones are soft shadows
// with a pale lit side. No sun, no mountains: just raked lines and rest.
func themeBackdropZenWash(k backdropKit) []backdropLayer {
	h := k.hex
	ink := stationeryInk(k)
	var sb strings.Builder
	stones := []struct{ x, y, rx, ry float64 }{{360, 560, 74, 50}, {470, 610, 40, 28}, {1060, 300, 90, 60}}
	for y := 20.0; y < 900; y += 26 {
		// A furrow: straight until it meets a stone, then round it. Drawn as one gentle wave and the
		// rings do the bending.
		sb.WriteString(fmt.Sprintf("<path d='M0 %.0fQ350 %.0f 700 %.0fT1400 %.0f' fill='none' stroke='%s' stroke-width='1.4' opacity='%s'/>", y, y-8, y, y, ink, k.op(.1, .12)))
	}
	for _, st := range stones {
		for i := 1; i <= 6; i++ {
			f := 1 + float64(i)*.55
			sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.0f' fill='none' stroke='%s' stroke-width='1.6' opacity='%s'/>", st.x, st.y, st.rx*f, st.ry*f, ink, k.op(.16-float64(i)*.015, .17-float64(i)*.016)))
		}
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.0f' fill='%s' opacity='%s'/>", st.x+6, st.y+8, st.rx, st.ry, ink, k.op(.16, .3)))
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.0f' fill='%s' opacity='%s'/>", st.x-4, st.y-4, st.rx*.8, st.ry*.7, h.accent, k.op(.14, .12)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		backdropGround(k),
	}
}
