package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropLookBerry is a heap of ripe berries: densely packed glossy drupelets of varied size
// crowding the bottom-right and top-left corners, each a lit sphere with a neon rim and a bright
// highlight, over a lime glow and a magenta stain.
func themeBackdropLookBerry(k backdropKit) []backdropLayer {
	h := k.hex
	seed := uint32(17)
	rnd := func() float64 {
		seed = seed*1664525 + 1013904223
		return float64(seed>>8) / float64(1<<24)
	}
	cols := []string{h.second, h.accent, h.cool, h.second, h.warm}
	var sb strings.Builder
	sb.WriteString("<defs>")
	for i, c := range cols {
		sb.WriteString(fmt.Sprintf("<radialGradient id='b%d' cx='.35' cy='.3' r='.8'><stop offset='0' stop-color='%s' stop-opacity='.95'/><stop offset='.55' stop-color='%s' stop-opacity='.7'/><stop offset='1' stop-color='%s' stop-opacity='.25'/></radialGradient>", i, c, c, c))
	}
	sb.WriteString("</defs>")
	heap := func(cx, cy, spread float64, n int) {
		for i := 0; i < n; i++ {
			a := rnd() * 2 * math.Pi
			d := math.Pow(rnd(), .7) * spread
			x, y := cx+d*math.Cos(a)*1.15, cy+d*math.Sin(a)
			r := 26 + rnd()*44 - d/spread*14
			if r < 14 {
				r = 14
			}
			i2 := int(rnd() * 5)
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='url(#b%d)' stroke='%s' stroke-width='1.6' stroke-opacity='.8' opacity='%s'/>", x, y, r, i2, cols[i2], k.op(.62, .72)))
			sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.1f' ry='%.1f' fill='#fff' opacity='%s' transform='rotate(-35 %.0f %.0f)'/>", x-r*.35, y-r*.4, r*.22, r*.12, k.op(.7, .6), x-r*.35, y-r*.4))
		}
	}
	heap(1260, 840, 360, 46)
	heap(90, 70, 250, 26)
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: k.blob(104, 108, 70, 60, k.second, 52)},
		{image: k.blob(0, 0, 60, 50, k.accent, 48)},
		backdropGround(k),
	}
}

// themeBackdropLookGoldenHour is the last hour of sun through a lens: a hot sun glow sitting on
// the left edge, one long anamorphic streak through it, and a chain of soft hexagonal bokeh
// drifting off along a diagonal towards the far corner.
func themeBackdropLookGoldenHour(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("<defs><linearGradient id='s' x1='0' x2='1'><stop offset='0' stop-color='%s' stop-opacity='0'/><stop offset='.12' stop-color='%s' stop-opacity='.9'/><stop offset='.3' stop-color='%s' stop-opacity='.35'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient><filter id='f' x='-20%%' y='-20%%' width='140%%' height='140%%'><feGaussianBlur stdDeviation='2.2'/></filter></defs>", h.warm, h.warm, h.accent, h.accent))
	sb.WriteString(fmt.Sprintf("<rect x='-40' y='296' width='1300' height='14' rx='7' fill='url(#s)' opacity='%s'/>", k.op(.8, .9)))
	sb.WriteString(fmt.Sprintf("<rect x='-40' y='302' width='760' height='3' fill='#fff' opacity='%s'/>", k.op(.5, .6)))
	type bk struct {
		t, r float64
		c    string
	}
	hex := func(x, y, r float64, c string, o float64) {
		var pts []string
		for i := 0; i < 6; i++ {
			a := float64(i)*math.Pi/3 + .3
			pts = append(pts, fmt.Sprintf("%.0f,%.0f", x+r*math.Cos(a), y+r*math.Sin(a)))
		}
		sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='%s' fill-opacity='%.2f' stroke='%s' stroke-opacity='%.2f' stroke-width='1.4' filter='url(#f)'/>", strings.Join(pts, " "), c, o*.6, c, o))
	}
	for _, b := range []bk{{.06, 26, h.warm}, {.16, 54, h.second}, {.27, 20, h.accent}, {.34, 38, h.warm}, {.5, 15, h.cool}, {.62, 44, h.accent}, {.74, 28, h.second}, {.86, 64, h.warm}, {.95, 34, h.accent}} {
		x := 100 + b.t*1000
		y := 300 + b.t*520 + math.Sin(b.t*17)*40
		d := math.Abs(b.t - .5)
		hex(x, y, b.r, b.c, (.35+d*.9)*1.0)
	}
	return []backdropLayer{
		svgScene(1200, 700, "xMidYMid slice", sb.String()),
		{image: k.blob(-4, 40, 60, 90, k.warm, 82)},
		{image: "linear-gradient(0deg, " + k.veil(k.hex.second, 34) + ", transparent 46%, " + k.veil(k.hex.accent, 30) + ")"},
		backdropGround(k),
	}
}

// themeBackdropLookNeonAlley is a back alley in perspective: two walls running to a vanishing
// point high in the page, each carrying slanted neon sign-bands that shrink as they recede, and a
// wet floor that smears their colours downward.
func themeBackdropLookNeonAlley(k backdropKit) []backdropLayer {
	h := k.hex
	vx, vy := 700.0, 330.0
	var sb strings.Builder
	sb.WriteString("<defs><filter id='g' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='3'/></filter><filter id='w' x='-30%' y='-5%' width='160%' height='140%'><feGaussianBlur stdDeviation='14 34'/></filter></defs>")
	// bands on a wall: t is depth 0..1 from the near edge; wall side s=-1 (left) or 1 (right).
	band := func(s float64, t0, t1, y0, y1 float64, c string) {
		// near edge x at 0 or 1400, far at the vanishing point
		xa := 700 + s*700*(1-t0)
		xb := 700 + s*700*(1-t1)
		ya0 := vy + (y0-vy)*(1-t0)
		yb0 := vy + (y0-vy)*(1-t1)
		ya1 := vy + (y1-vy)*(1-t0)
		yb1 := vy + (y1-vy)*(1-t1)
		pts := fmt.Sprintf("%.0f,%.0f %.0f,%.0f %.0f,%.0f %.0f,%.0f", xa, ya0, xb, yb0, xb, yb1, xa, ya1)
		sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='%s' opacity='%s' filter='url(#g)'/>", pts, c, k.op(.55, .7)))
		sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='none' stroke='%s' stroke-width='2' opacity='%s'/>", pts, c, k.op(.9, 1)))
		// reflection on the floor
		fx := (xa + xb) / 2
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.0f' fill='%s' opacity='%s' filter='url(#w)'/>", fx, 640+(1-(t0+t1)/2)*180, math.Abs(xb-xa)/2+10, 90+(1-t1)*90, c, k.op(.3, .4)))
	}
	band(-1, .0, .42, 120, 200, h.accent)
	band(1, .08, .5, 250, 300, h.cool)
	band(-1, .5, .78, 300, 350, h.warm)
	band(1, .55, .85, 160, 230, h.accent)
	band(-1, .15, .55, 520, 560, h.cool)
	band(1, .0, .3, 480, 540, h.second)
	// the wall lines and the floor edges
	for _, y := range []float64{0, 900} {
		for _, s := range []float64{-1, 1} {
			sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='1.4' opacity='%s'/>", 700+s*700, y, vx, vy, h.accent, k.op(.4, .5)))
		}
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: k.blob(50, 37, 20, 22, k.second, 60)},
		{image: "linear-gradient(0deg, " + k.veil(k.hex.accent, 36) + ", transparent 38%)"},
		backdropGround(k),
	}
}

// themeBackdropLookFilm is a strip of exposed 35 mm stock running down each side of the page: the
// dark rails with their sprocket holes, scratched hairlines and dust, an amber burn at the frame
// edge and a fine film grain over everything.
func themeBackdropLookFilm(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='n' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 -.12'/></filter></defs>")
	seed := uint32(5)
	rnd := func() float64 {
		seed = seed*1664525 + 1013904223
		return float64(seed>>8) / float64(1<<24)
	}
	rail := func(x0, w float64, c string) {
		sb.WriteString(fmt.Sprintf("<rect x='%.0f' y='0' width='%.0f' height='900' fill='%s' opacity='%s'/>", x0, w, c, k.op(.2, .3)))
		hx := x0 + w/2 - 11
		for y := 20.0; y < 900; y += 54 {
			sb.WriteString(fmt.Sprintf("<rect x='%.0f' y='%.0f' width='22' height='30' rx='6' fill='%s' opacity='%s'/>", hx, y, h.ground, k.op(.85, .9)))
		}
	}
	rail(20, 70, h.accent)
	rail(1310, 70, h.warm)
	// the exposed frame edges
	for _, x := range []float64{140, 1260} {
		sb.WriteString(fmt.Sprintf("<path d='M%.0f 0V900' stroke='%s' stroke-width='2' opacity='%s'/>", x, h.warm, k.op(.5, .6)))
	}
	// scratches and dust
	for i := 0; i < 14; i++ {
		x := rnd() * 1400
		y := rnd() * 900
		l := 80 + rnd()*400
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fq%.1f %.0f %.1f %.0f' stroke='%s' stroke-width='%.1f' opacity='%s' fill='none'/>", x, y, (rnd()-.5)*10, l/2, (rnd()-.5)*6, l, h.warm, .8+rnd(), k.op(.25, .35)))
	}
	for i := 0; i < 30; i++ {
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.1f' fill='%s' opacity='%s'/>", rnd()*1400, rnd()*900, .8+rnd()*2.4, h.warm, k.op(.35, .5)))
	}
	sb.WriteString(fmt.Sprintf("<rect width='1400' height='900' filter='url(#n)' opacity='%s'/>", k.op(.12, .1)))
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: k.blob(0, 50, 22, 90, k.warm, 70)},
		{image: k.blob(100, 30, 20, 80, k.accent, 60)},
		backdropGround(k),
	}
}

// themeBackdropLookDusk is the sky just after sunset, seen abstractly: stacked bands from an
// amber horizon through coral and violet to indigo, crossed by long thin clouds that are lit
// warm from below and cool on top.
func themeBackdropLookDusk(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-200%' width='140%' height='500%'><feGaussianBlur stdDeviation='6 2'/></filter></defs>")
	cloud := func(cx, cy, rx, ry float64, up, low string) {
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.1f' fill='%s' opacity='%s' filter='url(#b)'/>", cx, cy, rx, ry, up, k.op(.5, .6)))
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.1f' fill='%s' opacity='%s' filter='url(#b)'/>", cx+rx*.05, cy+ry*.9, rx*.92, ry*.55, low, k.op(.8, .9)))
	}
	cloud(300, 520, 360, 16, h.second, h.accent)
	cloud(1020, 600, 420, 22, h.cool, h.warm)
	cloud(700, 700, 560, 14, h.second, h.accent)
	cloud(1100, 400, 300, 10, h.cool, h.second)
	cloud(180, 770, 300, 12, h.second, h.warm)
	cloud(820, 150, 380, 9, h.cool, h.second)
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 112, 90, 40, k.warm, 84)},
		{image: "linear-gradient(0deg, " + k.veil(k.hex.accent, 56) + " 0%, " + k.veil(k.hex.second, 40) + " 34%, " + k.veil(k.hex.cool, 40) + " 70%, " + k.veil(k.hex.cool, 56) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropLookOpal is the play of colour in a precious opal: irregular, softly blurred
// patches of pale flash (aqua, mint, peach, rose) crowding the edges like harlequin facets, with
// a few fine fire lines running through them over a milky glow.
func themeBackdropLookOpal(k backdropKit) []backdropLayer {
	h := k.hex
	seed := uint32(23)
	rnd := func() float64 {
		seed = seed*1664525 + 1013904223
		return float64(seed>>8) / float64(1<<24)
	}
	cols := []string{h.accent, h.cool, h.warm, h.second, h.accent, h.second}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='o' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='7'/></filter></defs>")
	for i := 0; i < 40; i++ {
		// cells are placed near the frame, thinning to the middle
		a := rnd() * 2 * math.Pi
		d := .55 + rnd()*.6
		cx, cy := 700+math.Cos(a)*d*760, 450+math.Sin(a)*d*520
		n := 5 + int(rnd()*3)
		var pts []string
		for j := 0; j < n; j++ {
			b := float64(j)/float64(n)*2*math.Pi + rnd()*.5
			r := 50 + rnd()*110
			pts = append(pts, fmt.Sprintf("%.0f,%.0f", cx+r*math.Cos(b), cy+r*math.Sin(b)*.8))
		}
		c := cols[i%len(cols)]
		sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='%s' opacity='%s' filter='url(#o)'/>", strings.Join(pts, " "), c, k.op(.85, .8)))
		if i%3 == 0 {
			sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='none' stroke='%s' stroke-width='1.2' opacity='%s'/>", strings.Join(pts, " "), cols[(i+2)%len(cols)], k.op(.85, .8)))
		}
	}
	for i := 0; i < 5; i++ {
		y := 80 + rnd()*740
		sb.WriteString(fmt.Sprintf("<path d='M0 %.0fC400 %.0f 900 %.0f 1400 %.0f' fill='none' stroke='%s' stroke-width='1.1' opacity='%s'/>", y, y+rnd()*160-80, y+rnd()*160-80, y+rnd()*200-100, cols[i], k.op(.35, .35)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: k.blob(50, 50, 60, 60, k.ground, 40)},
		{image: k.blob(20, 20, 50, 50, k.accent, 60)},
		backdropGround(k),
	}
}

// themeBackdropLookHolo is holographic foil crumpled and held to the light: a field of sharp
// triangular facets, each filled with a rainbow gradient turned to its own angle, strongest at the
// corners, with a few four-point glints on the creases.
func themeBackdropLookHolo(k backdropKit) []backdropLayer {
	h := k.hex
	seed := uint32(31)
	rnd := func() float64 {
		seed = seed*1664525 + 1013904223
		return float64(seed>>8) / float64(1<<24)
	}
	const cols, rows = 8, 6
	cw, rh := 1400.0/cols, 900.0/rows
	type pt struct{ x, y float64 }
	var g [rows + 1][cols + 1]pt
	for r := 0; r <= rows; r++ {
		for c := 0; c <= cols; c++ {
			x, y := float64(c)*cw, float64(r)*rh
			if c > 0 && c < cols {
				x += (rnd() - .5) * cw * .7
			}
			if r > 0 && r < rows {
				y += (rnd() - .5) * rh * .7
			}
			g[r][c] = pt{x, y}
		}
	}
	pal := []string{h.accent, h.cool, h.warm, h.second}
	var sb strings.Builder
	sb.WriteString("<defs>")
	for i := 0; i < 8; i++ {
		a := rnd() * 6.28
		sb.WriteString(fmt.Sprintf("<linearGradient id='h%d' x1='%.2f' y1='%.2f' x2='%.2f' y2='%.2f'>", i, .5-.5*math.Cos(a), .5-.5*math.Sin(a), .5+.5*math.Cos(a), .5+.5*math.Sin(a)))
		for j := 0; j < 3; j++ {
			sb.WriteString(fmt.Sprintf("<stop offset='%.2f' stop-color='%s'/>", float64(j)/2, pal[(i+j)%4]))
		}
		sb.WriteString("</linearGradient>")
	}
	sb.WriteString("</defs>")
	n := 0
	tri := func(a, b, c pt) {
		mx, my := (a.x+b.x+c.x)/3, (a.y+b.y+c.y)/3
		d := math.Hypot((mx-700)/700, (my-450)/450)
		o := .1 + .5*math.Min(d, 1.1)*math.Min(d, 1.1)
		if !k.dark {
			o *= .8
		}
		sb.WriteString(fmt.Sprintf("<polygon points='%.0f,%.0f %.0f,%.0f %.0f,%.0f' fill='url(#h%d)' fill-opacity='%.2f' stroke='%s' stroke-opacity='%.2f' stroke-width='.8'/>", a.x, a.y, b.x, b.y, c.x, c.y, n%8, o, "#fff", o*.5))
		n += 3
	}
	for r := 0; r < rows; r++ {
		for c := 0; c < cols; c++ {
			a, b, cc, d := g[r][c], g[r][c+1], g[r+1][c+1], g[r+1][c]
			if (r+c)%2 == 0 {
				tri(a, b, cc)
				tri(a, cc, d)
			} else {
				tri(a, b, d)
				tri(b, cc, d)
			}
		}
	}
	for _, s := range []struct{ x, y, r float64 }{{150, 140, 34}, {1250, 190, 26}, {1120, 780, 40}, {260, 700, 22}, {980, 90, 16}} {
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fQ%.0f %.0f %.0f %.0fQ%.0f %.0f %.0f %.0fQ%.0f %.0f %.0f %.0fQ%.0f %.0f %.0f %.0fZ' fill='#fff' opacity='%s'/>",
			s.x, s.y-s.r, s.x, s.y, s.x+s.r, s.y, s.x, s.y, s.x, s.y+s.r, s.x, s.y, s.x-s.r, s.y, s.x, s.y, s.x, s.y-s.r, k.op(.9, .85)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: k.blob(100, 0, 50, 50, k.accent, 44)},
		{image: k.blob(0, 100, 50, 50, k.second, 44)},
		backdropGround(k),
	}
}
