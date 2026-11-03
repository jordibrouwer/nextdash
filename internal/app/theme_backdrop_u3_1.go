package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropGlacierMint is a frozen lake seen from above: hairline cracks that branch out from
// two impact points, each with a faint wider halo, under a cold mint glass tint.
func themeBackdropGlacierMint(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cnt := 0
	r := func() float64 { cnt++; return float64(k.rnd(cnt*7+3, 1000)) / 1000 }
	var crack func(x, y, a, l float64, d int)
	crack = func(x, y, a, l float64, d int) {
		if d > 4 || l < 14 {
			return
		}
		pd := fmt.Sprintf("M%.1f %.1f", x, y)
		for i := 0; i < 5; i++ {
			a += (r() - .5) * .8
			x += math.Cos(a) * l / 5
			y += math.Sin(a) * l / 5
			pd += fmt.Sprintf("L%.1f %.1f", x, y)
			if i >= 1 && r() < .4 {
				crack(x, y, a+(r()-.5)*2.2, l*.55, d+1)
			}
		}
		w := 2.4 - float64(d)*.4
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' stroke-opacity='.18' stroke-linecap='round'/>", pd, h.cool, w*4))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' stroke-opacity='.8' stroke-linecap='round' stroke-linejoin='round'/>", pd, h.accent, w))
	}
	for n := 0; n < 7; n++ {
		crack(840, 560, float64(n)*0.9+.3, 260+r()*120, 0)
	}
	for n := 0; n < 6; n++ {
		crack(150, 640, float64(n)*1.05+3.4, 220+r()*90, 0)
	}
	body := "<filter id='b'><feGaussianBlur stdDeviation='3'/></filter><g opacity='" + k.op(.5, .55) + "'>" + sb.String() + "</g>"
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 96) + " 0, transparent 55%)"},
		svgScene(1000, 700, "xMidYMax slice", body),
		{image: k.blob(84, 80, 40, 40, k.accent, 22)},
		{image: k.blob(14, 92, 40, 30, k.cool, 18)},
		backdropGround(k),
	}
}

// themeBackdropGlossAmberResin is the growth rings of a resin drop: wobbly closed rings spreading
// from a core in the lower right, with a few bubbles trapped near the middle of it.
func themeBackdropGlossAmberResin(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cx, cy := 790.0, 580.0
	rad := 50.0
	for i := 0; i < 14; i++ {
		rad += 36 + float64(k.rnd(i*5+1, 40))
		var pd strings.Builder
		for j := 0; j <= 72; j++ {
			t := float64(j) / 72 * 2 * math.Pi
			w := 1 + .05*math.Sin(3*t+float64(i)) + .035*math.Sin(5*t+float64(i)*1.7) + .02*math.Sin(9*t+float64(i)*.6)
			c := "L"
			if j == 0 {
				c = "M"
			}
			pd.WriteString(fmt.Sprintf("%s%.1f %.1f", c, cx+math.Cos(t)*rad*w*1.15, cy+math.Sin(t)*rad*w*.9))
		}
		col := h.accent
		if i%3 == 2 {
			col = h.warm
		}
		fill := "none"
		if i%2 == 0 {
			fill = h.warm
		}
		sb.WriteString(fmt.Sprintf("<path d='%sZ' fill='%s' fill-opacity='.05' stroke='%s' stroke-opacity='%.2f' stroke-width='%.1f'/>", pd.String(), fill, col, .7-float64(i)*.04, 2.2-float64(i)*.08))
	}
	for i := 0; i < 16; i++ {
		x := cx + float64(k.rnd(i*11+2, 420)) - 230
		y := cy + float64(k.rnd(i*13+5, 300)) - 190
		rr := 2 + float64(k.rnd(i*17+7, 90))/12
		sb.WriteString(fmt.Sprintf("<circle cx='%.1f' cy='%.1f' r='%.1f' fill='%s' fill-opacity='.18' stroke='%s' stroke-opacity='.7' stroke-width='1.2'/>", x, y, rr, h.warm, h.accent))
		sb.WriteString(fmt.Sprintf("<circle cx='%.1f' cy='%.1f' r='%.1f' fill='#fff' opacity='.55'/>", x-rr/3, y-rr/3, rr/4+.5))
	}
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 94) + " 0, transparent 60%)"},
		svgScene(1000, 700, "xMaxYMax slice", "<g opacity='"+k.op(.55, .7)+"'>"+sb.String()+"</g>"),
		{image: k.blob(79, 83, 46, 44, k.accent, 36)},
		backdropGround(k),
	}
}

// themeBackdropGlossAubergine is the sheen on a glossy fruit: two curved window reflections, one
// large crescent and one small, over a deep plum glow.
func themeBackdropGlossAubergine(k backdropKit) []backdropLayer {
	h := k.hex
	hl := h.accent
	if k.dark {
		hl = "#ffffff"
	}
	body := "<defs><linearGradient id='a' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + hl + "' stop-opacity='.85'/><stop offset='1' stop-color='" + hl + "' stop-opacity='0'/></linearGradient>" +
		"<linearGradient id='b' x1='1' y1='1' x2='0' y2='0'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='.5'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='0'/></linearGradient></defs>" +
		"<g opacity='" + k.op(.62, .5) + "'>" +
		"<path d='M70 560C40 300 200 90 470 40C250 140 160 330 190 560C150 600 90 600 70 560Z' fill='url(#a)'/>" +
		"<path d='M930 190C990 330 940 520 800 640C880 500 900 340 850 220C880 170 915 165 930 190Z' fill='url(#b)'/>" +
		"<path d='M110 575C85 330 215 135 440 70' fill='none' stroke='" + hl + "' stroke-opacity='.45' stroke-width='1.5' stroke-linecap='round'/></g>"
	return []backdropLayer{
		svgScene(1000, 700, "xMidYMid slice", body),
		{image: k.blob(50, 120, 110, 54, k.accent, 48)},
		{image: k.blob(10, 40, 50, 60, k.second, 12)},
		backdropGround(k),
	}
}

// themeBackdropGlossButterscotch is a caramel swirl: one thick spiral of toffee stirred into the
// background, with a thin bright highlight riding along its crest.
func themeBackdropGlossButterscotch(k backdropKit) []backdropLayer {
	h := k.hex
	var pd strings.Builder
	cx, cy := 720.0, 430.0
	for i := 0; i <= 260; i++ {
		t := float64(i) / 260 * 5.2 * math.Pi
		rr := 8 + t*30
		c := "L"
		if i == 0 {
			c = "M"
		}
		pd.WriteString(fmt.Sprintf("%s%.1f %.1f", c, cx+math.Cos(t)*rr*1.2, cy+math.Sin(t)*rr*.85))
	}
	p := pd.String()
	body := "<filter id='f' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='9'/></filter>" +
		"<g opacity='" + k.op(.6, .75) + "'>" +
		"<path d='" + p + "' fill='none' stroke='" + h.accent + "' stroke-opacity='.3' stroke-width='60' stroke-linecap='round' filter='url(#f)'/>" +
		"<path d='" + p + "' fill='none' stroke='" + h.warm + "' stroke-opacity='.14' stroke-width='26' stroke-linecap='round'/>" +
		"<path d='" + p + "' fill='none' stroke='#fff' stroke-opacity='.25' stroke-width='2.5' stroke-linecap='round' transform='translate(-9 -9)'/></g>"
	return []backdropLayer{
		{image: "radial-gradient(ellipse 50% 40% at 50% 48%, " + k.veil(k.ground, 70) + " 0, transparent 100%)"},
		svgScene(1000, 800, "xMidYMid slice", body),
		{image: k.blob(72, 54, 50, 50, k.warm, 24)},
		backdropGround(k),
	}
}

// themeBackdropGlossCandyLacquer is overlapping translucent discs of candy colour, big and few,
// pushed to the corners, each with a thin rim and a small bright glint.
func themeBackdropGlossCandyLacquer(k backdropKit) []backdropLayer {
	h := k.hex
	type d struct {
		x, y, r float64
		c       string
	}
	ds := []d{
		{110, 90, 170, h.accent}, {250, 40, 110, h.warm}, {60, 240, 90, h.cool},
		{900, 620, 200, h.accent}, {760, 690, 130, h.cool}, {960, 470, 90, h.warm},
		{520, 740, 100, h.second}, {930, 90, 70, h.second},
	}
	var sb strings.Builder
	for _, e := range ds {
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='%s' fill-opacity='.17'/>", e.x, e.y, e.r, e.c))
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-opacity='.55' stroke-width='2'/>", e.x, e.y, e.r, e.c))
		sb.WriteString(fmt.Sprintf("<path d='M%.1f %.1fA%.1f %.1f 0 0 1 %.1f %.1f' fill='none' stroke='#fff' stroke-opacity='%s' stroke-width='5' stroke-linecap='round'/>",
			e.x-e.r*.62, e.y-e.r*.5, e.r*.8, e.r*.8, e.x-e.r*.2, e.y-e.r*.78, k.op(.5, .35)))
	}
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 80) + " 0, transparent 40%)"},
		svgScene(1000, 760, "xMidYMid slice", "<g opacity='"+k.op(.8, .9)+"'>"+sb.String()+"</g>"),
		backdropGround(k),
	}
}

// themeBackdropGlossCinnabar is red lacquer and brush ink: two tapered, dry-edged brush strokes
// sweeping in from opposite corners, over a low ember glow.
func themeBackdropGlossCinnabar(k backdropKit) []backdropLayer {
	h := k.hex
	body := "<filter id='d' x='-10%' y='-10%' width='120%' height='120%'><feTurbulence type='fractalNoise' baseFrequency='.012 .09' numOctaves='3' seed='4' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='34'/></filter>" +
		"<g filter='url(#d)' opacity='" + k.op(.85, .92) + "'>" +
		"<path d='M-40 660C200 520 520 560 720 470C860 410 960 330 1040 220C960 370 860 500 700 560C500 640 200 700 -40 720Z' fill='" + h.accent + "' fill-opacity='.75'/>" +
		"<path d='M1040 -20C880 60 760 120 640 170C560 205 520 230 470 250C560 240 700 205 820 150C920 105 990 70 1040 60Z' fill='" + h.warm + "' fill-opacity='.65'/></g>"
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 60) + " 0, transparent 50%)"},
		svgScene(1000, 700, "xMidYMid slice", body),
		{image: k.blob(30, 110, 90, 40, k.accent, 36)},
		{image: k.blob(94, 6, 30, 30, k.warm, 16)},
		backdropGround(k),
	}
}

// themeBackdropGlossEmeraldEnamel is cloisonne: an irregular mesh of enamel cells in shades of
// green, held by thin gold wire, that fades out towards the top of the page.
func themeBackdropGlossEmeraldEnamel(k backdropKit) []backdropLayer {
	h := k.hex
	const cols, rows = 13, 9
	var pts [rows + 1][cols + 1][2]float64
	for j := 0; j <= rows; j++ {
		for i := 0; i <= cols; i++ {
			pts[j][i] = [2]float64{float64(i)*80 + float64(k.rnd(j*31+i*7+1, 50)) - 25, float64(j)*80 + float64(k.rnd(j*17+i*13+2, 50)) - 25}
		}
	}
	cs := []string{h.accent, h.accent, h.cool, h.warm}
	var sb strings.Builder
	for j := 0; j < rows; j++ {
		for i := 0; i < cols; i++ {
			a, b, c, d := pts[j][i], pts[j][i+1], pts[j+1][i+1], pts[j+1][i]
			op := (.04 + float64(k.rnd(j*29+i*3+9, 100))/100*.16) * (.25 + .75*float64(j)/rows)
			col := cs[k.rnd(j*41+i*5+4, len(cs))]
			sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0fL%.0f %.0fL%.0f %.0fZ' fill='%s' fill-opacity='%.3f' stroke='%s' stroke-opacity='.4' stroke-width='1.6' stroke-linejoin='round'/>",
				a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1], col, op, h.warm))
		}
	}
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 100) + " 0, " + k.veil(k.ground, 70) + " 35%, transparent 85%)"},
		svgScene(1040, 720, "xMidYMax slice", "<g opacity='"+k.op(.8, .95)+"'>"+sb.String()+"</g>"),
		{image: k.blob(50, 110, 90, 40, k.accent, 24)},
		backdropGround(k),
	}
}

// themeBackdropGlossJade is a carved jade bi disc cropped by the right edge: a thick ring with a
// hole, engraved rings and a scatter of grain dots, in a cloudy green glow.
func themeBackdropGlossJade(k backdropKit) []backdropLayer {
	h := k.hex
	cx, cy := 880.0, 500.0
	ring := func(r float64) string {
		return fmt.Sprintf("M%.1f %.1fA%.1f %.1f 0 1 0 %.1f %.1fA%.1f %.1f 0 1 0 %.1f %.1fZ", cx-r, cy, r, r, cx+r, cy, r, r, cx-r, cy)
	}
	var sb strings.Builder
	sb.WriteString("<defs><radialGradient id='j' cx='.4' cy='.35' r='.8'><stop offset='0' stop-color='" + h.cool + "' stop-opacity='.5'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='.2'/></radialGradient><filter id='c'><feGaussianBlur stdDeviation='14'/></filter></defs>")
	sb.WriteString("<path d='" + ring(330) + ring(95) + "' fill-rule='evenodd' fill='url(#j)'/>")
	sb.WriteString("<circle cx='" + fmt.Sprint(cx-90) + "' cy='" + fmt.Sprint(cy-120) + "' r='70' fill='" + h.warm + "' fill-opacity='.15' filter='url(#c)'/>")
	for _, r := range []float64{330, 95, 118, 305} {
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-opacity='.6' stroke-width='2'/>", cx, cy, r, h.accent))
	}
	for _, r := range []float64{150, 245} {
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-opacity='.25' stroke-width='1' stroke-dasharray='1 7'/>", cx, cy, r, h.cool))
	}
	for i := 0; i < 34; i++ {
		t := float64(k.rnd(i*19+3, 6283)) / 1000
		r := 130 + float64(k.rnd(i*23+1, 170))
		sb.WriteString(fmt.Sprintf("<circle cx='%.1f' cy='%.1f' r='%.1f' fill='%s' fill-opacity='.55'/>", cx+math.Cos(t)*r, cy+math.Sin(t)*r, 1.2+float64(k.rnd(i*7+5, 20))/10, h.cool))
	}
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 90) + " 0, transparent 50%)"},
		svgScene(1000, 760, "xMaxYMid slice", "<g opacity='"+k.op(.5, .65)+"'>"+sb.String()+"</g>"),
		{image: k.blob(86, 66, 50, 50, k.accent, 22)},
		backdropGround(k),
	}
}

// themeBackdropGlossLiquidChrome is mercury: a few merging droplets of polished metal, running
// together where they touch, in the bottom left and on the right edge.
func themeBackdropGlossLiquidChrome(k backdropKit) []backdropLayer {
	h := k.hex
	type c struct{ x, y, r float64 }
	cs := []c{
		{90, 600, 120}, {230, 650, 80}, {350, 700, 60}, {40, 450, 55}, {170, 520, 36}, {420, 610, 18},
		{960, 330, 90}, {900, 460, 55}, {990, 520, 40}, {820, 540, 16},
	}
	var sb strings.Builder
	for _, e := range cs {
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f'/>", e.x, e.y, e.r))
	}
	hl := "#ffffff"
	body := "<defs><linearGradient id='m' gradientUnits='userSpaceOnUse' x1='0' y1='350' x2='1000' y2='750'><stop offset='0' stop-color='" + h.accent + "'/><stop offset='.28' stop-color='" + hl + "'/><stop offset='.5' stop-color='" + h.cool + "'/><stop offset='.72' stop-color='" + h.accent + "'/><stop offset='1' stop-color='" + h.second + "'/></linearGradient>" +
		"<filter id='g' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='13'/><feColorMatrix values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 24 -10'/></filter></defs>" +
		"<g fill='url(#m)' filter='url(#g)' opacity='" + k.op(.4, .3) + "'>" + sb.String() + "</g>"
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 80) + " 0, transparent 45%)"},
		svgScene(1000, 750, "xMidYMax slice", body),
		{image: k.blob(10, 100, 50, 30, k.accent, 20)},
		backdropGround(k),
	}
}

// themeBackdropGlossNeonTide is two families of thin neon sine lines at slightly different
// frequencies, which beat against each other into a moire of slow tides along the bottom.
func themeBackdropGlossNeonTide(k backdropKit) []backdropLayer {
	h := k.hex
	family := func(n int, f, ph float64) string {
		var sb strings.Builder
		for i := 0; i < n; i++ {
			t := float64(i) / float64(n-1)
			base := 330 + t*t*400
			amp := 10 + t*60
			var pd strings.Builder
			for j := 0; j <= 50; j++ {
				x := float64(j) * 20
				y := base + amp*math.Sin(x*f+ph+float64(i)*.28)
				c := "L"
				if j == 0 {
					c = "M"
				}
				pd.WriteString(fmt.Sprintf("%s%.0f %.0f", c, x, y))
			}
			sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke-opacity='%.2f' stroke-width='1.3'/>", pd.String(), .25+t*.55))
		}
		return sb.String()
	}
	body := "<filter id='g' x='-5%' y='-5%' width='110%' height='110%'><feGaussianBlur stdDeviation='4'/></filter>" +
		"<g opacity='" + k.op(.55, .6) + "'>" +
		"<g stroke='" + h.accent + "' filter='url(#g)'>" + family(24, .0062, 0) + "</g>" +
		"<g stroke='" + h.accent + "'>" + family(24, .0062, 0) + "</g>" +
		"<g stroke='" + h.second + "' stroke-opacity='.8'>" + family(24, .0071, 1.4) + "</g></g>"
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 85) + " 0, transparent 40%)"},
		svgScene(1000, 760, "xMidYMax slice", body),
		{image: k.blob(50, 112, 110, 36, k.accent, 22)},
		backdropGround(k),
	}
}
