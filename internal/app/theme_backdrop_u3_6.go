package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropNeutral is a drop of ink bleeding into paper: a few soft blotches with ragged edges
// from a thresholded noise, in the accent and the success colour, over a faint wash.
func themeBackdropNeutral(k backdropKit) []backdropLayer {
	h := k.hex
	bleed := func(w, seed int, fx string, c, a string) backdropLayer {
		body := fmt.Sprintf("<filter id='n' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='%s' numOctaves='4' seed='%d' stitchTiles='stitch'/>"+
			"<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 9 -5.2' result='m'/><feGaussianBlur in='m' stdDeviation='6' result='s'/>"+
			"<feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='s' operator='in'/></filter>"+
			"<rect width='%d' height='%d' filter='url(#n)'/>", fx, seed, c, a, w, w)
		return svgTile(k, w, w, body)
	}
	return []backdropLayer{
		bleed(900, 7, ".0035 .0045", h.accent, k.op(.16, .2)),
		bleed(700, 21, ".0055", h.cool, k.op(.1, .14)),
		{image: k.blob(80, 100, 90, 50, k.accent, 12)},
		backdropGround(k),
	}
}

// themeBackdropNocturneInk is a copperplate flourish: long, thin gold pen strokes that swell and
// taper, looping up from the bottom of the page like a signature in the dark.
func themeBackdropNocturneInk(k backdropKit) []backdropLayer {
	h := k.hex
	stroke := func(d string, w float64, c, a string) string {
		return fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' stroke-linecap='round' opacity='%s'/>", d, c, w, a)
	}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='6'/></filter></defs>")
	paths := []string{
		"M-40 860C200 800 360 640 560 700S760 880 640 800S560 640 820 640S1160 760 1300 700S1500 600 1460 560",
		"M40 900C260 860 420 760 640 800S1000 880 1180 800S1420 700 1440 780",
		"M900 900C960 780 1120 760 1160 840S1060 900 1020 840S1100 700 1280 690",
		"M-20 640C120 600 200 700 140 760S40 740 100 680S280 620 420 660",
	}
	for i, d := range paths {
		sb.WriteString(fmt.Sprintf("<g filter='url(#b)'>%s</g>", stroke(d, 9, h.accent, k.op(.25, .3))))
		sb.WriteString(stroke(d, 2.6-float64(i%2)*.8, h.accent, k.op(.5, .55)))
		sb.WriteString(stroke(d, .9, h.warm, k.op(.5, .6)))
	}
	// swelling downstrokes
	for i := 0; i < 5; i++ {
		x := 220 + i*230 + k.rnd(i+3, 60)
		y := 600 + k.rnd(i+9, 120)
		d := fmt.Sprintf("M%d %dC%d %d %d %d %d 900", x, y, x+30, y+80, x-40, y+160, x+10)
		sb.WriteString(stroke(d, 5, h.accent, k.op(.2, .26)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 120, 90, 50, k.accent, 14)},
		backdropGround(k),
	}
}

// themeBackdropNordicFrost is frost fern on a window: branching ice crystals grown inward from the
// bottom corners, each side-branch a little shorter than the last.
func themeBackdropNordicFrost(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	seed := 0
	var grow func(x, y, ang, ln float64, depth int, c string)
	grow = func(x, y, ang, ln float64, depth int, c string) {
		if depth == 0 || ln < 10 {
			return
		}
		x2 := x + math.Cos(ang)*ln
		y2 := y + math.Sin(ang)*ln
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='%.1f' stroke-linecap='round' opacity='%s'/>", x, y, x2, y2, c, float64(depth)*.45+.3, k.op(.5, .6)))
		for i := 1; i <= 4; i++ {
			f := float64(i) / 5
			px := x + (x2-x)*f
			py := y + (y2-y)*f
			seed++
			sub := ln * (.46 - f*.2) * (.85 + float64(k.rnd(seed, 30))/100)
			grow(px, py, ang+.9, sub, depth-1, c)
			grow(px, py, ang-.9, sub, depth-1, c)
		}
	}
	grow(-20, 920, -1.05, 330, 4, h.accent)
	grow(-30, 700, -.5, 260, 4, h.accent)
	grow(1420, 920, -2.1, 340, 4, h.accent)
	grow(1440, 680, -2.7, 250, 4, h.cool)
	grow(560, 930, -1.6, 200, 3, h.cool)
	grow(900, 930, -1.4, 170, 3, h.accent)
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(0deg, " + k.veil(k.accent, 14) + ", transparent 40%)"},
		backdropGround(k),
	}
}

// themeBackdropObsidianGold is kintsugi on black glass: thin cracks of gold running across the
// page, branching and thickening where they meet, over a slow diagonal sheen.
func themeBackdropObsidianGold(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='5'/></filter></defs>")
	seed := 0
	var crack func(x, y, ang float64, steps int, w float64)
	crack = func(x, y, ang float64, steps int, w float64) {
		var d strings.Builder
		d.WriteString(fmt.Sprintf("M%.0f %.0f", x, y))
		for i := 0; i < steps; i++ {
			seed++
			ang += (float64(k.rnd(seed, 100)) - 50) / 100 * .9
			l := 40 + float64(k.rnd(seed+400, 50))
			x += math.Cos(ang) * l
			y += math.Sin(ang) * l
			d.WriteString(fmt.Sprintf("L%.0f %.0f", x, y))
			if w > .9 && i%3 == 2 {
				crack(x, y, ang+.7-float64(k.rnd(seed+800, 3))*.7, steps-i-2, w*.6)
			}
		}
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' stroke-linejoin='round' opacity='%s' filter='url(#b)'/>", d.String(), h.accent, w*4, k.op(.22, .3)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' stroke-linejoin='round' opacity='%s'/>", d.String(), h.accent, w, k.op(.55, .6)))
	}
	crack(-20, 760, -.35, 12, 2.2)
	crack(1420, 880, -2.6, 10, 2)
	crack(700, 930, -1.5, 7, 1.6)
	crack(1100, -10, 1.9, 6, 1.2)
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: "linear-gradient(115deg, transparent 30%, " + k.veil(k.warm, 9) + " 44%, transparent 52%, " + k.veil(k.accent, 6) + " 70%, transparent 78%)"},
		backdropGround(k),
	}
}

// themeBackdropOceanDepth is sunlight from far above: soft shafts fanning down from the top left,
// fading before they reach the dark at the bottom, with a cold band of bioluminescence on the floor.
func themeBackdropOceanDepth(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='14'/></filter>" +
		"<linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='.9'/><stop offset='.75' stop-color='" + h.accent + "' stop-opacity='0'/></linearGradient></defs><g filter='url(#b)'>")
	for i := 0; i < 7; i++ {
		x0 := 80 + i*150 + k.rnd(i, 70)
		w0 := 20 + k.rnd(i+30, 40)
		spread := 140 + k.rnd(i+60, 160)
		sb.WriteString(fmt.Sprintf("<path d='M%d -20L%d -20L%d 900L%d 900Z' fill='url(#g)' opacity='%s'/>", x0, x0+w0, x0+w0+spread, x0+spread-120, k.op(.22, .28)))
	}
	sb.WriteString("</g>")
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMin slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(k.accent, 10) + ", transparent 35%)"},
		{image: k.blob(30, 115, 80, 26, k.cool, 24)},
		{image: k.blob(80, 118, 60, 22, k.accent, 18)},
		backdropGround(k),
	}
}

// themeBackdropOceanicSteel is brushed steel: a conic sheen like light on a turned metal plate,
// finished with long horizontal brush lines.
func themeBackdropOceanicSteel(k backdropKit) []backdropLayer {
	return []backdropLayer{
		{image: "repeating-linear-gradient(0deg, " + k.veil(k.accent, 5) + " 0 1px, transparent 1px " + k.px(3) + ", " + k.veil(k.ground, 20) + " " + k.px(3) + " " + k.px(4) + ", transparent " + k.px(4) + " " + k.px(7) + ")"},
		{image: "conic-gradient(from 20deg at 72% 38%, transparent 0deg, " + k.veil(k.accent, 15) + " 25deg, transparent 55deg, " + k.veil(k.accent, 8) + " 110deg, transparent 150deg, " + k.veil(k.cool, 9) + " 200deg, transparent 240deg, " + k.veil(k.accent, 14) + " 300deg, transparent 340deg)"},
		{image: k.blob(72, 38, 50, 40, k.accent, 14)},
		backdropGround(k),
	}
}

// themeBackdropOliveDrab is army canvas: a coarse woven cloth from two fine crossing line sets,
// with a worn, uneven fade from the dye and a faded stencil ring on the bottom edge.
func themeBackdropOliveDrab(k backdropKit) []backdropLayer {
	h := k.hex
	ring := "<circle cx='300' cy='430' r='230' fill='none' stroke='" + h.accent + "' stroke-width='10' stroke-dasharray='70 22' opacity='" + k.op(.16, .18) + "'/>" +
		"<circle cx='300' cy='430' r='160' fill='none' stroke='" + h.accent + "' stroke-width='3' opacity='" + k.op(.16, .18) + "'/>" +
		"<path d='M300 160V260M300 600V700M20 430H120M480 430H580' stroke='" + h.accent + "' stroke-width='5' opacity='" + k.op(.16, .18) + "'/>"
	return []backdropLayer{
		svgScene(600, 600, "xMaxYMax meet", ring),
		{image: "repeating-linear-gradient(90deg, " + k.veil(k.accent, 8) + " 0 1px, transparent 1px " + k.px(3) + ")"},
		{image: "repeating-linear-gradient(0deg, " + k.veil(k.warm, 7) + " 0 1px, transparent 1px " + k.px(3) + ")"},
		{image: k.blob(20, 30, 70, 50, k.cool, 8)},
		{image: k.blob(85, 75, 60, 50, k.warm, 8)},
		backdropGround(k),
	}
}

// themeBackdropOwlHours is the small hours on a huge clock: the tick marks of a dial far larger
// than the page, centred off the top right corner like a moon, with one warm dot for the hour.
func themeBackdropOwlHours(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cx, cy := 1150.0, -80.0
	for ring, r := range []float64{420, 620, 820} {
		for i := 0; i < 60; i++ {
			a := float64(i) / 60 * 2 * math.Pi
			ln := 10.0
			w := 1.4
			if i%5 == 0 {
				ln, w = 26, 3
			}
			r2 := r - ln
			c := h.accent
			if ring == 1 {
				c = h.cool
			}
			sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='%.1f' stroke-linecap='round' opacity='%s'/>",
				cx+math.Cos(a)*r, cy+math.Sin(a)*r, cx+math.Cos(a)*r2, cy+math.Sin(a)*r2, c, w, k.op(.5, .6)))
		}
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-width='1' opacity='%s'/>", cx, cy, r, h.accent, k.op(.4, .4)))
	}
	a := 2.2
	sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='9' fill='%s' opacity='.9'/><circle cx='%.0f' cy='%.0f' r='24' fill='%s' opacity='.2'/>", cx+math.Cos(a)*620, cy+math.Sin(a)*620, h.warm, cx+math.Cos(a)*620, cy+math.Sin(a)*620, h.warm))
	return []backdropLayer{
		svgScene(1400, 900, "xMaxYMin slice", sb.String()),
		{image: k.blob(88, 0, 60, 50, k.accent, 14)},
		backdropGround(k),
	}
}

// themeBackdropOxbloodLeather is pebbled leather: a lit grain of rounded bumps from a noise map
// through diffuse lighting, darkened at the edges and warmed from below.
func themeBackdropOxbloodLeather(k backdropKit) []backdropLayer {
	h := k.hex
	light := h.warm
	body := "<filter id='l' x='0' y='0' width='1' height='1'><feTurbulence type='turbulence' baseFrequency='.045' numOctaves='2' seed='5' stitchTiles='stitch' result='t'/>" +
		"<feColorMatrix in='t' type='matrix' values='1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1' result='n'/>" +
		"<feDiffuseLighting in='n' lighting-color='" + light + "' surfaceScale='3' diffuseConstant='1.1' result='d'><feDistantLight azimuth='235' elevation='55'/></feDiffuseLighting>" +
		"<feColorMatrix in='d' type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .9 .9 .9 0 -1.15'/></filter>" +
		"<rect width='320' height='320' filter='url(#l)' opacity='" + k.op(.55, .5) + "'/>"
	return []backdropLayer{
		svgTile(k, 320, 320, body),
		{image: "radial-gradient(120% 100% at 50% 40%, transparent 55%, " + k.veil(k.ground, 45) + " 100%)"},
		{image: k.blob(50, 115, 100, 40, k.accent, 20)},
		backdropGround(k),
	}
}

// themeBackdropPaleNight is frosted glass: a handful of large translucent panes at different tilts,
// each lit along one edge, overlapping so that their colours mix where they cross.
func themeBackdropPaleNight(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs>")
	cols := []string{h.accent, h.cool, h.second, h.warm}
	for i, c := range cols {
		sb.WriteString(fmt.Sprintf("<linearGradient id='p%d' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%s' stop-opacity='.55'/><stop offset='1' stop-color='%s' stop-opacity='.05'/></linearGradient>", i, c, c))
	}
	sb.WriteString("</defs>")
	panes := []string{
		"M-60 380L520 150L720 640L60 900Z",
		"M420 520L980 330L1180 900L560 940Z",
		"M880 -40L1460 60L1360 520L820 420Z",
		"M1000 560L1480 480L1460 940L1120 940Z",
		"M120 -30L620 -40L540 240L150 200Z",
	}
	for i, d := range panes {
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='url(#p%d)' opacity='%s'/>", d, i%4, k.op(.28, .3)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='#fff' stroke-width='1.5' stroke-linejoin='round' opacity='%s'/>", d, k.op(.4, .22)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: k.blob(20, 20, 60, 50, k.accent, 12)},
		backdropGround(k),
	}
}
