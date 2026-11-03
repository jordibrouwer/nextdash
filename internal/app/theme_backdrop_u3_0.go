package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropEmberAsh is a dying fire seen as drift: sparks of orange rising from the bottom edge,
// dense low and thinning out as they climb, with a few grey flakes of ash and a glow along the floor.
func themeBackdropEmberAsh(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cols := []string{h.warm, h.accent, h.second, h.warm}
	for i := 0; i < 180; i++ {
		u := float64(k.rnd(i*7+1, 1000)) / 1000
		y := 700 - 690*u*u
		x := float64(k.rnd(i*7+2, 900))
		r := 0.8 + float64(k.rnd(i*7+3, 18))/10
		a := 1 - u*0.65
		c := cols[k.rnd(i*7+4, len(cols))]
		if k.rnd(i*7+5, 3) == 0 {
			sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fq%d %d %d %d' stroke='%s' stroke-width='%.1f' stroke-linecap='round' fill='none' opacity='%.2f'/>",
				x, y, 4+k.rnd(i, 6), 14+k.rnd(i+1, 16), k.rnd(i+2, 12)-6, 30+k.rnd(i+3, 30), c, r*0.7, a*0.35))
		}
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.1f' fill='%s' opacity='%.2f'/>", x, y, r*3, c, a*0.24))
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.1f' fill='%s' opacity='%.2f'/>", x, y, r, c, a))
	}
	var ash strings.Builder
	for i := 0; i < 26; i++ {
		x := k.rnd(i*11+1, 900)
		y := 120 + k.rnd(i*11+2, 560)
		ash.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='2' rx='1' fill='%s' opacity='%s' transform='rotate(%d %d %d)'/>",
			x, y, 5+k.rnd(i*11+3, 9), h.accent, k.op(.16, .2), k.rnd(i*11+4, 180), x, y))
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMax slice", sb.String()),
		svgScene(900, 700, "xMidYMax slice", ash.String()),
		{image: k.blob(50, 112, 100, 40, k.warm, 60)},
		{image: k.blob(30, 110, 60, 26, k.second, 44)},
		backdropGround(k),
	}
}

// themeBackdropEmeraldMatrix is data falling as light: thin vertical streaks of green, each fading
// upward from a bright head, at irregular columns and lengths.
func themeBackdropEmeraldMatrix(k backdropKit) []backdropLayer {
	h := k.hex
	build := func(seed, n int, wMax int, a float64) string {
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%s' stop-opacity='0'/><stop offset='1' stop-color='%s' stop-opacity='1'/></linearGradient></defs>", h.accent, h.accent))
		for i := 0; i < n; i++ {
			x := k.rnd(seed+i*5, 900)
			ln := 70 + k.rnd(seed+i*5+1, 280)
			head := 140 + k.rnd(seed+i*5+2, 540)
			w := 1 + k.rnd(seed+i*5+3, wMax)
			op := a * (0.4 + float64(k.rnd(seed+i*5+4, 60))/100)
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='url(#g)' opacity='%.2f'/>", x, head-ln, w, ln, op))
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='%s' opacity='%.2f'/>", x, head, w, 4+k.rnd(seed+i, 6), h.cool, math.Min(1, op*1.3)))
		}
		return sb.String()
	}
	dk := .5
	if !k.dark {
		dk = .42
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMax slice", build(3, 60, 3, dk*1.5)),
		svgScene(900, 700, "xMidYMax slice", build(901, 40, 2, dk*1.0)),
		{image: k.blob(50, 112, 100, 40, k.accent, 40)},
		backdropGround(k),
	}
}

// themeBackdropForestEverglade is a wetland at first light: slow bands of mist lying over the water
// and a few long reeds bending in from the bottom edge.
func themeBackdropForestEverglade(k backdropKit) []backdropLayer {
	h := k.hex
	mist := fmt.Sprintf("<defs><filter id='b' x='-30%%' y='-80%%' width='160%%' height='260%%'><feGaussianBlur stdDeviation='34'/></filter></defs><g filter='url(#b)'>"+
		"<ellipse cx='300' cy='430' rx='420' ry='34' fill='%s' opacity='%s'/>"+
		"<ellipse cx='640' cy='520' rx='460' ry='42' fill='%s' opacity='%s'/>"+
		"<ellipse cx='260' cy='610' rx='480' ry='50' fill='%s' opacity='%s'/>"+
		"<ellipse cx='700' cy='320' rx='300' ry='24' fill='%s' opacity='%s'/></g>",
		h.accent, k.op(.2, .2), h.cool, k.op(.18, .2), h.accent, k.op(.24, .26), h.warm, k.op(.1, .1))
	var reeds strings.Builder
	for i := 0; i < 46; i++ {
		x := k.rnd(i*9+1, 900)
		ht := 90 + k.rnd(i*9+2, 260)
		bend := k.rnd(i*9+3, 90) - 45
		c := h.cool
		if i%3 == 0 {
			c = h.accent
		}
		reeds.WriteString(fmt.Sprintf("<path d='M%d 700Q%d %d %d %d' stroke='%s' stroke-width='%.1f' stroke-linecap='round' fill='none' opacity='%s'/>",
			x, x+bend/3, 700-ht*2/3, x+bend, 700-ht, c, 1+float64(k.rnd(i*9+4, 14))/10, k.op(.34, .4)))
		if i%5 == 0 {
			reeds.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='3' ry='11' fill='%s' opacity='%s' transform='rotate(%d %d %d)'/>",
				x+bend, 700-ht-8, h.warm, k.op(.3, .36), bend/3, x+bend, 700-ht))
		}
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMax slice", reeds.String()),
		svgScene(900, 700, "xMidYMax slice", mist),
		backdropGround(k),
	}
}

// themeBackdropForestMoss is sunlight through a canopy: a few soft shafts of light slanting down
// from the top right, dust floating in them, and low green pools of moss along the floor.
func themeBackdropForestMoss(k backdropKit) []backdropLayer {
	h := k.hex
	var rays strings.Builder
	rays.WriteString(fmt.Sprintf("<defs><linearGradient id='r' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%s' stop-opacity='%s'/><stop offset='.6' stop-color='%s' stop-opacity='%s'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient>"+
		"<filter id='b' x='-30%%' y='-10%%' width='160%%' height='120%%'><feGaussianBlur stdDeviation='14'/></filter></defs><g filter='url(#b)'>", h.warm, k.op(.4, .46), h.accent, k.op(.16, .18), h.accent))
	for i, x0 := range []int{300, 420, 480, 600, 720, 830, 940, 1040} {
		w := 30 + k.rnd(i*3+1, 50)
		rays.WriteString(fmt.Sprintf("<polygon points='%d,-20 %d,-20 %d,760 %d,760' fill='url(#r)' opacity='%.2f'/>", x0, x0+w, x0+w-380, x0-380-k.rnd(i, 60), 0.6+float64(k.rnd(i*3+2, 40))/100))
	}
	rays.WriteString("</g>")
	var dust strings.Builder
	for i := 0; i < 70; i++ {
		y := k.rnd(i*5+1, 560)
		x := 760 - y*55/100 + k.rnd(i*5+2, 260) - 130
		dust.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, y, 0.8+float64(k.rnd(i*5+3, 14))/10, h.warm, k.op(.55, .7)))
	}
	return []backdropLayer{
		svgScene(900, 700, "xMaxYMin slice", dust.String()),
		svgScene(900, 700, "xMaxYMin slice", rays.String()),
		{image: k.blob(24, 112, 60, 26, k.cool, 34)},
		{image: k.blob(80, 108, 70, 22, k.accent, 30)},
		backdropGround(k),
	}
}

// themeBackdropForgedTitanium is heat-tinted metal: wide, oblique bands of anodised colour, violet
// into teal into gold, blurred at the edges and crossed by fine brushing lines.
func themeBackdropForgedTitanium(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.accent, h.cool, h.warm, h.second, h.accent}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-20%' y='-20%' width='140%' height='140%'><feGaussianBlur stdDeviation='22'/></filter></defs><g filter='url(#b)' transform='rotate(-26 450 350)'>")
	x := -300
	for i := 0; i < 9; i++ {
		w := 50 + k.rnd(i*3+1, 130)
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='-500' width='%d' height='1700' fill='%s' opacity='%s'/>", x, w, cols[i%len(cols)], k.op(.11, .15)))
		x += w + 20 + k.rnd(i*3+2, 90)
	}
	sb.WriteString("</g>")
	var fine strings.Builder
	fine.WriteString("<g transform='rotate(-26 450 350)'>")
	for i := 0; i < 46; i++ {
		fine.WriteString(fmt.Sprintf("<rect x='-400' y='%d' width='1700' height='1' fill='%s' opacity='%s'/>", -300+i*21+k.rnd(i, 14), h.accent, k.op(.08, .11)))
	}
	fine.WriteString("</g>")
	return []backdropLayer{
		svgScene(900, 700, "xMidYMid slice", fine.String()),
		svgScene(900, 700, "xMidYMid slice", sb.String()),
		{image: k.blob(50, 112, 100, 28, k.accent, 22)},
		backdropGround(k),
	}
}

// themeBackdropFoundryIron is a casting going cold: jagged cracks of molten orange rising from the
// bottom edge, each with a soft glow, heavy at the floor and fading to nothing before mid-page.
func themeBackdropFoundryIron(k backdropKit) []backdropLayer {
	h := k.hex
	var paths []string
	crack := func(seed, x0, y0, steps int, dir float64) {
		var d strings.Builder
		d.WriteString(fmt.Sprintf("M%d %d", x0, y0))
		x, y := float64(x0), float64(y0)
		for s := 0; s < steps; s++ {
			x += float64(k.rnd(seed+s*3, 56)-28) + dir*8
			y -= 22 + float64(k.rnd(seed+s*3+1, 34))
			d.WriteString(fmt.Sprintf("L%.0f %.0f", x, y))
		}
		paths = append(paths, d.String())
	}
	for i := 0; i < 11; i++ {
		x0 := 40 + i*80 + k.rnd(i*13, 70)
		steps := 5 + k.rnd(i*13+1, 7)
		crack(i*101, x0, 710, steps, float64(k.rnd(i*13+2, 3)-1))
		if i%2 == 0 {
			crack(i*101+57, x0+k.rnd(i, 30)-15, 650-k.rnd(i*13+3, 60), 3+k.rnd(i*13+4, 3), float64(k.rnd(i*13+5, 3)-1)*2)
		}
	}
	var glow, core strings.Builder
	for _, p := range paths {
		glow.WriteString(fmt.Sprintf("<path d='%s' stroke='%s' stroke-width='9' stroke-linejoin='round' fill='none' opacity='%s'/>", p, h.warm, k.op(.4, .5)))
		core.WriteString(fmt.Sprintf("<path d='%s' stroke='%s' stroke-width='2.2' stroke-linejoin='round' fill='none' opacity='%s'/>", p, h.second, k.op(.9, 1)))
	}
	mask := "<defs><linearGradient id='m' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='#fff'/><stop offset='.55' stop-color='#fff' stop-opacity='.45'/><stop offset='.85' stop-color='#fff' stop-opacity='0'/></linearGradient><mask id='k'><rect width='900' height='700' fill='url(#m)'/></mask>" +
		"<filter id='b' x='-10%' y='-10%' width='120%' height='120%'><feGaussianBlur stdDeviation='6'/></filter></defs>"
	return []backdropLayer{
		svgScene(900, 700, "xMidYMax slice", mask+"<g mask='url(#k)'>"+core.String()+"</g>"),
		svgScene(900, 700, "xMidYMax slice", mask+"<g mask='url(#k)' filter='url(#b)'>"+glow.String()+"</g>"),
		{image: k.blob(50, 112, 100, 34, k.warm, 56)},
		backdropGround(k),
	}
}

// themeBackdropFoxNight is a cold clear night: a pale moon with rings of halo in the upper corner,
// scattered stars, two distant ridges, and a faint warm glow where the fox's fire would be.
func themeBackdropFoxNight(k backdropKit) []backdropLayer {
	h := k.hex
	sky := fmt.Sprintf("<defs><radialGradient id='m'><stop offset='0' stop-color='%s' stop-opacity='%s'/><stop offset='.4' stop-color='%s' stop-opacity='%s'/><stop offset='1' stop-color='%s' stop-opacity='0'/></radialGradient></defs>"+
		"<circle cx='710' cy='150' r='300' fill='url(#m)'/>"+
		"<circle cx='710' cy='150' r='54' fill='%s' opacity='%s'/>"+
		"<circle cx='710' cy='150' r='96' fill='none' stroke='%s' stroke-width='1' opacity='%s'/>"+
		"<circle cx='710' cy='150' r='150' fill='none' stroke='%s' stroke-width='1' opacity='%s'/>",
		h.accent, k.op(.2, .22), h.accent, k.op(.08, .1), h.accent, h.accent, k.op(.2, .26), h.accent, k.op(.14, .18), h.accent, k.op(.08, .1))
	var st strings.Builder
	for i := 0; i < 56; i++ {
		c := h.accent
		if i%6 == 0 {
			c = h.warm
		}
		st.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", k.rnd(i*3+1, 900), k.rnd(i*3+2, 480), 0.6+float64(k.rnd(i*3+3, 10))/10, c, k.op(.4, .55)))
	}
	ridge := func(seed, base, amp int, fill string, a string) string {
		var d strings.Builder
		d.WriteString(fmt.Sprintf("M-20 720L-20 %d", base))
		for x := 0; x <= 940; x += 70 + k.rnd(seed, 40) {
			d.WriteString(fmt.Sprintf("L%d %d", x, base-k.rnd(seed+x, amp)))
		}
		d.WriteString("L940 720Z")
		return fmt.Sprintf("<path d='%s' fill='%s' opacity='%s' stroke='%s' stroke-opacity='.3' stroke-width='1' stroke-linejoin='round'/>", d.String(), fill, a, h.accent)
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMax slice", ridge(7, 640, 110, h.accent, k.op(.1, .14))+ridge(41, 690, 70, h.accent, k.op(.14, .2))),
		svgScene(900, 700, "xMaxYMin slice", sky+st.String()),
		{image: k.blob(30, 114, 70, 22, k.warm, 24)},
		backdropGround(k),
	}
}

// themeBackdropFrostFern is frost on a window pane: fine feathered fronds of ice growing in from the
// bottom left and top right corners, each branch carrying smaller branches.
func themeBackdropFrostFern(k backdropKit) []backdropLayer {
	h := k.hex
	frond := func(x, y, ang, ln float64, depth int, sw float64, seed int) string {
		var sb strings.Builder
		var rec func(x, y, ang, ln float64, depth int, sw float64, seed int)
		rec = func(x, y, ang, ln float64, depth int, sw float64, seed int) {
			ex, ey := x+math.Cos(ang)*ln, y+math.Sin(ang)*ln
			cx, cy := x+math.Cos(ang+0.06)*ln*0.5, y+math.Sin(ang+0.06)*ln*0.5
			sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fQ%.0f %.0f %.0f %.0f' stroke-width='%.2f'/>", x, y, cx, cy, ex, ey, sw))
			if depth == 0 {
				return
			}
			n := 8
			for i := 1; i <= n; i++ {
				t := float64(i) / float64(n+1)
				px, py := x+(ex-x)*t, y+(ey-y)*t
				bl := ln * 0.36 * (1.05 - t*0.8)
				rec(px, py, ang+0.95, bl, depth-1, sw*0.7, seed+i)
				rec(px, py, ang-0.95, bl, depth-1, sw*0.7, seed+i+50)
			}
		}
		rec(x, y, ang, ln, depth, sw, seed)
		return sb.String()
	}
	wrap := func(body string) string {
		return fmt.Sprintf("<g fill='none' stroke='%s' stroke-linecap='round' opacity='%s'>%s</g>", h.accent, k.op(.34, .3), body)
	}
	return []backdropLayer{
		svgScene(900, 900, "xMinYMax slice", wrap(frond(60, 860, -1.1, 540, 2, 2.2, 1)+frond(40, 840, -0.4, 300, 2, 1.6, 9))),
		svgScene(900, 900, "xMaxYMin slice", wrap(frond(850, 30, 2.1, 400, 2, 1.8, 3))),
		{image: k.blob(8, 100, 50, 30, k.cool, 22)},
		backdropGround(k),
	}
}

// themeBackdropFrostedJuniper is a fogged window with a hand dragged down it: soft clear streaks
// running from the top with a bright droplet at each foot, over a light bloom of condensation.
func themeBackdropFrostedJuniper(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%s' stop-opacity='0'/><stop offset='.3' stop-color='%s' stop-opacity='%s'/><stop offset='1' stop-color='%s' stop-opacity='%s'/></linearGradient>"+
		"<filter id='b' x='-50%%' y='-5%%' width='200%%' height='110%%'><feGaussianBlur stdDeviation='2.4'/></filter></defs><g filter='url(#b)'>", h.accent, h.accent, k.op(.22, .26), h.accent, k.op(.34, .4)))
	for i := 0; i < 30; i++ {
		x := 30 + k.rnd(i*7+1, 840)
		w := 5 + k.rnd(i*7+2, 20)
		y := k.rnd(i*7+3, 260)
		hh := 220 + k.rnd(i*7+4, 380)
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='%d' fill='url(#s)'/>", x, y, w, hh, w/2))
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s'/>", x+w/2, y+hh, w/2+2, w/2+5, h.cool, k.op(.55, .62)))
	}
	sb.WriteString("</g>")
	var dots strings.Builder
	for i := 0; i < 140; i++ {
		dots.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", k.rnd(i*3+1, 900), k.rnd(i*3+2, 700), 0.7+float64(k.rnd(i*3+3, 12))/10, h.accent, k.op(.34, .4)))
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMin slice", sb.String()),
		svgScene(900, 700, "xMidYMid slice", dots.String()),
		{image: k.blob(50, 108, 110, 34, k.accent, 36)},
		backdropGround(k),
	}
}

// themeBackdropFrozenLavender is a pane of cracked violet ice: irregular triangular facets in
// lavender with hairline seams, a few of them catching light, faint at the top and clearer below.
func themeBackdropFrozenLavender(k backdropKit) []backdropLayer {
	h := k.hex
	const cols, rows, cw, ch = 9, 8, 120, 96
	pt := func(i, j int) (float64, float64) {
		jx, jy := 0.0, 0.0
		if i > 0 && i < cols {
			jx = float64(k.rnd(i*31+j*7+1, 70) - 35)
		}
		if j > 0 && j < rows {
			jy = float64(k.rnd(i*17+j*13+2, 56) - 28)
		}
		return float64(i*cw-90) + jx, float64(j*ch-34) + jy
	}
	var sb strings.Builder
	fills := []string{h.accent, h.accent, h.cool, h.second, h.warm}
	n := 0
	for j := 0; j < rows; j++ {
		for i := 0; i < cols; i++ {
			ax, ay := pt(i, j)
			bx, by := pt(i+1, j)
			cx, cy := pt(i, j+1)
			dx, dy := pt(i+1, j+1)
			tris := [][6]float64{{ax, ay, bx, by, cx, cy}, {bx, by, dx, dy, cx, cy}}
			if k.rnd(i*5+j*3, 2) == 0 {
				tris = [][6]float64{{ax, ay, bx, by, dx, dy}, {ax, ay, dx, dy, cx, cy}}
			}
			for _, t := range tris {
				n++
				depth := 0.35 + 0.65*float64(j)/float64(rows)
				f := fills[k.rnd(n*3+1, len(fills))]
				if k.rnd(n*3+2, 9) > 1 {
					f = h.accent
				}
				a := float64(k.rnd(n*3+3, 100)) / 100 * 0.2 * depth
				if !k.dark {
					a *= 0.9
				}
				sb.WriteString(fmt.Sprintf("<polygon points='%.0f,%.0f %.0f,%.0f %.0f,%.0f' fill='%s' fill-opacity='%.3f' stroke='%s' stroke-opacity='%.2f' stroke-width='.9' stroke-linejoin='round'/>",
					t[0], t[1], t[2], t[3], t[4], t[5], f, a, h.accent, 0.18*depth))
			}
		}
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMax slice", sb.String()),
		{image: k.blob(70, 20, 80, 30, k.accent, 26)},
		{image: k.blob(30, 110, 90, 26, k.cool, 22)},
		backdropGround(k),
	}
}
