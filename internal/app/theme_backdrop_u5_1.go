package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropLookTropic is a giant palm frond arching in from the top right corner, its leaflets
// alternately lacquer green and hot orange with a thin pink rib, and a smaller frond rising at the
// lower left, over a warm tropical glow.
func themeBackdropLookTropic(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='10'/></filter></defs>")
	frond := func(x0, y0, cx, cy, x1, y1 float64, maxLen, wid float64, n int, sd int, blur bool) {
		var g strings.Builder
		rib := fmt.Sprintf("M%.0f %.0f Q%.0f %.0f %.0f %.0f", x0, y0, cx, cy, x1, y1)
		for i := 1; i < n; i++ {
			t := float64(i) / float64(n)
			px := (1-t)*(1-t)*x0 + 2*(1-t)*t*cx + t*t*x1
			py := (1-t)*(1-t)*y0 + 2*(1-t)*t*cy + t*t*y1
			dx := 2*(1-t)*(cx-x0) + 2*t*(x1-cx)
			dy := 2*(1-t)*(cy-y0) + 2*t*(y1-cy)
			ang := math.Atan2(dy, dx) * 180 / math.Pi
			ln := maxLen * math.Sin(math.Pi*(0.12+0.88*t)) * (0.85 + float64(k.rnd(sd+i, 30))/100)
			col := h.cool
			if i%3 == 0 {
				col = h.accent
			} else if i%7 == 0 {
				col = h.warm
			}
			for _, side := range []float64{-1, 1} {
				a := ang + side*(62-18*t)
				g.WriteString(fmt.Sprintf("<path transform='translate(%.0f %.0f) rotate(%.1f)' d='M0 0Q%.0f %.0f %.0f 0Q%.0f %.0f 0 0Z' fill='%s' opacity='%s'/>",
					px, py, a, ln*.5, -wid, ln, ln*.5, wid, col, k.op(.5, .55)))
			}
		}
		if blur {
			sb.WriteString("<g filter='url(#b)'>" + g.String() + "</g>")
			return
		}
		sb.WriteString(g.String())
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='5' stroke-linecap='round' opacity='%s'/>", rib, h.second, k.op(.6, .7)))
	}
	frond(1460, -40, 1060, 60, 700, 520, 330, 62, 26, 11, true)
	frond(1460, -40, 1060, 60, 700, 520, 330, 62, 26, 11, false)
	frond(-60, 860, 120, 560, 420, 330, 230, 44, 18, 91, false)
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(88, 10, 60, 50, k.warm, 26)},
		{image: k.blob(8, 96, 55, 45, k.cool, 22)},
		backdropGround(k),
	}
}

// themeBackdropLookTwilight is the limb of a planet at dusk: a huge dark curve rising across the
// bottom of the page with a thin band of lit atmosphere along its rim, amber at the crown fading to
// violet, and a haze of fine dust above it.
func themeBackdropLookTwilight(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><radialGradient id='a' gradientUnits='userSpaceOnUse' cx='700' cy='1560' r='1180'>" +
		"<stop offset='.70' stop-color='" + h.second + "' stop-opacity='0'/>" +
		"<stop offset='.755' stop-color='" + h.accent + "' stop-opacity='" + k.op(.45, .5) + "'/>" +
		"<stop offset='.775' stop-color='" + h.warm + "' stop-opacity='" + k.op(.9, .95) + "'/>" +
		"<stop offset='.80' stop-color='" + h.second + "' stop-opacity='" + k.op(.5, .55) + "'/>" +
		"<stop offset='.9' stop-color='" + h.accent + "' stop-opacity='" + k.op(.16, .2) + "'/>" +
		"<stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></radialGradient>" +
		"<radialGradient id='p' gradientUnits='userSpaceOnUse' cx='700' cy='1560' r='900'><stop offset='.8' stop-color='" + h.ground + "' stop-opacity='.96'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='" + k.op(.3, .22) + "'/></radialGradient></defs>")
	sb.WriteString("<circle cx='700' cy='1560' r='1180' fill='url(#a)'/><circle cx='700' cy='1560' r='910' fill='url(#p)'/>")
	for i := 0; i < 70; i++ {
		x := k.rnd(i*3, 1400)
		y := 80 + k.rnd(i*3+1, 520)
		c := h.warm
		if i%3 == 0 {
			c = h.cool
		}
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, y, 0.8+float64(k.rnd(i, 14))/10, c, k.op(.35, .6)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(h.accent, 26) + " 0%, transparent 55%)"},
		backdropGround(k),
	}
}

// themeBackdropLookOrchid is one huge orchid bloom cropped by the right edge: broad glossy petals
// in magenta and pink with fine veins running up them, two narrow sepals below and a darker lip in
// the middle, over a soft glow of the same colour.
func themeBackdropLookOrchid(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='22'/></filter>" +
		"<linearGradient id='p' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='" + h.second + "' stop-opacity='" + k.op(.7, .75) + "'/><stop offset='.6' stop-color='" + h.accent + "' stop-opacity='" + k.op(.5, .55) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='" + k.op(.28, .32) + "'/></linearGradient>" +
		"<linearGradient id='s' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='" + h.cool + "' stop-opacity='" + k.op(.5, .5) + "'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='" + k.op(.3, .32) + "'/></linearGradient></defs>")
	cx, cy := 1180, 470
	petal := func(ang, ln, wd float64, fill string, veins bool) {
		body := fmt.Sprintf("M0 0C%.0f %.0f %.0f %.0f 0 %.0fC%.0f %.0f %.0f %.0f 0 0Z", -wd*.9, -ln*.12, -wd*1.2, -ln*.8, -ln, wd*1.2, -ln*.8, wd*.9, -ln*.12)
		sb.WriteString(fmt.Sprintf("<g transform='translate(%d %d) rotate(%.0f)'>", cx, cy, ang))
		sb.WriteString("<path d='" + body + "' fill='" + fill + "' filter='url(#b)' opacity='.8'/>")
		sb.WriteString("<path d='" + body + "' fill='" + fill + "'/>")
		if veins {
			for v := -4; v <= 4; v++ {
				f := float64(v) / 4
				sb.WriteString(fmt.Sprintf("<path d='M0 -%.0fQ%.0f %.0f %.0f %.0f' fill='none' stroke='%s' stroke-width='1.6' opacity='%s'/>", ln*.1, f*wd*.5, -ln*.5, f*wd*.7, -ln*.9, h.warm, k.op(.4, .45)))
			}
		}
		sb.WriteString("</g>")
	}
	petal(-150, 520, 130, "url(#s)", false)
	petal(150, 470, 120, "url(#s)", false)
	petal(0, 480, 120, "url(#s)", false)
	petal(-78, 560, 220, "url(#p)", true)
	petal(-262, 520, 210, "url(#p)", true)
	sb.WriteString(fmt.Sprintf("<g transform='translate(%d %d) rotate(180)'><path d='M0 0C-70 -40 -90 -190 0 -230C90 -190 70 -40 0 0Z' fill='%s' opacity='%s'/><path d='M0 -20C-24 -70 -20 -150 0 -190C20 -150 24 -70 0 -20Z' fill='%s' opacity='%s'/></g>", cx, cy, h.second, k.op(.8, .85), h.warm, k.op(.5, .6)))
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMid slice", sb.String()),
		{image: k.blob(80, 55, 60, 70, k.accent, 20)},
		backdropGround(k),
	}
}

// themeBackdropLookMintHaze is a contour map of soft hills in mint: wobbly closed rings around three
// summits, thin and bright near the tops and fading out, with drifts of cool haze lying between.
func themeBackdropLookMintHaze(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	ring := func(cx, cy, r float64, seed int) string {
		const n = 24
		pts := make([][2]float64, n)
		ph1 := float64(k.rnd(seed, 628)) / 100
		ph2 := float64(k.rnd(seed+1, 628)) / 100
		for i := 0; i < n; i++ {
			a := float64(i) / n * 2 * math.Pi
			rr := r * (1 + .16*math.Sin(2*a+ph1) + .09*math.Sin(3*a+ph2) + .05*math.Sin(5*a+ph1))
			pts[i] = [2]float64{cx + rr*math.Cos(a)*1.25, cy + rr*math.Sin(a)}
		}
		var d strings.Builder
		for i := 0; i < n; i++ {
			p0, p1 := pts[i], pts[(i+1)%n]
			mx, my := (p0[0]+p1[0])/2, (p0[1]+p1[1])/2
			if i == 0 {
				pm := pts[n-1]
				d.WriteString(fmt.Sprintf("M%.0f %.0f", (pm[0]+p0[0])/2, (pm[1]+p0[1])/2))
			}
			d.WriteString(fmt.Sprintf("Q%.0f %.0f %.0f %.0f", p0[0], p0[1], mx, my))
		}
		return d.String() + "Z"
	}
	type hill struct {
		x, y, r float64
		c       string
	}
	hills := []hill{{260, 560, 70, h.accent}, {1120, 250, 60, h.cool}, {760, 700, 50, h.accent}}
	for hi, hl := range hills {
		for i := 0; i < 11; i++ {
			a := .8 - float64(i)*.065
			if !k.dark {
				a *= .75
			}
			c := hl.c
			if i%4 == 3 {
				c = h.warm
			}
			sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' opacity='%.2f'/>", ring(hl.x, hl.y, hl.r+float64(i)*52, hi*40+i), c, 2.4-float64(i)*.12, a))
		}
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(20, 70, 60, 40, k.accent, 24)},
		{image: k.blob(85, 20, 55, 40, k.cool, 22)},
		{image: k.blob(55, 95, 50, 30, k.warm, 16)},
		backdropGround(k),
	}
}

// themeBackdropLookCobalt is a pleated fan of folded cobalt paper opening out from the lower right
// corner: long narrow triangles of different widths in deep blue and cyan with hard edges, a few
// edged in gold.
func themeBackdropLookCobalt(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	ox, oy := 1460.0, 860.0
	a := 180.0
	cols := []string{h.accent, h.cool, h.accent, h.second}
	for i := 0; i < 20; i++ {
		w := 3.5 + float64(k.rnd(i*2, 60))/10
		a0, a1 := a, a+w
		a += w
		r := 1900.0
		p := func(deg float64) (float64, float64) {
			return ox + r*math.Cos(deg*math.Pi/180), oy + r*math.Sin(deg*math.Pi/180)
		}
		x0, y0 := p(a0)
		x1, y1 := p(a1)
		c := cols[i%len(cols)]
		op := .16 + float64(k.rnd(i*2+1, 28))/100
		if !k.dark {
			op *= .75
		}
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0f L%.0f %.0f L%.0f %.0f Z' fill='%s' opacity='%.2f'/>", ox, oy, x0, y0, x1, y1, c, op))
		if i%5 == 2 {
			sb.WriteString(fmt.Sprintf("<line x1='%.0f' y1='%.0f' x2='%.0f' y2='%.0f' stroke='%s' stroke-width='2' opacity='%s'/>", ox, oy, x1, y1, h.warm, k.op(.7, .8)))
		}
		a += 1.2
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMax slice", sb.String()),
		{image: k.blob(92, 100, 55, 55, k.accent, 30)},
		{image: k.blob(10, 5, 50, 40, k.cool, 16)},
		backdropGround(k),
	}
}

// themeBackdropLookNorthern is a northern-lights curtain: hundreds of thin vertical rays standing
// on a wavering base line, green at the foot rising to cyan-white and a violet fringe at the top,
// each ray a different height so the upper edge is ragged.
func themeBackdropLookNorthern(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	grad := func(id, c1, c2 string) string {
		return "<linearGradient id='" + id + "' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='" + c1 + "' stop-opacity='" + k.op(.8, .9) + "'/><stop offset='.5' stop-color='" + c1 + "' stop-opacity='" + k.op(.35, .4) + "'/><stop offset='1' stop-color='" + c2 + "' stop-opacity='0'/></linearGradient>"
	}
	sb.WriteString("<defs><filter id='b' x='-5%' y='-5%' width='110%' height='110%'><feGaussianBlur stdDeviation='2.5'/></filter>" +
		grad("g0", h.accent, h.second) + grad("g1", h.cool, h.accent) + grad("g2", h.second, h.second) + "</defs>")
	curtain := func(off, sc float64, seed int, op string) {
		sb.WriteString("<g filter='url(#b)' opacity='" + op + "'>")
		for x := 0; x < 1420; x += 7 {
			fx := float64(x)
			base := 330 + off + 90*math.Sin(fx/210) + 45*math.Sin(fx/73+1)
			ht := sc * (170 + float64(k.rnd(seed+x, 220)) + 120*math.Sin(fx/310+2))
			if ht < 60 {
				ht = 60
			}
			g := "g0"
			if k.rnd(seed+x*3, 100) < 22 {
				g = "g1"
			} else if x > 900 && k.rnd(seed+x*5, 100) < 40 {
				g = "g2"
			}
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%.0f' width='%d' height='%.0f' fill='url(#%s)'/>", x, base-ht, 4+k.rnd(seed+x*7, 4), ht, g))
		}
		sb.WriteString("</g>")
	}
	curtain(120, .7, 500, "0.55")
	curtain(0, 1, 100, "0.9")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMin slice", sb.String()),
		{image: "linear-gradient(0deg, " + k.veil(h.accent, 24) + " 0%, transparent 40%)"},
		backdropGround(k),
	}
}

// themeBackdropLookPolar is a polar map: the rings and radiating meridians of a pole projection
// seen from the top right corner, alternate wedges lightly tinted like paper, with a dashed flight
// arc in warm sand and a bright marker at the pole.
func themeBackdropLookPolar(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cx, cy := 1230.0, -70.0
	const wedges = 28
	for i := 0; i < wedges; i++ {
		if i%2 == 1 {
			continue
		}
		a0 := float64(i) / wedges * 2 * math.Pi
		a1 := float64(i+1) / wedges * 2 * math.Pi
		r := 2200.0
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0f L%.0f %.0f A%.0f %.0f 0 0 1 %.0f %.0f Z' fill='%s' opacity='%s'/>",
			cx, cy, cx+r*math.Cos(a0), cy+r*math.Sin(a0), r, r, cx+r*math.Cos(a1), cy+r*math.Sin(a1), h.accent, k.op(.1, .09)))
	}
	for i := 0; i < wedges; i++ {
		a := float64(i) / wedges * 2 * math.Pi
		sb.WriteString(fmt.Sprintf("<line x1='%.0f' y1='%.0f' x2='%.0f' y2='%.0f' stroke='%s' stroke-width='1.2' opacity='%s'/>", cx, cy, cx+2200*math.Cos(a), cy+2200*math.Sin(a), h.accent, k.op(.5, .45)))
	}
	for i := 1; i <= 9; i++ {
		w := 1.2
		if i%3 == 0 {
			w = 2.4
		}
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%d' fill='none' stroke='%s' stroke-width='%.1f' opacity='%s'/>", cx, cy, i*165, h.cool, w, k.op(.55, .5)))
	}
	sb.WriteString("<path d='M-40 640Q420 330 960 220' fill='none' stroke='" + h.warm + "' stroke-width='3' stroke-dasharray='2 12' stroke-linecap='round' opacity='" + k.op(.9, .9) + "'/>")
	sb.WriteString("<circle cx='960' cy='220' r='9' fill='" + h.warm + "' opacity='.9'/><circle cx='960' cy='220' r='22' fill='none' stroke='" + h.warm + "' stroke-width='2' opacity='.6'/>")
	sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='16' fill='%s'/>", cx, cy, h.second))
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMin slice", sb.String()),
		{image: k.blob(90, 0, 60, 60, k.accent, 24)},
		{image: k.blob(5, 100, 50, 40, k.cool, 14)},
		backdropGround(k),
	}
}

// themeBackdropLookVerdant is a canopy seen from below: big pointed leaves hanging in from the top
// corners at three depths, the far ones soft and blurred, the near ones sharp with a pale midrib and
// veins, with sunlight glowing through the gaps.
func themeBackdropLookVerdant(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='14'/></filter></defs>")
	leaf := func(x, y, ang, ln, wd float64, c string, op string, veins bool) string {
		body := fmt.Sprintf("M0 0C%.0f %.0f %.0f %.0f 0 %.0fC%.0f %.0f %.0f %.0f 0 0Z", wd, -ln*.25, wd*.9, -ln*.7, -ln, -wd*.9, -ln*.7, -wd, -ln*.25)
		s := fmt.Sprintf("<g transform='translate(%.0f %.0f) rotate(%.0f)'><path d='%s' fill='%s' opacity='%s'/>", x, y, ang, body, c, op)
		if veins {
			s += fmt.Sprintf("<path d='M0 0L0 %.0f' stroke='%s' stroke-width='3' opacity='.6'/>", -ln, h.warm)
			for v := 1; v < 9; v++ {
				yy := -ln * float64(v) / 10
				s += fmt.Sprintf("<path d='M0 %.0fL%.0f %.0fM0 %.0fL%.0f %.0f' stroke='%s' stroke-width='1.4' opacity='.4'/>", yy, wd*.6, yy-ln*.1, yy, -wd*.6, yy-ln*.1, h.warm)
			}
		}
		return s + "</g>"
	}
	sb.WriteString("<g filter='url(#b)'>")
	sb.WriteString(leaf(120, -20, 160, 700, 150, h.cool, k.op(.4, .4), false))
	sb.WriteString(leaf(1300, -30, 200, 650, 150, h.cool, k.op(.4, .4), false))
	sb.WriteString(leaf(700, -60, 180, 380, 90, h.warm, k.op(.3, .32), false))
	sb.WriteString("</g>")
	sb.WriteString(leaf(-20, 120, 135, 560, 120, h.accent, k.op(.55, .6), true))
	sb.WriteString(leaf(60, -40, 168, 430, 85, h.cool, k.op(.55, .6), true))
	sb.WriteString(leaf(1430, 90, 225, 540, 115, h.accent, k.op(.55, .6), true))
	sb.WriteString(leaf(1330, -40, 192, 400, 80, h.second, k.op(.45, .5), true))
	sb.WriteString(leaf(1400, 880, 28, 330, 70, h.accent, k.op(.5, .55), true))
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMin slice", sb.String()),
		{image: k.blob(50, 0, 40, 40, k.warm, 26)},
		{image: k.blob(5, 100, 50, 40, k.cool, 18)},
		backdropGround(k),
	}
}
