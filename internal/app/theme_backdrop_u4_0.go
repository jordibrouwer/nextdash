package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropSolarEmber is a solar prominence: glowing loops of fire arching up from the bottom
// edge on the left and right, each a soft wide halo with a hot thin core, over the limb of a sun.
func themeBackdropSolarEmber(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='9'/></filter>" +
		"<radialGradient id='s' cx='.5' cy='1' r='.9'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='" + k.op(.5, .55) + "'/><stop offset='.6' stop-color='" + h.accent + "' stop-opacity='" + k.op(.25, .3) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<ellipse cx='260' cy='850' rx='520' ry='300' fill='url(#s)'/><ellipse cx='1180' cy='860' rx='460' ry='260' fill='url(#s)'/>")
	loop := func(x0, x1, ht int, c string, w float64) {
		d := fmt.Sprintf("M%d 810C%d %d %d %d %d 810", x0, x0-ht/6, 810-ht, x1+ht/6, 810-ht, x1)
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.0f' stroke-linecap='round' opacity='%s' filter='url(#b)'/>", d, c, w*3, k.op(.55, .6)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' stroke-linecap='round' opacity='%s'/>", d, c, w, k.op(.6, .7)))
	}
	loop(40, 330, 420, h.accent, 5)
	loop(120, 260, 250, h.warm, 3.5)
	loop(200, 480, 330, h.second, 3)
	loop(300, 400, 170, h.warm, 3)
	loop(1020, 1330, 450, h.accent, 5)
	loop(1100, 1250, 270, h.warm, 3.5)
	loop(1180, 1400, 330, h.second, 3)
	loop(900, 1060, 190, h.warm, 3)
	for i := 0; i < 22; i++ {
		x := 20 + k.rnd(i*3, 520)
		if i%2 == 1 {
			x = 900 + k.rnd(i*3, 500)
		}
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, 480+k.rnd(i*5+1, 280), 1.5+float64(k.rnd(i, 25))/10, h.warm, k.op(.7, .8)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 55%, " + k.veil(h.accent, 22) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropSolarFlats is sun through a tall window onto a floor: flat parallelograms of warm
// light cut by the mullions, each with a cooler flat shadow beside it, lying across the lower left
// and again, smaller, in the upper right.
func themeBackdropSolarFlats(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	patch := func(tx, ty float64, sc float64, lit, shade string, a float64) {
		sb.WriteString(fmt.Sprintf("<g transform='translate(%.0f %.0f) scale(%.2f) skewX(-32)'>", tx, ty, sc))
		for r := 0; r < 2; r++ {
			for c := 0; c < 3; c++ {
				x, y := c*190, r*250
				sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='170' height='230' fill='%s' opacity='%s'/>", x+34, y+26, shade, k.op(a*.7, a*.75)))
				sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='170' height='230' fill='%s' opacity='%s'/>", x, y, lit, k.op(a, a+.05)))
			}
		}
		sb.WriteString("</g>")
	}
	patch(-60, 330, 1.0, h.warm, h.accent, .38)
	patch(1000, -80, .62, h.warm, h.accent, .34)
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(10, 100, 70, 50, k.warm, 30)},
		backdropGround(k),
	}
}

// themeBackdropSolarWind is the solar wind meeting a planet: fine streamlines of charge flowing in
// from the left, bending round a glowing world on the right, with a bow shock arc in front of it.
func themeBackdropSolarWind(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cx, cy, rr := 1060.0, 430.0, 120.0
	sb.WriteString("<defs><linearGradient id='f' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='1060' y2='0'><stop offset='0' stop-color='#fff' stop-opacity='0'/><stop offset='1' stop-color='#fff' stop-opacity='1'/></linearGradient>" +
		"<mask id='m'><rect width='1400' height='800' fill='url(#f)'/></mask>" +
		"<radialGradient id='p'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='" + k.op(.55, .6) + "'/><stop offset='.45' stop-color='" + h.second + "' stop-opacity='" + k.op(.3, .35) + "'/><stop offset='1' stop-color='" + h.second + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<circle cx='1060' cy='430' r='330' fill='url(#p)'/><g mask='url(#m)' fill='none' stroke-linecap='round'>")
	for i := -11; i <= 11; i++ {
		s := float64(i)*52 + 26
		var pts []string
		for x := -20.0; x <= 1440; x += 30 {
			dx, dy := x-cx, s
			y := cy + s*(1+rr*rr*1.4/(dx*dx+dy*dy))
			pts = append(pts, fmt.Sprintf("%.0f,%.0f", x, y))
		}
		c := h.accent
		switch {
		case i%3 == 0:
			c = h.second
		case i%3 == 1:
			c = h.warm
		}
		sb.WriteString(fmt.Sprintf("<polyline points='%s' stroke='%s' stroke-width='1.6' opacity='%s'/>", strings.Join(pts, " "), c, k.op(.6, .65)))
	}
	sb.WriteString("</g>")
	sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fA%.0f %.0f 0 0 0 %.0f %.0f' fill='none' stroke='%s' stroke-width='3' opacity='%s'/>", cx-210, cy-170, 240.0, 240.0, cx-210, cy+170, h.warm, k.op(.55, .65)))
	sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='%s' opacity='%s'/>", cx, cy, rr, h.ground, k.op(.5, .6)))
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMid slice", sb.String()),
		backdropGround(k),
	}
}

// themeBackdropSquidInk is a squid in the dark: a drifting cloud of ink with a glowing rim, and
// clusters of chromatophores, spots with a halo that flare in teal, mint and amber.
func themeBackdropSquidInk(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='c' x='-30%' y='-30%' width='160%' height='160%'><feTurbulence type='fractalNoise' baseFrequency='.008' numOctaves='3' seed='4' result='t'/><feDisplacementMap in='SourceGraphic' in2='t' scale='90'/><feGaussianBlur stdDeviation='10'/></filter>" +
		"<radialGradient id='d'><stop offset='0' stop-color='#fff' stop-opacity='.9'/><stop offset='.5' stop-color='#fff' stop-opacity='.25'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString(fmt.Sprintf("<g filter='url(#c)'><ellipse cx='240' cy='640' rx='300' ry='170' fill='%s' opacity='%s'/><ellipse cx='1180' cy='200' rx='260' ry='150' fill='%s' opacity='%s'/>"+
		"<ellipse cx='330' cy='610' rx='200' ry='100' fill='%s' opacity='%s'/></g>", h.accent, k.op(.5, .45), h.accent, k.op(.4, .38), h.ground, k.op(.5, .6)))
	cols := []string{h.accent, h.cool, h.warm, h.accent}
	cluster := func(ox, oy, n, spread, seed int) {
		for i := 0; i < n; i++ {
			x := ox + k.rnd(seed+i*3, spread) - spread/2 + k.rnd(seed+i*3+1, spread/2) - spread/4
			y := oy + k.rnd(seed+i*7, spread) - spread/2
			r := 4 + k.rnd(seed+i*11, 15)
			c := cols[k.rnd(seed+i, len(cols))]
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%s'/>", x, y, r*3, c, k.op(.28, .32)))
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%s'/>", x, y, r, c, k.op(.6, .7)))
			sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='none' stroke='%s' stroke-width='1.2' opacity='%s'/>", x, y, r+5, c, k.op(.5, .5)))
		}
	}
	cluster(170, 560, 22, 340, 1)
	cluster(1240, 640, 18, 320, 40)
	cluster(1180, 150, 14, 280, 90)
	cluster(80, 140, 8, 160, 140)
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		backdropGround(k),
	}
}

// themeBackdropStaticNoise is a film leader: a countdown ring with crosshairs cropped at the lower
// right, sprocket holes down the left edge, long vertical scratches and a scatter of dust, all in
// greys with a faint flicker band across the middle of the frame.
func themeBackdropStaticNoise(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	ink := h.accent
	cx, cy := 1060.0, 640.0
	for i, r := range []float64{150, 205, 330} {
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-width='%.1f' opacity='%s'/>", cx, cy, r, ink, 5-float64(i)*1.4, k.op(.55, .6)))
	}
	sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fH%.0fM%.0f %.0fV%.0f' stroke='%s' stroke-width='2' opacity='%s'/>", cx-420, cy, cx+420, cx, cy-420, cy+420, ink, k.op(.5, .55)))
	sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0fA150 150 0 0 1 %.0f %.0fZ' fill='%s' opacity='%s'/>", cx, cy, cx, cy-150, cx+106, cy-106, ink, k.op(.28, .3)))
	for i := 0; i < 15; i++ {
		y := 24 + i*58
		sb.WriteString(fmt.Sprintf("<rect x='34' y='%d' width='38' height='28' rx='7' fill='%s' opacity='%s'/>", y, h.ground, "1"))
		sb.WriteString(fmt.Sprintf("<rect x='34' y='%d' width='38' height='28' rx='7' fill='none' stroke='%s' stroke-width='2' opacity='%s'/>", y, ink, k.op(.55, .6)))
	}
	sb.WriteString(fmt.Sprintf("<rect x='20' y='0' width='66' height='900' fill='%s' opacity='%s'/>", ink, k.op(.1, .12)))
	for i := 0; i < 11; i++ {
		x := 140 + k.rnd(i*3, 1200)
		y := k.rnd(i*3+1, 500)
		sb.WriteString(fmt.Sprintf("<path d='M%d %dq%d %d %d %d' stroke='%s' stroke-width='%.1f' fill='none' opacity='%s'/>", x, y, k.rnd(i, 8)-4, 260+k.rnd(i+2, 240), k.rnd(i+3, 10)-5, 500+k.rnd(i+4, 360), ink, 1+float64(k.rnd(i+5, 20))/10, k.op(.5, .55)))
	}
	for i := 0; i < 90; i++ {
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", k.rnd(i*5+1, 1400), k.rnd(i*5+2, 900), .8+float64(k.rnd(i*5+3, 30))/10, ink, k.op(.5, .55)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 38%, " + k.veil(ink, 14) + " 46%, " + k.veil(ink, 6) + " 54%, transparent 60%)"},
		backdropGround(k),
	}
}

func themeBackdropSteelDawn(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='g' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='14'/></filter><filter id='r' x='-5%' y='-5%' width='110%' height='110%'><feGaussianBlur stdDeviation='3'/></filter>" +
		"<radialGradient id='s'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='" + k.op(.7, .75) + "'/><stop offset='.4' stop-color='" + h.warm + "' stop-opacity='" + k.op(.25, .3) + "'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<circle cx='700' cy='720' r='360' fill='url(#s)'/>")
	ring := func(r float64, c string, w string, op string, f string) {
		sb.WriteString(fmt.Sprintf("<circle cx='700' cy='720' r='%.0f' fill='none' stroke='%s' stroke-width='%s' opacity='%s' %s/>", r, c, w, op, f))
	}
	ring(470, h.accent, "34", k.op(.2, .22), "filter='url(#g)'")
	ring(452, h.second, "3", k.op(.55, .55), "filter='url(#r)'")
	ring(462, h.warm, "3", k.op(.55, .6), "filter='url(#r)'")
	ring(473, h.cool, "3", k.op(.55, .55), "filter='url(#r)'")
	ring(485, h.accent, "2", k.op(.5, .55), "filter='url(#r)'")
	for _, x := range []float64{236, 1164} {
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='722' rx='34' ry='54' fill='%s' opacity='%s' filter='url(#g)'/>", x, h.cool, k.op(.7, .7)))
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='722' rx='10' ry='22' fill='%s' opacity='%s'/>", x, h.warm, k.op(.7, .8)))
	}
	sb.WriteString(fmt.Sprintf("<path d='M520 250Q700 190 880 250' fill='none' stroke='%s' stroke-width='5' stroke-linecap='round' opacity='%s' filter='url(#r)'/>", h.accent, k.op(.55, .6)))
	sb.WriteString(fmt.Sprintf("<rect x='0' y='745' width='1400' height='60' fill='%s' opacity='%s' filter='url(#g)'/>", h.warm, k.op(.5, .5)))
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 50%, " + k.veil(h.accent, 20) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropStone is a cut face of sedimentary rock made of paper: strata with deckled edges that
// each cast a soft shadow on the one below, the grain of a sheet over all of it, and a few
// pressed pebbles.
func themeBackdropStone(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.accent, h.warm, h.second, h.accent, h.cool, h.warm, h.accent, h.second, h.warm, h.accent}
	top := func(i int, x float64) float64 {
		return 470 + float64(i)*38 + (x-700)*0.13 + 14*math.Sin(x/130+float64(i)*1.7) + 7*math.Sin(x/47+float64(i)*3)
	}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='e' x='-2%' y='-2%' width='104%' height='104%'><feTurbulence type='fractalNoise' baseFrequency='.05' numOctaves='3' seed='5' result='t'/><feDisplacementMap in='SourceGraphic' in2='t' scale='9'/></filter><filter id='s' x='-5%' y='-5%' width='110%' height='115%'><feGaussianBlur stdDeviation='4'/></filter></defs>")
	for i := 0; i < 10; i++ {
		var up, dn []string
		for x := -60.0; x <= 1460; x += 50 {
			up = append(up, fmt.Sprintf("%.0f,%.0f", x, top(i, x)))
		}
		for x := 1460.0; x >= -60; x -= 50 {
			dn = append(dn, fmt.Sprintf("%.0f,1000", x))
		}
		pts := strings.Join(up, " ") + " " + strings.Join(dn, " ")
		sb.WriteString(fmt.Sprintf("<g transform='translate(0 9)'><polygon points='%s' fill='#000' opacity='%s' filter='url(#s)'/></g>", pts, k.op(.4, .7)))
		sb.WriteString(fmt.Sprintf("<g filter='url(#e)'><polygon points='%s' fill='%s' opacity='%s'/><polyline points='%s' fill='none' stroke='#fff' stroke-width='3' opacity='%s'/></g>", pts, cols[i], k.op(.5+float64(i%3)*.05, .4+float64(i%3)*.05), strings.Join(up, " "), k.op(.8, .3)))
	}
	for i := 0; i < 9; i++ {
		x := 100 + k.rnd(i*3, 1200)
		i2 := 1 + k.rnd(i*5+1, 7)
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%.0f' rx='%d' ry='%d' fill='%s' opacity='%s'/>", x, top(i2, float64(x))+16, 10+k.rnd(i, 22), 4+k.rnd(i+1, 6), h.ground, k.op(.4, .5)))
	}
	grain := fmt.Sprintf("<filter id='g' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='.9 .4' numOctaves='3' seed='7' stitchTiles='stitch' result='n'/>"+
		"<feColorMatrix in='n' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2 0 0 0 -.7' result='m'/><feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='m' operator='in'/></filter><rect width='240' height='240' filter='url(#g)'/>", h.accent, k.op(.85, .6))
	return []backdropLayer{
		svgTile(k, 240, 240, grain),
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		backdropGround(k),
	}
}

func themeBackdropStormPetrel(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='1.1'/></filter><filter id='g' x='-30%' y='-100%' width='160%' height='300%'><feGaussianBlur stdDeviation='24'/></filter>" +
		"<linearGradient id='f' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='0' y2='620'><stop offset='0' stop-color='#fff' stop-opacity='1'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient><mask id='m'><rect width='1400' height='800' fill='url(#f)'/></mask></defs>")
	sb.WriteString(fmt.Sprintf("<ellipse cx='700' cy='640' rx='620' ry='40' fill='%s' opacity='%s' filter='url(#g)'/>", h.cool, k.op(.4, .45)))
	sb.WriteString("<g mask='url(#m)' filter='url(#b)'>")
	for i := 0; i < 110; i++ {
		x := k.rnd(i*3, 1400)
		if x > 380 && x < 1000 {
			x = (x + 640) % 1400
			if x > 380 && x < 1000 {
				continue
			}
		}
		y := k.rnd(i*5+1, 380)
		c := h.accent
		if i%4 == 0 {
			c = h.cool
		}
		sb.WriteString(fmt.Sprintf("<line x1='%d' y1='%d' x2='%d' y2='%d' stroke='%s' stroke-width='%.1f' opacity='%s'/>", x, y, x-34, y+170+k.rnd(i, 120), c, 1+float64(k.rnd(i*7, 14))/10, k.op(.6, .65)))
	}
	sb.WriteString("</g>")
	for i := 0; i < 26; i++ {
		x := k.rnd(i*3+2, 1400)
		y := 690 + k.rnd(i*5+3, 100)
		sb.WriteString(fmt.Sprintf("<path d='M%d %dq%d -5 %d 0' fill='none' stroke='%s' stroke-width='2' stroke-linecap='round' opacity='%s'/>", x, y, 14+k.rnd(i, 20), 30+k.rnd(i, 40), h.accent, k.op(.45, .55)))
	}
	sb.WriteString(fmt.Sprintf("<path d='M300 640q36 -26 82 -4q-34 -2 -48 12q-12 -2 -20 4q-8 -8 -14 -12z' fill='%s' opacity='%s'/>", h.accent, k.op(.8, .85)))
	sb.WriteString(fmt.Sprintf("<path d='M382 636q40 -24 74 -4q-30 -4 -42 8z' fill='%s' opacity='%s'/>", h.accent, k.op(.7, .75)))
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		backdropGround(k),
	}
}

// themeBackdropSumiInk is a single enso, the brushed circle: one stroke that swells where the
// brush landed and thins and breaks where it lifted, cropped by the lower right, with spatter.
func themeBackdropSumiInk(k backdropKit) []backdropLayer {
	h := k.hex
	cx, cy, r := 1010.0, 500.0, 330.0
	var outer, inner []string
	const n = 90
	start := 0.35 * math.Pi
	for i := 0; i <= n; i++ {
		t := float64(i) / n
		a := start + t*2*math.Pi*0.93
		w := 7 + 50*math.Pow(1-t, 0.55)*(0.55+0.45*math.Sin(t*5+1))
		rad := r + 24*t
		outer = append(outer, fmt.Sprintf("%.1f,%.1f", cx+(rad+w/2)*math.Cos(a), cy+(rad+w/2)*math.Sin(a)))
		inner = append([]string{fmt.Sprintf("%.1f,%.1f", cx+(rad-w/2)*math.Cos(a), cy+(rad-w/2)*math.Sin(a))}, inner...)
	}
	pts := strings.Join(outer, " ") + " " + strings.Join(inner, " ")
	var sb strings.Builder
	sb.WriteString("<defs><filter id='r' x='-10%' y='-10%' width='120%' height='120%'><feTurbulence type='fractalNoise' baseFrequency='.05' numOctaves='3' seed='8' result='t'/><feDisplacementMap in='SourceGraphic' in2='t' scale='9'/></filter>" +
		"<filter id='w' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='26'/></filter></defs>")
	sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='%s' opacity='%s' filter='url(#w)'/>", cx, cy, r*0.8, h.accent, k.op(.2, .2)))
	sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='%s' opacity='%s' filter='url(#r)'/>", pts, h.accent, k.op(.55, .6)))
	sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-width='2' stroke-dasharray='90 14 40 30 8 60' opacity='%s' filter='url(#r)'/>", cx, cy, r+8, h.warm, k.op(.35, .45)))
	for i := 0; i < 26; i++ {
		a := start - 0.12*math.Pi + float64(k.rnd(i, 100))/100*0.7 - 0.2
		d := r + 60 + float64(k.rnd(i*3, 200))
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.1f' fill='%s' opacity='%s'/>", cx+d*math.Cos(a), cy+d*math.Sin(a), 1.5+float64(k.rnd(i*5, 55))/10, h.accent, k.op(.5, .55)))
	}
	sb.WriteString(fmt.Sprintf("<path d='M70 740q60 -50 150 -40' fill='none' stroke='%s' stroke-width='5' stroke-linecap='round' opacity='%s' filter='url(#r)'/>", h.second, k.op(.45, .5)))
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMid slice", sb.String()),
		backdropGround(k),
	}
}

// themeBackdropSunflowerInk is a sunflower drawn in ink line: a huge head cropped by the lower
// right with two rings of outlined petals, and a disc of seeds placed at the golden angle, with a
// smaller bloom in the upper left.
func themeBackdropSunflowerInk(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	flower := func(cx, cy, sc float64, np int) {
		sb.WriteString(fmt.Sprintf("<g transform='translate(%.0f %.0f) scale(%.2f)'>", cx, cy, sc))
		for ring := 0; ring < 2; ring++ {
			base, ln, wd := 150.0, 330.0, 46.0
			c, fa := h.accent, k.op(.12, .14)
			off := 0.0
			if ring == 1 {
				base, ln, wd, c, off = 140, 250, 38, h.warm, 180/float64(np)
				fa = k.op(.18, .2)
			}
			for i := 0; i < np; i++ {
				deg := float64(i)*360/float64(np) + off
				sb.WriteString(fmt.Sprintf("<path transform='rotate(%.1f)' d='M0 -%.0fQ%.0f -%.0f 0 -%.0fQ-%.0f -%.0f 0 -%.0f' fill='%s' fill-opacity='%s' stroke='%s' stroke-width='3' stroke-linejoin='round' opacity='%s'/>",
					deg, base, wd, base+ln*0.5, base+ln, wd, base+ln*0.5, base, c, fa, c, k.op(.65, .7)))
				sb.WriteString(fmt.Sprintf("<path transform='rotate(%.1f)' d='M0 -%.0fV-%.0f' stroke='%s' stroke-width='1.4' opacity='%s'/>", deg, base+20, base+ln*0.7, c, k.op(.4, .45)))
			}
		}
		sb.WriteString(fmt.Sprintf("<circle r='150' fill='%s' fill-opacity='%s' stroke='%s' stroke-width='3' opacity='%s'/>", h.warm, k.op(.14, .16), h.warm, k.op(.65, .7)))
		for i := 1; i < 170; i++ {
			rr := 10 * math.Sqrt(float64(i))
			if rr > 140 {
				break
			}
			a := float64(i) * 2.399963
			sb.WriteString(fmt.Sprintf("<circle cx='%.1f' cy='%.1f' r='%.1f' fill='%s' opacity='%s'/>", rr*math.Cos(a), rr*math.Sin(a), 2.2+rr/40, h.warm, k.op(.6, .7)))
		}
		sb.WriteString("</g>")
	}
	flower(1190, 650, 1.05, 24)
	flower(80, 110, .55, 16)
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMax slice", sb.String()),
		{image: k.blob(88, 90, 60, 50, k.accent, 30)},
		backdropGround(k),
	}
}
