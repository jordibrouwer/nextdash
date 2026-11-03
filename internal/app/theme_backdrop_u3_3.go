package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropHarbourFog is a harbour in fog: broad blurred banks of cold haze layered up the
// page, with a few warm lights low down, each with a faint vertical reflection on the water.
func themeBackdropHarbourFog(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-100%' width='140%' height='300%'><feGaussianBlur stdDeviation='34'/></filter><filter id='l' x='-300%' y='-300%' width='700%' height='700%'><feGaussianBlur stdDeviation='9'/></filter><filter id='r' x='-200%' y='-5%' width='500%' height='110%'><feGaussianBlur stdDeviation='4 1'/></filter></defs>")
	for i, y := range []int{250, 360, 470, 560, 650} {
		c := h.accent
		if i%2 == 1 {
			c = h.cool
		}
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s' filter='url(#b)'/>", 200+i*260+k.rnd(i, 120), y, 520+k.rnd(i+9, 200), 46+i*6, c, k.op(.42, .46)))
	}
	for i, p := range []struct{ x, y int }{{230, 640}, {560, 670}, {640, 655}, {980, 630}, {1180, 668}} {
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='11' fill='%s' opacity='%s' filter='url(#l)'/>", p.x, p.y, h.warm, k.op(1, 1)))
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='3' fill='%s' opacity='%s'/>", p.x, p.y, h.warm, k.op(.9, 1)))
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='5' height='%d' fill='%s' opacity='%s' filter='url(#r)'/>", p.x-2, p.y+14, 70+i*8, h.warm, k.op(.4, .5)))
	}
	sb.WriteString("<ellipse cx='700' cy='790' rx='800' ry='70' fill='" + h.accent + "' opacity='" + k.op(.2, .22) + "' filter='url(#b)'/>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 40%, " + k.veil(h.accent, 26) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropHermeticTeal is sacred geometry in glass: large thin circles overlapping in
// vesica pairs and a ring of arcs, cropped by the window, with a teal glow behind the centre.
func themeBackdropHermeticTeal(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><radialGradient id='g'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='" + k.op(.25, .3) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<circle cx='1000' cy='430' r='420' fill='url(#g)'/>")
	ring := func(cx, cy, r float64, c string, op string, w string) {
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-width='%s' opacity='%s'/>", cx, cy, r, c, w, op))
	}
	cx, cy, r := 1000.0, 430.0, 170.0
	ring(cx, cy, r, h.accent, k.op(.4, .42), "1.4")
	for i := 0; i < 6; i++ {
		a := float64(i) * math.Pi / 3
		ring(cx+r*math.Cos(a), cy+r*math.Sin(a), r, h.accent, k.op(.3, .32), "1.1")
	}
	ring(cx, cy, r*2, h.cool, k.op(.3, .3), "1.1")
	ring(cx, cy, r*3.4, h.second, k.op(.22, .24), "1")
	ring(cx, cy, r*0.5, h.warm, k.op(.3, .34), "1")
	for i := 0; i < 12; i++ {
		a := float64(i) * math.Pi / 6
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='3.5' fill='%s' opacity='%s'/>", cx+r*2*math.Cos(a), cy+r*2*math.Sin(a), h.accent, k.op(.5, .6)))
	}
	ring(160, 700, 130, h.cool, k.op(.3, .32), "1.1")
	ring(160+130, 700, 130, h.cool, k.op(.24, .26), "1.1")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.ground + " 0%, transparent 28%)"},
		backdropGround(k),
	}
}

// themeBackdropHoarfrost is frost growing in from the corners: thin branching fern crystals
// that spread from the bottom left and top right edges and fade towards the quiet middle.
func themeBackdropHoarfrost(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	var branch func(x, y, ang, l float64, depth, seed int, c string)
	branch = func(x, y, ang, l float64, depth, seed int, c string) {
		x2, y2 := x+l*math.Cos(ang), y+l*math.Sin(ang)
		w := 0.6 + float64(depth)*0.25
		sb.WriteString(fmt.Sprintf("<line x1='%.0f' y1='%.0f' x2='%.0f' y2='%.0f' stroke='%s' stroke-width='%.1f' stroke-linecap='round'/>", x, y, x2, y2, c, w))
		if depth == 0 || l < 8 {
			return
		}
		for i := 1; i <= 4; i++ {
			t := float64(i) / 4.4
			bx, by := x+(x2-x)*t, y+(y2-y)*t
			j := float64(k.rnd(seed+i*7, 20)-10) / 100
			branch(bx, by, ang+1.0+j, l*(0.42-0.06*t), depth-1, seed+i*13, c)
			branch(bx, by, ang-1.0+j, l*(0.42-0.06*t), depth-1, seed+i*17, c)
		}
		branch(x2, y2, ang+float64(k.rnd(seed, 20)-10)/100, l*0.3, depth-1, seed+3, c)
	}
	sb.WriteString("<g opacity='" + k.op(.4, .5) + "'>")
	branch(-10, 810, -0.75, 420, 3, 5, h.accent)
	branch(-10, 810, -0.28, 360, 3, 41, h.cool)
	branch(-10, 810, -1.25, 330, 3, 77, h.accent)
	sb.WriteString("</g><g opacity='" + k.op(.3, .38) + "'>")
	branch(1410, -10, 2.4, 330, 3, 11, h.accent)
	branch(1410, -10, 1.9, 290, 3, 53, h.cool)
	branch(1410, -10, 2.9, 260, 3, 91, h.accent)
	sb.WriteString("</g>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(0, 100, 50, 50, k.accent, 30)},
		{image: k.blob(100, 0, 40, 40, k.cool, 22)},
		backdropGround(k),
	}
}

// themeBackdropHorizonGlow is the sky just after sunset: a lit horizon hairline low on the page,
// a wide warm glow rising from it in pink and peach, and a few narrowing bands in the dark below.
func themeBackdropHorizonGlow(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-100%' width='140%' height='300%'><feGaussianBlur stdDeviation='18'/></filter></defs>")
	sb.WriteString("<rect x='-50' y='560' width='1500' height='2' fill='" + h.warm + "' opacity='" + k.op(.6, .75) + "'/>")
	sb.WriteString("<ellipse cx='700' cy='564' rx='420' ry='10' fill='" + h.warm + "' opacity='" + k.op(.5, .6) + "' filter='url(#b)'/>")
	for i := 0; i < 7; i++ {
		y := 590 + i*i*3 + i*14
		w := 760 - i*80
		c := h.accent
		if i%2 == 1 {
			c = h.second
		}
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='2' fill='%s' opacity='%s'/>", 700-w/2, y, w, 2+i/2, c, k.op(.26-float64(i)*.02, .34-float64(i)*.03)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "radial-gradient(ellipse 70% 38% at 50% 70%, " + k.veil(k.accent, 40) + ", " + k.veil(k.warm, 16) + " 55%, transparent 100%)"},
		{image: "linear-gradient(180deg, transparent 45%, " + k.veil(k.second, 18) + " 70%, transparent 71%)"},
		backdropGround(k),
	}
}

// themeBackdropIcebergDrift is a few faceted bergs on a waterline: angular shards of glass,
// each with a pale tip above the line and a deeper, dimmer mass mirrored below it.
func themeBackdropIcebergDrift(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	wl := 480
	berg := func(cx int, sc float64, c string) {
		pt := func(x, y float64) string { return fmt.Sprintf("%.0f %.0f", float64(cx)+x*sc, float64(wl)+y*sc) }
		sb.WriteString("<path d='M" + pt(-150, 0) + "L" + pt(-80, -70) + "L" + pt(-30, -50) + "L" + pt(20, -130) + "L" + pt(90, -60) + "L" + pt(150, 0) + "Z' fill='" + c + "' opacity='" + k.op(.2, .26) + "'/>")
		sb.WriteString("<path d='M" + pt(20, -130) + "L" + pt(90, -60) + "L" + pt(150, 0) + "L" + pt(20, 0) + "Z' fill='" + h.cool + "' opacity='" + k.op(.1, .14) + "'/>")
		sb.WriteString("<path d='M" + pt(-150, 0) + "L" + pt(-60, 110) + "L" + pt(10, 170) + "L" + pt(100, 90) + "L" + pt(150, 0) + "Z' fill='" + c + "' opacity='" + k.op(.1, .14) + "'/>")
		sb.WriteString("<path d='M" + pt(-60, 110) + "L" + pt(10, 170) + "L" + pt(20, 0) + "L" + pt(-150, 0) + "Z' fill='" + h.second + "' opacity='" + k.op(.06, .08) + "'/>")
	}
	berg(1020, 1.3, h.accent)
	berg(300, 0.8, h.accent)
	berg(640, 0.45, h.cool)
	berg(1260, 0.4, h.accent)
	sb.WriteString(fmt.Sprintf("<rect x='-20' y='%d' width='1440' height='1.5' fill='%s' opacity='%s'/>", wl, h.accent, k.op(.4, .5)))
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 60%, " + k.veil(h.accent, 14) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropIndigoLetterpress is wet ink on paper: mottled, uneven indigo ink bleed from a
// turbulence field, with a thick-and-thin printer's rule running across the foot of the page.
func themeBackdropIndigoLetterpress(k backdropKit) []backdropLayer {
	h := k.hex
	ink := "<filter id='t' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.012 .02' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 1.25'/></filter>"
	body := "<defs>" + ink + "</defs><rect width='900' height='700' fill='" + h.accent + "' opacity='" + k.op(.3, .38) + "' filter='url(#t)'/>"
	var rule strings.Builder
	rule.WriteString("<rect x='80' y='60' width='1240' height='4' fill='" + h.accent + "' opacity='" + k.op(.4, .5) + "'/>")
	rule.WriteString("<rect x='80' y='70' width='1240' height='1' fill='" + h.accent + "' opacity='" + k.op(.4, .5) + "'/>")
	rule.WriteString("<rect x='80' y='60' width='6' height='6' fill='" + h.warm + "' opacity='" + k.op(.4, .5) + "'/>")
	return []backdropLayer{
		svgScene(1400, 100, "xMidYMax slice", rule.String()),
		{image: svgBackdropURL(900, 700, "xMidYMid slice", body), size: "100% 100%"},
		{image: k.blob(80, 100, 50, 40, k.accent, 24)},
		backdropGround(k),
	}
}

// themeBackdropIrisMeadow is a meadow of iris at dusk: tapering sword leaves leaning up from the
// bottom edge at different heights, with a few blurred violet blooms floating above them.
func themeBackdropIrisMeadow(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-100%' y='-100%' width='300%' height='300%'><feGaussianBlur stdDeviation='22'/></filter></defs>")
	for i := 0; i < 5; i++ {
		x, y := 150+i*270+k.rnd(i, 120), 520+k.rnd(i+30, 100)
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s' filter='url(#b)'/>", x, y, 60+k.rnd(i+5, 30), 40+k.rnd(i+7, 24), h.accent, k.op(.4, .48)))
		if i%2 == 0 {
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='20' fill='%s' opacity='%s' filter='url(#b)'/>", x+30, y-30, h.warm, k.op(.3, .4)))
		}
	}
	for i := 0; i < 26; i++ {
		x := -20 + i*56 + k.rnd(i*3, 40)
		ht := 180 + k.rnd(i*3+1, 300)
		lean := k.rnd(i*3+2, 140) - 70
		w := 14 + k.rnd(i*5, 12)
		c := h.cool
		if i%4 == 3 {
			c = h.accent
		}
		sb.WriteString(fmt.Sprintf("<path d='M%d 810C%d %d %d %d %d %dC%d %d %d %d %d 810Z' fill='%s' opacity='%s'/>", x-w, x-w+lean/4, 810-ht/2, x+lean/2, 810-ht*3/4, x+lean, 810-ht, x+w+lean/3, 810-ht/2, x+w, 700, x+w, c, k.op(.14+float64(i%3)*.03, .2+float64(i%3)*.04)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 50%, " + k.veil(k.accent, 16) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropIronGall is an old manuscript page: faint lines of looping ink script in iron
// brown, a few ink blots, and the rings of old damp stains spreading across the sheet.
func themeBackdropIronGall(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	for i := 0; i < 5; i++ {
		cx, cy := 180+k.rnd(i, 1000), 120+k.rnd(i+9, 560)
		for j := 0; j < 5; j++ {
			sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='none' stroke='%s' stroke-width='%d' opacity='%s'/>", cx, cy, 90+j*34+k.rnd(i+j, 14), 70+j*28, h.accent, 1+j%2*2, k.op(.14-float64(j)*.015, .18-float64(j)*.02)))
		}
		if i%2 == 0 {
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%s'/>", cx+30, cy-20, 6+k.rnd(i, 8), h.warm, k.op(.3, .34)))
		}
	}
	for row := 0; row < 10; row++ {
		y := 100 + row*66
		x := 60 + k.rnd(row, 60)
		var d strings.Builder
		d.WriteString(fmt.Sprintf("M%d %d", x, y))
		for x < 1280-k.rnd(row+40, 300) {
			a := 6 + k.rnd(row*50+x, 16)
			step := 14 + k.rnd(row*60+x, 10)
			d.WriteString(fmt.Sprintf("c%d %d %d %d %d %d", step/3, -a*2, step, -a*2, step, 0))
			d.WriteString(fmt.Sprintf("c%d %d %d %d %d 0", step/4, a*2, step/2, a, step/2))
			x += step*3/2 + 4
			if k.rnd(x+row, 6) == 0 {
				x += 20
				d.WriteString(fmt.Sprintf("m20 0"))
			}
		}
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='1.6' stroke-linecap='round' opacity='%s'/>", d.String(), h.accent, k.op(.26, .3)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(10, 10, 50, 50, k.warm, 20)},
		backdropGround(k),
	}
}

// themeBackdropJungleNeon is neon vine: a few thick tube-lit stems curling in from the right and
// bottom-left edges, each a bright core inside a blurred halo, with small bud nodes along them.
func themeBackdropJungleNeon(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='9'/></filter></defs>")
	vine := func(d string, c string, nodes [][2]int) {
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='14' stroke-linecap='round' opacity='%s' filter='url(#b)'/>", d, c, k.op(.4, .5)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='3' stroke-linecap='round' opacity='%s'/>", d, c, k.op(.6, .75)))
		for _, n := range nodes {
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='9' fill='%s' opacity='%s' filter='url(#b)'/><circle cx='%d' cy='%d' r='3.5' fill='%s' opacity='%s'/>", n[0], n[1], h.warm, k.op(.5, .6), n[0], n[1], h.warm, k.op(.7, .85)))
		}
	}
	vine("M1420 230C1260 250 1180 340 1230 440S1330 560 1180 640S1020 780 1100 820", h.accent, [][2]int{{1230, 440}, {1180, 640}})
	vine("M1420 520C1330 540 1290 600 1330 660", h.second, [][2]int{{1330, 660}})
	vine("M-20 620C100 600 200 650 190 730S260 800 330 820", h.accent, [][2]int{{190, 730}})
	vine("M-20 300C60 320 100 380 70 450", h.cool, [][2]int{{70, 450}})
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMax slice", sb.String()),
		{image: k.blob(100, 70, 40, 50, k.accent, 22)},
		backdropGround(k),
	}
}

// themeBackdropKelpDrift is a kelp forest seen through water: wide translucent ribbons swaying up
// from the bottom edge in layers, and pale shafts of light slanting down from the top.
func themeBackdropKelpDrift(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	for layer := 0; layer < 2; layer++ {
		for i := 0; i < 9; i++ {
			x := 40 + i*160 + layer*80 + k.rnd(i+layer*11, 60)
			ht := 300 + k.rnd(i*2+layer*7, 280) - layer*80
			sw := 50 + k.rnd(i+layer*3, 60)
			w := 22 - layer*8
			c := h.cool
			if (i+layer)%3 == 0 {
				c = h.accent
			}
			d := fmt.Sprintf("M%d 810C%d %d %d %d %d %dC%d %d %d %d %d 810Z", x-w, x-w+sw, 810-ht/3, x-w-sw, 810-ht*2/3, x+sw/2, 810-ht, x+w-sw, 810-ht*2/3, x+w+sw, 810-ht/3, x+w)
			sb.WriteString(fmt.Sprintf("<path d='%s' fill='%s' opacity='%s'/>", d, c, k.op(.14-float64(layer)*.04, .2-float64(layer)*.06)))
		}
	}
	for i := 0; i < 4; i++ {
		x := 150 + i*330
		sb.WriteString(fmt.Sprintf("<path d='M%d -10L%d -10L%d 820L%d 820Z' fill='%s' opacity='%s'/>", x, x+50+i*8, x-260, x-340, h.warm, k.op(.05, .06)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(k.cool, 14) + " 0%, transparent 40%, " + k.veil(k.accent, 16) + " 100%)"},
		backdropGround(k),
	}
}
