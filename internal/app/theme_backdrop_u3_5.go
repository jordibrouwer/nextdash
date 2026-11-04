package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropMidnightFirefly is a dark meadow at night: scattered soft glows of different sizes
// with faint looping flight trails, lower on the page than the top.
func themeBackdropMidnightFirefly(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	grad := func(id, c string) {
		sb.WriteString(fmt.Sprintf("<radialGradient id='%s'><stop offset='0' stop-color='%s' stop-opacity='1'/><stop offset='.25' stop-color='%s' stop-opacity='.4'/><stop offset='1' stop-color='%s' stop-opacity='0'/></radialGradient>", id, c, c, c))
	}
	sb.WriteString("<defs>")
	grad("ga", h.accent)
	grad("gc", h.cool)
	grad("gw", h.warm)
	sb.WriteString("</defs>")
	ids := []string{"ga", "gc", "ga", "gw", "ga"}
	cols := []string{h.accent, h.cool, h.accent, h.warm, h.accent}
	for i := 0; i < 9; i++ {
		x, y := k.rnd(i*7+1, 1400), 330+k.rnd(i*7+2, 560)
		dx, dy := 90+k.rnd(i*7+3, 180), 40+k.rnd(i*7+4, 120)
		sb.WriteString(fmt.Sprintf("<path d='M%d %dc%d %d %d %d %d %ds%d %d %d %d' fill='none' stroke='%s' stroke-width='1.3' stroke-dasharray='2 9' stroke-linecap='round' opacity='%s'/>",
			x, y, dx/2, -dy, dx, dy, dx*3/2, -dy/2, dx, dy, dx, 0, cols[i%5], k.op(.4, .35)))
	}
	for i := 0; i < 30; i++ {
		x, y := k.rnd(i*5+100, 1400), 260+k.rnd(i*5+101, 640)
		r := 10 + k.rnd(i*5+102, 38)
		c := i % 5
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='url(#%s)' opacity='%s'/>", x, y, r, ids[c], k.op(.6, .8)))
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, y, 1.2+float64(r)/18, cols[c], k.op(.8, .95)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 115, 100, 40, k.cool, 22)},
		backdropGround(k),
	}
}

// themeBackdropMidnightInk is a drop of ink in still water: pale blue washes and tendrils that
// have been pulled apart by a slow current, soft at every edge.
func themeBackdropMidnightInk(k backdropKit) []backdropLayer {
	h := k.hex
	body := "<defs><filter id='d' x='-30%' y='-30%' width='160%' height='160%'><feTurbulence type='fractalNoise' baseFrequency='.007 .011' numOctaves='3' seed='6' result='t'/>" +
		"<feDisplacementMap in='SourceGraphic' in2='t' scale='260'/><feGaussianBlur stdDeviation='9'/></filter></defs>"
	g := func(c string, a string, inner string) string {
		return "<g filter='url(#d)' fill='" + c + "' stroke='" + c + "' opacity='" + a + "'>" + inner + "</g>"
	}
	body += g(h.accent, k.op(.6, .55),
		"<ellipse cx='360' cy='640' rx='240' ry='110' stroke='none'/><ellipse cx='1020' cy='760' rx='300' ry='90' stroke='none'/>"+
			"<path d='M200 800C400 500 700 700 900 420' fill='none' stroke-width='40' stroke-linecap='round'/>"+
			"<path d='M820 880C1000 640 1200 700 1320 500' fill='none' stroke-width='18' stroke-linecap='round'/>")
	body += g(h.cool, k.op(.4, .34),
		"<ellipse cx='700' cy='820' rx='260' ry='70' stroke='none'/>"+
			"<path d='M60 640C260 560 420 760 640 640' fill='none' stroke-width='14' stroke-linecap='round'/>")
	body += g(h.second, k.op(.22, .18), "<ellipse cx='1180' cy='600' rx='140' ry='70' stroke='none'/>")
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", body),
		backdropGround(k),
	}
}

// themeBackdropMidnightNeon is a wet street at night: smeared vertical reflections of neon signs
// of different colours that fade as they run down the pavement.
func themeBackdropMidnightNeon(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cols := []string{h.accent, h.cool, h.second, h.warm, h.accent, h.cool}
	sb.WriteString("<defs><filter id='b' x='-100%' y='-10%' width='300%' height='120%'><feGaussianBlur stdDeviation='5 14'/></filter>")
	for i, c := range cols {
		sb.WriteString(fmt.Sprintf("<linearGradient id='g%d' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%s' stop-opacity='.9'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient>", i, c, c))
	}
	sb.WriteString("</defs><g filter='url(#b)'>")
	for i := 0; i < 26; i++ {
		x := k.rnd(i*4+1, 1400)
		w := 5 + k.rnd(i*4+2, 26)
		y := 560 + k.rnd(i*4+3, 120)
		hh := 150 + k.rnd(i*4+4, 230)
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='url(#g%d)' opacity='%s'/>", x, y, w, hh, i%len(cols), k.op(.5, .6)))
	}
	sb.WriteString("</g>")
	for i := 0; i < 12; i++ {
		y := 600 + i*26 + k.rnd(i, 10)
		x := k.rnd(i*3+50, 1100)
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='1.4' fill='%s' opacity='%s'/>", x, y, 120+k.rnd(i*3+51, 380), cols[i%len(cols)], k.op(.25, .3)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 55%, " + k.veil(k.accent, 12) + " 78%, transparent 100%)"},
		backdropGround(k),
	}
}

// themeBackdropMirageSand is heat haze over sand: long ribbons of warm light with wavering edges,
// stacked and broken, pulled sideways by a stretched noise.
func themeBackdropMirageSand(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='w' x='-10%' y='-10%' width='120%' height='120%'><feTurbulence type='fractalNoise' baseFrequency='.003 .045' numOctaves='2' seed='8' result='t'/>" +
		"<feDisplacementMap in='SourceGraphic' in2='t' scale='70' xChannelSelector='R' yChannelSelector='G'/></filter></defs><g filter='url(#w)'>")
	cols := []string{h.accent, h.warm, h.accent, h.cool}
	for i := 0; i < 22; i++ {
		y := 430 + i*21 + k.rnd(i, 8)
		x := k.rnd(i*3+9, 500) - 200
		w := 300 + k.rnd(i*3+10, 800)
		hh := 3 + k.rnd(i*3+11, 12)
		a := (0.5 - float64(i)*0.018)
		if a < .08 {
			a = .08
		}
		a *= map[bool]float64{true: 1, false: .8}[k.dark]
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='%d' fill='%s' opacity='%.2f'/>", x, y, w, hh, hh/2, cols[i%len(cols)], a))
		if i%3 == 0 {
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='2' fill='%s' opacity='%.2f'/>", x+w+60, y, 200+k.rnd(i, 300), hh-1, cols[(i+1)%len(cols)], a*.8))
		}
	}
	sb.WriteString("</g>")
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 108, 90, 34, k.warm, 28)},
		backdropGround(k),
	}
}

// themeBackdropMonochromeMist is fog in grey: two slow layers of soft cloud noise, thicker toward
// the bottom, with no hard edge anywhere.
func themeBackdropMonochromeMist(k backdropKit) []backdropLayer {
	h := k.hex
	fog := func(seed int, fx, fy, c, a string) backdropLayer {
		body := fmt.Sprintf("<filter id='f' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='%s %s' numOctaves='4' seed='%d' result='n'/>"+
			"<feColorMatrix in='n' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.4 0 0 0 -.95' result='m'/><feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='m' operator='in'/></filter>"+
			"<rect width='1200' height='800' filter='url(#f)'/>", fx, fy, seed, c, a)
		return svgScene(1200, 800, "xMidYMax slice", body)
	}
	ink := "#000000"
	if k.dark {
		ink = "#ffffff"
	}
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.ground + " 0%, transparent 40%, transparent 100%)"},
		fog(5, ".0035", ".008", h.accent, k.op(.55, .5)),
		fog(21, ".006", ".012", ink, k.op(.12, .12)),
		{image: k.blob(50, 110, 100, 40, k.accent, 22)},
		backdropGround(k),
	}
}

// themeBackdropMoonlitSteel is brushed steel under a moon: fine horizontal grain, a fan of
// metallic sheen spreading from a pale moon glow in the top corner.
func themeBackdropMoonlitSteel(k backdropKit) []backdropLayer {
	h := k.hex
	body := fmt.Sprintf("<filter id='g' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='.0012 .55' numOctaves='2' seed='3' stitchTiles='stitch' result='n'/>"+
		"<feColorMatrix in='n' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 3 0 0 0 -1.3' result='m'/><feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='m' operator='in'/></filter>"+
		"<rect width='600' height='600' filter='url(#g)'/>", h.accent, k.op(.55, .6))
	return []backdropLayer{
		svgTile(k, 600, 600, body),
		{image: "conic-gradient(from 150deg at 88% -12%, transparent 0deg, " + k.veil(k.accent, 16) + " 14deg, transparent 28deg, " + k.veil(k.accent, 10) + " 44deg, transparent 62deg)"},
		{image: "conic-gradient(from 60deg at 8% 120%, transparent 0deg, " + k.veil(k.cool, 12) + " 12deg, transparent 30deg, " + k.veil(k.accent, 9) + " 46deg, transparent 60deg)"},
		{image: k.blob(88, -8, 46, 40, k.accent, 30)},
		backdropGround(k),
	}
}

// themeBackdropMossStone is lichen on stone: irregular clusters of fine specks that thin out from
// dense centres, in the stone's greens and ochres, with a faint grain beneath.
func themeBackdropMossStone(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cols := []string{h.cool, h.warm, h.cool, h.accent, h.second}
	for c := 0; c < 26; c++ {
		cx, cy := k.rnd(c*11+1, 1400), 300+k.rnd(c*11+2, 600)
		R := 50 + k.rnd(c*11+3, 120)
		col := cols[c%len(cols)]
		for i := 0; i < 110; i++ {
			ang := float64(k.rnd(c*977+i*3, 628)) / 100
			u := float64(k.rnd(c*977+i*3+1, 1000)) / 1000
			d := float64(R) * u * u
			x := float64(cx) + math.Cos(ang)*d*1.4
			y := float64(cy) + math.Sin(ang)*d
			r := 1.1 + float64(k.rnd(c*977+i*3+2, 36))/10*(1.1-u)
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.1f' fill='%s' opacity='%s'/>", x, y, r, col, k.op(.7, .72)))
		}
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s'/>", cx, cy, R, R*3/4, col, k.op(.12, .12)))
	}
	grain := fmt.Sprintf("<filter id='g' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' seed='9' stitchTiles='stitch' result='n'/>"+
		"<feColorMatrix in='n' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.2 0 0 0 -.95' result='m'/><feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='m' operator='in'/></filter><rect width='200' height='200' filter='url(#g)'/>", h.accent, k.op(.25, .22))
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		svgTile(k, 200, 200, grain),
		backdropGround(k),
	}
}

// themeBackdropMulberrySilk is draped satin: broad blurred folds in purple and rose sweeping
// across the page, each with a thin bright line where the light catches the ridge.
func themeBackdropMulberrySilk(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-40%' width='140%' height='180%'><feGaussianBlur stdDeviation='22'/></filter>")
	for i, c := range []string{h.accent, h.second, h.cool} {
		sb.WriteString(fmt.Sprintf("<linearGradient id='s%d' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='%s' stop-opacity='0'/><stop offset='.5' stop-color='%s' stop-opacity='1'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient>", i, c, c, c))
	}
	sb.WriteString("</defs>")
	folds := []struct {
		d  string
		g  int
		w  int
		op float64
	}{
		{"M-100 760C300 520 560 960 940 680S1340 360 1520 520", 0, 90, .5},
		{"M-100 900C260 720 640 1000 1000 820S1340 640 1520 760", 1, 70, .38},
		{"M-100 600C200 420 520 680 860 520S1260 420 1520 300", 2, 46, .26},
		{"M-100 480C240 300 460 500 760 360S1200 200 1500 120", 0, 40, .22},
	}
	for _, f := range folds {
		a := f.op * map[bool]float64{true: 1, false: .8}[k.dark]
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='url(#s%d)' stroke-width='%d' opacity='%.2f' filter='url(#b)'/>", f.d, f.g, f.w, a))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='url(#s%d)' stroke-width='1.6' opacity='%.2f' transform='translate(0 -%d)'/>", f.d, f.g, a*1.1, f.w/3))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 50%, " + k.veil(k.accent, 14) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropNebulaNursery is where stars are being born: small clusters of bright seeds, each
// with a coloured halo and a faint four-point spike, joined by dim gas filaments and dust.
func themeBackdropNebulaNursery(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='14'/></filter>")
	for i, c := range []string{h.accent, h.warm, h.cool} {
		sb.WriteString(fmt.Sprintf("<radialGradient id='h%d'><stop offset='0' stop-color='%s' stop-opacity='.9'/><stop offset='.3' stop-color='%s' stop-opacity='.3'/><stop offset='1' stop-color='%s' stop-opacity='0'/></radialGradient>", i, c, c, c))
	}
	sb.WriteString("</defs>")
	sb.WriteString(fmt.Sprintf("<g filter='url(#b)' fill='none' stroke='%s' stroke-width='26' stroke-linecap='round' opacity='%s'><path d='M120 640C320 520 460 700 680 600'/><path d='M880 760C1040 600 1200 700 1300 520'/></g>", h.accent, k.op(.2, .2)))
	sb.WriteString(fmt.Sprintf("<g fill='none' stroke='%s' stroke-width='1' stroke-dasharray='1 7' opacity='%s'><path d='M120 640C320 520 460 700 680 600'/><path d='M880 760C1040 600 1200 700 1300 520'/></g>", h.warm, k.op(.5, .5)))
	cols := []string{h.accent, h.warm, h.cool}
	centres := [][2]int{{260, 660}, {640, 620}, {1020, 740}, {1250, 540}, {430, 820}}
	for ci, c := range centres {
		for i := 0; i < 3+ci%3; i++ {
			x := c[0] + k.rnd(ci*40+i*3, 150) - 75
			y := c[1] + k.rnd(ci*40+i*3+1, 110) - 55
			r := 14 + k.rnd(ci*40+i*3+2, 34)
			g := (ci + i) % 3
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='url(#h%d)' opacity='%s'/>", x, y, r*2, g, k.op(.7, .85)))
			sp := r + 6
			sb.WriteString(fmt.Sprintf("<path d='M%d %dH%d M%d %dV%d' stroke='%s' stroke-width='1.2' opacity='%s'/>", x-sp, y, x+sp, x, y-sp, y+sp, cols[g], k.op(.55, .7)))
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s'/>", x, y, 2+float64(r)/14, cols[g]))
		}
	}
	for i := 0; i < 70; i++ {
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", k.rnd(i*3+700, 1400), 380+k.rnd(i*3+701, 520), .6+float64(k.rnd(i*3+702, 10))/10, cols[i%3], k.op(.4, .55)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		backdropGround(k),
	}
}

// themeBackdropNeonGrid is a grid of fine neon lines bent as if a heavy mass sat under it, with a
// few intersections lit as nodes.
func themeBackdropNeonGrid(k backdropKit) []backdropLayer {
	h := k.hex
	cx, cy, sig, amp := 960.0, 560.0, 300.0, 0.55
	warp := func(x, y float64) (float64, float64) {
		dx, dy := x-cx, y-cy
		f := amp * math.Exp(-(dx*dx+dy*dy)/(2*sig*sig))
		return x + dx*f, y + dy*f
	}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='6'/></filter></defs>")
	const step = 70
	line := func(vertical bool, v int) {
		var d strings.Builder
		for t := -100; t <= 1500; t += 25 {
			x, y := float64(v), float64(t)
			if !vertical {
				x, y = float64(t), float64(v)
			}
			x, y = warp(x, y)
			if t == -100 {
				d.WriteString(fmt.Sprintf("M%.0f %.0f", x, y))
			} else {
				d.WriteString(fmt.Sprintf("L%.0f %.0f", x, y))
			}
		}
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='1.1' opacity='%s'/>", d.String(), h.accent, k.op(.3, .26)))
	}
	for v := 0; v <= 1400; v += step {
		line(true, v)
	}
	for v := 0; v <= 900; v += step {
		line(false, v)
	}
	for gx := 0; gx <= 1400; gx += step {
		for gy := 0; gy <= 900; gy += step {
			if k.rnd(gx*13+gy*7, 100) < 5 {
				x, y := warp(float64(gx), float64(gy))
				c := h.cool
				if k.rnd(gx+gy, 2) == 0 {
					c = h.accent
				}
				sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='9' fill='%s' opacity='%s' filter='url(#b)'/><circle cx='%.0f' cy='%.0f' r='2.4' fill='%s' opacity='%s'/>", x, y, c, k.op(.7, .8), x, y, c, k.op(.85, .95)))
			}
		}
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: k.blob(69, 62, 40, 40, k.accent, 14)},
		backdropGround(k),
	}
}
