package app

import (
	"fmt"
	"strings"
)

// Backdrop recipes of the instrument theme group; see theme_groups.go. Each one is drawn for one family:
// it has to fit that theme's name, shape and colours. Both are drawn from the theme's accent alone
// (plus a cool tint for the water), never from the warm/second colours the generic recipes wash the
// page with -- that is where a green cockpit used to pick up red and yellow smears.

// themeBackdropHudHorizon is "hudhorizon", the Cockpit's page: an artificial horizon a few degrees
// off level, a pitch ladder of broken lines either side of the centre, tick scales down the two
// edges and a heading tape along the top, all in one phosphor colour over a near-black ground.
func themeBackdropHudHorizon(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	line := func(x1, y1, x2, y2 float64, w float64, op string) {
		sb.WriteString(fmt.Sprintf("<path d='M%.1f %.1fL%.1f %.1f' stroke='%s' stroke-width='%.1f' opacity='%s'/>", x1, y1, x2, y2, h.accent, w, op))
	}
	text := func(x, y float64, anchor, s string, op string) {
		sb.WriteString(fmt.Sprintf("<text x='%.0f' y='%.0f' fill='%s' font-family='ui-monospace,Menlo,monospace' font-size='15' text-anchor='%s' opacity='%s'>%s</text>", x, y, h.accent, anchor, op, s))
	}

	// Below the horizon the ground is a slightly denser field, hatched.
	sb.WriteString("<g transform='rotate(-4 700 480)'>")
	sb.WriteString(fmt.Sprintf("<rect x='-400' y='480' width='2200' height='900' fill='%s' opacity='%s'/>", h.accent, k.op(.06, .05)))
	for i := 1; i <= 14; i++ {
		y := 480 + float64(i*i)*3.2 + 10
		line(-400, y, 1800, y, 1, k.op(.16, .14))
	}
	// The horizon, broken around the flight-path marker.
	line(-400, 480, 560, 480, 2.4, k.op(.8, .75))
	line(840, 480, 1800, 480, 2.4, k.op(.8, .75))
	// Pitch ladder: a pair of bars per five degrees, the ends turned toward the horizon.
	for i := -4; i <= 4; i++ {
		if i == 0 {
			continue
		}
		y := 480 - float64(i)*74
		half, gap := 96.0, 40.0
		if i%2 != 0 {
			half, gap = 54.0, 40.0
		}
		hook := 12.0
		if i > 0 {
			hook = -12.0
		}
		for _, s := range []float64{-1, 1} {
			x0, x1 := 700+s*gap, 700+s*(gap+half)
			line(x0, y, x1, y, 2, k.op(.62, .6))
			line(x1, y, x1, y+hook, 2, k.op(.62, .6))
		}
		if i%2 == 0 {
			lab := fmt.Sprintf("%d", abs(i)*5)
			text(700-gap-half-12, y+5, "end", lab, k.op(.65, .62))
			text(700+gap+half+12, y+5, "start", lab, k.op(.65, .62))
		}
	}
	sb.WriteString("</g>")

	// Flight-path marker at the centre.
	sb.WriteString(fmt.Sprintf("<circle cx='700' cy='480' r='15' fill='none' stroke='%s' stroke-width='2.4' opacity='%s'/>", h.accent, k.op(.9, .9)))
	line(660, 480, 685, 480, 2.4, k.op(.9, .9))
	line(715, 480, 740, 480, 2.4, k.op(.9, .9))
	line(700, 465, 700, 450, 2.4, k.op(.9, .9))

	// Speed and altitude scales on the two edges.
	for _, side := range []struct {
		x, dir float64
		lab    string
	}{{46, 1, "end"}, {1354, -1, "start"}} {
		line(side.x, 130, side.x, 830, 1.4, k.op(.4, .42))
		for i := 0; i <= 35; i++ {
			y := 130 + float64(i)*20
			l := 8.0
			if i%5 == 0 {
				l = 18
				text(side.x+side.dir*34, y+5, side.lab, fmt.Sprintf("%d", 380-i*10), k.op(.5, .5))
			}
			line(side.x, y, side.x+side.dir*l, y, 1.4, k.op(.45, .48))
		}
		// The current value in a box beside the centre.
		sb.WriteString(fmt.Sprintf("<path d='M%.0f 462h%.0fv36h%.0fz' fill='none' stroke='%s' stroke-width='2' opacity='%s'/>", side.x, side.dir*58, -side.dir*58, h.accent, k.op(.8, .8)))
	}

	// Heading tape along the top.
	line(300, 52, 1100, 52, 1.4, k.op(.4, .42))
	for i := 0; i <= 40; i++ {
		x := 300 + float64(i)*20
		l := 7.0
		if i%5 == 0 {
			l = 15
			text(x, 36, "middle", fmt.Sprintf("%03d", (i/5*10+280)%360), k.op(.5, .5))
		}
		line(x, 52, x, 52+l, 1.4, k.op(.45, .48))
	}
	sb.WriteString(fmt.Sprintf("<path d='M692 50l8 -12l8 12z' fill='%s' opacity='%s'/>", h.accent, k.op(.8, .8)))

	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		// Phosphor bloom around the centre, and a vignette toward the edges.
		{image: "radial-gradient(ellipse at 50% 52%, " + k.veil(h.accent, 14) + ", transparent 55%)"},
		backdropGround(k),
	}
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// themeBackdropDecoCurve is "decocurve", the Dive Computer's page: a depth scale down the left, a
// dive profile (a smooth descent, a bottom time, then an ascent that climbs in decompression steps
// to the surface), the ceiling it must stay under, and bubble trails rising from the diver, over a
// wash that is lightest at the surface and deepest at the bottom.
func themeBackdropDecoCurve(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	// Depth lines every 10 m, with the scale on the left.
	for i := 0; i <= 8; i++ {
		y := 70 + i*100
		sb.WriteString(fmt.Sprintf("<path d='M120 %d H1360' stroke='%s' stroke-width='1' stroke-dasharray='2 10' opacity='%s'/>", y, h.accent, k.op(.34, .3)))
		sb.WriteString(fmt.Sprintf("<text x='104' y='%d' fill='%s' font-family='ui-monospace,Menlo,monospace' font-size='15' text-anchor='end' opacity='%s'>%dm</text>", y+5, h.accent, k.op(.7, .65), i*5))
	}
	sb.WriteString(fmt.Sprintf("<path d='M120 70V870' stroke='%s' stroke-width='2' opacity='%s'/>", h.accent, k.op(.7, .7)))
	for i := 0; i <= 80; i++ {
		l := 6
		if i%10 == 0 {
			l = 16
		}
		sb.WriteString(fmt.Sprintf("<path d='M120 %dh-%d' stroke='%s' stroke-width='1.4' opacity='%s'/>", 70+i*10, l, h.accent, k.op(.6, .6)))
	}

	// The dive: down to 30 m, a while on the bottom, then up, stopping at 9, 6 and 3 m.
	profile := "M130 70 C250 74 300 510 420 520 L720 536 C790 540 820 420 860 410 L930 410 L930 354 L1010 354 L1010 304 L1110 304 L1110 254 L1240 254 L1240 70 L1290 70"
	sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='5' stroke-linejoin='round' opacity='%s'/>", profile, h.accent, k.op(.85, .9)))
	// The ceiling above it, drawn as a stepped, dashed line.
	sb.WriteString(fmt.Sprintf("<path d='M860 372 L930 372 L930 322 L1010 322 L1010 272 L1110 272 L1110 222 L1240 222' fill='none' stroke='%s' stroke-width='2.5' stroke-dasharray='10 8' opacity='%s'/>", h.cool, k.op(.7, .75)))
	// A second, shallower profile for company.
	sb.WriteString(fmt.Sprintf("<path d='M150 70 C230 72 280 330 380 336 L620 346 C690 350 720 300 760 296 L800 296 L800 254 L850 254 L850 70' fill='none' stroke='%s' stroke-width='2.5' opacity='%s'/>", h.cool, k.op(.5, .55)))

	// Bubble trails rise from points along the profile, swelling as they climb.
	for t, x0 := range []int{470, 560, 650, 940, 1030} {
		y0 := 530
		if x0 > 900 {
			y0 = 400 - (x0-940)/90*50
		}
		for i := 0; i < 9; i++ {
			y := y0 - 40 - i*(y0-90)/9
			r := 3 + i*2/1
			x := x0 + ((i+t)%3-1)*9
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' fill-opacity='.06' stroke='%s' stroke-width='1.6' opacity='%s'/>", x, y, r, h.cool, h.cool, k.op(.6, .6)))
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='#fff' opacity='.55'/>", x-r/3, y-r/3, float64(r)/4+.5))
		}
	}
	// The diver at the bottom of the profile.
	sb.WriteString(fmt.Sprintf("<circle cx='720' cy='536' r='9' fill='%s' opacity='%s'/>", h.accent, k.op(1, 1)))

	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(h.cool, 26) + ", transparent 55%, " + k.veil(h.accent, 8) + " 100%)"},
		backdropGround(k),
	}
}
