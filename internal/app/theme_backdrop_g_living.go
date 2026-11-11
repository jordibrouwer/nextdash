package app

import (
	"fmt"
	"math"
	"strings"
)

// Backdrop recipes of the living theme group; see theme_groups.go. Each one is drawn for one family:
// it has to fit that theme's name, shape and colours.

// themeBackdropCloudStrata is the "cloudstrata" recipe: the sky as bands. Banks of cloud lie one
// behind the next, the far ones pale and thin near the top, the near ones fuller and warmer lower
// down, each bank built of overlapping flat-bottomed masses so the whole reads as weather seen from
// the ground rather than as a pattern.
func themeBackdropCloudStrata(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	// Clouds are white on a light sky and the sky's own pale blue on a dark one; the theme's
	// other colours (green, red) have no place in the weather.
	cloud, shade := "#ffffff", h.accent
	if k.dark {
		cloud, shade = h.accent, h.accent
	}
	banks := []struct {
		y, ry, n int
		fill     string
		op       string
	}{
		{80, 24, 14, cloud, k.op(.62, .20)},
		{200, 34, 11, shade, k.op(.20, .16)},
		{210, 30, 11, cloud, k.op(.55, .18)},
		{360, 46, 8, shade, k.op(.20, .16)},
		{370, 42, 8, cloud, k.op(.50, .13)},
		{540, 62, 6, shade, k.op(.22, .18)},
		{552, 56, 6, cloud, k.op(.48, .12)},
	}
	for b, bank := range banks {
		step := 1500 / bank.n
		for i := 0; i < bank.n+1; i++ {
			x := -60 + i*step + k.rnd(b*40+i, step/2)
			rx := step/2 + 30 + k.rnd(b*50+i+7, step/3)
			ry := bank.ry/2 + k.rnd(b*60+i+3, bank.ry/2)
			y := bank.y + k.rnd(b*70+i+5, 30)
			sb.WriteString(fmt.Sprintf("<ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' opacity='%s'/>", x, y, rx, ry, bank.fill, bank.op))
		}
	}
	// The first layer is the top one, so the ground goes last.
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(h.accent, 46) + ", transparent 70%)"},
		backdropGround(k),
	}
}

// themeBackdropSundial is the "sundial" recipe: a dial face laid across the page. Hour lines fan
// from a gnomon at the foot of the page, half rings of the dial rise behind them, and the paths the
// sun takes at midwinter, equinox and midsummer arc over the top as dashed lines, with a long
// shadow wedge on the face.
func themeBackdropSundial(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cx, cy := 700.0, 860.0
	// The shadow of the gnomon, a wedge on the face.
	sb.WriteString(fmt.Sprintf("<polygon points='%.0f,%.0f %.0f,%.0f %.0f,%.0f' fill='%s' opacity='%s'/>",
		cx, cy, cx-150, cy-760, cx-60, cy-790, h.second, k.op(.16, .20)))
	// Half rings of the dial.
	for i, r := range []float64{150, 300, 450, 600, 750, 900} {
		w, op := 1.5, k.op(.38, .26)
		if i%2 == 1 {
			w, op = 3, k.op(.50, .34)
		}
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0f A%.0f %.0f 0 0 1 %.0f %.0f' fill='none' stroke='%s' stroke-width='%.1f' opacity='%s'/>",
			cx-r, cy, r, r, cx+r, cy, h.accent, w, op))
	}
	// Hour lines: a line every 15 degrees across the upper half, the noon line longest.
	for a := 195; a <= 345; a += 15 {
		rad := float64(a) * math.Pi / 180
		length, w := 1000.0, 1.6
		if a%45 == 0 {
			w = 3
		}
		if a == 270 {
			length, w = 1100, 4
		}
		x2, y2 := cx+length*math.Cos(rad), cy+length*math.Sin(rad)
		sb.WriteString(fmt.Sprintf("<line x1='%.0f' y1='%.0f' x2='%.0f' y2='%.0f' stroke='%s' stroke-width='%.1f' opacity='%s'/>",
			cx, cy, x2, y2, h.warm, w, k.op(.55, .34)))
		// Hour marks on the outer ring.
		mx, my := cx+780*math.Cos(rad), cy+780*math.Sin(rad)
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='6' fill='%s' opacity='%s'/>", mx, my, h.warm, k.op(.7, .5)))
	}
	// The sun's path across the sky in three seasons, flat dashed arcs.
	for i, ry := range []float64{300, 520, 740} {
		sb.WriteString(fmt.Sprintf("<ellipse cx='%.0f' cy='%.0f' rx='%.0f' ry='%.0f' fill='none' stroke='%s' stroke-width='2.4' stroke-dasharray='4 14' stroke-linecap='round' opacity='%s'/>",
			cx, cy, 380+float64(i)*190, ry, h.second, k.op(.7, .5)))
	}
	// The gnomon itself, and the warm light on the face.
	sb.WriteString(fmt.Sprintf("<polygon points='%.0f,%.0f %.0f,%.0f %.0f,%.0f' fill='%s' opacity='%s'/>",
		cx-26, cy+60, cx, cy-60, cx+26, cy+60, h.warm, k.op(.6, .5)))
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(h.accent, 18) + ", transparent 40%)"},
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 108, 80, 75, h.warm, 46)},
		backdropGround(k),
	}
}
