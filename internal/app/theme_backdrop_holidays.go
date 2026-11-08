package app

import (
	"fmt"
	"strings"
)

// themeBackdropGingerbread is a baking tray seen from above: gingerbread men, stars, hearts,
// round cookies and candy canes laid out in loose rows, each piped with white icing and
// dotted with sugar in the theme's colours. Drawn sharp, with no soft fields, so the icing
// lines stay crisp at any size.
func themeBackdropGingerbread(k backdropKit) []backdropLayer {
	h := k.hex
	dough, doughEdge, icing := "#c98b55", "#a86d3c", "#ffffff"
	cookieOp, icingOp := k.op(0.62, 0.42), k.op(0.95, 0.78)
	if k.dark {
		dough, doughEdge = "#9a6034", "#6e4022"
	}
	sugar := []string{h.accent, h.warm, h.cool, h.second}

	man := func() string {
		return "<path d='M-9 -12L-26 -6Q-31 0-24 4L-10 1L-17 27Q-17 34-10 33L0 15L10 33Q17 34 17 27L10 1L24 4Q31 0 26 -6L9 -12Z' fill='" + dough + "' stroke='" + doughEdge + "' stroke-width='1.5'/>" +
			"<circle cy='-22' r='12' fill='" + dough + "' stroke='" + doughEdge + "' stroke-width='1.5'/>" +
			"<g fill='none' stroke='" + icing + "' stroke-width='2.2' stroke-linecap='round' opacity='" + icingOp + "'>" +
			"<path d='M-5 -18Q0 -14 5 -18'/><path d='M-22 -3l3 3 3 -3 3 3M16 -3l3 3 3 -3 3 3'/><path d='M-14 25l3 3 3 -3M8 25l3 3 3 -3'/></g>" +
			"<g fill='" + icing + "' opacity='" + icingOp + "'><circle cx='-4' cy='-25' r='1.8'/><circle cx='4' cy='-25' r='1.8'/></g>" +
			"<circle cy='-4' r='2.6' fill='" + sugar[0] + "'/><circle cy='5' r='2.6' fill='" + sugar[1] + "'/>"
	}
	star := func() string {
		pts := "0,-30 8,-10 29,-9 13,4 18,25 0,13 -18,25 -13,4 -29,-9 -8,-10"
		inner := "0,-22 5,-8 21,-7 9,2 13,18 0,9 -13,18 -9,2 -21,-7 -5,-8"
		return "<polygon points='" + pts + "' fill='" + dough + "' stroke='" + doughEdge + "' stroke-width='1.5' stroke-linejoin='round'/>" +
			"<polygon points='" + inner + "' fill='none' stroke='" + icing + "' stroke-width='2' stroke-dasharray='3 3' stroke-linejoin='round' opacity='" + icingOp + "'/>" +
			"<circle r='3.4' fill='" + sugar[2] + "'/>"
	}
	heart := func() string {
		return "<path d='M0 24C-30 4-30-22-12-22C-5-22 0-16 0-12C0-16 5-22 12-22C30-22 30 4 0 24Z' fill='" + dough + "' stroke='" + doughEdge + "' stroke-width='1.5'/>" +
			"<path d='M0 15C-20 2-20-15-10-15C-5-15-1-11 0-7C1-11 5-15 10-15C20-15 20 2 0 15Z' fill='none' stroke='" + icing + "' stroke-width='2.2' opacity='" + icingOp + "'/>" +
			"<circle cx='-8' cy='-6' r='2' fill='" + sugar[3] + "'/><circle cx='8' cy='-6' r='2' fill='" + sugar[0] + "'/><circle cy='4' r='2' fill='" + sugar[1] + "'/>"
	}
	round := func() string {
		return "<circle r='24' fill='" + dough + "' stroke='" + doughEdge + "' stroke-width='1.5'/>" +
			"<path d='M0 0m-3 0a3 3 0 1 1 6 0a7 7 0 1 1-13 0a11 11 0 1 1 21 0a15 15 0 1 1-29 0' fill='none' stroke='" + icing + "' stroke-width='2' opacity='" + icingOp + "'/>"
	}
	flake := func() string {
		var arms strings.Builder
		for a := 0; a < 180; a += 60 {
			arms.WriteString(fmt.Sprintf("<path d='M0 -18V18M0 -11l-5 -5M0 -11l5 -5M0 11l-5 5M0 11l5 5' transform='rotate(%d)'/>", a))
		}
		return "<circle r='25' fill='" + dough + "' stroke='" + doughEdge + "' stroke-width='1.5'/>" +
			"<g fill='none' stroke='" + icing + "' stroke-width='2.2' stroke-linecap='round' opacity='" + icingOp + "'>" + arms.String() + "</g>"
	}
	cane := func() string {
		d := "M8 30V-12A12 12 0 0 0-16 -12"
		return "<path d='" + d + "' fill='none' stroke='" + icing + "' stroke-width='9' stroke-linecap='round' opacity='" + icingOp + "'/>" +
			"<path d='" + d + "' fill='none' stroke='" + h.accent + "' stroke-width='9' stroke-linecap='round' stroke-dasharray='5 6'/>"
	}
	shapes := []func() string{man, star, heart, round, man, flake, cane, star, heart, man}

	var sb strings.Builder
	sb.WriteString("<g opacity='" + cookieOp + "'>")
	const cols, rows = 9, 6
	i := 0
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			x := 80 + float64(c)*160 + float64((r%2)*80) + float64((i*37)%23-11)
			y := 70 + float64(r)*150 + float64((i*53)%27-13)
			rot := (i*47)%50 - 25
			scale := 0.95 + float64((i*29)%30)/100
			sb.WriteString(fmt.Sprintf("<g transform='translate(%.0f %.0f) rotate(%d) scale(%.2f)'>%s</g>", x, y, rot, scale, shapes[(i*7+r)%len(shapes)]()))
			i++
		}
	}
	sb.WriteString("</g>")
	// Sugar sprinkles between the cookies.
	sb.WriteString("<g opacity='" + k.op(0.75, 0.6) + "'>")
	for j := 0; j < 140; j++ {
		x := (j*137 + 41) % 1400
		y := (j*211 + 97) % 900
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='3' height='9' rx='1.5' fill='%s' transform='rotate(%d %d %d)'/>",
			x, y, sugar[j%len(sugar)], (j*61)%180, x+1, y+4))
	}
	sb.WriteString("</g>")
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		backdropGround(k),
	}
}
