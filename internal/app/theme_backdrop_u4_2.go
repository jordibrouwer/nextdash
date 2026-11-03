package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropUnraidAzure is a planet seen with its orbits: big thin tilted ellipses sweeping in
// from the lower right and the upper left, each carrying a few small lit nodes, over a soft azure glow.
func themeBackdropUnraidAzure(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='6'/></filter></defs>")
	orbit := func(cx, cy, rx, ry, rot float64, c string, w string, op string, dash string, seed int) {
		sb.WriteString(fmt.Sprintf("<g transform='rotate(%.0f %.0f %.0f)'>", rot, cx, cy))
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.0f' fill='none' stroke='%s' stroke-width='%s' opacity='%s' stroke-dasharray='%s'/>", cx, cy, rx, ry, c, w, op, dash))
		for i := 0; i < 3; i++ {
			a := float64(k.rnd(seed+i*5, 628)) / 100
			x, y := cx+rx*math.Cos(a), cy+ry*math.Sin(a)
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='9' fill='%s' opacity='%s' filter='url(#b)'/>", x, y, c, k.op(.7, .8)))
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='3.5' fill='%s' opacity='%s'/>", x, y, c, k.op(.8, .9)))
		}
		sb.WriteString("</g>")
	}
	for i := 0; i < 5; i++ {
		c := h.accent
		if i == 2 {
			c = h.cool
		}
		orbit(1300, 760, float64(380+i*170), float64(130+i*60), -20, c, "1.6", k.op(.5-float64(i)*.05, .55-float64(i)*.05), "none", 10+i*17)
	}
	orbit(1300, 760, 560, 200, -20, h.warm, "1.2", k.op(.4, .45), "3 12", 77)
	for i := 0; i < 3; i++ {
		orbit(80, 40, float64(260+i*150), float64(100+i*50), 28, h.accent, "1.3", k.op(.4, .45), "none", 31+i*13)
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(100, 100, 60, 60, k.accent, 44)},
		{image: k.blob(0, 0, 40, 40, k.cool, 28)},
		backdropGround(k),
	}
}

// themeBackdropUnraidBlack is a drive-bay vent in the dark: rows of rounded glowing slits that start
// at the left and right edges and thin out toward the quiet middle, mostly orange with a few green and amber.
func themeBackdropUnraidBlack(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cols := []string{h.accent, h.accent, h.accent, h.warm, h.cool}
	for j := 0; j < 16; j++ {
		y := 420 + j*24 + k.rnd(j, 6)
		for side := 0; side < 2; side++ {
			x := 0
			reach := 300 + k.rnd(j*3+side, 280)
			for n := 0; x < reach; n++ {
				l := 18 + k.rnd(j*100+side*50+n, 90)
				gap := 8 + k.rnd(j*77+side*31+n, 40)
				fade := 1 - float64(x)/float64(reach+60)
				c := cols[k.rnd(j*13+side*7+n, len(cols))]
				px := x
				if side == 1 {
					px = 1400 - x - l
				}
				sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='7' rx='3.5' fill='%s' opacity='%.2f'/>", px, y, l, c, fade*0.85))
				x += l + gap
			}
		}
	}
	body := "<defs><filter id='b' x='-5%' y='-20%' width='110%' height='140%'><feGaussianBlur stdDeviation='7'/></filter></defs><g filter='url(#b)' opacity='" + k.op(.75, .9) + "'>" + sb.String() + "</g><g opacity='" + k.op(.8, .85) + "'>" + sb.String() + "</g>"
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", body),
		{image: "linear-gradient(180deg, transparent 55%, " + k.veil(k.accent, 16) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropUnraidBlaze is a wall of flame along the bottom: soft tongues of red, amber and hot
// pale cores, tall at both edges and low in the middle, with a glow rising behind them.
func themeBackdropUnraidBlaze(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	tongue := func(x, w, ht, lean float64, c string, op string) {
		sb.WriteString(fmt.Sprintf("<path d='M%.0f 810C%.0f %.0f %.0f %.0f %.0f %.0f C%.0f %.0f %.0f %.0f %.0f 810Z' fill='%s' opacity='%s'/>",
			x-w, x-w, 810-ht*.35, x-w*.3, 810-ht*.62, x+lean, 810-ht,
			x+w*.15, 810-ht*.55, x+w, 810-ht*.3, x+w, c, op))
	}
	n := 22
	for i := 0; i < n; i++ {
		x := float64(i)*1400/float64(n-1) + float64(k.rnd(i, 40)) - 20
		e := math.Abs(x-700) / 700
		ht := 120 + 340*math.Pow(e, 1.6) + float64(k.rnd(i+50, 90))
		w := 60 + float64(k.rnd(i+9, 40))
		lean := float64(k.rnd(i+3, 70)) - 35
		tongue(x, w, ht, lean, h.accent, k.op(.4, .46))
		tongue(x, w*.62, ht*.68, lean*.6, h.warm, k.op(.45, .5))
		tongue(x, w*.3, ht*.38, lean*.3, "#fff1c9", k.op(.5, .55))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", "<defs><filter id='b' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='5'/></filter></defs><g filter='url(#b)'>"+sb.String()+"</g>"),
		{image: "linear-gradient(180deg, transparent 50%, " + k.veil(k.accent, 24) + " 100%)"},
		{image: k.blob(0, 100, 50, 50, k.second, 40)},
		{image: k.blob(100, 100, 50, 50, k.warm, 36)},
		backdropGround(k),
	}
}

// themeBackdropUnraidEmber is a bed of coals: irregular glowing patches of orange and hot yellow
// cut from noise, dense at the bottom edge and breaking up into separate embers as they rise.
func themeBackdropUnraidEmber(k backdropKit) []backdropLayer {
	h := k.hex
	patch := func(id string, seed int, thr string, c string, op string, blur string) string {
		return fmt.Sprintf("<filter id='%s' x='0' y='0' width='100%%' height='100%%'><feTurbulence type='fractalNoise' baseFrequency='.011 .02' numOctaves='3' seed='%d'/>"+
			"<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 7 0 0 0 %s' result='m'/><feComposite in='SourceGraphic' in2='m' operator='in' result='c'/><feGaussianBlur in='c' stdDeviation='%s'/></filter>", id, seed, thr, blur)
	}
	grad := func(id, c, from string) string {
		return "<linearGradient id='" + id + "' x1='0' y1='0' x2='0' y2='1'><stop offset='" + from + "' stop-color='" + c + "' stop-opacity='0'/><stop offset='1' stop-color='" + c + "' stop-opacity='1'/></linearGradient>"
	}
	defs := "<defs>" + patch("a", 4, "-3.1", h.accent, "", "1.5") + patch("b", 19, "-3.5", h.warm, "", "1.2") + grad("g", h.accent, ".25") + grad("w", h.warm, ".4") + "</defs>"
	body := defs +
		"<rect width='1400' height='800' fill='url(#g)' filter='url(#a)' opacity='" + k.op(.75, .85) + "'/>" +
		"<rect width='1400' height='800' fill='url(#w)' filter='url(#b)' opacity='" + k.op(.8, .9) + "'/>"
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", body),
		{image: "linear-gradient(180deg, transparent 60%, " + k.veil(k.second, 20) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropVampireCastle is a gothic hall: tall nested pointed arches rising from the left and
// right edges in violet line, the inner one lit blood red from behind, over heavy velvet shadow.
func themeBackdropVampireCastle(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='r' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='" + h.second + "' stop-opacity='.55'/><stop offset='1' stop-color='" + h.second + "' stop-opacity='0'/></linearGradient></defs>")
	arch := func(cx, w, ys float64, stroke string, sw string, fill string, op string) {
		x0, x1 := cx-w/2, cx+w/2
		sb.WriteString(fmt.Sprintf("<path d='M%.0f 820V%.0f A%.0f %.0f 0 0 1 %.0f %.0f A%.0f %.0f 0 0 1 %.0f %.0f V820' fill='%s' stroke='%s' stroke-width='%s' opacity='%s'/>",
			x0, ys, w, w, cx, ys-.866*w, w, w, x1, ys, fill, stroke, sw, op))
	}
	for _, a := range []struct {
		cx, ys float64
		lit    bool
	}{{90, 470, true}, {1320, 330, true}, {1000, 640, false}} {
		arch(a.cx, 440, a.ys, h.accent, "2", "none", k.op(.4, .45))
		arch(a.cx, 340, a.ys+14, h.accent, "1.4", "none", k.op(.45, .5))
		if a.lit {
			arch(a.cx, 250, a.ys+30, h.accent, "2.4", "url(#r)", k.op(.6, .65))
		} else {
			arch(a.cx, 250, a.ys+30, h.accent, "1.4", "none", k.op(.4, .45))
		}
		sb.WriteString(fmt.Sprintf("<path d='M%.0f 820V%.0f' stroke='%s' stroke-width='1.2' opacity='%s'/>", a.cx, a.ys-60, h.accent, k.op(.3, .35)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(8, 70, 36, 50, k.second, 36)},
		{image: k.blob(95, 40, 30, 50, k.second, 30)},
		{image: k.blob(50, 110, 80, 30, k.accent, 36)},
		backdropGround(k),
	}
}

// themeBackdropVelocityInk is ink flicked from a brush: two arcs of stretched droplets that start
// fat and round and shrink to specks along the throw, each throw beginning in a ragged splat.
func themeBackdropVelocityInk(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='s' x='-30%' y='-30%' width='160%' height='160%'><feTurbulence type='fractalNoise' baseFrequency='.03' numOctaves='3' seed='6'/><feDisplacementMap in='SourceGraphic' scale='34'/></filter></defs>")
	throw := func(x0, y0, cx, cy, x1, y1 float64, c string, op string, n int, big float64) {
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='%s' opacity='%s' filter='url(#s)'/>", x0, y0, big*1.2, c, op))
		for i := 1; i <= n; i++ {
			t := float64(i) / float64(n+1)
			t = t*t*.4 + t*.6
			x := (1-t)*(1-t)*x0 + 2*(1-t)*t*cx + t*t*x1
			y := (1-t)*(1-t)*y0 + 2*(1-t)*t*cy + t*t*y1
			dx := 2*(1-t)*(cx-x0) + 2*t*(x1-cx)
			dy := 2*(1-t)*(cy-y0) + 2*t*(y1-cy)
			ang := math.Atan2(dy, dx) * 180 / math.Pi
			r := big*math.Pow(1-t, 1.4) + 2
			jx, jy := float64(k.rnd(i*7+int(x0), 26))-13, float64(k.rnd(i*11+int(y0), 26))-13
			sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.1f' ry='%.1f' fill='%s' opacity='%s' transform='rotate(%.0f %.0f %.0f)'/>", x+jx, y+jy, r*1.9, r, c, op, ang, x+jx, y+jy))
		}
	}
	throw(-10, 790, 420, 640, 900, 120, h.accent, k.op(.5, .55), 22, 36)
	throw(1410, 30, 1100, 150, 700, 560, h.cool, k.op(.4, .45), 16, 24)
	throw(1100, 800, 1250, 700, 1420, 470, h.warm, k.op(.4, .45), 10, 16)
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(0, 100, 40, 40, k.accent, 36)},
		backdropGround(k),
	}
}

// themeBackdropVermilionSeal is a hanko chop: a big rough-edged square seal in vermilion with carved
// strokes and worn gaps, tilted into the lower right corner, and a small one at the top left.
func themeBackdropVermilionSeal(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='w' x='-10%' y='-10%' width='120%' height='120%'><feTurbulence type='fractalNoise' baseFrequency='.04' numOctaves='3' seed='3' result='t'/>" +
		"<feDisplacementMap in='SourceGraphic' in2='t' scale='12' result='d'/><feTurbulence type='fractalNoise' baseFrequency='.06 .05' numOctaves='2' seed='12' result='n'/>" +
		"<feColorMatrix in='n' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 7 0 0 0 -3.9' result='m'/><feComposite in='d' in2='m' operator='out'/></filter></defs>")
	seal := func(x, y, s, rot float64, op string) {
		u := s / 100
		g := h.ground
		sb.WriteString(fmt.Sprintf("<g transform='translate(%.0f %.0f) rotate(%.0f) scale(%.2f)' opacity='%s' filter='url(#w)'>", x, y, rot, u, op))
		sb.WriteString("<rect width='100' height='100' fill='" + h.accent + "'/>")
		sb.WriteString("<rect x='6' y='6' width='88' height='88' fill='none' stroke='" + g + "' stroke-width='3'/>")
		sb.WriteString("<g stroke='" + g + "' stroke-width='6' stroke-linecap='round' fill='none'>")
		sb.WriteString("<path d='M26 24H48M37 24V44M26 36H48'/><path d='M60 22V46M60 22H76M60 34H74'/>")
		sb.WriteString("<path d='M24 60H44M34 60V78M24 70H46'/><path d='M58 62L78 62M68 62V80M58 78L78 76'/>")
		sb.WriteString("</g></g>")
	}
	seal(1060, 470, 380, -9, k.op(.65, .7))
	seal(50, 50, 130, 7, k.op(.5, .55))
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(88, 92, 36, 44, k.accent, 40)},
		{image: "linear-gradient(180deg, transparent 70%, " + k.veil(k.accent, 14) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropVioletShades is sun through venetian blinds: slanted bands of gold light with
// soft edges, wide at the top left corner and fading out across the page, with a faint orange set
// from the opposite corner.
func themeBackdropVioletShades(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b'><feGaussianBlur stdDeviation='1.6'/></filter>" +
		"<linearGradient id='f' gradientUnits='userSpaceOnUse' x1='-300' y1='0' x2='1100' y2='0'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='.65'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></linearGradient>" +
		"<linearGradient id='o' gradientUnits='userSpaceOnUse' x1='1700' y1='0' x2='900' y2='0'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='.6'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='0'/></linearGradient></defs>")
	sb.WriteString("<g filter='url(#b)' transform='rotate(-24 700 400)'>")
	y := -60.0
	for i := 0; i < 11; i++ {
		t := 26 + float64(k.rnd(i, 26)) + float64(10-i)*3
		sb.WriteString(fmt.Sprintf("<rect x='-300' y='%.0f' width='1500' height='%.0f' fill='url(#f)' opacity='%s'/>", y, t, k.op(.85, .9)))
		y += t + 30 + float64(k.rnd(i+30, 24))
	}
	y = 380
	for i := 0; i < 8; i++ {
		t := 14 + float64(k.rnd(i+60, 16))
		sb.WriteString(fmt.Sprintf("<rect x='700' y='%.0f' width='1200' height='%.0f' fill='url(#o)' opacity='%s'/>", y, t, k.op(.7, .8)))
		y += t + 24 + float64(k.rnd(i+90, 18))
	}
	sb.WriteString("</g>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(0, 0, 50, 50, k.accent, 32)},
		{image: k.blob(100, 100, 50, 50, k.second, 26)},
		backdropGround(k),
	}
}

// themeBackdropVividHyper is a jump to hyperspace: hundreds of short coloured streaks radiating out
// from the centre in cyan, green, yellow and red, kept clear of the middle and longest at the edges.
func themeBackdropVividHyper(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cols := []string{h.accent, h.cool, h.warm, h.second, h.accent, h.cool}
	for i := 0; i < 110; i++ {
		a := float64(k.rnd(i*3, 62832)) / 10000
		r0 := 330 + float64(k.rnd(i*3+1, 420))
		l := 50 + float64(k.rnd(i*3+2, 300))
		c := cols[k.rnd(i+400, len(cols))]
		w := 1 + float64(k.rnd(i+500, 22))/10
		op := .3 + float64(k.rnd(i+600, 30))/100
		ca, sa := math.Cos(a), math.Sin(a)
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='%.1f' stroke-linecap='round' opacity='%.2f'/>",
			700+ca*r0*1.15, 400+sa*r0*.8, 700+ca*(r0+l)*1.15, 400+sa*(r0+l)*.8, c, w, op))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", "<g opacity='"+k.op(.9, .95)+"'>"+sb.String()+"</g>"),
		{image: k.blob(0, 50, 30, 80, k.second, 26)},
		{image: k.blob(100, 50, 30, 80, k.accent, 30)},
		backdropGround(k),
	}
}

// themeBackdropVolcanicAsh is an eruption on the right: a dark cone with thin rivers of lava
// running down its flank, a glowing crater, a smeared plume of ash leaning away to the upper left
// and flakes of ash falling across the page.
func themeBackdropVolcanicAsh(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='p' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='34'/></filter><filter id='l' x='-50%' y='-10%' width='200%' height='120%'><feGaussianBlur stdDeviation='5'/></filter></defs>")
	for i, c := range []struct{ x, y, rx, ry float64 }{{1110, 330, 90, 60}, {1000, 230, 140, 80}, {830, 150, 190, 90}, {600, 90, 240, 100}, {330, 70, 260, 90}} {
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.0f' fill='#8e8486' opacity='%s' filter='url(#p)'/>", c.x, c.y, c.rx, c.ry, k.op(.5-float64(i)*.04, .5-float64(i)*.05)))
	}
	sb.WriteString("<path d='M640 810L980 470L1075 400L1135 410L1215 480L1400 650V810Z' fill='" + h.accent + "' opacity='" + k.op(.28, .3) + "'/>")
	sb.WriteString("<path d='M640 810L980 470L1075 400L1135 410L1215 480L1400 650' fill='none' stroke='" + h.accent + "' stroke-width='2' opacity='" + k.op(.5, .55) + "'/>")
	rivers := strings.Builder{}
	for i := 0; i < 6; i++ {
		x, y := 1100.0+float64(k.rnd(i, 24))-12, 405.0
		d := fmt.Sprintf("M%.0f %.0f", x, y)
		dir := float64(i-2) * 38
		for s := 0; s < 7; s++ {
			x += dir/6 + float64(k.rnd(i*9+s, 36)) - 18
			y += 52 + float64(k.rnd(i*5+s, 24))
			d += fmt.Sprintf("L%.0f %.0f", x, y)
		}
		c := h.second
		if i%3 == 1 {
			c = h.warm
		}
		rivers.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' stroke-linecap='round' stroke-linejoin='round' opacity='.8'/>", d, c, 1.5+float64(k.rnd(i+3, 20))/10))
	}
	sb.WriteString("<g filter='url(#l)' opacity='" + k.op(.8, .9) + "'>" + rivers.String() + "</g><g opacity='" + k.op(.8, .85) + "'>" + rivers.String() + "</g>")
	sb.WriteString("<circle cx='1105' cy='402' r='46' fill='" + h.second + "' opacity='" + k.op(.6, .7) + "' filter='url(#p)'/><circle cx='1105' cy='404' r='8' fill='" + h.warm + "' opacity='.9' filter='url(#l)'/>")
	for i := 0; i < 70; i++ {
		x := float64(k.rnd(i*2, 1400))
		y := float64(k.rnd(i*2+1, 800))
		if k.rnd(i+900, 3) > 0 {
			x = 500 + float64(k.rnd(i*2+7, 900))
		}
		s := 2 + float64(k.rnd(i+300, 40))/10
		c := "#9c9294"
		if i%9 == 0 {
			c = h.second
		}
		sb.WriteString(fmt.Sprintf("<rect x='%.0f' y='%.0f' width='%.1f' height='%.1f' fill='%s' opacity='%s' transform='rotate(%d %.0f %.0f)'/>", x, y, s, s*.7, c, k.op(.55, .6), k.rnd(i+700, 180), x, y))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMax slice", sb.String()),
		{image: k.blob(86, 100, 40, 40, k.second, 34)},
		backdropGround(k),
	}
}
