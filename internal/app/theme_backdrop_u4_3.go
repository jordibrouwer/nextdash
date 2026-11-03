package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropWheatField is a field of wheat in a low wind: ears on thin curved stems lean in from
// the bottom edge, each ear a stack of small grain pairs, near ones bold and far ones faint, under
// a warm haze along the horizon.
func themeBackdropWheatField(k backdropKit) []backdropLayer {
	h := k.hex
	ears := func(seed, n int, scale, a float64) string {
		var sb strings.Builder
		for i := 0; i < n; i++ {
			x := float64(k.rnd(seed+i*9, 900))
			hgt := (180 + float64(k.rnd(seed+i*9+1, 300))) * scale
			lean := float64(k.rnd(seed+i*9+2, 120)) - 50
			c := h.accent
			if k.rnd(seed+i*9+3, 4) == 0 {
				c = h.cool
			}
			tx, ty := x+lean, 720-hgt
			cx, cy := x+lean*0.1, 720-hgt*0.55
			sb.WriteString(fmt.Sprintf("<path d='M%.0f 720Q%.0f %.0f %.0f %.0f' stroke='%s' stroke-width='%.1f' fill='none' opacity='%.2f'/>", x, cx, cy, tx, ty, c, 2*scale+.6, a*0.8))
			ang := math.Atan2(ty-cy, tx-cx) * 180 / math.Pi
			var g strings.Builder
			for j := 0; j < 7; j++ {
				yy := -float64(j) * 11 * scale
				w := (9 - float64(j)) * scale
				g.WriteString(fmt.Sprintf("<ellipse cx='%.1f' cy='%.1f' rx='%.1f' ry='%.1f' transform='rotate(-35 %.1f %.1f)'/>", -5*scale, yy, 3.4*scale, w*0.7, -5*scale, yy))
				g.WriteString(fmt.Sprintf("<ellipse cx='%.1f' cy='%.1f' rx='%.1f' ry='%.1f' transform='rotate(35 %.1f %.1f)'/>", 5*scale, yy, 3.4*scale, w*0.7, 5*scale, yy))
			}
			g.WriteString(fmt.Sprintf("<path d='M0 %.0fL0 %.0f' stroke='%s' stroke-width='1' opacity='.7'/>", -78*scale, -100*scale, c))
			sb.WriteString(fmt.Sprintf("<g transform='translate(%.0f %.0f) rotate(%.0f)' fill='%s' opacity='%.2f'>%s</g>", tx, ty, ang+90, c, a, g.String()))
		}
		return sb.String()
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMax slice", ears(11, 16, 1.5, .5)),
		svgScene(900, 700, "xMidYMax slice", ears(400, 22, 0.8, .3)),
		{image: k.blob(50, 108, 110, 34, k.accent, 56)},
		{image: k.blob(88, 96, 50, 30, k.warm, 40)},
		{image: k.blob(10, 4, 50, 30, k.cool, 22)},
		backdropGround(k),
	}
}

// themeBackdropWinterEmber is snow falling past a hearth: soft flakes of every size drift down the
// page, white and cold far from the fire and turning amber near the glow in the lower left corner.
func themeBackdropWinterEmber(k backdropKit) []backdropLayer {
	h := k.hex
	flakes := func(seed, n int, rMin, rMax int, a float64) string {
		var sb strings.Builder
		sb.WriteString("<defs><filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='1.4'/></filter></defs>")
		for i := 0; i < n; i++ {
			x := float64(k.rnd(seed+i*4, 900))
			y := float64(k.rnd(seed+i*4+1, 700))
			r := float64(rMin) + float64(k.rnd(seed+i*4+2, (rMax-rMin)*10))/10
			d := math.Hypot(x/900, (700-y)/700)
			heat := math.Max(0, 1-d*1.5)
			c := "#ffffff"
			if !k.dark {
				c = h.cool
			}
			if heat > 0.25 {
				c = h.accent
			}
			if heat > 0.7 {
				c = h.warm
			}
			f := ""
			if r > 5 {
				f = " filter='url(#b)'"
			}
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.1f' fill='%s' opacity='%.2f'%s/>", x, y, r, c, a*(0.55+heat*0.6), f))
		}
		return sb.String()
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMax slice", flakes(5, 70, 6, 13, .22)),
		svgScene(900, 700, "xMidYMax slice", flakes(300, 120, 1, 3, .6)),
		{image: k.blob(0, 105, 80, 54, k.accent, 60)},
		{image: k.blob(4, 100, 38, 30, k.warm, 52)},
		{image: k.blob(100, 0, 60, 46, k.cool, 24)},
		backdropGround(k),
	}
}

// themeBackdropZenEmber is a raked gravel garden lit by embers: fine parallel lines that run across
// the page and bend in loops around two stones, the lines in warm tones, the stones as dark soft discs.
func themeBackdropZenEmber(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	stones := [][3]float64{{690, 540, 74}, {210, 180, 46}}
	for i := 0; i < 34; i++ {
		y0 := 40 + float64(i)*20
		c := h.accent
		if i%5 == 3 {
			c = h.warm
		}
		var d strings.Builder
		d.WriteString(fmt.Sprintf("M-20 %.0f", y0))
		for x := 0.0; x <= 920; x += 20 {
			y := y0 + 4*math.Sin(x/90+float64(i)*.2)
			for _, s := range stones {
				dx, dy := x-s[0], y0-s[1]
				dist := math.Hypot(dx, dy)
				ring := s[2] + 22 + 14*math.Abs(math.Sin(float64(i)))
				if dist < ring*1.8 {
					push := (ring*1.8 - dist) / (ring * 1.8)
					y += math.Copysign(1, dy+.01) * push * push * ring * 1.3
				}
			}
			d.WriteString(fmt.Sprintf("L%.0f %.1f", x, y))
		}
		sb.WriteString(fmt.Sprintf("<path d='%s' stroke='%s' stroke-width='1.4' fill='none' opacity='%.2f'/>", d.String(), c, 0.18+0.3*float64(k.rnd(i, 100))/100))
	}
	for _, s := range stones {
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.0f' fill='%s' opacity='%s'/>", s[0], s[1]+8, s[2]*0.9, s[2]*0.6, h.ground, k.op(.5, .7)))
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.0f' fill='none' stroke='%s' stroke-width='2' opacity='.5'/>", s[0], s[1]+8, s[2]*0.9, s[2]*0.6, h.warm))
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMid slice", sb.String()),
		{image: k.blob(80, 92, 60, 40, k.accent, 52)},
		{image: k.blob(10, 10, 46, 34, k.warm, 34)},
		{image: k.blob(50, 50, 40, 30, k.cool, 14)},
		backdropGround(k),
	}
}

// themeBackdropZinc is the spangle of galvanised steel: a few crystal grains, each a burst of fine
// feathered rays from a nucleus inside a faint hexagonal edge, in violet with a little mint and gold.
func themeBackdropZinc(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cols := []string{h.accent, h.accent, h.cool, h.warm}
	nuclei := [][3]float64{{110, 130, 150}, {760, 90, 120}, {830, 440, 170}, {90, 560, 160}, {470, 660, 130}, {380, 40, 80}, {640, 700, 90}}
	for n, g := range nuclei {
		c := cols[n%len(cols)]
		var hex strings.Builder
		for j := 0; j < 6; j++ {
			a := (float64(j)*60 + float64(k.rnd(n*3+j, 30))) * math.Pi / 180
			hex.WriteString(fmt.Sprintf("%.0f,%.0f ", g[0]+math.Cos(a)*g[2]*1.1, g[1]+math.Sin(a)*g[2]*1.1))
		}
		sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='%s' fill-opacity='.05' stroke='%s' stroke-width='1.2' opacity='.5'/>", hex.String(), c, c))
		for j := 0; j < 26; j++ {
			a := float64(j) * 2 * math.Pi / 26
			ln := g[2] * (0.5 + float64(k.rnd(n*50+j, 50))/100)
			x2, y2 := g[0]+math.Cos(a)*ln, g[1]+math.Sin(a)*ln
			sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='1.3' opacity='.5'/>", g[0], g[1], x2, y2, c))
			for t := 0.35; t < 1; t += 0.28 {
				px, py := g[0]+math.Cos(a)*ln*t, g[1]+math.Sin(a)*ln*t
				for _, s := range []float64{-1, 1} {
					b := a + s*0.7
					sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='.9' opacity='.38'/>", px, py, px+math.Cos(b)*ln*0.16, py+math.Sin(b)*ln*0.16, c))
				}
			}
		}
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='4' fill='%s' opacity='.8'/>", g[0], g[1], c))
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMid slice", sb.String()),
		{image: k.blob(10, 10, 50, 40, k.accent, 40)},
		{image: k.blob(94, 94, 56, 44, k.accent, 44)},
		{image: k.blob(96, 40, 30, 40, k.cool, 22)},
		backdropGround(k),
	}
}

// themeBackdropChalk is a blackboard wiped with a damp cloth: wide ghostly swipes of chalk dust,
// roughened at the edges, a wobbly hand-drawn underline in the accent colour and a haze of loose
// dust settling along the ledge at the bottom.
func themeBackdropChalk(k backdropKit) []backdropLayer {
	h := k.hex
	dust := "#f3efe6"
	if !k.dark {
		dust = "#6b6358"
	}
	swipes := "<defs><filter id='r' x='-10%' y='-10%' width='120%' height='120%'><feTurbulence type='fractalNoise' baseFrequency='.03 .09' numOctaves='3' seed='4' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='38'/><feGaussianBlur stdDeviation='9'/></filter></defs><g filter='url(#r)' fill='" + dust + "'>"
	for i := 0; i < 7; i++ {
		y := 70 + float64(i)*95 + float64(k.rnd(i, 40))
		x := float64(k.rnd(i+20, 260)) - 120
		w := 420 + float64(k.rnd(i+40, 420))
		swipes += fmt.Sprintf("<path d='M%.0f %.0fQ%.0f %.0f %.0f %.0fL%.0f %.0fQ%.0f %.0f %.0f %.0fZ' opacity='%s'/>", x, y, x+w/2, y-30, x+w, y+10, x+w, y+52, x+w/2, y+22, x, y+60, k.op(.14, .13))
	}
	swipes += "</g>"
	var marks strings.Builder
	marks.WriteString(fmt.Sprintf("<g filter='url(#s)' stroke='%s' fill='none' stroke-linecap='round' opacity='.6'><path d='M520 640Q600 628 680 642T850 636' stroke-width='5'/><path d='M60 120Q90 100 130 124T200 112' stroke-width='4' opacity='.7'/></g>", h.accent))
	marks.WriteString("<defs><filter id='s'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='9' result='t'/><feDisplacementMap in='SourceGraphic' in2='t' scale='5'/></filter></defs>")
	for i := 0; i < 90; i++ {
		x := k.rnd(i*3+1, 900)
		y := 600 + k.rnd(i*3+2, 100)
		marks.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, y, 0.8+float64(k.rnd(i*3+3, 20))/10, dust, k.op(.35, .5)))
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMax slice", marks.String()),
		svgScene(900, 700, "xMidYMid slice", swipes),
		{image: k.blob(50, 108, 110, 30, k.accent, 40)},
		{image: k.blob(0, 0, 50, 36, k.accent, 22)},
		backdropGround(k),
	}
}

// themeBackdropConcrete is a poured wall with its formwork showing: panels of uneven width with
// dark seam lines and a few tie holes, mottled with cast-in blotches, rust-orange stains running
// down from the seams and a pale lip of grout along the bottom.
func themeBackdropConcrete(k backdropKit) []backdropLayer {
	h := k.hex
	line := "#000000"
	if !k.dark {
		line = "#3a3632"
	}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='m' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.012' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 1.6 -.55'/></filter><linearGradient id='st' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='.75'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></linearGradient></defs>")
	sb.WriteString(fmt.Sprintf("<rect width='900' height='700' filter='url(#m)' opacity='%s'/>", k.op(.35, .3)))
	rows := []float64{0, 230, 470, 700}
	for r := 0; r < 3; r++ {
		x := float64(k.rnd(r+60, 160)) - 40
		for x < 900 {
			w := 170 + float64(k.rnd(r*11+int(x), 140))
			sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='3' opacity='.4'/>", x, rows[r]+2, x, rows[r+1]-2, line))
			for _, tx := range []float64{x + 36, x + w - 36} {
				for _, ty := range []float64{rows[r] + 60, rows[r+1] - 60} {
					if k.rnd(int(tx+ty), 3) == 0 {
						sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='9' fill='%s' opacity='.45'/><circle cx='%.0f' cy='%.0f' r='9' fill='none' stroke='%s' stroke-width='1.5' opacity='.35'/>", tx, ty, line, tx, ty, h.warm))
					}
				}
			}
			if k.rnd(int(x)+r, 3) != 0 {
				sx := x + float64(k.rnd(int(x)+7, 12)) - 6
				sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fQ%.0f %.0f %.0f %.0fL%.0f %.0fQ%.0f %.0f %.0f %.0fZ' fill='url(#st)' opacity='.5'/>", sx-4, rows[r]+4, sx-9, rows[r]+60, sx-3, rows[r]+120+float64(k.rnd(int(x), 80)), sx+6, rows[r]+120+float64(k.rnd(int(x), 80)), sx+9, rows[r]+60, sx+4, rows[r]+4))
			}
			x += w
		}
		sb.WriteString(fmt.Sprintf("<path d='M0 %.0fL900 %.0f' stroke='%s' stroke-width='3' opacity='.35'/>", rows[r+1], rows[r+1], line))
	}
	return []backdropLayer{
		svgScene(900, 700, "xMidYMid slice", sb.String()),
		{image: k.blob(90, 100, 56, 40, k.accent, 40)},
		{image: k.blob(6, 6, 50, 36, k.warm, 18)},
		backdropGround(k),
	}
}

// themeBackdropBlack is polished black: a broad soft sheen sweeps in a diagonal band from the
// lower left, a hairline of cyan light rides the edge of it, and two dim wells of cyan glow sit in
// the far corners so the black is never flat.
func themeBackdropBlack(k backdropKit) []backdropLayer {
	h := k.hex
	body := fmt.Sprintf("<defs><linearGradient id='b' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='%s' stop-opacity='0'/><stop offset='.5' stop-color='%s' stop-opacity='.4'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient><filter id='f' x='-20%%' y='-20%%' width='140%%' height='140%%'><feGaussianBlur stdDeviation='14'/></filter></defs>", h.accent, h.accent, h.accent)
	body += "<g transform='rotate(-32 450 350)'>"
	body += "<rect x='-300' y='470' width='1500' height='120' fill='url(#b)' filter='url(#f)' opacity='.8'/>"
	body += fmt.Sprintf("<rect x='-300' y='520' width='1500' height='2' fill='%s' opacity='.65'/>", h.accent)
	body += fmt.Sprintf("<rect x='-300' y='560' width='1500' height='1' fill='%s' opacity='.35'/>", h.cool)
	body += "<rect x='-300' y='260' width='1500' height='46' fill='url(#b)' filter='url(#f)' opacity='.4'/>"
	body += fmt.Sprintf("<rect x='-300' y='284' width='1500' height='1' fill='%s' opacity='.3'/>", h.accent)
	body += "</g>"
	return []backdropLayer{
		svgScene(900, 700, "xMidYMid slice", body),
		{image: k.blob(0, 100, 60, 46, k.accent, 36)},
		{image: k.blob(100, 0, 50, 40, k.accent, 26)},
		{image: k.blob(50, 50, 70, 50, k.cool, 8)},
		backdropGround(k),
	}
}
