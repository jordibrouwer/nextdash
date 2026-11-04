package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropRaceLivery is a car's livery seen as a speed blur: a few long slanted stripes
// (one wide, a pinstripe, a thin accent) that rise from the bottom edge and fade out well before the middle.
func themeBackdropRaceLivery(k backdropKit) []backdropLayer {
	h := k.hex
	stripe := func(x, w, rise, skew int, fill string, op string) string {
		return fmt.Sprintf("<path d='M%d 700H%d L%d %d H%d Z' fill='url(#%s)' opacity='%s'/>", x, x+w, x+w+skew, 700-rise, x+skew, fill, op)
	}
	grad := func(id, c string) string {
		return fmt.Sprintf("<linearGradient id='%s' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='%s' stop-opacity='1'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient>", id, c, c)
	}
	var sb strings.Builder
	sb.WriteString("<defs>" + grad("a", h.accent) + grad("w", h.warm) + grad("c", h.cool) + grad("s", h.second) + "</defs>")
	sb.WriteString(stripe(120, 150, 430, 260, "a", k.op(.2, .26)))
	sb.WriteString(stripe(290, 14, 470, 270, "w", k.op(.3, .34)))
	sb.WriteString(stripe(322, 5, 470, 270, "a", k.op(.34, .4)))
	sb.WriteString(stripe(560, 60, 300, 200, "s", k.op(.12, .16)))
	sb.WriteString(stripe(650, 8, 340, 205, "w", k.op(.22, .26)))
	sb.WriteString(stripe(780, 90, 220, 150, "a", k.op(.1, .14)))
	sb.WriteString(stripe(-60, 40, 260, 180, "c", k.op(.08, .12)))
	return []backdropLayer{
		svgScene(1000, 700, "xMidYMax slice", sb.String()),
		{image: k.blob(30, 110, 70, 30, k.accent, 20)},
		backdropGround(k),
	}
}

// themeBackdropRainWindow is rain on a window pane: a few irregular drip trails, each ending in a
// bead of water, over soft out-of-focus lights behind the glass.
func themeBackdropRainWindow(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='14'/></filter></defs>")
	cols := []string{h.accent, h.warm, h.cool, h.second}
	for i := 0; i < 7; i++ {
		x := 60 + k.rnd(i*5+1, 880)
		y := 380 + k.rnd(i*5+2, 280)
		r := 22 + k.rnd(i*5+3, 34)
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%s' filter='url(#b)'/>", x, y, r, cols[i%4], k.op(.2, .22)))
	}
	for i := 0; i < 15; i++ {
		x := 30 + k.rnd(i*7+11, 940)
		top := k.rnd(i*7+12, 380)
		ln := 120 + k.rnd(i*7+13, 300)
		w1 := k.rnd(i*7+14, 24) - 12
		w2 := k.rnd(i*7+15, 20) - 10
		endY := top + ln
		sb.WriteString(fmt.Sprintf("<path d='M%d %d C%d %d %d %d %d %d' fill='none' stroke='%s' stroke-width='1.6' stroke-linecap='round' opacity='%s'/>", x, top, x+w1, top+ln/3, x+w2, top+2*ln/3, x+w1/2, endY, h.accent, k.op(.16, .2)))
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' fill-opacity='.08' stroke='%s' stroke-width='1.2' opacity='%s'/>", x+w1/2, endY, 4+k.rnd(i+3, 4), 6+k.rnd(i+4, 5), h.accent, h.accent, k.op(.5, .6)))
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='1.6' fill='#fff' opacity='.55'/>", x+w1/2-2, endY-3))
	}
	return []backdropLayer{
		svgScene(1000, 700, "xMidYMid slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(k.cool, 8) + " 0%, transparent 50%)"},
		backdropGround(k),
	}
}

// themeBackdropRetroCrt is the curve of a picture tube: horizontal scanlines that bow with the
// glass, a phosphor glow in the middle and a dark vignette in the corners.
func themeBackdropRetroCrt(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	for y := -40; y <= 760; y += 13 {
		bow := (y - 350) / 9
		sb.WriteString(fmt.Sprintf("<path d='M-20 %d Q500 %d 1020 %d' fill='none' stroke='%s' stroke-width='2' opacity='%s'/>", y, y+bow*2, y, h.accent, k.op(.11, .13)))
	}
	return []backdropLayer{
		{image: "radial-gradient(ellipse at 50% 50%, transparent 52%, " + k.veil(k.ground, 75) + " 100%)"},
		svgScene(1000, 700, "xMidYMid slice", sb.String()),
		{image: k.blob(50, 50, 80, 70, k.accent, 12)},
		backdropGround(k),
	}
}

// themeBackdropRetroCrtMk2 is an oscilloscope screen: a glowing lissajous trace and a slow sine
// across a faint dotted graticule.
func themeBackdropRetroCrtMk2(k backdropKit) []backdropLayer {
	h := k.hex
	var liss, sine strings.Builder
	for i := 0; i <= 360; i++ {
		t := float64(i) / 360 * 2 * math.Pi
		c := "L"
		if i == 0 {
			c = "M"
		}
		liss.WriteString(fmt.Sprintf("%s%.1f %.1f", c, 700+300*math.Sin(3*t+1.2), 380+220*math.Sin(2*t)))
	}
	for i := 0; i <= 120; i++ {
		x := float64(i) * 1000 / 120
		c := "L"
		if i == 0 {
			c = "M"
		}
		sine.WriteString(fmt.Sprintf("%s%.1f %.1f", c, x, 560+46*math.Sin(x/90)+12*math.Sin(x/23)))
	}
	grat := ""
	for i := 1; i < 10; i++ {
		grat += fmt.Sprintf("<path d='M%d 0V700M0 %d H1000' stroke='%s' stroke-width='1' stroke-dasharray='2 12' opacity='%s'/>", i*100, i*70, h.accent, k.op(.3, .3))
	}
	body := "<defs><filter id='g' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='5'/></filter></defs>" + grat +
		fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='5' filter='url(#g)' opacity='%s'/><path d='%s' fill='none' stroke='%s' stroke-width='1.6' opacity='%s'/>",
			liss.String(), h.accent, k.op(.3, .35), liss.String(), h.accent, k.op(.4, .5)) +
		fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='5' filter='url(#g)' opacity='%s'/><path d='%s' fill='none' stroke='%s' stroke-width='1.4' opacity='%s'/>",
			sine.String(), h.warm, k.op(.2, .25), sine.String(), h.warm, k.op(.3, .4))
	return []backdropLayer{
		svgScene(1000, 700, "xMidYMid slice", body),
		{image: "radial-gradient(ellipse at 50% 50%, transparent 55%, " + k.veil(k.ground, 70) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropRetroGroove is a seventies colour arc: concentric rings of amber, orange, red and
// green that swing out of the bottom-right corner and thin out toward the middle.
func themeBackdropRetroGroove(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.cool, h.accent, h.warm, h.second}
	var sb strings.Builder
	for i := 0; i < 8; i++ {
		r := 760 - i*78
		sb.WriteString(fmt.Sprintf("<circle cx='1000' cy='700' r='%d' fill='%s' opacity='%s'/>", r, cols[i%4], k.op(.14, .17)))
		sb.WriteString(fmt.Sprintf("<circle cx='1000' cy='700' r='%d' fill='%s' opacity='%s'/>", r-34, h.ground, k.op(.6, .7)))
	}
	return []backdropLayer{
		svgScene(1000, 700, "xMaxYMax slice", sb.String()),
		{image: "radial-gradient(circle at 100% 100%, transparent 25%, " + k.veil(k.ground, 40) + " 70%)"},
		backdropGround(k),
	}
}

// themeBackdropRhubarbTart is a bundle of rhubarb stalks: uneven vertical stripes of pink and red
// with fine fibres, rising from the bottom and fading away higher up.
func themeBackdropRhubarbTart(k backdropKit) []backdropLayer {
	h := k.hex
	grad := func(id, c string) string {
		return fmt.Sprintf("<linearGradient id='%s' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='%s' stop-opacity='.9'/><stop offset='.7' stop-color='%s' stop-opacity='.15'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient>", id, c, c, c)
	}
	var sb strings.Builder
	sb.WriteString("<defs>" + grad("a", h.accent) + grad("s", h.second) + grad("w", h.warm) + "</defs>")
	ids := []string{"a", "s", "a", "w"}
	x := -10
	for i := 0; x < 1000; i++ {
		w := 20 + k.rnd(i*3+1, 70)
		ht := 260 + k.rnd(i*3+2, 340)
		id := ids[k.rnd(i*3+3, 4)]
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='%d' fill='url(#%s)' opacity='%s'/>", x, 700-ht, w, ht+20, w/2, id, k.op(.2, .26)))
		for f := 1; f < 4; f++ {
			fx := x + f*w/4 + k.rnd(i*9+f, 4)
			sb.WriteString(fmt.Sprintf("<path d='M%d %dV700' stroke='%s' stroke-width='1' opacity='%s'/>", fx, 700-ht*3/4, h.warm, k.op(.14, .16)))
		}
		x += w + 6 + k.rnd(i*3+4, 30)
	}
	return []backdropLayer{
		svgScene(1000, 700, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 120, 90, 30, k.accent, 20)},
		backdropGround(k),
	}
}

// themeBackdropRosePine is a pine wood in mist: two ranks of slim conifers of different heights
// along the bottom edge, with a pale fog laid between them and a faint moon glow above.
func themeBackdropRosePine(k backdropKit) []backdropLayer {
	h := k.hex
	trees := func(seed, n, minH, maxH int, fill, alpha string) string {
		var sb strings.Builder
		for i := 0; i < n; i++ {
			x := 20 + k.rnd(seed+i*4, 960)
			ht := minH + k.rnd(seed+i*4+1, maxH-minH)
			w := 26 + ht/9 + k.rnd(seed+i*4+2, 10)
			top := 700 - ht
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='3' height='%d' fill='%s' opacity='%s'/>", x-1, top+ht/2, ht/2+10, fill, alpha))
			for t := 0; t < 4; t++ {
				ty := top + t*ht/7
				tw := w * (t + 2) / 5
				sb.WriteString(fmt.Sprintf("<path d='M%d %dL%d %dL%d %dQ%d %d %d %dZ' fill='%s' opacity='%s'/>", x, ty, x-tw, ty+ht/5, x, ty+ht/6, x, ty+ht/6, x+tw, ty+ht/5, fill, alpha))
			}
		}
		return sb.String()
	}
	return []backdropLayer{
		svgScene(1000, 700, "xMidYMax slice", trees(40, 11, 140, 300, h.accent, k.op(.34, .42))),
		{image: "linear-gradient(180deg, transparent 62%, " + k.veil(k.second, 14) + " 80%, transparent 92%)"},
		svgScene(1000, 700, "xMidYMax slice", trees(900, 9, 260, 480, h.accent, k.op(.2, .26))),
		{image: k.blob(78, 18, 24, 22, k.warm, 16)},
		backdropGround(k),
	}
}

// themeBackdropRoseTitanium is brushed metal: fine horizontal brush grain over broad, soft rose
// reflections that sweep out of a conic highlight below the page.
func themeBackdropRoseTitanium(k backdropKit) []backdropLayer {
	h := k.hex
	grain := func(w, seed int, fx string, c, a string) backdropLayer {
		body := fmt.Sprintf("<filter id='n' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='%s' numOctaves='2' seed='%d' stitchTiles='stitch'/>"+
			"<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 3 0 0 0 -1.35' result='m'/><feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='m' operator='in'/></filter>"+
			"<rect width='%d' height='%d' filter='url(#n)'/>", fx, seed, c, a, w, w)
		return svgTile(k, w, w, body)
	}
	return []backdropLayer{
		grain(300, 4, "0.004 0.7", h.accent, k.op(.5, .5)),
		grain(220, 9, "0.003 0.9", h.warm, k.op(.3, .35)),
		{image: "conic-gradient(from 195deg at 30% 135%, transparent 0deg, " + k.veil(k.accent, 16) + " 14deg, transparent 32deg, " + k.veil(k.warm, 10) + " 52deg, transparent 80deg)"},
		{image: "linear-gradient(105deg, transparent 20%, " + k.veil(k.accent, 8) + " 38%, transparent 46%, " + k.veil(k.accent, 6) + " 70%, transparent 78%)"},
		backdropGround(k),
	}
}

// themeBackdropRosewaterPane is stacked glass: three large slanted panes that overlap at the edges,
// each a faint rose tint with a bright edge where the light catches.
func themeBackdropRosewaterPane(k backdropKit) []backdropLayer {
	h := k.hex
	pane := func(pts, id string, a string) string {
		return fmt.Sprintf("<polygon points='%s' fill='url(#%s)' opacity='%s'/><polygon points='%s' fill='none' stroke='#fff' stroke-width='1.4' stroke-linejoin='round' opacity='%s'/>", pts, id, a, pts, k.op(.35, .22))
	}
	grad := func(id, c string) string {
		return fmt.Sprintf("<linearGradient id='%s' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%s' stop-opacity='.55'/><stop offset='1' stop-color='%s' stop-opacity='.05'/></linearGradient>", id, c, c)
	}
	body := "<defs>" + grad("a", h.accent) + grad("w", h.warm) + grad("s", h.second) + "</defs>" +
		pane("-40,260 330,120 420,700 -40,700", "a", k.op(.34, .4)) +
		pane("250,420 560,330 640,700 300,700", "w", k.op(.22, .3)) +
		pane("640,60 1040,20 1040,700 780,700", "s", k.op(.3, .36)) +
		pane("520,600 900,520 960,700 560,700", "a", k.op(.2, .26))
	return []backdropLayer{
		svgScene(1000, 700, "xMidYMax slice", body),
		{image: k.blob(80, 10, 50, 40, k.accent, 14)},
		backdropGround(k),
	}
}

// themeBackdropRoyalAmethyst is a geode cut open: wobbly agate rings in violet and rose around a
// crystal core, anchored in the bottom-left corner and fading out toward the middle.
func themeBackdropRoyalAmethyst(k backdropKit) []backdropLayer {
	h := k.hex
	ring := func(cx, cy, r float64, p float64) string {
		var sb strings.Builder
		const n = 72
		for i := 0; i < n; i++ {
			a := float64(i) / n * 2 * math.Pi
			rr := r * (1 + .07*math.Sin(3*a+p) + .04*math.Sin(5*a+p*1.7))
			c := "L"
			if i == 0 {
				c = "M"
			}
			sb.WriteString(fmt.Sprintf("%s%.1f %.1f", c, cx+rr*math.Cos(a), cy+rr*math.Sin(a)*.85))
		}
		sb.WriteString("Z")
		return sb.String()
	}
	cols := []string{h.accent, h.second, h.accent, h.warm}
	var sb strings.Builder
	cx, cy := 170.0, 590.0
	for i := 0; i < 11; i++ {
		r := 560 - float64(i)*48
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='%s' opacity='%s'/>", ring(cx, cy, r, float64(i)*.35), cols[i%4], k.op(.12, .15)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='#fff' stroke-width='1.2' opacity='%s'/>", ring(cx, cy, r, float64(i)*.35), k.op(.3, .2)))
	}
	for i := 0; i < 9; i++ {
		a := float64(i)/9*2*math.Pi + .3
		l := 40 + float64(k.rnd(i+5, 40))
		sb.WriteString(fmt.Sprintf("<polygon points='%.0f,%.0f %.0f,%.0f %.0f,%.0f' fill='%s' opacity='%s'/>",
			cx, cy, cx+l*math.Cos(a-.14), cy+l*math.Sin(a-.14), cx+l*1.3*math.Cos(a), cy+l*1.3*math.Sin(a), h.accent, k.op(.4, .45)))
	}
	return []backdropLayer{
		svgScene(1000, 700, "xMinYMax slice", sb.String()),
		{image: "radial-gradient(circle at 0% 100%, transparent 20%, " + k.veil(k.ground, 45) + " 75%)"},
		backdropGround(k),
	}
}
