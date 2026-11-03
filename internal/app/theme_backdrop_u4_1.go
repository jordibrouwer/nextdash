package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropSynthSunset is the retro sun: a big striped half-disc sinking into a hot horizon in
// the lower right, pink at the bottom and yellow at the top, with a neon line and a glow along the
// horizon.
func themeBackdropSynthSunset(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.warm + "'/><stop offset='.5' stop-color='" + h.accent + "'/><stop offset='1' stop-color='" + h.second + "'/></linearGradient>")
	sb.WriteString("<mask id='m'><rect width='1400' height='800' fill='#fff'/>")
	y := 520.0
	th := 3.0
	for y < 770 {
		sb.WriteString(fmt.Sprintf("<rect x='500' y='%.0f' width='1000' height='%.1f' fill='#000'/>", y, th))
		y += 26 + th*1.6
		th += 2.6
	}
	sb.WriteString("</mask><filter id='g' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='26'/></filter><filter id='l' x='-5%' y='-900%' width='110%' height='1900%'><feGaussianBlur stdDeviation='5'/></filter></defs>")
	sb.WriteString("<circle cx='1010' cy='770' r='330' fill='" + h.accent + "' opacity='" + k.op(.4, .5) + "' filter='url(#g)'/>")
	sb.WriteString("<circle cx='1010' cy='770' r='300' fill='url(#s)' mask='url(#m)' opacity='" + k.op(.62, .7) + "'/>")
	sb.WriteString("<rect x='0' y='768' width='1400' height='3' fill='" + h.cool + "' opacity='" + k.op(.7, .8) + "' filter='url(#l)'/>")
	sb.WriteString("<rect x='0' y='768' width='1400' height='2' fill='" + h.cool + "' opacity='" + k.op(.8, .9) + "'/>")
	sb.WriteString("<rect x='0' y='771' width='1400' height='40' fill='" + h.second + "' opacity='" + k.op(.16, .2) + "'/>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(88, 108, 70, 40, k.second, 40)},
		{image: "linear-gradient(180deg, transparent 55%, " + k.veil(k.accent, 22) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropTarnishedBrass is hammered brass: overlapping dents each with a bright rim on the
// lit side and a shadow on the other, crowded toward the edges, with green tarnish bleeding in
// from the corners.
func themeBackdropTarnishedBrass(k backdropKit) []backdropLayer {
	h := k.hex
	shadow := "#000000"
	if !k.dark {
		shadow = h.warm
	}
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-40%' y='-40%' width='180%' height='180%'><feGaussianBlur stdDeviation='48'/></filter></defs>")
	sb.WriteString("<circle cx='80' cy='700' r='260' fill='" + h.cool + "' opacity='" + k.op(.3, .36) + "' filter='url(#b)'/>")
	sb.WriteString("<circle cx='1300' cy='120' r='230' fill='" + h.cool + "' opacity='" + k.op(.28, .32) + "' filter='url(#b)'/>")
	sb.WriteString("<circle cx='1220' cy='740' r='200' fill='" + h.warm + "' opacity='" + k.op(.26, .3) + "' filter='url(#b)'/>")
	arc := func(cx, cy, r, a0, a1 float64, c string, w float64, op string) {
		x0, y0 := cx+r*math.Cos(a0), cy+r*math.Sin(a0)
		x1, y1 := cx+r*math.Cos(a1), cy+r*math.Sin(a1)
		sb.WriteString(fmt.Sprintf("<path d='M%.1f %.1fA%.1f %.1f 0 0 1 %.1f %.1f' fill='none' stroke='%s' stroke-width='%.1f' stroke-linecap='round' opacity='%s'/>", x0, y0, r, r, x1, y1, c, w, op))
	}
	n := 0
	for i := 0; i < 90 && n < 52; i++ {
		x := float64(k.rnd(i*5+1, 1400))
		y := float64(k.rnd(i*5+2, 800))
		if x > 330 && x < 1070 && y > 130 && y < 600 {
			continue
		}
		r := 26 + float64(k.rnd(i*5+3, 62))
		tilt := float64(k.rnd(i*5+4, 60)) / 100
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='%s' opacity='%s'/>", x, y, r, h.accent, k.op(.06, .08)))
		arc(x, y, r, math.Pi*(1.05+tilt), math.Pi*(1.62+tilt), h.accent, 3, k.op(.6, .62))
		arc(x, y, r, math.Pi*(0.05+tilt), math.Pi*(0.62+tilt), shadow, 3, k.op(.4, .5))
		arc(x, y, r*.62, math.Pi*(1.1+tilt), math.Pi*(1.5+tilt), h.warm, 1.6, k.op(.45, .45))
		n++
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(50, 112, 100, 36, k.accent, 22)},
		backdropGround(k),
	}
}

// themeBackdropTerminalAmber is a terminal burned into its own screen: a huge prompt chevron and
// block cursor ghosted at the lower left, a progress bar along the bottom, double-line box corners
// at the four corners and an amber phosphor glow at the screen edge.
func themeBackdropTerminalAmber(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='g' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='16'/></filter></defs>")
	corner := func(tx, ty, sx, sy float64) string {
		return fmt.Sprintf("<g transform='translate(%.0f %.0f) scale(%.0f %.0f)'><path d='M0 150V0H150M16 150V16H150' fill='none' stroke='%s' stroke-width='3' opacity='%s'/></g>", tx, ty, sx, sy, h.accent, k.op(.55, .6))
	}
	sb.WriteString(corner(36, 36, 1, 1) + corner(1364, 36, -1, 1) + corner(36, 764, 1, -1) + corner(1364, 764, -1, -1))
	chev := "<path d='M96 636L176 686L96 736' fill='none' stroke='" + h.accent + "' stroke-width='24' stroke-linecap='square' stroke-linejoin='miter'/>"
	cur := "<rect x='216' y='630' width='70' height='112' fill='" + h.accent + "'/>"
	sb.WriteString("<g filter='url(#g)' opacity='" + k.op(.55, .6) + "'>" + chev + cur + "</g>")
	sb.WriteString("<g opacity='" + k.op(.45, .5) + "'>" + chev + cur + "</g>")
	sb.WriteString("<rect x='440' y='748' width='520' height='20' fill='none' stroke='" + h.warm + "' stroke-width='3' opacity='" + k.op(.5, .55) + "'/>")
	sb.WriteString("<rect x='448' y='756' width='318' height='4' fill='" + h.warm + "' opacity='" + k.op(.6, .65) + "'/><rect x='448' y='756' width='318' height='4' fill='" + h.warm + "' opacity='.0'/>")
	sb.WriteString("<rect x='448' y='752' width='318' height='12' fill='" + h.warm + "' opacity='" + k.op(.22, .26) + "'/>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: "radial-gradient(ellipse at 50% 50%, transparent 52%, " + k.veil(k.accent, 22) + " 100%)"},
		{image: k.blob(10, 100, 70, 40, k.warm, 26)},
		backdropGround(k),
	}
}

// themeBackdropTerracottaStudio is a thrown pot cropped by the lower right corner: the ridges a
// potter's fingers leave as bowed lines round its belly, a speckled clay body, and a slip glaze
// running down in drips from the top left edge.
func themeBackdropTerracottaStudio(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='c' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='.55'/><stop offset='.45' stop-color='" + h.cool + "' stop-opacity='.22'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='.5'/></linearGradient></defs>")
	cx := 1130.0
	hw := func(y float64) float64 {
		t := (y - 230) / 600
		return 90 + 160*math.Sin(math.Pi*(0.12+0.8*t))
	}
	var left, right []string
	for y := 230.0; y <= 840; y += 20 {
		left = append(left, fmt.Sprintf("%.0f %.0f", cx-hw(y), y))
		right = append([]string{fmt.Sprintf("%.0f %.0f", cx+hw(y), y)}, right...)
	}
	sb.WriteString("<polygon points='" + strings.Join(left, " ") + " " + strings.Join(right, " ") + "' fill='url(#c)' opacity='" + k.op(.8, .9) + "'/>")
	for i, y := 0, 250.0; y < 820; i, y = i+1, y+21 {
		w := hw(y)
		c, op := h.accent, k.op(.5, .55)
		if i%3 == 2 {
			c, op = h.warm, k.op(.35, .4)
		}
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fQ%.0f %.0f %.0f %.0f' fill='none' stroke='%s' stroke-width='1.8' opacity='%s'/>", cx-w, y, cx, y+22, cx+w, y, c, op))
	}
	for i := 0; i < 70; i++ {
		y := 240 + float64(k.rnd(i*3+1, 580))
		w := hw(y)
		x := cx - w + float64(k.rnd(i*3+2, int(w*2)))
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.1f' fill='%s' opacity='%s'/>", x, y, 1+float64(k.rnd(i*3+3, 20))/10, h.second, k.op(.55, .5)))
	}
	sb.WriteString("<rect x='-10' y='-10' width='460' height='34' fill='" + h.second + "' opacity='" + k.op(.45, .5) + "'/>")
	for i, d := range []struct{ x, l int }{{30, 150}, {110, 70}, {190, 230}, {268, 110}, {340, 180}, {412, 60}} {
		sb.WriteString(fmt.Sprintf("<line x1='%d' y1='20' x2='%d' y2='%d' stroke='%s' stroke-width='%d' stroke-linecap='round' opacity='%s'/>", d.x, d.x, d.l, h.second, 16+(i%3)*3, k.op(.45, .5)))
		sb.WriteString(fmt.Sprintf("<line x1='%d' y1='20' x2='%d' y2='%d' stroke='%s' stroke-width='3' stroke-linecap='round' opacity='.5'/>", d.x-4, d.x-4, d.l-6, h.warm))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMax slice", sb.String()),
		{image: k.blob(88, 110, 80, 40, k.accent, 34)},
		backdropGround(k),
	}
}

// themeBackdropThunderhead is a storm seen the moment it strikes: one forked bolt with branches
// coming down the upper right, a second faint one far left, and the cloud flashing violet behind.
func themeBackdropThunderhead(k backdropKit) []backdropLayer {
	h := k.hex
	core := "#ffffff"
	if !k.dark {
		core = h.second
	}
	bolt := func(x, y float64, seed, steps int, spread float64) (string, string) {
		var main, branches strings.Builder
		main.WriteString(fmt.Sprintf("M%.0f %.0f", x, y))
		cx, cy := x, y
		for i := 0; i < steps; i++ {
			cx += (float64(k.rnd(seed+i*7, 100)) - 50) * spread / 50
			cy += 34 + float64(k.rnd(seed+i*7+1, 40))
			main.WriteString(fmt.Sprintf("L%.0f %.0f", cx, cy))
			if i > 1 && k.rnd(seed+i*7+2, 100) < 46 {
				dir := 1.0
				if k.rnd(seed+i*7+3, 2) == 0 {
					dir = -1
				}
				bx, by := cx, cy
				branches.WriteString(fmt.Sprintf("M%.0f %.0f", bx, by))
				for j := 0; j < 3+k.rnd(seed+i, 3); j++ {
					bx += dir * (20 + float64(k.rnd(seed+i*11+j, 36)))
					by += 18 + float64(k.rnd(seed+i*13+j, 34))
					branches.WriteString(fmt.Sprintf("L%.0f %.0f", bx, by))
				}
			}
		}
		return main.String(), branches.String()
	}
	m1, b1 := bolt(1090, -10, 3, 12, 90)
	m2, b2 := bolt(140, -10, 41, 8, 70)
	var sb strings.Builder
	sb.WriteString("<defs><filter id='g' x='-60%' y='-20%' width='220%' height='140%'><feGaussianBlur stdDeviation='9'/></filter><radialGradient id='f'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='.55'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></radialGradient></defs>")
	sb.WriteString("<ellipse cx='1060' cy='60' rx='520' ry='260' fill='url(#f)' opacity='" + k.op(.8, 1) + "'/>")
	sb.WriteString("<ellipse cx='140' cy='40' rx='300' ry='170' fill='url(#f)' opacity='" + k.op(.45, .55) + "'/>")
	stroke := func(d, c string, w float64, op string, filt string) {
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='%.1f' stroke-linejoin='round' stroke-linecap='round' opacity='%s'%s/>", d, c, w, op, filt))
	}
	stroke(m1+b1, h.second, 16, k.op(.5, .55), " filter='url(#g)'")
	stroke(m1, h.accent, 4, k.op(.7, .8), "")
	stroke(b1, h.accent, 2.4, k.op(.6, .7), "")
	stroke(m1, core, 1.6, k.op(.8, .9), "")
	stroke(m2+b2, h.accent, 12, k.op(.28, .34), " filter='url(#g)'")
	stroke(m2, h.accent, 2.4, k.op(.45, .55), "")
	stroke(b2, h.accent, 1.6, k.op(.4, .5), "")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMin slice", sb.String()),
		{image: k.blob(80, 0, 90, 34, k.cool, 34)},
		backdropGround(k),
	}
}

// themeBackdropTidalSlate is a shoreline seen from above at falling tide: scalloped, foam-edged
// water lines that run diagonally across the page, each one leaving a deeper wash behind it.
func themeBackdropTidalSlate(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cols := []string{h.accent, h.cool}
	for i := 0; i < 7; i++ {
		b := 150 + float64(i)*88
		pts := make([]string, 0, 72)
		fi := float64(i)
		for x := -20.0; x <= 1420; x += 20 {
			y := b + 0.2*x + 14*math.Sin(x/57+fi) + 9*math.Sin(x/19+fi*2.3) + float64(k.rnd(i*100+int(x), 7))
			pts = append(pts, fmt.Sprintf("%.0f %.0f", x, y))
		}
		line := "M" + strings.Join(pts, "L")
		sb.WriteString(fmt.Sprintf("<path d='%sL1420 -20L-20 -20Z' fill='%s' opacity='%s'/>", line, cols[i%2], k.op(.11, .14)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='2.2' stroke-dasharray='%d 12 %d 7 28 16' opacity='%s'/>", line, h.accent, 70+i*9, 24+i*4, k.op(.6, .62)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='1' transform='translate(0 10)' stroke-dasharray='40 22 90 14' opacity='%s'/>", line, h.cool, k.op(.4, .42)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(10, 4, 90, 40, k.cool, 40)},
		{image: k.blob(92, 108, 80, 40, k.warm, 20)},
		backdropGround(k),
	}
}

// themeBackdropTidepoolLens is optics under water: a tall biconvex lens at the lower left with a
// fringe of colour on its rim, parallel beams bending through it to one bright focal flare, and a
// small second lens in the top right corner.
func themeBackdropTidepoolLens(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='r' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='0'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='.7'/></linearGradient>" +
		"<linearGradient id='l' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='.4'/><stop offset='1' stop-color='" + h.cool + "' stop-opacity='.12'/></linearGradient>" +
		"<radialGradient id='f'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='.95'/><stop offset='.35' stop-color='" + h.warm + "' stop-opacity='.35'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='0'/></radialGradient>" +
		"<linearGradient id='b' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='.3'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='.1'/></linearGradient></defs>")
	fx, fy := 940.0, 690.0
	sb.WriteString(fmt.Sprintf("<polygon points='330,470 330,760 %.0f %.0f' fill='url(#b)' opacity='%s'/>", fx, fy, k.op(.8, 1)))
	for i := 0; i < 6; i++ {
		y := 465 + float64(i)*58
		sb.WriteString(fmt.Sprintf("<path d='M-20 %.0fL330 %.0fL%.0f %.0f' fill='none' stroke='url(#r)' stroke-width='1.8' opacity='%s'/>", y, y, fx, fy, k.op(.8, .9)))
		sb.WriteString(fmt.Sprintf("<path d='M330 %.0fL%.0f %.0f' fill='none' stroke='%s' stroke-width='1.6' opacity='%s'/>", y, fx, fy, h.accent, k.op(.45, .5)))
	}
	lens := func(cx, cy, w, ht float64, bop string) {
		d := fmt.Sprintf("M%.0f %.0fQ%.0f %.0f %.0f %.0fQ%.0f %.0f %.0f %.0fZ", cx, cy-ht/2, cx+w, cy, cx, cy+ht/2, cx-w, cy, cx, cy-ht/2)
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='url(#l)' opacity='%s'/>", d, bop))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='2.6' transform='translate(4 -2)' opacity='%s'/>", d, h.second, k.op(.5, .5)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='2.6' transform='translate(-4 2)' opacity='%s'/>", d, h.warm, k.op(.5, .5)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='3' opacity='%s'/>", d, h.accent, k.op(.8, .85)))
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fQ%.0f %.0f %.0f %.0f' fill='none' stroke='%s' stroke-width='2' stroke-linecap='round' opacity='%s'/>", cx-w*.28, cy-ht*.34, cx-w*.52, cy-ht*.12, cx-w*.4, cy+ht*.12, h.cool, k.op(.7, .8)))
	}
	lens(330, 610, 120, 460, k.op(.9, 1))
	lens(1240, 130, 58, 190, k.op(.8, .9))
	sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='84' fill='url(#f)' opacity='%s'/>", fx, fy, k.op(.8, .9)))
	sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fh120M%.0f %.0fh120M%.0f %.0fv70M%.0f %.0fv70' stroke='%s' stroke-width='1.6' stroke-linecap='round' opacity='%s'/>", fx-60, fy, fx-60, fy, fx, fy-35, fx, fy-35, h.warm, k.op(.6, .7)))
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(62, 92, 90, 40, k.cool, 28)},
		backdropGround(k),
	}
}

// themeBackdropTomorrowDusk is the sky at the blue hour: long thin lens-shaped streaks of high
// cloud, blue near the top and lit gold, then red, toward the bottom, and one evening planet with
// a cross of light in the upper right.
func themeBackdropTomorrowDusk(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><radialGradient id='p'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='.9'/><stop offset='.25' stop-color='" + h.warm + "' stop-opacity='.3'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='0'/></radialGradient>" +
		"<linearGradient id='x' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='0'/><stop offset='.5' stop-color='" + h.warm + "' stop-opacity='.8'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='0'/></linearGradient></defs>")
	for i := 0; i < 20; i++ {
		y := 300 + float64(i)*26 + float64(k.rnd(i*3, 14))
		c, op := h.accent, k.op(.5, .55)
		switch {
		case y > 700:
			c, op = h.second, k.op(.5, .5)
		case y > 560:
			c, op = h.warm, k.op(.5, .55)
		}
		l := 260 + float64(k.rnd(i*3+1, 560))
		x := float64(k.rnd(i*3+2, 1500)) - 50
		t := 4 + float64(i)*.45 + float64(k.rnd(i*7, 6))
		tilt := -14 + float64(k.rnd(i*5, 10))
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fQ%.0f %.0f %.0f %.0fQ%.0f %.0f %.0f %.0fZ' fill='%s' opacity='%s'/>", x-l/2, y, x, y-t, x+l/2, y+tilt, x, y+t, x-l/2, y, c, op))
		if i%3 == 0 {
			sb.WriteString(fmt.Sprintf("<line x1='%.0f' y1='%.0f' x2='%.0f' y2='%.0f' stroke='%s' stroke-width='1.2' opacity='%s'/>", x-l*.8, y+t+8, x+l*.2, y+t+8+tilt*.6, c, k.op(.4, .45)))
		}
	}
	sb.WriteString("<circle cx='1140' cy='150' r='80' fill='url(#p)' opacity='" + k.op(.9, 1) + "'/>")
	sb.WriteString("<rect x='1070' y='149' width='140' height='2' fill='url(#x)' opacity='" + k.op(.8, .9) + "'/>")
	sb.WriteString("<rect x='1139' y='80' width='2' height='140' fill='url(#x)' opacity='" + k.op(.5, .6) + "' transform='rotate(0)'/>")
	sb.WriteString("<circle cx='1140' cy='150' r='4' fill='" + h.warm + "'/>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(k.accent, 16) + " 0%, transparent 45%)"},
		{image: k.blob(50, 108, 100, 34, k.warm, 34)},
		backdropGround(k),
	}
}

// themeBackdropTyrian is cloth dipped in purple dye: the colour wicks up from the bottom edge in
// ragged fingers, a second deeper bath beneath it, a thread of gold along the tide line, and a
// smaller dyed hem along the top.
func themeBackdropTyrian(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='w' x='-20%' y='-40%' width='140%' height='180%'><feTurbulence type='fractalNoise' baseFrequency='.007 .03' numOctaves='3' seed='7' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='190' xChannelSelector='R' yChannelSelector='G'/></filter>" +
		"<filter id='v' x='-20%' y='-40%' width='140%' height='180%'><feTurbulence type='fractalNoise' baseFrequency='.011 .05' numOctaves='2' seed='19' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='120' xChannelSelector='R' yChannelSelector='G'/><feGaussianBlur stdDeviation='2'/></filter>" +
		"<linearGradient id='d' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='.5'/><stop offset='1' stop-color='" + h.second + "' stop-opacity='.7'/></linearGradient>" +
		"<linearGradient id='e' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.second + "' stop-opacity='.2'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='.55'/></linearGradient></defs>")
	sb.WriteString("<g filter='url(#w)'><rect x='-300' y='560' width='2000' height='500' fill='url(#d)' opacity='" + k.op(.75, .85) + "'/>")
	sb.WriteString("<rect x='-300' y='559' width='2000' height='3' fill='" + h.warm + "' opacity='" + k.op(.8, .85) + "'/></g>")
	sb.WriteString("<g filter='url(#v)'><rect x='-300' y='680' width='2000' height='400' fill='url(#e)' opacity='" + k.op(.8, .9) + "'/></g>")
	sb.WriteString("<g filter='url(#v)'><rect x='-300' y='-300' width='2000' height='370' fill='url(#e)' opacity='" + k.op(.6, .7) + "'/>")
	sb.WriteString("<rect x='-300' y='68' width='2000' height='2' fill='" + h.warm + "' opacity='" + k.op(.6, .7) + "'/></g>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(14, 108, 70, 36, k.accent, 30)},
		backdropGround(k),
	}
}

// themeBackdropUltraviolet is blacklight paint: splatters in four fluorescent colours, each a
// lumpy core with drips, tapered streaks and a spray of droplets thrown out round it, glowing
// at the edges of the page.
func themeBackdropUltraviolet(k backdropKit) []backdropLayer {
	h := k.hex
	rf := func(n int, lo, hi float64) float64 { return lo + float64(k.rnd(n, 1000))/1000*(hi-lo) }
	splat := func(cx, cy, R float64, c string, seed int) string {
		var sb strings.Builder
		for i := 0; i < 7; i++ {
			a := rf(seed+i, 0, 2*math.Pi)
			d := rf(seed+i+50, 0, R*.5)
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='%s'/>", cx+d*math.Cos(a), cy+d*math.Sin(a), R*rf(seed+i+90, .38, .66), c))
		}
		for i := 0; i < 24; i++ {
			a := rf(seed+i*3+200, 0, 2*math.Pi)
			d := R * rf(seed+i*3+201, 1, 2.8)
			r := math.Max(1.8, R*.13*(1-(d/R-1)/2.2)*rf(seed+i*3+202, .5, 1.1))
			ex, ey := cx+d*math.Cos(a), cy+d*math.Sin(a)
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.1f' fill='%s'/>", ex, ey, r, c))
			if i%3 == 0 {
				sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='%.1f' stroke-linecap='round'/>", cx+R*.7*math.Cos(a), cy+R*.7*math.Sin(a), cx+d*.85*math.Cos(a), cy+d*.85*math.Sin(a), c, math.Max(2, r*.9)))
			}
		}
		for i := 0; i < 3; i++ {
			x := cx - R*.4 + float64(i)*R*.4 + rf(seed+i+300, -8, 8)
			l := R * rf(seed+i+310, .6, 1.9)
			sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fV%.0f' stroke='%s' stroke-width='%.0f' stroke-linecap='round'/><circle cx='%.0f' cy='%.0f' r='%.0f' fill='%s'/>", x, cy, cy+l, c, R*.07+2, x, cy+l+4, R*.07+3, c))
		}
		return sb.String()
	}
	type sp struct {
		x, y, r float64
		c       string
		seed    int
	}
	sps := []sp{{150, 650, 110, h.accent, 11}, {1290, 150, 90, h.cool, 23}, {1210, 700, 64, h.second, 37}, {90, 110, 46, h.warm, 53}}
	var body strings.Builder
	body.WriteString("<defs><filter id='g' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='14'/></filter></defs>")
	var g, s strings.Builder
	for _, p := range sps {
		g.WriteString(splat(p.x, p.y, p.r, p.c, p.seed))
		s.WriteString(splat(p.x, p.y, p.r, p.c, p.seed))
	}
	body.WriteString("<g filter='url(#g)' opacity='" + k.op(.6, .75) + "'>" + g.String() + "</g>")
	body.WriteString("<g opacity='" + k.op(.6, .65) + "'>" + s.String() + "</g>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", body.String()),
		{image: k.blob(50, 50, 90, 40, k.accent, 18)},
		backdropGround(k),
	}
}
