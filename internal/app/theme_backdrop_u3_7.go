package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropPaperInk is ink spilled on paper: a few wet blots with ragged, bled edges and a
// darker coffee ring, and a fine spatter of drops around them.
func themeBackdropPaperInk(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='w' x='-40%' y='-40%' width='180%' height='180%'><feTurbulence type='fractalNoise' baseFrequency='.014' numOctaves='3' seed='7' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='110'/><feGaussianBlur stdDeviation='5'/></filter></defs>")
	sb.WriteString("<g filter='url(#w)'>")
	for i, b := range []struct {
		x, y, r int
		c       string
	}{{210, 640, 190, h.accent}, {1180, 560, 150, h.accent}, {760, 720, 110, h.accent}, {1260, 150, 70, h.warm}, {90, 330, 60, h.cool}} {
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%s'/>", b.x, b.y, b.r, b.c, k.op(.16, .14)))
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='none' stroke='%s' stroke-width='%d' opacity='%s'/>", b.x, b.y, b.r-6, b.c, 6+i%3*3, k.op(.3, .26)))
	}
	sb.WriteString("</g>")
	for i := 0; i < 70; i++ {
		x, y := k.rnd(i*3, 1400), 300+k.rnd(i*3+1, 500)
		r := 0.8 + float64(k.rnd(i*3+2, 40))/10
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, y, r, h.accent, k.op(.34, .3)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(80, 90, 60, 40, k.warm, 14)},
		backdropGround(k),
	}
}

// themeBackdropPastelMountain is hazy ridgelines in soft pastel, one behind the other and each
// paler than the one in front, under a low pale sun.
func themeBackdropPastelMountain(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs>")
	cols := []string{h.cool, h.second, h.warm, h.accent}
	for i, c := range cols {
		sb.WriteString(fmt.Sprintf("<linearGradient id='g%d' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%s' stop-opacity='%s'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient>", i, c, k.op(.3, .26), c))
	}
	sb.WriteString("<radialGradient id='s'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='" + k.op(.5, .5) + "'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<circle cx='1020' cy='420' r='260' fill='url(#s)'/>")
	for i := range cols {
		base := 470 + i*85
		amp := 200 - i*30
		y0 := base - k.rnd(i*40, amp)
		d := fmt.Sprintf("M0 800V%d", y0)
		px, py := 0, y0
		for x := 140; x <= 1540; x += 140 {
			y := base - k.rnd(i*40+x/140, amp)
			d += fmt.Sprintf("C%d %d %d %d %d %d", px+70, py, x-70, y, x, y)
			px, py = x, y
		}
		d += "V800Z"
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='url(#g%d)'/>", d, i))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 40%, " + k.veil(k.second, 14) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropPatinaVerdigris is copper left out in the weather: crusty blue-green blooms
// gathered towards the bottom corners, rust spots and a few thin streaks run down from them.
func themeBackdropPatinaVerdigris(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='c' x='-20%' y='-20%' width='140%' height='140%'><feTurbulence type='fractalNoise' baseFrequency='.02' numOctaves='3' seed='3' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='70'/><feGaussianBlur stdDeviation='9'/></filter>")
	sb.WriteString("<linearGradient id='r' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='" + k.op(.3, .26) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></linearGradient></defs>")
	for i := 0; i < 9; i++ {
		x := k.rnd(i*7, 1400)
		y := 380 + k.rnd(i*7+1, 300)
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='url(#r)'/>", x, y, 2+k.rnd(i*7+2, 4), 120+k.rnd(i*7+3, 220)))
	}
	sb.WriteString("<g filter='url(#c)'>")
	cs := []string{h.accent, h.cool, h.accent, h.cool, h.warm}
	for i := 0; i < 34; i++ {
		x := k.rnd(i*5, 1400)
		y := 800 - k.rnd(i*5+1, 800)*k.rnd(i*5+2, 100)/100
		if k.rnd(i*5+3, 3) == 0 {
			x = (x % 380) + (i%2)*1020
		}
		c := cs[k.rnd(i*5+4, len(cs))]
		o := k.op(.28, .24)
		if c == h.warm {
			o = k.op(.2, .16)
		}
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s'/>", x, y, 30+k.rnd(i*5, 70), 20+k.rnd(i*5+1, 50), c, o))
	}
	sb.WriteString("</g>")
	return []backdropLayer{svgScene(1400, 800, "xMidYMax slice", sb.String()), backdropGround(k)}
}

// themeBackdropPeacock is a train of peacock feathers fanning up from the bottom left and bottom
// right: fine barbs and nested eyes of teal, blue and gold.
func themeBackdropPeacock(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	feather := func(cx, cy int, sc, rot float64) {
		sb.WriteString(fmt.Sprintf("<g transform='translate(%d %d) rotate(%.0f) scale(%.2f)'>", cx, cy, rot, sc))
		for i := -24; i <= 24; i++ {
			a := float64(i) * 2.2 * math.Pi / 180
			l := 560 - math.Abs(float64(i))*5
			c := h.accent
			if i%3 == 0 {
				c = h.cool
			}
			sb.WriteString(fmt.Sprintf("<path d='M0 0Q%.0f %.0f %.0f %.0f' fill='none' stroke='%s' stroke-width='1.2' opacity='%s'/>", math.Sin(a)*l*.5, -l*.5, math.Sin(a)*l, -math.Cos(a)*l, c, k.op(.3, .26)))
		}
		for j, e := range []struct {
			rx, ry int
			c      string
			o      float64
		}{{120, 160, h.cool, .16}, {88, 122, h.accent, .24}, {58, 84, h.second, .2}, {34, 52, h.warm, .3}, {14, 24, h.ground, .6}} {
			_ = j
			sb.WriteString(fmt.Sprintf("<ellipse cx='0' cy='-170' rx='%d' ry='%d' fill='%s' opacity='%.2f'/>", e.rx, e.ry, e.c, e.o*map[bool]float64{true: 1, false: .8}[k.dark]))
		}
		sb.WriteString("</g>")
	}
	feather(150, 840, 1, 18)
	feather(1290, 860, .8, -22)
	feather(560, 900, .55, 4)
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(10, 100, 60, 40, k.cool, 24)},
		backdropGround(k),
	}
}

// themeBackdropPistachioCream is soft-serve: fat spiral ribbons of cream and pistachio, huge and
// cropped by the lower corners, with a scatter of crushed nut.
func themeBackdropPistachioCream(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b'><feGaussianBlur stdDeviation='6'/></filter></defs>")
	spiral := func(cx, cy int, r0, r1 float64, turns float64, w int, c string, o string) {
		var d strings.Builder
		n := int(turns * 40)
		for i := 0; i <= n; i++ {
			t := float64(i) / float64(n)
			a := t * turns * 2 * math.Pi
			r := r0 + (r1-r0)*t
			cmd := "L"
			if i == 0 {
				cmd = "M"
			}
			d.WriteString(fmt.Sprintf("%s%.1f %.1f", cmd, float64(cx)+math.Cos(a)*r, float64(cy)+math.Sin(a)*r*.7))
		}
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%d' stroke-linecap='round' opacity='%s' filter='url(#b)'/>", d.String(), c, w, o))
	}
	spiral(1150, 760, 20, 380, 3.4, 52, h.accent, k.op(.2, .16))
	spiral(1150, 760, 40, 400, 3.4, 12, h.cool, k.op(.3, .26))
	spiral(120, 700, 10, 260, 2.8, 44, h.cool, k.op(.18, .14))
	spiral(120, 700, 25, 270, 2.8, 10, h.warm, k.op(.3, .24))
	for i := 0; i < 36; i++ {
		x, y := k.rnd(i*3, 1400), 380+k.rnd(i*3+1, 420)
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s' transform='rotate(%d %d %d)'/>", x, y, 3+k.rnd(i, 4), 2, h.accent, k.op(.38, .34), k.rnd(i*3+2, 180), x, y))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(80, 100, 70, 40, k.warm, 14)},
		backdropGround(k),
	}
}

// themeBackdropPolarDawn is a sun just clearing a frozen horizon: a wide rose-gold glow, flat
// ice sheets in the distance and a shimmering column of reflection on the ice below.
func themeBackdropPolarDawn(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><radialGradient id='s'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='" + k.op(.6, .6) + "'/><stop offset='.4' stop-color='" + h.accent + "' stop-opacity='" + k.op(.2, .24) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<ellipse cx='700' cy='540' rx='700' ry='360' fill='url(#s)'/>")
	sb.WriteString("<path d='M700 540A84 84 0 0 1 784 540Z M616 540A84 84 0 0 1 700 540Z' fill='" + h.warm + "' opacity='" + k.op(.5, .6) + "'/>")
	sb.WriteString("<path d='M0 540L180 526L330 538L520 522L700 540L930 524L1120 536L1260 520L1400 538V560H0Z' fill='" + h.cool + "' opacity='" + k.op(.14, .18) + "'/>")
	for j := 0; j < 16; j++ {
		y := 566 + j*15
		w := 60 + j*22 + k.rnd(j, 60)
		x := 700 - w/2 + k.rnd(j+40, 40) - 20
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='3' rx='1.5' fill='%s' opacity='%.2f'/>", x, y, w, h.warm, (0.5-float64(j)*0.025)*map[bool]float64{true: 1, false: .8}[k.dark]))
	}
	for j := 0; j < 9; j++ {
		y := 560 + j*30
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='2' fill='%s' opacity='%s'/>", k.rnd(j*2, 400)-100, y, 400+k.rnd(j*2+1, 900), h.accent, k.op(.2, .16)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 30%, " + k.veil(k.accent, 16) + " 60%, " + k.veil(k.warm, 16) + " 70%, transparent 82%)"},
		backdropGround(k),
	}
}

// themeBackdropPolarNight is ice seen as a field of faceted plates: a jittered mesh of triangles
// in glacier colours, each facet a slightly different tone, quieter towards the top.
func themeBackdropPolarNight(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.accent, h.cool, h.second, h.accent, h.warm}
	const nx, ny = 9, 6
	pt := func(i, j int) (int, int) {
		x, y := i*175, j*160
		if i > 0 && i < nx {
			x += k.rnd(i*31+j*7, 90) - 45
		}
		if j > 0 && j < ny {
			y += k.rnd(i*13+j*17+5, 90) - 45
		}
		return x, y
	}
	var sb strings.Builder
	for j := 0; j < ny; j++ {
		for i := 0; i < nx; i++ {
			x0, y0 := pt(i, j)
			x1, y1 := pt(i+1, j)
			x2, y2 := pt(i, j+1)
			x3, y3 := pt(i+1, j+1)
			f := 0.45 + 0.55*float64(j)/float64(ny)
			tris := [2][6]int{{x0, y0, x1, y1, x2, y2}, {x1, y1, x3, y3, x2, y2}}
			for t, tr := range tris {
				s := i*53 + j*29 + t*11
				a := (0.08 + float64(k.rnd(s, 200))/1000) * f
				if !k.dark {
					a *= 1.2
				}
				c := cols[k.rnd(s+1, len(cols))]
				sb.WriteString(fmt.Sprintf("<path d='M%d %dL%d %dL%d %dZ' fill='%s' fill-opacity='%.3f' stroke='%s' stroke-opacity='%.2f' stroke-width='1'/>", tr[0], tr[1], tr[2], tr[3], tr[4], tr[5], c, a, h.accent, 0.42*f))
			}
		}
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(20, 100, 60, 40, k.accent, 32)},
		backdropGround(k),
	}
}

// themeBackdropPorcelainBlue is cobalt on white glaze: a handful of loaded brush strokes that
// swell and taper with dry-brush edges, and a few flicks of spatter.
func themeBackdropPorcelainBlue(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='d' x='-10%' y='-40%' width='120%' height='180%'><feTurbulence type='fractalNoise' baseFrequency='.01 .22' numOctaves='2' seed='5' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='18'/></filter></defs>")
	sb.WriteString("<g filter='url(#d)'>")
	for i, s := range []struct {
		x, y, l, w int
		a          float64
		c          string
		o          float64
	}{{-60, 700, 760, 54, -8, h.accent, .2}, {520, 770, 880, 70, -14, h.accent, .16}, {900, 520, 520, 36, 18, h.cool, .16}, {40, 470, 380, 28, 24, h.cool, .14}, {260, 760, 520, 18, -6, h.accent, .26}, {1000, 700, 360, 14, -20, h.accent, .24}} {
		_ = i
		l, w := float64(s.l), float64(s.w)
		sb.WriteString(fmt.Sprintf("<path d='M0 0C%.0f %.0f %.0f %.0f %.0f 0C%.0f %.0f %.0f %.0f 0 0Z' fill='%s' opacity='%.2f' transform='translate(%d %d) rotate(%.0f)'/>", l*.25, -w, l*.7, -w*1.1, l, l*.7, w*.4, l*.3, w*.3, s.c, s.o*map[bool]float64{true: 1, false: 1.3}[k.dark], s.x, s.y, s.a))
	}
	sb.WriteString("</g>")
	for i := 0; i < 22; i++ {
		x, y := 100+k.rnd(i*3, 1200), 520+k.rnd(i*3+1, 260)
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, y, 1+float64(k.rnd(i*3+2, 30))/10, h.accent, k.op(.4, .34)))
	}
	return []backdropLayer{svgScene(1400, 800, "xMidYMax slice", sb.String()), backdropGround(k)}
}

// themeBackdropPorcelain is glaze running down a vessel: a pale celadon veil that thickens
// towards a ragged lower edge, with fat drips that stopped just below it and a glossy highlight.
func themeBackdropPorcelain(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='0'/><stop offset='.5' stop-color='" + h.accent + "' stop-opacity='" + k.op(.1, .08) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='" + k.op(.24, .2) + "'/></linearGradient></defs>")
	edge := 580
	d := fmt.Sprintf("M0 0V%d", edge)
	x := 0
	for i := 0; x < 1400; i++ {
		nx := x + 90 + k.rnd(i*3, 120)
		w := 20 + k.rnd(i*3+1, 22)
		ln := 30 + k.rnd(i*3+2, 140)
		d += fmt.Sprintf("Q%d %d %d %d", x+(nx-x)/2, edge+k.rnd(i, 24)-12, nx, edge)
		d += fmt.Sprintf("V%d", edge-4)
		d += fmt.Sprintf("L%d %dV%dA%d %d 0 0 0 %d %dV%d", nx, edge, edge+ln, w/2, w/2, nx+w, edge+ln, edge)
		x = nx + w
	}
	d += "V0Z"
	sb.WriteString("<path d='" + d + "' fill='url(#g)'/>")
	sb.WriteString("<path d='M-40 420C300 330 700 300 1100 360' fill='none' stroke='" + h.accent + "' stroke-width='14' stroke-linecap='round' opacity='" + k.op(.1, .08) + "'/>")
	sb.WriteString("<path d='M120 470C400 400 700 380 980 420' fill='none' stroke='" + h.cool + "' stroke-width='3' stroke-linecap='round' opacity='" + k.op(.3, .26) + "'/>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 60%, " + k.veil(k.warm, 12) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropPrismVeil is white light meeting a glass prism: a thin beam enters from the left
// and fans out to the right as soft wedges of the theme's four colours.
func themeBackdropPrismVeil(k backdropKit) []backdropLayer {
	h := k.hex
	beam := "#ffffff"
	if !k.dark {
		beam = h.accent
	}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='f' x='-10%' y='-30%' width='120%' height='160%'><feGaussianBlur stdDeviation='16'/></filter>")
	for i, c := range []string{h.second, h.warm, h.cool, h.accent} {
		sb.WriteString(fmt.Sprintf("<linearGradient id='w%d' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='%s' stop-opacity='%s'/><stop offset='1' stop-color='%s' stop-opacity='%s'/></linearGradient>", i, c, k.op(.3, .34), c, k.op(.04, .05)))
	}
	sb.WriteString("</defs><g filter='url(#f)'>")
	for i := 0; i < 4; i++ {
		y := 330 + i*95
		sb.WriteString(fmt.Sprintf("<path d='M470 430L1400 %dL1400 %dZ' fill='url(#w%d)'/>", y, y+110, i))
	}
	sb.WriteString("</g>")
	sb.WriteString("<path d='M0 250L470 430' stroke='" + beam + "' stroke-width='2' opacity='" + k.op(.5, .5) + "'/>")
	sb.WriteString("<path d='M0 250L470 430' stroke='" + beam + "' stroke-width='14' opacity='" + k.op(.08, .1) + "' filter='url(#f)'/>")
	sb.WriteString("<path d='M410 520L470 400L530 520Z' fill='" + h.accent + "' fill-opacity='" + k.op(.08, .08) + "' stroke='" + beam + "' stroke-opacity='" + k.op(.5, .45) + "' stroke-width='1.5'/>")
	for i := 0; i < 4; i++ {
		y := 340 + i*95
		sb.WriteString(fmt.Sprintf("<path d='M500 430L1400 %d' stroke='%s' stroke-width='1' opacity='%s'/>", y+55, []string{h.second, h.warm, h.cool, h.accent}[i], k.op(.3, .3)))
	}
	return []backdropLayer{svgScene(1400, 800, "xMidYMid slice", sb.String()), backdropGround(k)}
}
