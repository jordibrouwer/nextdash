package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropKevlarWeave is aramid cloth seen close: long gold strands running both ways, the
// ones in one direction dashed so they seem to pass under the others, over a soft sheen.
func themeBackdropKevlarWeave(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	for i := 0; i < 46; i++ {
		x := k.rnd(i*5, 1900) - 400
		w := 1.2 + float64(k.rnd(i*5+1, 30))/10
		c := h.accent
		if k.rnd(i*5+2, 6) == 0 {
			c = h.warm
		}
		sb.WriteString(fmt.Sprintf("<path d='M%d -40L%d 940' stroke='%s' stroke-width='%.1f' opacity='%s'/>", x, x+980, c, w, k.op(.2, .2)))
	}
	for i := 0; i < 46; i++ {
		x := k.rnd(i*5+3, 1900) - 100
		w := 1.2 + float64(k.rnd(i*5+4, 30))/10
		c := h.accent
		if k.rnd(i*5+2, 7) == 0 {
			c = h.cool
		}
		sb.WriteString(fmt.Sprintf("<path d='M%d -40L%d 940' stroke='%s' stroke-width='%.1f' stroke-dasharray='%d %d' opacity='%s'/>", x, x-980, c, w, 50+k.rnd(i, 50), 36+k.rnd(i+9, 30), k.op(.16, .2)))
	}
	body := "<g fill='none' stroke-linecap='round'>" + sb.String() + "</g>"
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", body),
		{image: "linear-gradient(115deg, transparent 30%, " + k.veil(h.accent, 8) + " 46%, " + k.veil(h.warm, 12) + " 50%, transparent 62%)"},
		{image: k.blob(80, 112, 70, 40, k.warm, 22)},
		backdropGround(k),
	}
}

// themeBackdropLavenderMist is fog behind frosted glass: wide blurred banks of lavender, rose and
// mint drifting low on the page, with one pale reflection across the pane.
func themeBackdropLavenderMist(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='f' x='-30%' y='-60%' width='160%' height='220%'><feGaussianBlur stdDeviation='46'/></filter></defs><g filter='url(#f)'>")
	cols := []string{h.accent, h.second, h.cool, h.accent, h.second}
	for i := 0; i < 9; i++ {
		cx := k.rnd(i*4, 1400)
		cy := 480 + k.rnd(i*4+1, 420)
		rx := 220 + k.rnd(i*4+2, 260)
		ry := 40 + k.rnd(i*4+3, 60)
		sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s'/>", cx, cy, rx, ry, cols[i%len(cols)], k.op(.3, .3)))
	}
	sb.WriteString("</g>")
	return []backdropLayer{
		{image: "linear-gradient(112deg, transparent 38%, " + k.veil("#ffffff", 7) + " 44%, transparent 50%)"},
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: k.blob(30, 100, 70, 40, k.accent, 24)},
		backdropGround(k),
	}
}

// themeBackdropLibraryMahogany is a dim library: the soft shapes of book spines of every height
// along the bottom edge, bound in leather colours with brass bands, and a lamp glow top left.
func themeBackdropLibraryMahogany(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b'><feGaussianBlur stdDeviation='1.2'/></filter></defs><g filter='url(#b)'>")
	cols := []string{h.accent, h.second, h.warm, h.cool, h.accent, h.second}
	x := -10
	for i := 0; x < 1420; i++ {
		w := 16 + k.rnd(i*3, 34)
		ht := 150 + k.rnd(i*3+1, 230)
		c := cols[k.rnd(i*3+2, len(cols))]
		y := 900 - ht
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='2' fill='%s' opacity='%s'/>", x, y, w-3, ht, c, k.op(.2, .22)))
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='3' fill='%s' opacity='%s'/>", x, y+18, w-3, h.cool, k.op(.4, .4)))
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='3' fill='%s' opacity='%s'/>", x, y+ht-60, w-3, h.cool, k.op(.3, .3)))
		x += w
	}
	sb.WriteString("</g><rect x='0' y='884' width='1400' height='16' fill='" + h.warm + "' opacity='" + k.op(.3, .3) + "'/>")
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: k.blob(12, 0, 60, 55, k.warm, 28)},
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 40) + " 0%, transparent 60%)"},
		backdropGround(k),
	}
}

// themeBackdropLicoriceLayer is a licorice wheel: one long glossy black ribbon coiled in a spiral
// that runs off the lower right corner, edged in amber, with a gloss line along it and a scatter of
// amber, blue and rose sugar sprinkles.
func themeBackdropLicoriceLayer(k backdropKit) []backdropLayer {
	h := k.hex
	var d strings.Builder
	cx, cy := 1130.0, 640.0
	for i := 0; i <= 420; i++ {
		t := float64(i) / 420 * 15.2
		r := 12 + t*34
		x, y := cx+r*math.Cos(t), cy+r*math.Sin(t)
		if i == 0 {
			d.WriteString(fmt.Sprintf("M%.1f %.1f", x, y))
		} else {
			d.WriteString(fmt.Sprintf("L%.1f %.1f", x, y))
		}
	}
	path := d.String()
	ribbon, rim := "#0b0b0e", h.accent
	body := fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='40' stroke-linejoin='round' opacity='%s'/>", path, rim, k.op(.5, .42)) +
		fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='31' stroke-linejoin='round' opacity='%s'/>", path, ribbon, k.op(.82, .9)) +
		fmt.Sprintf("<path d='%s' fill='none' stroke='#fff' stroke-width='3' stroke-linejoin='round' opacity='%s' transform='translate(-7 -7)'/>", path, k.op(.28, .3))
	var sp strings.Builder
	cols := []string{h.accent, h.cool, h.second, h.warm}
	for i := 0; i < 46; i++ {
		x, y := k.rnd(i*5+1, 1400), k.rnd(i*5+2, 800)
		sp.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='14' height='5' rx='2.5' fill='%s' opacity='%s' transform='rotate(%d %d %d)'/>",
			x, y, cols[k.rnd(i*5+3, 4)], k.op(.7, .7), k.rnd(i*5+4, 180), x, y))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMax slice", body),
		svgScene(1400, 800, "xMidYMid slice", sp.String()),
		{image: k.blob(90, 100, 50, 50, k.accent, 30)},
		backdropGround(k),
	}
}

func themeBackdropLimeSoda(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='0'/><stop offset='.5' stop-color='#fff' stop-opacity='1'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>")
	cols := []string{h.accent, h.cool, h.warm, h.accent, h.cool, h.accent}
	for i, c := range cols {
		sb.WriteString(fmt.Sprintf("<linearGradient id='s%d' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='%s' stop-opacity='0'/><stop offset='.55' stop-color='%s' stop-opacity='.9'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient>", i, c, c, c))
	}
	sb.WriteString("<filter id='b'><feGaussianBlur stdDeviation='7'/></filter></defs>")
	for i := range cols {
		x := 60 + i*250 + k.rnd(i, 120)
		w := 50 + k.rnd(i+20, 110)
		sb.WriteString(fmt.Sprintf("<path d='M%d 0H%d L%d 900H%d Z' fill='url(#s%d)' opacity='%s' filter='url(#b)'/>", x, x+w, x+w-380, x-380, i, k.op(.2, .2)))
		sb.WriteString(fmt.Sprintf("<path d='M%d 0L%d 900' stroke='%s' stroke-width='1.5' opacity='%s'/>", x+w, x+w-380, cols[i], k.op(.25, .3)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMid slice", sb.String()),
		{image: k.blob(50, 112, 90, 36, k.accent, 26)},
		backdropGround(k),
	}
}

// themeBackdropMarigoldDusk is paper cut in layers: four soft ridges of marigold, amber and rose
// paper with a low sun behind them, each ridge throwing a small shadow on the one below.
func themeBackdropMarigoldDusk(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><radialGradient id='s'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='" + k.op(.55, .6) + "'/><stop offset='.4' stop-color='" + h.accent + "' stop-opacity='" + k.op(.2, .22) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<circle cx='930' cy='470' r='360' fill='url(#s)'/><circle cx='930' cy='470' r='70' fill='" + h.warm + "' opacity='" + k.op(.55, .65) + "'/>")
	ridge := func(base, amp float64, f1, f2, ph float64) string {
		var p strings.Builder
		p.WriteString("M-20 920")
		for x := -20; x <= 1420; x += 20 {
			fx := float64(x)
			y := base - amp*(0.6*math.Sin(fx/f1+ph)+0.4*math.Sin(fx/f2+ph*2.3))
			p.WriteString(fmt.Sprintf("L%d %.0f", x, y))
		}
		p.WriteString("L1420 920Z")
		return p.String()
	}
	cols := []string{h.second, h.warm, h.accent, h.second}
	ops := []string{k.op(.3, .34), k.op(.3, .36), k.op(.34, .4), k.op(.4, .5)}
	for i := 0; i < 4; i++ {
		d := ridge(560+float64(i)*70, 46+float64(i)*8, 150+float64(i)*40, 61+float64(i)*17, float64(i)*1.9+.5)
		sb.WriteString(fmt.Sprintf("<g transform='translate(0 -7)'><path d='%s' fill='#000' opacity='.12'/></g>", d))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='%s' opacity='%s'/>", d, cols[i], ops[i]))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 50%, " + k.veil(h.second, 18) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropMatrixBluepill is a halftone of square pixels: a slow blue wave of dots that swell
// toward the bottom of the page and thin out to nothing across the middle.
func themeBackdropMatrixBluepill(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	step := 34
	for row := 0; row*step < 960; row++ {
		for col := -1; col*step < 1440; col++ {
			x := float64(col*step + (row%2)*step/2)
			y := float64(row * step)
			wave := (1 + math.Sin(x/190+y/310)) / 2
			vert := math.Pow(y/900, 1.6)
			r := (0.4 + 5.2*wave) * vert
			if r < 0.9 {
				continue
			}
			c := h.accent
			if wave > .9 && vert > .6 {
				c = h.cool
			}
			sb.WriteString(fmt.Sprintf("<rect x='%.0f' y='%.0f' width='%.1f' height='%.1f' fill='%s'/>", x-r, y-r, 2*r, 2*r, c))
		}
	}
	body := "<g opacity='" + k.op(.4, .34) + "'>" + sb.String() + "</g>"
	return []backdropLayer{
		{image: "radial-gradient(ellipse 50% 32% at 50% 40%, " + k.veil(k.ground, 70) + ", transparent)"},
		svgScene(1400, 900, "xMidYMax slice", body),
		{image: k.blob(50, 112, 100, 40, k.accent, 26)},
		backdropGround(k),
	}
}

// themeBackdropMatrixConstruct is the loading program: an endless floor of lines running to a
// glowing horizon, with a few tall faint columns standing in the empty space above it.
func themeBackdropMatrixConstruct(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	hy := 500.0
	sb.WriteString("<defs><linearGradient id='f' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='0'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='1'/></linearGradient></defs>")
	for i := -16; i <= 16; i++ {
		x := 700 + float64(i)*170
		sb.WriteString(fmt.Sprintf("<path d='M700 %.0f L%.0f 900' stroke='%s' stroke-width='1.2' opacity='%s'/>", hy, 700+(x-700)*8, h.accent, k.op(.3, .3)))
	}
	for i := 1; i <= 9; i++ {
		t := float64(i) / 9
		y := hy + 400*t*t
		sb.WriteString(fmt.Sprintf("<path d='M0 %.0fH1400' stroke='%s' stroke-width='%.1f' opacity='%.2f'/>", y, h.accent, 0.8+t, (0.1+0.3*t)*map[bool]float64{true: 1, false: .9}[k.dark]))
	}
	for i := 0; i < 9; i++ {
		x := 60 + k.rnd(i, 1280)
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='0' width='1.5' height='%.0f' fill='url(#f)' opacity='%s'/>", x, hy, k.op(.18, .22)))
	}
	sb.WriteString("<ellipse cx='700' cy='500' rx='620' ry='14' fill='" + h.cool + "' opacity='" + k.op(.2, .26) + "'/>")
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", "<g>"+sb.String()+"</g>"),
		{image: k.blob(50, 56, 90, 14, k.accent, 24)},
		backdropGround(k),
	}
}

// themeBackdropMatrixRain is falling code: columns of small glyph blocks of uneven length, each
// with a bright head and a tail that fades, thinned out behind the middle of the page.
func themeBackdropMatrixRain(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	for c := 0; c < 64; c++ {
		x := 8 + c*22 + k.rnd(c, 8)
		n := 6 + k.rnd(c+100, 20)
		head := 40 + k.rnd(c+200, 880)
		for i := 0; i < n; i++ {
			y := head - i*15
			if y < -10 {
				break
			}
			a := 0.85 * math.Pow(1-float64(i)/float64(n), 1.7)
			col := h.accent
			if i == 0 {
				col, a = h.warm, 0.95
			}
			gw := 5 + k.rnd(c*31+i, 5)
			gh := 6 + k.rnd(c*17+i, 6)
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='1' fill='%s' opacity='%.2f'/>", x, y, gw, gh, col, a))
		}
	}
	body := "<g opacity='" + k.op(.4, .42) + "'>" + sb.String() + "</g>"
	return []backdropLayer{
		{image: "radial-gradient(ellipse 42% 38% at 50% 48%, " + k.veil(k.ground, 75) + ", transparent)"},
		svgScene(1400, 900, "xMidYMid slice", body),
		{image: k.blob(50, 112, 100, 34, k.accent, 22)},
		backdropGround(k),
	}
}

// themeBackdropMatrixRedpill is the picture tearing: slices of the page shifted sideways, red
// bars with an orange ghost beside them, and one bright seam where it has split.
func themeBackdropMatrixRedpill(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	for i := 0; i < 30; i++ {
		y := 330 + k.rnd(i*6, 560)
		ht := 3 + k.rnd(i*6+1, 20)
		x := k.rnd(i*6+2, 1000) - 200
		w := 160 + k.rnd(i*6+3, 700)
		c := h.accent
		if k.rnd(i*6+4, 5) == 0 {
			c = h.second
		}
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='%s' opacity='%s'/>", x, y, w, ht, c, k.op(.26, .26)))
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='%s' opacity='%s'/>", x+16, y+1, w, ht, h.cool, k.op(.18, .2)))
	}
	sb.WriteString("<rect x='930' y='240' width='2' height='660' fill='" + h.accent + "' opacity='" + k.op(.4, .45) + "'/>")
	sb.WriteString("<rect x='924' y='240' width='14' height='660' fill='" + h.accent + "' opacity='" + k.op(.08, .1) + "'/>")
	return []backdropLayer{
		svgScene(1400, 900, "xMidYMax slice", sb.String()),
		{image: k.blob(66, 100, 40, 90, k.accent, 20)},
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 60) + " 0%, transparent 40%)"},
		backdropGround(k),
	}
}
