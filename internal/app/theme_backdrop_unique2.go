package app

import (
	"fmt"
	"strings"
)

/*
The second set of one-theme recipes. Where the first set is drawn with gradients, most of these are
drawn as an SVG in a data: URI with the theme's own colours (backdropHex): a candle, a skyline, a
panel of neon tube, the squares of a contribution graph. A shape a gradient cannot make -- a
rectangle that stops, a petal, a ring that fades -- is a path here.

A recipe that is a scene and not a pattern (a skyline, a coral reef, a moon) is one tile as tall as
the window, anchored to its bottom edge, so it is drawn once and does not repeat upward.
*/

// backdropHexOr is a colour the SVG can use: anything that is not a colour it can read (a var(), an
// empty string) becomes a neutral grey.
func backdropHexOr(c string) string {
	c = strings.TrimSpace(c)
	if strings.HasPrefix(c, "#") || strings.HasPrefix(c, "rgb") || strings.HasPrefix(c, "hsl") {
		return c
	}
	return "#888888"
}

// svgBackdropURL wraps an SVG body in a data: URI. The body uses single quotes only.
func svgBackdropURL(w, h int, par, body string) string {
	svg := fmt.Sprintf("<svg xmlns='http://www.w3.org/2000/svg' width='%d' height='%d' viewBox='0 0 %d %d' preserveAspectRatio='%s'>%s</svg>", w, h, w, h, par, body)
	enc := strings.NewReplacer("%", "%25", "<", "%3C", ">", "%3E", "#", "%23").Replace(svg)
	return "url(\"data:image/svg+xml," + enc + "\")"
}

// svgTile is a tile of w by h, scaled by --bd-scale, that repeats.
func svgTile(k backdropKit, w, h int, body string) backdropLayer {
	return backdropLayer{image: svgBackdropURL(w, h, "xMidYMid meet", body), size: k.px(w) + " " + k.px(h)}
}

// svgScene is a tile as big as the window, with the picture anchored by par (e.g. "xMidYMax slice").
func svgScene(w, h int, par, body string) backdropLayer {
	return backdropLayer{image: svgBackdropURL(w, h, par, body), size: "100% 100%"}
}

func backdropGround(k backdropKit) backdropLayer {
	return backdropLayer{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"}
}

// op picks an opacity for a light or a dark page.
func (k backdropKit) op(light, dark float64) string {
	if k.dark {
		return fmt.Sprintf("%.2f", dark)
	}
	return fmt.Sprintf("%.2f", light)
}

// themeBackdropFizz is a flute from the side: thin streams of bubbles that start small at the
// bottom and swell as they rise.
func themeBackdropFizz(k backdropKit) []backdropLayer {
	h := k.hex
	stream := func(w, ht int, c string) backdropLayer {
		var sb strings.Builder
		for i := 0; i < 9; i++ {
			y := ht - 30 - i*(ht-60)/9
			r := 2 + i*2
			x := w/2 + (i%2)*8 - 4
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' fill-opacity='.07' stroke='%s' stroke-width='1.4' opacity='%s'/>", x, y, r, c, c, k.op(.7, .8)))
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='#fff' opacity='.6'/>", x-r/3, y-r/3, float64(r)/4+.6))
		}
		return svgTile(k, w, ht, sb.String())
	}
	return []backdropLayer{
		stream(167, 713, h.accent), stream(233, 823, h.cool), stream(131, 607, h.warm),
		{image: k.blob(50, 112, 100, 36, k.accent, 30)},
		backdropGround(k),
	}
}

// themeBackdropStatic is a television between channels: a noise of fine specks, a lime roll bar
// drifting through and the lines of the tube.
func themeBackdropStatic(k backdropKit) []backdropLayer {
	h := k.hex
	noise := func(w int, seed int, c string, a string) backdropLayer {
		body := fmt.Sprintf("<filter id='n' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='%d' stitchTiles='stitch'/>"+
			"<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.6 0 0 0 -1.05' result='m'/><feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='m' operator='in'/></filter>"+
			"<rect width='%d' height='%d' filter='url(#n)'/>", seed, c, a, w, w)
		return svgTile(k, w, w, body)
	}
	return []backdropLayer{
		{image: "repeating-linear-gradient(0deg, " + k.veil(k.ground, 40) + " 0 1px, transparent 1px " + k.px(4) + ")"},
		{image: "linear-gradient(180deg, transparent 48%, " + k.veil(k.accent, 14) + " 54%, " + k.veil(k.accent, 24) + " 57%, " + k.veil(k.accent, 8) + " 62%, transparent 70%)"},
		noise(220, 3, h.accent, k.op(.5, .6)),
		noise(143, 11, h.cool, k.op(.35, .45)),
		backdropGround(k),
	}
}

// themeBackdropSkyline is a city at dusk: two skylines, a far one that is only a shape and a near
// one with lit windows, over a glow along the bottom edge.
func themeBackdropSkyline(k backdropKit) []backdropLayer {
	h := k.hex
	skyline := func(seed int, minW, maxW, maxH int, fill, edge string, lit []string, alpha string, winShare int) string {
		var sb strings.Builder
		x := 0
		for n := 0; x < 900; n++ {
			bw := minW + k.rnd(seed+n*3, maxW-minW)
			bh := maxH/3 + k.rnd(seed+n*3+1, maxH*2/3)
			top := 520 - bh
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='%s' opacity='%s'/>", x, top, bw-2, bh, fill, alpha))
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='2' fill='%s' opacity='.7'/>", x, top, bw-2, edge))
			if k.rnd(seed+n*3+2, 4) == 0 {
				sb.WriteString(fmt.Sprintf("<path d='M%d %dV%d' stroke='%s' stroke-width='1.5' opacity='.6'/>", x+bw/2, top, top-26, edge))
			}
			if winShare > 0 {
				for wy := top + 10; wy < 512; wy += 12 {
					for wx := x + 6; wx < x+bw-8; wx += 9 {
						if k.rnd(seed+wx*7+wy*13, 100) < winShare {
							sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='4' height='6' fill='%s' opacity='.8'/>", wx, wy, lit[k.rnd(seed+wx+wy, len(lit))]))
						}
					}
				}
			}
			x += bw
		}
		return sb.String()
	}
	return []backdropLayer{
		svgScene(900, 520, "xMidYMax slice", skyline(11, 40, 90, 380, h.accent, h.accent, nil, k.op(.28, .34), 0)),
		svgScene(900, 520, "xMinYMax slice", skyline(5, 36, 70, 280, h.ground, h.cool, []string{h.warm, h.warm, h.cool, h.accent, h.second}, "1", 16)),
		{image: k.blob(50, 112, 100, 36, k.warm, 40)},
		{image: "linear-gradient(180deg, transparent 40%, " + k.veil(k.second, 24) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropMarbled is marbling paper: combed bands of colour from noise, two layers of two
// colours with different grain.
func themeBackdropMarbled(k backdropKit) []backdropLayer {
	h := k.hex
	band := func(w, seed int, fx, fy string, c, a string) backdropLayer {
		body := fmt.Sprintf("<filter id='m' x='0' y='0' width='1' height='1'><feTurbulence type='turbulence' baseFrequency='%s %s' numOctaves='3' seed='%d' stitchTiles='stitch'/>"+
			"<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0' result='r'/>"+
			"<feComponentTransfer in='r' result='b'><feFuncA type='discrete' tableValues='0 0 0 0 0 0 0 0 1 0 0 0 0 0 0 0'/></feComponentTransfer>"+
			"<feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='b' operator='in'/></filter>"+
			"<rect width='%d' height='%d' filter='url(#m)'/>", fx, fy, seed, c, a, w, w)
		return svgTile(k, w, w, body)
	}
	return []backdropLayer{
		band(640, 4, ".007", ".018", h.second, k.op(.5, .6)),
		band(521, 9, ".011", ".013", h.accent, k.op(.55, .65)),
		backdropGround(k),
	}
}

// themeBackdropTubes is a bar sign: three runs of glass tube, each with its glow, bent round the page.
func themeBackdropTubes(k backdropKit) []backdropLayer {
	h := k.hex
	tube := func(d, c string) string {
		return fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='14' stroke-linecap='round' stroke-linejoin='round' opacity='%s' filter='url(#b)'/>"+
			"<path d='%s' fill='none' stroke='%s' stroke-width='5' stroke-linecap='round' stroke-linejoin='round' opacity='%s'/>"+
			"<path d='%s' fill='none' stroke='#fff' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' opacity='.7'/>",
			d, c, k.op(.6, .8), d, c, k.op(.7, .9), d)
	}
	body := "<defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='9'/></filter></defs>" +
		tube("M120 140H520Q580 140 580 200V300Q580 360 520 360H300", h.accent) +
		"<circle cx='1100' cy='250' r='96' fill='none' stroke='" + h.cool + "' stroke-width='14' opacity='" + k.op(.6, .8) + "' filter='url(#b)'/>" +
		"<circle cx='1100' cy='250' r='96' fill='none' stroke='" + h.cool + "' stroke-width='5' opacity='" + k.op(.7, .9) + "'/>" +
		"<circle cx='1100' cy='250' r='96' fill='none' stroke='#fff' stroke-width='1.6' opacity='.7'/>" +
		tube("M80 760C300 640 500 880 760 740S1180 700 1340 800", h.warm) +
		tube("M140 520H260Q300 520 300 560V640", h.cool) +
		tube("M900 520H1200Q1260 520 1260 580V680", h.cool) +
		tube("M520 580C560 480 640 480 660 580S760 660 800 580", h.second) +
		tube("M1330 110V420", h.warm) +
		tube("M80 440L160 380L240 440L320 380", h.accent) +
		"<circle cx='700' cy='130' r='44' fill='none' stroke='" + h.second + "' stroke-width='14' opacity='" + k.op(.6, .8) + "' filter='url(#b)'/>" +
		"<circle cx='700' cy='130' r='44' fill='none' stroke='" + h.second + "' stroke-width='5' opacity='" + k.op(.7, .9) + "'/>" +
		"<circle cx='700' cy='130' r='44' fill='none' stroke='#fff' stroke-width='1.6' opacity='.7'/>"
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", body),
		backdropGround(k),
	}
}

// themeBackdropContrib is a contribution graph: a field of small squares, a week to a column, each
// as green as the day was busy.
func themeBackdropContrib(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	base, baseOp := "black", ".08"
	if k.dark {
		base, baseOp = "white", ".08"
	}
	for c := 0; c < 40; c++ {
		for r := 0; r < 7; r++ {
			n := k.rnd(c*7+r, 100)
			col, a := base, baseOp
			switch {
			case n >= 94:
				col, a = h.cool, k.op(.85, .9)
			case n >= 84:
				col, a = h.cool, k.op(.6, .65)
			case n >= 68:
				col, a = h.cool, k.op(.38, .42)
			case n >= 52:
				col, a = h.cool, k.op(.2, .24)
			}
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='11' height='11' rx='2' fill='%s' opacity='%s'/>", c*14, r*14, col, a))
		}
	}
	return []backdropLayer{svgTile(k, 560, 98, sb.String()), backdropGround(k)}
}

// themeBackdropTwill is denim: a fine diagonal twill, faded whiskers where it has worn, a seam of
// double stitching down the left and a stitched back pocket in the corner.
func themeBackdropTwill(k backdropKit) []backdropLayer {
	h := k.hex
	seam := fmt.Sprintf("<g fill='none' stroke='%s' stroke-width='3' stroke-dasharray='14 9' opacity='%s'><path d='M70 0V1000'/><path d='M84 0V1000'/></g>", h.warm, k.op(.55, .6))
	pocket := fmt.Sprintf("<g fill='none' opacity='%s'><path d='M640 600H980V930L810 985L640 930Z' stroke='%s' stroke-width='3'/>"+
		"<path d='M654 614H966V920L810 970L654 920Z' stroke='%s' stroke-width='3' stroke-dasharray='12 8'/></g>", k.op(.5, .55), h.accent, h.warm)
	ink := "black"
	if k.dark {
		ink = "white"
	}
	return []backdropLayer{
		{image: k.blob(24, 60, 34, 7, ink, 14) + ""},
		{image: k.blob(76, 34, 30, 6, ink, 12)},
		{image: "repeating-linear-gradient(63deg, " + k.veil(h.accent, 18) + " 0 1px, transparent 1px " + k.px(4) + ")"},
		{image: "repeating-linear-gradient(-63deg, " + k.veil(h.cool, 10) + " 0 1px, transparent 1px " + k.px(7) + ")"},
		{image: svgBackdropURL(1000, 1000, "none", seam), size: "100% 100%"},
		svgScene(1000, 1000, "xMaxYMax meet", pocket),
		backdropGround(k),
	}
}

// themeBackdropSandripples is wind on sand: ripple lines in long curves, struck from three centres
// far off the page.
func themeBackdropSandripples(k backdropKit) []backdropLayer {
	v := k.veil
	ring := func(at string, c string, p, gap int) backdropLayer {
		return backdropLayer{image: "repeating-radial-gradient(circle at " + at + ", " + v(c, p) + " 0 1px, transparent 1px " + k.px(gap) + ")"}
	}
	return []backdropLayer{
		ring("130% 150%", k.accent, 40, 19),
		ring("-30% 160%", k.warm, 34, 23),
		ring("60% 190%", k.second, 24, 29),
		{image: k.blob(80, 20, 60, 50, k.warm, 28)},
		{image: k.blob(20, 80, 60, 50, k.accent, 24)},
		backdropGround(k),
	}
}

// themeBackdropMirage is the desert at noon: a low sun with its halo, a line of mesas on the
// horizon and the air above the sand bending in rows.
func themeBackdropMirage(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><radialGradient id='s'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='" + k.op(.6, .7) + "'/><stop offset='.5' stop-color='" + h.warm + "' stop-opacity='" + k.op(.2, .26) + "'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<circle cx='980' cy='540' r='320' fill='url(#s)'/>")
	sb.WriteString("<circle cx='980' cy='540' r='84' fill='" + h.warm + "' opacity='" + k.op(.55, .65) + "'/>")
	sb.WriteString("<path d='M0 560V520H120L150 470H260L290 520H470V500H560L590 450H700L730 500H860V560Z' fill='" + h.second + "' opacity='" + k.op(.22, .3) + "'/>")
	for i := 0; i < 14; i++ {
		y := 570 + i*16
		sb.WriteString(fmt.Sprintf("<path d='M0 %d", y))
		for x := 0; x < 1400; x += 80 {
			sb.WriteString(fmt.Sprintf("q40 %d 80 0", -7-(i%3)*2))
		}
		sb.WriteString(fmt.Sprintf("' fill='none' stroke='%s' stroke-width='1.4' opacity='%.2f'/>", h.accent, (0.7-float64(i)*0.04)*map[bool]float64{true: 0.9, false: 0.75}[k.dark]))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 50%, " + k.veil(h.warm, 22) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropTwilight is the first stars: a crescent moon, a scatter of stars in the upper sky,
// long thin cloud over the horizon and a band of last light under it.
func themeBackdropTwilight(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<path d='M1130 150A62 62 0 1 0 1190 250A50 50 0 1 1 1130 150Z' fill='" + h.warm + "' opacity='" + k.op(.4, .5) + "'/>")
	for i := 0; i < 46; i++ {
		x, y := k.rnd(i*3, 1400), k.rnd(i*3+1, 420)
		r := 1 + float64(k.rnd(i*3+2, 12))/10
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, y, r, h.accent, k.op(.6, .8)))
	}
	for i, c := range []struct{ x, y, l, t int }{{200, 520, 420, 6}, {760, 560, 520, 8}, {1060, 500, 300, 5}, {80, 600, 360, 7}, {640, 640, 440, 6}} {
		col := h.accent
		if i%2 == 1 {
			col = h.second
		}
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s'/>", c.x, c.y, c.l/2, c.t, col, k.op(.2, .26)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 52%, " + k.veil(h.second, 22) + " 76%, " + k.veil(h.warm, 28) + " 94%, transparent 100%)"},
		backdropGround(k),
	}
}

// themeBackdropMinimap is an editor's minimap: lines of code seen from far away, each a few bars
// of the syntax colours, indented the way code is.
func themeBackdropMinimap(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.accent, h.second, h.warm, h.cool, h.accent}
	page := func(w, rows, seed int) backdropLayer {
		var sb strings.Builder
		for r := 0; r < rows; r++ {
			x := (k.rnd(seed+r*5, 4)) * 12
			for s := 0; s < 1+k.rnd(seed+r*5+1, 3); s++ {
				bw := 18 + k.rnd(seed+r*5+2+s*17, 120)
				sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='4' rx='1.5' fill='%s' opacity='%s'/>", x, r*8+2, bw, cols[k.rnd(seed+r*5+3+s*7, len(cols))], k.op(.2, .26)))
				x += bw + 8
			}
		}
		return svgTile(k, w, rows*8, sb.String())
	}
	return []backdropLayer{page(520, 30, 100), page(437, 26, 700), backdropGround(k)}
}

// themeBackdropOrchidBloom is an orchid: five petals and a lip round a throat, large and cropped by
// the top right corner, with a smaller bloom at the bottom left.
func themeBackdropOrchidBloom(k backdropKit) []backdropLayer {
	h := k.hex
	bloom := func(cx, cy int, sc float64, id string) string {
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("<g transform='translate(%d %d) scale(%.2f)'>", cx, cy, sc))
		for _, a := range []int{36, 108, 180, 252, 324} {
			sb.WriteString(fmt.Sprintf("<ellipse cx='0' cy='-120' rx='38' ry='150' fill='%s' opacity='%s' transform='rotate(%d)'/>", h.cool, k.op(.1, .14), a))
		}
		for _, a := range []int{0, 72, 144, 216, 288} {
			sb.WriteString(fmt.Sprintf("<ellipse cx='0' cy='-110' rx='72' ry='128' fill='url(#%s)' stroke='%s' stroke-width='1.5' stroke-opacity='.4' transform='rotate(%d)'/>", id, h.accent, a))
		}
		sb.WriteString(fmt.Sprintf("<ellipse cx='0' cy='52' rx='44' ry='58' fill='%s' opacity='%s'/>", h.second, k.op(.5, .6)))
		sb.WriteString(fmt.Sprintf("<circle cx='0' cy='0' r='26' fill='%s' opacity='.7'/><circle cx='0' cy='0' r='10' fill='#fff' opacity='.8'/>", h.warm))
		sb.WriteString("</g>")
		return sb.String()
	}
	grad := func(id string) string {
		return fmt.Sprintf("<linearGradient id='%s' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='%s' stop-opacity='%s'/><stop offset='1' stop-color='%s' stop-opacity='%s'/></linearGradient>",
			id, h.second, k.op(.26, .32), h.accent, k.op(.18, .22))
	}
	return []backdropLayer{
		svgScene(900, 900, "xMinYMax slice", "<defs>"+grad("q")+"</defs>"+bloom(200, 720, 0.6, "q")),
		svgScene(900, 900, "xMaxYMin slice", "<defs>"+grad("p")+"</defs>"+bloom(700, 260, 1.05, "p")),
		backdropGround(k),
	}
}

// themeBackdropCandleGlow is candlelight with no candles: tall soft flames of warm light, each with
// a wide halo, on three pitches, over a warm haze along the bottom.
func themeBackdropCandleGlow(k backdropKit) []backdropLayer {
	v := k.veil
	glow := func(w, h, x, y, rx, ry int, c string, p int) backdropLayer {
		return backdropLayer{
			image: "radial-gradient(ellipse " + k.px(rx) + " " + k.px(ry) + " at " + k.px(x) + " " + k.px(y) + ", " + v(c, p) + " 0, " + v(c, p*45/100) + " 35%, " + v(c, p*12/100) + " 70%, transparent 100%)",
			size:  k.px(w) + " " + k.px(h),
		}
	}
	return []backdropLayer{
		glow(211, 233, 60, 80, 7, 24, k.accent, 90),
		glow(307, 331, 200, 150, 8, 28, k.warm, 90),
		glow(149, 173, 90, 60, 6, 18, k.warm, 90),
		glow(211, 233, 60, 90, 90, 120, k.warm, 46),
		glow(307, 331, 200, 160, 130, 160, k.accent, 40),
		glow(149, 173, 90, 70, 70, 90, k.warm, 38),
		{image: k.blob(50, 112, 100, 46, k.warm, 40)},
		backdropGround(k),
	}
}

// themeBackdropCandyGlow is a sweet shop as colour only: soft fields of pink, teal and orange, with
// glitter on three pitches.
func themeBackdropCandyGlow(k backdropKit) []backdropLayer {
	v := k.veil
	spark := func(w, h, x, y int, c string, p int) backdropLayer {
		return backdropLayer{
			image: "radial-gradient(circle at " + k.px(x) + " " + k.px(y) + ", " + v(c, p) + " 0, " + v(c, p*40/100) + " " + k.px(2) + ", transparent " + k.px(5) + ")",
			size:  k.px(w) + " " + k.px(h),
		}
	}
	return []backdropLayer{
		spark(53, 61, 20, 24, "#fff", 80),
		spark(79, 71, 40, 30, k.cool, 80),
		spark(97, 89, 60, 50, k.warm, 80),
		{image: k.blob(20, 25, 60, 55, k.accent, 58)},
		{image: k.blob(82, 20, 52, 50, k.cool, 52)},
		{image: k.blob(74, 82, 60, 55, k.warm, 48)},
		{image: k.blob(14, 86, 50, 50, k.second, 46)},
		{image: "linear-gradient(115deg, transparent 30%, " + v(k.accent, 24) + " 46%, " + v(k.cool, 20) + " 56%, transparent 72%)"},
		backdropGround(k),
	}
}

// themeBackdropCloudBank is the sky from below: one bank of cloud along the whole top edge, built of
// overlapping soft masses, over a sky that is bluest at the top and clears towards the middle.
func themeBackdropCloudBank(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	// The shadow of the bank first, in the sky's blue, then the white tops over it.
	for i := 0; i < 17; i++ {
		x := -40 + i*88
		r := 62 + k.rnd(i*3, 50)
		y := 20 + k.rnd(i*3+1, 60)
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%s'/>", x, y+34, r, h.accent, k.op(.38, .16)))
	}
	sb.WriteString(fmt.Sprintf("<rect x='-100' y='0' width='1600' height='90' fill='%s' opacity='%s'/>", h.accent, k.op(.3, .14)))
	for i := 0; i < 17; i++ {
		x := -40 + i*88
		r := 62 + k.rnd(i*3, 50)
		y := 20 + k.rnd(i*3+1, 60)
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='#fff' opacity='%s'/>", x, y, r, k.op(.95, .1)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMin slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(h.accent, 54) + ", " + k.veil(h.accent, 16) + " 36%, transparent 64%)"},
		backdropGround(k),
	}
}

// themeBackdropGraphiteGlow is graphite and a red light: soft cherry and rose fields over dark
// diagonal bands and the hatching of a pencil.
func themeBackdropGraphiteGlow(k backdropKit) []backdropLayer {
	v := k.veil
	ink := "black"
	if k.dark {
		ink = "white"
	}
	return []backdropLayer{
		{image: k.line(ink, 5, 45, 9)},
		{image: k.line(ink, 3, 135, 23)},
		{image: "repeating-linear-gradient(60deg, transparent 0 " + k.px(97) + ", " + v(ink, 14) + " " + k.px(97) + " " + k.px(100) + ")"},
		{image: "linear-gradient(120deg, transparent 18%, " + v(ink, 24) + " 38%, " + v(ink, 10) + " 52%, transparent 66%)"},
		{image: k.blob(28, 72, 60, 52, k.second, 80)},
		{image: k.blob(78, 28, 56, 50, k.accent, 72)},
		{image: k.blob(62, 98, 50, 30, k.second, 48)},
		backdropGround(k),
	}
}

// themeBackdropPCB is a printed circuit board: copper traces that run straight and turn at 45
// degrees, a ring at every joint, a few vias and a chip with its pins, on one tile.
func themeBackdropPCB(k backdropKit) []backdropLayer {
	h := k.hex
	trace := func(d, c string, w float64) string {
		return fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' stroke-linecap='round' stroke-linejoin='round' opacity='%s'/>", d, c, w, k.op(.55, .6))
	}
	pad := func(x, y int, c string) string {
		return fmt.Sprintf("<circle cx='%d' cy='%d' r='7' fill='%s' fill-opacity='.18' stroke='%s' stroke-width='2.5' opacity='%s'/><circle cx='%d' cy='%d' r='2.4' fill='%s'/>", x, y, c, c, k.op(.7, .75), x, y, h.ground)
	}
	var sb strings.Builder
	sb.WriteString(trace("M20 60H140L180 100H340", h.accent, 3))
	sb.WriteString(trace("M20 140H80L120 180V300H340", h.accent, 3))
	sb.WriteString(trace("M60 20V90L100 130V230H220L260 270H340", h.accent, 3))
	sb.WriteString(trace("M200 20V70H300L340 110", h.cool, 2))
	sb.WriteString(trace("M20 260H100L140 300V340", h.cool, 2))
	sb.WriteString(trace("M160 340V320L190 290H260", h.warm, 2))
	for _, pt := range [][2]int{{20, 60}, {340, 100}, {20, 140}, {340, 300}, {60, 20}, {340, 270}} {
		sb.WriteString(pad(pt[0], pt[1], h.accent))
	}
	for _, pt := range [][2]int{{200, 20}, {340, 110}, {20, 260}, {140, 340}, {260, 290}} {
		sb.WriteString(pad(pt[0], pt[1], h.cool))
	}
	sb.WriteString(fmt.Sprintf("<rect x='236' y='150' width='70' height='46' rx='3' fill='none' stroke='%s' stroke-width='2' opacity='%s'/>", h.cool, k.op(.6, .65)))
	for i := 0; i < 5; i++ {
		x := 244 + i*13
		sb.WriteString(fmt.Sprintf("<path d='M%d 150V140M%d 196V206' stroke='%s' stroke-width='2.5' opacity='%s'/>", x, x, h.warm, k.op(.6, .65)))
	}
	sb.WriteString(fmt.Sprintf("<circle cx='246' cy='160' r='3' fill='%s' opacity='.7'/>", h.warm))
	return []backdropLayer{svgTile(k, 360, 360, sb.String()), backdropGround(k)}
}

// themeBackdropSwells is the sea as bands of colour: swells of pink, teal, amber and coral, stacked
// from the bottom edge to the top, each fainter than the one below.
func themeBackdropSwells(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.accent, h.cool, h.second, h.warm}
	var sb strings.Builder
	for i := 0; i < 8; i++ {
		y := 740 - i*100
		d := fmt.Sprintf("M0 %d C150 %d 300 %d 500 %d S850 %d 1000 %d V800 H0Z", y, y-60+(i%2)*120, y+60-(i%2)*120, y, y-50+(i%2)*100, y)
		a := 0.4 - float64(i)*0.04
		if !k.dark {
			a *= 0.8
		}
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='%s' opacity='%.2f'/><path d='M0 %d C150 %d 300 %d 500 %d S850 %d 1000 %d' fill='none' stroke='%s' stroke-width='2' opacity='%.2f'/>",
			d, cols[i%4], a, y, y-60+(i%2)*120, y+60-(i%2)*120, y, y-50+(i%2)*100, y, cols[i%4], a+0.2))
	}
	return []backdropLayer{svgScene(1000, 800, "none", sb.String()), backdropGround(k)}
}

// themeBackdropNebulaBands is deep space without a single star: fields of violet, green and amber,
// one diagonal band of light and a fine dust.
func themeBackdropNebulaBands(k backdropKit) []backdropLayer {
	v := k.veil
	dust := func(w, h, x, y int, c string, p int) backdropLayer {
		return backdropLayer{image: "radial-gradient(circle at " + k.px(x) + " " + k.px(y) + ", " + v(c, p) + " 0, transparent " + k.px(2) + ")", size: k.px(w) + " " + k.px(h)}
	}
	return []backdropLayer{
		dust(41, 47, 10, 14, "#fff", 70),
		dust(67, 59, 30, 20, k.cool, 70),
		{image: "linear-gradient(115deg, transparent 28%, " + v(k.accent, 24) + " 44%, " + v(k.cool, 20) + " 56%, transparent 72%)"},
		{image: k.blob(20, 30, 60, 50, k.accent, 56)},
		{image: k.blob(82, 72, 60, 50, k.cool, 46)},
		{image: k.blob(62, 14, 40, 30, k.warm, 30)},
		{image: k.blob(8, 92, 40, 30, k.second, 28)},
		backdropGround(k),
	}
}

// themeBackdropLightBands is light under water: broad soft bands of colour that drift across the
// page, each with a fine line of light along it.
func themeBackdropLightBands(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='f' x='-20%' y='-60%' width='140%' height='220%'><feGaussianBlur stdDeviation='28'/></filter></defs>")
	for i := 0; i < 5; i++ {
		y := 110 + i*150
		c := h.accent
		if i%2 == 1 {
			c = h.cool
		}
		d := fmt.Sprintf("M-100 %d C200 %d 500 %d 800 %d S1300 %d 1500 %d", y, y-80, y+80, y, y-60, y+20)
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='80' opacity='%s' filter='url(#f)'/>", d, c, k.op(.3, .34)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='1.5' opacity='%s' transform='translate(0 26)'/>", d, c, k.op(.4, .5)))
	}
	return []backdropLayer{svgScene(1400, 800, "none", sb.String()), backdropGround(k)}
}
