package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropLookEmber is a bed of cooling coals: big blurred, overlapping lumps of orange, pink
// and lime glow packed along the bottom edge, with a hot haze rising off them into the velvet.
func themeBackdropLookEmber(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.accent, h.second, h.warm, h.accent, h.cool, h.second}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-40%' width='140%' height='180%'><feGaussianBlur stdDeviation='16'/></filter></defs><g filter='url(#b)'>")
	for i := 0; i < 38; i++ {
		cx := k.rnd(i*7+1, 1500) - 50
		cy := 740 + k.rnd(i*7+2, 190)
		rx := 60 + k.rnd(i*7+3, 90)
		ry := 30 + k.rnd(i*7+4, 40)
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s' transform='rotate(%d %d %d)'/>",
			cx, cy, rx, ry, cols[i%len(cols)], k.op(.62, .72), k.rnd(i*7+5, 40)-20, cx, cy))
	}
	sb.WriteString("</g>")
	for i := 0; i < 14; i++ {
		x := 40 + k.rnd(i*5+11, 1320)
		y := 700 + k.rnd(i*5+12, 180)
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%s'/>", x, y, 3+k.rnd(i*5+13, 5), h.warm, k.op(.8, .95)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 112, 110, 40, k.accent, 34)},
		{image: "linear-gradient(0deg, " + k.veil(k.second, 26) + ", transparent 45%)"},
		backdropGround(k),
	}
}

// themeBackdropLookSupernova is the shell of an exploded star: thick, blurred, broken rings of
// gold, mint and magenta spreading from a bright star with diffraction spikes high in the right
// corner, with thin filaments thrown outward through the rings.
func themeBackdropLookSupernova(k backdropKit) []backdropLayer {
	h := k.hex
	cx, cy := 1080.0, 230.0
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b1' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='26'/></filter>" +
		"<filter id='b2' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='9'/></filter>" +
		"<filter id='b3' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='2.5'/></filter>" +
		fmt.Sprintf("<radialGradient id='c'><stop offset='0' stop-color='#ffffff'/><stop offset='.25' stop-color='%s'/><stop offset='1' stop-color='%s' stop-opacity='0'/></radialGradient></defs>", h.accent, h.accent))
	ring := func(r float64, w float64, c string, dash string, f string, a string) {
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-width='%.0f' stroke-dasharray='%s' filter='url(#%s)' opacity='%s'/>", cx, cy, r, c, w, dash, f, a))
	}
	ring(520, 110, h.second, "900 340 520 210", "b1", k.op(.5, .6))
	ring(400, 80, h.cool, "700 280 460 150", "b1", k.op(.55, .65))
	ring(290, 44, h.accent, "520 160 300 90", "b2", k.op(.65, .8))
	ring(205, 20, h.warm, "260 90 190 60", "b2", k.op(.7, .85))
	cols := []string{h.accent, h.cool, h.second, h.warm}
	for i := 0; i < 46; i++ {
		a := float64(k.rnd(i*3+1, 360)) * math.Pi / 180
		r0 := 230 + float64(k.rnd(i*3+2, 220))
		l := 40 + float64(k.rnd(i*3+3, 150))
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='%.1f' stroke-linecap='round' filter='url(#b3)' opacity='%s'/>",
			cx+r0*math.Cos(a), cy+r0*math.Sin(a), cx+(r0+l)*math.Cos(a), cy+(r0+l)*math.Sin(a), cols[i%4], 1.4+float64(i%3), k.op(.6, .75)))
	}
	sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='120' fill='url(#c)' opacity='%s'/>", cx, cy, k.op(.8, .95)))
	sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='360' ry='3' fill='%s' filter='url(#b3)' opacity='%s'/>", cx, cy, h.accent, k.op(.8, .95)))
	sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='3' ry='260' fill='%s' filter='url(#b3)' opacity='%s'/>", cx, cy, h.accent, k.op(.8, .95)))
	return []backdropLayer{
		svgScene(1400, 900, "xMaxYMin slice", sb.String()),
		{image: k.blob(100, 0, 70, 60, k.second, 26)},
		backdropGround(k),
	}
}

// themeBackdropLookSolarFlare is a camera pointed into the sun: a blown-out light in the top right
// corner with a long anamorphic streak, and a diagonal chain of ghost discs and hexagons, each in
// a different theme colour, marching across the page.
func themeBackdropLookSolarFlare(k backdropKit) []backdropLayer {
	h := k.hex
	sx, sy := 1260.0, 110.0
	ex, ey := 90.0, 800.0
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-200%' width='140%' height='500%'><feGaussianBlur stdDeviation='6'/></filter>" +
		fmt.Sprintf("<radialGradient id='s'><stop offset='0' stop-color='#ffffff'/><stop offset='.2' stop-color='%s'/><stop offset='1' stop-color='%s' stop-opacity='0'/></radialGradient></defs>", h.warm, h.accent))
	sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='330' fill='url(#s)' opacity='%s'/>", sx, sy, k.op(.8, .95)))
	sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='900' ry='9' fill='%s' filter='url(#b)' opacity='%s'/>", sx, sy, h.warm, k.op(.7, .85)))
	sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='620' ry='3' fill='#ffffff' filter='url(#b)' opacity='%s'/>", sx, sy, k.op(.6, .8)))
	cols := []string{h.second, h.cool, h.accent, h.warm, h.second, h.cool, h.accent}
	ts := []float64{.16, .27, .38, .5, .63, .8, 1.0}
	rs := []float64{34, 70, 22, 110, 48, 150, 60}
	for i, t := range ts {
		x := sx + (ex-sx)*t
		y := sy + (ey-sy)*t
		c := cols[i]
		if i%2 == 0 {
			var pts []string
			for a := 0; a < 6; a++ {
				ang := float64(a)*math.Pi/3 + math.Pi/6
				pts = append(pts, fmt.Sprintf("%.0f,%.0f", x+rs[i]*math.Cos(ang), y+rs[i]*math.Sin(ang)))
			}
			sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='%s' fill-opacity='%s' stroke='%s' stroke-width='2' opacity='%s'/>", strings.Join(pts, " "), c, k.op(.22, .26), c, k.op(.8, .9)))
		} else {
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='%s' fill-opacity='%s' stroke='%s' stroke-width='3' stroke-opacity='.9' opacity='%s'/>", x, y, rs[i], c, k.op(.3, .34), c, k.op(.8, .9)))
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='#ffffff' stroke-width='1' opacity='.4'/>", x, y, rs[i]*.6))
		}
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMaxYMin slice", sb.String()),
		{image: k.blob(100, 0, 80, 70, k.accent, 36)},
		{image: "linear-gradient(210deg, " + k.veil(k.warm, 22) + ", transparent 55%)"},
		backdropGround(k),
	}
}

// themeBackdropLookCandyBurst is a comic-book pop: two fields of halftone dots, pink swelling out
// of the lower left corner and mint out of the upper right, shrinking to nothing towards the
// middle of the page.
func themeBackdropLookCandyBurst(k backdropKit) []backdropLayer {
	h := k.hex
	dots := func(ox, oy float64, c string, a string, off float64) string {
		var sb strings.Builder
		const step = 44.0
		for y := off; y < 940; y += step {
			for x := off; x < 1440; x += step {
				d := math.Hypot(x-ox, y-oy)
				f := 1 - d/1050
				if f <= 0 {
					continue
				}
				r := 17 * f * f
				if r < 1.6 {
					continue
				}
				sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.1f'/>", x, y, r))
			}
		}
		return fmt.Sprintf("<g fill='%s' opacity='%s'>%s</g>", c, a, sb.String())
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMinYMax slice", dots(0, 900, h.accent, k.op(.8, .85), 10)),
		svgScene(1400, 900, "xMaxYMin slice", dots(1400, 0, h.cool, k.op(.75, .8), 32)),
		{image: k.blob(8, 96, 50, 50, k.warm, 34)},
		{image: k.blob(94, 6, 40, 40, k.second, 28)},
		backdropGround(k),
	}
}

// themeBackdropLookMagma is a lava river: one thick winding channel of glow across the page, with
// a white-hot core, a wide red halo, a thinner side branch and a few dark crust slabs floating on it.
func themeBackdropLookMagma(k backdropKit) []backdropLayer {
	h := k.hex
	main := "M-120 760 C 240 560 420 960 760 640 S 1180 260 1520 400"
	side := "M520 700 C 640 820 820 860 980 960"
	var sb strings.Builder
	sb.WriteString("<defs><filter id='a' x='-20%' y='-40%' width='140%' height='180%'><feGaussianBlur stdDeviation='34'/></filter>" +
		"<filter id='b' x='-20%' y='-40%' width='140%' height='180%'><feGaussianBlur stdDeviation='12'/></filter>" +
		"<filter id='c' x='-20%' y='-40%' width='140%' height='180%'><feGaussianBlur stdDeviation='3'/></filter></defs>")
	stroke := func(d, c string, w int, f, a string) {
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%d' stroke-linecap='round' filter='url(#%s)' opacity='%s'/>", d, c, w, f, a))
	}
	stroke(main, h.second, 190, "a", k.op(.6, .7))
	stroke(side, h.second, 110, "a", k.op(.5, .6))
	stroke(main, h.accent, 80, "b", k.op(.85, .95))
	stroke(side, h.accent, 40, "b", k.op(.8, .9))
	stroke(main, h.warm, 22, "c", k.op(.95, 1))
	stroke(side, h.warm, 10, "c", k.op(.9, 1))
	slabs := [][3]int{{300, 700, 46}, {620, 700, 34}, {900, 520, 40}, {1160, 330, 36}, {80, 740, 30}}
	for i, s := range slabs {
		var pts []string
		for a := 0; a < 7; a++ {
			ang := float64(a) * math.Pi * 2 / 7
			r := float64(s[2]) * (.7 + float64(k.rnd(i*9+a, 60))/100)
			pts = append(pts, fmt.Sprintf("%.0f,%.0f", float64(s[0])+r*math.Cos(ang), float64(s[1])+r*math.Sin(ang)*.6))
		}
		sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='%s' stroke='%s' stroke-width='1.5' stroke-opacity='.7'/>", strings.Join(pts, " "), h.ground, h.warm))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(0deg, " + k.veil(k.accent, 24) + ", transparent 50%)"},
		backdropGround(k),
	}
}

// themeBackdropLookLagoon is the light on the floor of a shallow lagoon: two drifting webs of
// bright caustic lines, one mint and one lime, over a pool of turquoise that deepens in the corner.
func themeBackdropLookLagoon(k backdropKit) []backdropLayer {
	h := k.hex
	web := func(w int, seed int, fx string, c string, a string) backdropLayer {
		body := fmt.Sprintf("<filter id='n' x='0' y='0' width='1' height='1'><feTurbulence type='turbulence' baseFrequency='%s' numOctaves='2' seed='%d' stitchTiles='stitch'/>"+
			"<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -15 0 0 0 5.2' result='m'/><feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='m' operator='in'/></filter>"+
			"<rect width='%d' height='%d' filter='url(#n)'/>", fx, seed, c, a, w, w)
		return svgTile(k, w, w, body)
	}
	return []backdropLayer{
		web(640, 4, ".006 .009", h.cool, k.op(.55, .6)),
		web(430, 9, ".009 .012", h.accent, k.op(.4, .5)),
		{image: k.blob(88, 90, 70, 60, k.cool, 34)},
		{image: k.blob(10, 8, 60, 50, k.accent, 30)},
		{image: "linear-gradient(160deg, " + k.veil(k.accent, 16) + ", transparent 40%, " + k.veil(k.warm, 14) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropLookConfetti is the morning after a party: a few long curling streamers in pink,
// green, gold and red hanging in from the top corners, and a loose scatter of tumbling paper
// rectangles in between.
func themeBackdropLookConfetti(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.accent, h.cool, h.warm, h.second}
	var sb strings.Builder
	streamer := func(x0 float64, amp, freq, ph float64, c string, w int, dir float64) {
		var d strings.Builder
		for y := -20; y <= 940; y += 20 {
			t := float64(y) / 900
			x := x0 + dir*t*140 + amp*math.Sin(t*freq+ph)*(0.4+t)
			if y == -20 {
				d.WriteString(fmt.Sprintf("M%.0f %d", x, y))
			} else {
				d.WriteString(fmt.Sprintf("L%.0f %d", x, y))
			}
		}
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%d' stroke-linecap='round' stroke-linejoin='round' opacity='%s'/>", d.String(), c, w, k.op(.8, .85)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='#ffffff' stroke-width='%d' stroke-linecap='round' stroke-linejoin='round' opacity='.22' transform='translate(-%d 0)'/>", d.String(), w/4, w/4))
	}
	streamer(70, 70, 11, 0, h.accent, 26, -.4)
	streamer(190, 55, 14, 2, h.warm, 16, .5)
	streamer(40, 45, 9, 4, h.cool, 20, 1)
	streamer(1330, 75, 12, 1, h.cool, 28, .4)
	streamer(1210, 55, 15, 3, h.second, 16, -.6)
	streamer(1370, 40, 8, 5, h.warm, 20, -1)
	for i := 0; i < 46; i++ {
		x := k.rnd(i*5+1, 1400)
		y := k.rnd(i*5+2, 900)
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='2' fill='%s' opacity='%s' transform='rotate(%d %d %d)'/>",
			x, y, 9+k.rnd(i*5+3, 8), 16+k.rnd(i*5+3, 14), cols[i%4], k.op(.6, .7), k.rnd(i*5+4, 180), x, y))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMin slice", sb.String()),
		{image: k.blob(50, 108, 90, 40, k.accent, 24)},
		backdropGround(k),
	}
}

// themeBackdropLookKoi is a pond seen from above: two big orange-and-cream koi swimming in a slow
// curve under rippling water, a couple of lily pads, a soft ring where something rose, and a
// wash of ink-dark water around them.
func themeBackdropLookKoi(k backdropKit) []backdropLayer {
	h := k.hex
	body := "M0 0 C30 -40 150 -44 230 -8 C255 3 275 8 305 5 L360 44 C346 18 346 -6 360 -30 L305 -4 C275 -6 255 -2 230 8 C150 44 30 40 0 0Z"
	fish := func(x, y, rot, sc float64, main, patch string) string {
		return fmt.Sprintf("<g transform='translate(%.0f %.0f) rotate(%.0f) scale(%.2f)'>"+
			"<ellipse cx='110' cy='-30' rx='46' ry='14' fill='%s' opacity='.7' transform='rotate(-35 110 -30)'/>"+
			"<ellipse cx='110' cy='30' rx='46' ry='14' fill='%s' opacity='.7' transform='rotate(35 110 30)'/>"+
			"<path d='%s' fill='%s'/>"+
			"<ellipse cx='95' cy='-4' rx='44' ry='20' fill='%s' opacity='.95'/>"+
			"<ellipse cx='185' cy='6' rx='30' ry='15' fill='%s' opacity='.9'/>"+
			"<ellipse cx='18' cy='-8' rx='9' ry='6' fill='%s' opacity='.9'/></g>",
			x, y, rot, sc, main, main, body, main, patch, h.warm, h.ground)
	}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='w' x='-10%' y='-10%' width='120%' height='120%'><feTurbulence type='fractalNoise' baseFrequency='.007 .011' numOctaves='2' seed='5' result='t'/>" +
		"<feDisplacementMap in='SourceGraphic' in2='t' scale='42'/><feGaussianBlur stdDeviation='1.6'/></filter></defs>")
	sb.WriteString("<g filter='url(#w)'>")
	for _, p := range [][3]int{{1180, 220, 70}, {1010, 330, 50}, {210, 700, 64}} {
		sb.WriteString(fmt.Sprintf("<path d='M%d %dL%d %dA%d %d 0 1 1 %d %dZ' fill='%s' opacity='%s' transform='rotate(%d %d %d)'/>",
			p[0], p[1], p[0]+p[2], p[1]-p[2]/4, p[2], p[2], p[0]+p[2], p[1]+p[2]/4, h.cool, k.op(.65, .6), p[2]*3, p[0], p[1]))
	}
	sb.WriteString(fish(1060, 740, -150, 1.5, h.accent, h.warm))
	sb.WriteString(fish(300, 210, 28, 1.05, h.accent, "#fff3e0"))
	sb.WriteString("</g>")
	for i, r := range []int{40, 85, 140, 205} {
		sb.WriteString(fmt.Sprintf("<circle cx='520' cy='760' r='%d' fill='none' stroke='%s' stroke-width='%.1f' opacity='%s'/>", r, h.cool, 2.4-float64(i)*.4, k.op(.5, .5-float64(i)*.08)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: k.blob(80, 85, 70, 55, k.accent, 22)},
		{image: "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 35%, " + k.veil(k.cool, 22) + " 100%)"},
		backdropGround(k),
	}
}
