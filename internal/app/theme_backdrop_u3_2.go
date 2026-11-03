package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropGlossObsidianMirror is volcanic glass: a few broad diagonal sheets of reflected
// light, each with a hairline of cyan on its edge, leaning across the page the way light slides
// over a polished black mirror.
func themeBackdropGlossObsidianMirror(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='0'/><stop offset='.55' stop-color='" + h.accent + "' stop-opacity='" + k.op(.22, .20) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></linearGradient></defs>")
	sb.WriteString("<g transform='rotate(-24 700 400)'>")
	for _, s := range []struct{ x, w int }{{-260, 220}, {60, 90}, {200, 40}, {1000, 150}, {1210, 60}, {1330, 260}} {
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='-700' width='%d' height='2200' fill='url(#g)'/>", s.x, s.w))
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='-700' width='1.3' height='2200' fill='%s' opacity='%s'/>", s.x+s.w*55/100, h.accent, k.op(.34, .4)))
	}
	sb.WriteString("</g>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(88, 96, 50, 36, k.cool, 22)},
		backdropGround(k),
	}
}

// themeBackdropGlossPearl is nacre: the growth ridges of a shell as thin arcs fanning out from the
// lower-left corner, in pearl pastels, over a few soft blurred swirls of colour.
func themeBackdropGlossPearl(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.accent, h.second, h.cool, h.warm}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b'><feGaussianBlur stdDeviation='46'/></filter></defs>")
	for i, c := range []struct {
		x, y, r int
	}{{260, 640, 190}, {640, 760, 150}, {1120, 560, 210}, {1300, 120, 140}} {
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%s' filter='url(#b)'/>", c.x, c.y, c.r, cols[i%4], k.op(.30, .30)))
	}
	r := 120.0
	for i := 0; i < 24; i++ {
		r += 36 + float64(k.rnd(i, 50))
		op := (0.55 - float64(i)*0.018) * map[bool]float64{true: 0.8, false: 0.65}[k.dark]
		sb.WriteString(fmt.Sprintf("<ellipse cx='0' cy='820' rx='%.0f' ry='%.0f' fill='none' stroke='%s' stroke-width='%.1f' opacity='%.2f'/>", r*1.18, r*0.92, cols[i%4], 0.8+float64(k.rnd(i+40, 10))/10, op))
	}
	return []backdropLayer{svgScene(1400, 800, "xMinYMax slice", sb.String()), backdropGround(k)}
}

// themeBackdropGlossRoseGold is champagne bokeh: out-of-focus discs of warm metal in many sizes,
// each with a brighter rim, drifting thicker toward the lower half of the page.
func themeBackdropGlossRoseGold(k backdropKit) []backdropLayer {
	h := k.hex
	cols := []string{h.accent, h.warm, h.accent, h.second}
	var sb strings.Builder
	sb.WriteString("<defs><radialGradient id='d'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='.35'/><stop offset='.8' stop-color='" + h.accent + "' stop-opacity='.6'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='.9'/></radialGradient></defs>")
	for i := 0; i < 30; i++ {
		x := k.rnd(i*4, 1400)
		y := 360 + k.rnd(i*4+1, 460)
		if i%6 == 0 {
			y = k.rnd(i*4+1, 300)
		}
		r := 14 + k.rnd(i*4+2, 78)
		c := cols[i%4]
		op := (0.10 + float64(k.rnd(i*4+3, 10))/100) * map[bool]float64{true: 1.0, false: 0.85}[k.dark]
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%.2f'/>", x, y, r, c, op))
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='none' stroke='%s' stroke-width='1.2' opacity='%.2f'/>", x, y, r, c, op*1.7))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 112, 80, 40, k.warm, 26)},
		backdropGround(k),
	}
}

// themeBackdropGlossSapphireNight is moonlight through deep water: a fan of soft light rays
// spreading from beyond the top-right corner, with a few cold sparks near the source.
func themeBackdropGlossSapphireNight(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b'><feGaussianBlur stdDeviation='7'/></filter><radialGradient id='r' gradientUnits='userSpaceOnUse' cx='1520' cy='-220' r='1750'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='" + k.op(.55, .5) + "'/><stop offset='.5' stop-color='" + h.accent + "' stop-opacity='" + k.op(.2, .18) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<g filter='url(#b)'>")
	for i := 0; i < 9; i++ {
		a := (104 + float64(i)*8.2 + float64(k.rnd(i, 40))/10) * math.Pi / 180
		w := (1.2 + float64(k.rnd(i+20, 30))/10) * math.Pi / 180
		x1, y1 := 1520+2000*math.Cos(a-w), -220+2000*math.Sin(a-w)
		x2, y2 := 1520+2000*math.Cos(a+w), -220+2000*math.Sin(a+w)
		sb.WriteString(fmt.Sprintf("<polygon points='1520,-220 %.0f,%.0f %.0f,%.0f' fill='url(#r)' opacity='%.2f'/>", x1, y1, x2, y2, 0.5+float64(k.rnd(i+50, 50))/100))
	}
	sb.WriteString("</g>")
	for i := 0; i < 16; i++ {
		x, y := 900+k.rnd(i*2, 480), k.rnd(i*2+1, 260)
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, y, 1+float64(k.rnd(i+70, 12))/10, h.accent, k.op(.5, .7)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMin slice", sb.String()),
		{image: k.blob(10, 100, 60, 40, k.cool, 16)},
		backdropGround(k),
	}
}

// themeBackdropGlossUltraviolet is blacklight interference: two sets of fine concentric rings,
// one from the lower left and one from the upper right, whose overlap makes moire fringes.
func themeBackdropGlossUltraviolet(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	for i := 1; i < 64; i++ {
		r := i * 17
		sb.WriteString(fmt.Sprintf("<circle cx='260' cy='700' r='%d' fill='none' stroke='%s' stroke-width='.9' opacity='%s'/>", r, h.accent, k.op(.2, .17)))
		sb.WriteString(fmt.Sprintf("<circle cx='1130' cy='140' r='%d' fill='none' stroke='%s' stroke-width='.9' opacity='%s'/>", r+int(k.rnd(1, 5)), h.cool, k.op(.17, .14)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(18, 88, 50, 40, k.accent, 40)},
		{image: k.blob(82, 10, 44, 34, k.second, 28)},
		backdropGround(k),
	}
}

// themeBackdropGraphitePrism is light split by glass: short runs of hairline in three offset
// colours, like colour fringing along an edge, slanting across the page at one steady angle.
func themeBackdropGraphitePrism(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<g transform='rotate(-32 700 400)'>")
	for i := 0; i < 46; i++ {
		y := 40 + i*19 + k.rnd(i, 14)
		x := k.rnd(i+30, 1100) - 200
		l := 260 + k.rnd(i+60, 700)
		for j, c := range []string{h.accent, h.warm, h.cool} {
			sb.WriteString(fmt.Sprintf("<line x1='%d' y1='%d' x2='%d' y2='%d' stroke='%s' stroke-width='1.8' opacity='%s'/>", x, y+j*4, x+l, y+j*4, c, k.op(.7, .6)))
		}
	}
	sb.WriteString("</g>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(20, 20, 50, 40, k.accent, 34)},
		backdropGround(k),
	}
}

// themeBackdropGraphiteTwill is a carbon layup: broad diagonal tows of fibre, each shaded across
// its width so it catches a ribbon of sheen, laid down overlapping at uneven lengths.
func themeBackdropGraphiteTwill(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='t' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='0'/><stop offset='.45' stop-color='" + h.accent + "' stop-opacity='" + k.op(.4, .34) + "'/><stop offset='.6' stop-color='" + h.accent + "' stop-opacity='" + k.op(.2, .16) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></linearGradient></defs>")
	sb.WriteString("<g transform='rotate(-38 700 400)'>")
	x := -500
	for i := 0; i < 28; i++ {
		w := 50 + k.rnd(i, 80)
		y := -300 + k.rnd(i+20, 500)
		l := 700 + k.rnd(i+40, 900)
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='url(#t)'/>", x, y, w, l))
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='1' height='%d' fill='%s' opacity='%s'/>", x, y, l, h.accent, k.op(.5, .45)))
		x += w + 4 + k.rnd(i+60, 20)
	}
	sb.WriteString("</g>")
	return []backdropLayer{svgScene(1400, 800, "xMidYMid slice", sb.String()), backdropGround(k)}
}

// themeBackdropGray is haze in the hills: five soft ridgelines in blue-grey, the far ones faint and
// the near ones darker, with mist laid over each so they dissolve upward.
func themeBackdropGray(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='m' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.ground + "' stop-opacity='0'/><stop offset='1' stop-color='" + h.ground + "' stop-opacity='.75'/></linearGradient></defs>")
	for r := 0; r < 5; r++ {
		base := 430 + r*70
		amp := 80 + r*14
		pts := make([]int, 0, 22)
		for i := 0; i <= 20; i++ {
			pts = append(pts, base-k.rnd(r*30+i, amp))
		}
		d := fmt.Sprintf("M0 %d", pts[0])
		for i := 1; i < 20; i++ {
			d += fmt.Sprintf("Q%d %d %d %d", i*70, pts[i], i*70+35, (pts[i]+pts[i+1])/2)
		}
		d += fmt.Sprintf("L1400 %d", pts[20])
		d += "L1400 800L0 800Z"
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='%s' opacity='%s'/>", d, h.accent, k.op(.07+float64(r)*0.035, .06+float64(r)*0.04)))
		sb.WriteString(fmt.Sprintf("<rect x='0' y='%d' width='1400' height='140' fill='url(#m)'/>", base-60))
	}
	return []backdropLayer{svgScene(1400, 800, "xMidYMax slice", sb.String()), backdropGround(k)}
}

// themeBackdropGreatWave is one big curling wave rising from the lower right: the claw of the
// crest, contour lines following its swell, and flecks of foam spilling off the tip.
func themeBackdropGreatWave(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	body := "M560 800C610 540 780 300 1040 245C1200 212 1320 262 1400 340L1400 800Z"
	sb.WriteString("<path d='" + body + "' fill='" + h.accent + "' opacity='" + k.op(.10, .12) + "'/>")
	for j := 1; j <= 7; j++ {
		sb.WriteString(fmt.Sprintf("<path d='M560 800C610 540 780 300 1040 245C1200 212 1320 262 1400 340' fill='none' stroke='%s' stroke-width='1.3' opacity='%s' transform='translate(%d %d)'/>", h.accent, k.op(.34-float64(j)*0.03, .38-float64(j)*0.035), j*46, j*38))
	}
	sb.WriteString("<path d='M1040 245C1120 195 1240 215 1262 292C1276 340 1228 372 1194 346C1170 326 1184 292 1210 296' fill='none' stroke='" + h.accent + "' stroke-width='2.2' opacity='" + k.op(.5, .55) + "'/>")
	for i := 0; i < 34; i++ {
		x, y := 1000+k.rnd(i*3, 330), 170+k.rnd(i*3+1, 190)
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%.1f' fill='%s' opacity='%s'/>", x, y, 1.2+float64(k.rnd(i*3+2, 38))/10, h.warm, k.op(.5, .5)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 55%, " + k.veil(h.accent, 14) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropGunmetalBronze is brushed metal: fine horizontal grain pulled out of stretched
// noise in bronze, a warm bloom low on one side and a cool patina bloom on the other.
func themeBackdropGunmetalBronze(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.0015 0.45' numOctaves='2' seed='7'/><feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.6 0 0 0 -.62' result='a'/><feFlood flood-color='" + h.accent + "'/><feComposite in2='a' operator='in'/></filter></defs>")
	sb.WriteString("<rect width='1400' height='800' filter='url(#n)' opacity='" + k.op(.55, .5) + "'/>")
	for i := 0; i < 12; i++ {
		y := 60 + k.rnd(i, 700)
		x := k.rnd(i+20, 900)
		sb.WriteString(fmt.Sprintf("<line x1='%d' y1='%d' x2='%d' y2='%d' stroke='%s' stroke-width='.8' opacity='%s'/>", x, y, x+200+k.rnd(i+40, 500), y, h.warm, k.op(.3, .26)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "none", sb.String()),
		{image: k.blob(12, 104, 60, 40, k.accent, 30)},
		{image: k.blob(94, 90, 40, 36, k.cool, 14)},
		backdropGround(k),
	}
}
