package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropRustedRail is a railway line running to a hazy horizon: two rails and fading
// sleepers in perspective, with a bloom of rust-coloured corrosion in the lower corners.
func themeBackdropRustedRail(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='f' gradientUnits='userSpaceOnUse' x1='0' y1='430' x2='0' y2='800'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='0'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='" + k.op(.5, .6) + "'/></linearGradient>" +
		"<filter id='r' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='.012 .02' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 .45 0 0 0 0 .1 0 0 0 3.2 -1.55'/></filter>" +
		"<radialGradient id='m' cx='.5' cy='.5' r='.5'><stop offset='0' stop-color='#fff'/><stop offset='1' stop-color='#000'/></radialGradient>" +
		"<mask id='k'><rect width='1400' height='800' fill='#000'/><ellipse cx='120' cy='800' rx='620' ry='300' fill='url(#m)'/><ellipse cx='1300' cy='790' rx='560' ry='260' fill='url(#m)'/></mask></defs>")
	sb.WriteString("<g mask='url(#k)' opacity='" + k.op(.3, .34) + "'><rect width='1400' height='800' filter='url(#r)'/></g>")
	for i := 1; i <= 13; i++ {
		t := float64(i) / 13
		y := 430 + t*t*370
		d := y - 430
		sb.WriteString(fmt.Sprintf("<rect x='%.1f' y='%.1f' width='%.1f' height='%.1f' fill='%s' opacity='%.2f'/>", 700-d*1.15, y, d*2.3, 2+d*.05, h.warm, (0.05+t*0.2)*map[bool]float64{true: 1, false: 0.8}[k.dark]))
	}
	for _, s := range []float64{-1, 1} {
		sb.WriteString(fmt.Sprintf("<path d='M700 430L%.0f 800' stroke='url(#f)' stroke-width='7' fill='none'/>", 700+s*760))
		sb.WriteString(fmt.Sprintf("<path d='M700 430L%.0f 800' stroke='%s' stroke-width='1.5' fill='none' opacity='.3'/>", 700+s*735, h.warm))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 54, 70, 12, k.warm, 36)},
		backdropGround(k),
	}
}

// themeBackdropSaffronRobe is cloth hanging in long folds: tall soft ribbons that sway from side
// to side, shaded from saffron to shadow, calmer toward the top.
func themeBackdropSaffronRobe(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='0'/><stop offset='.45' stop-color='" + h.accent + "' stop-opacity='" + k.op(.22, .26) + "'/><stop offset='.7' stop-color='" + h.warm + "' stop-opacity='" + k.op(.12, .16) + "'/><stop offset='1' stop-color='" + h.second + "' stop-opacity='0'/></linearGradient></defs>")
	for i := 0; i < 8; i++ {
		x := float64(i)*190 - 40 + float64(k.rnd(i, 60))
		w := 90 + float64(k.rnd(i+30, 90))
		sw := 60 + float64(k.rnd(i+60, 120))
		sb.WriteString(fmt.Sprintf("<path d='M%.0f 0C%.0f 240 %.0f 520 %.0f 800L%.0f 800C%.0f 520 %.0f 240 %.0f 0Z' fill='url(#g)'/>", x, x+sw, x-sw*.8, x+30, x+30+w, x-sw*.8+w*1.1, x+sw+w*.9, x+w))
		sb.WriteString(fmt.Sprintf("<path d='M%.0f 0C%.0f 240 %.0f 520 %.0f 800' stroke='%s' stroke-width='1.2' fill='none' opacity='%s'/>", x+w*.5, x+sw+w*.5, x-sw*.8+w*.55, x+30+w*.5, h.warm, k.op(.2, .22)))
	}
	return []backdropLayer{
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 70) + " 0, transparent 45%)"},
		svgScene(1400, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(30, 100, 70, 40, k.accent, 24)},
		backdropGround(k),
	}
}

// themeBackdropSakuraNight is a blossom branch reaching in from the lower left under soft pink
// lantern bokeh, with only a few blossoms and out-of-focus lights scattered at random.
func themeBackdropSakuraNight(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='7'/></filter></defs>")
	sb.WriteString("<g filter='url(#b)'>")
	cols := []string{h.accent, h.second, h.warm}
	for i := 0; i < 16; i++ {
		x, y := k.rnd(i*3, 1400), 300+k.rnd(i*3+1, 480)
		r := 14 + k.rnd(i*3+2, 40)
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='%d' fill='%s' opacity='%s'/>", x, y, r, cols[i%3], k.op(.14, .17)))
	}
	sb.WriteString("</g>")
	br := "<path d='M-20 790C160 700 300 650 460 520C540 456 600 380 700 330' stroke='" + h.accent + "' stroke-width='5' fill='none' stroke-linecap='round' opacity='" + k.op(.4, .4) + "'/>" +
		"<path d='M300 660C380 640 440 650 520 600M460 520C500 520 560 500 600 450M560 440C560 400 580 370 640 350M200 720C240 700 260 740 330 730' stroke='" + h.accent + "' stroke-width='2.4' fill='none' stroke-linecap='round' opacity='" + k.op(.36, .36) + "'/>"
	sb.WriteString(br)
	for i, p := range [][2]int{{700, 330}, {640, 350}, {600, 450}, {520, 600}, {440, 652}, {330, 730}, {260, 740}, {560, 500}, {385, 560}} {
		for a := 0; a < 5; a++ {
			ang := float64(a)*72 + float64(i*23)
			dx, dy := 11*math.Cos(ang*math.Pi/180), 11*math.Sin(ang*math.Pi/180)
			sb.WriteString(fmt.Sprintf("<circle cx='%.1f' cy='%.1f' r='9' fill='%s' opacity='%s'/>", float64(p[0])+dx, float64(p[1])+dy, h.accent, k.op(.34, .4)))
		}
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='%d' r='3.5' fill='%s' opacity='.7'/>", p[0], p[1], h.warm))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMinYMax slice", sb.String()),
		{image: k.blob(20, 110, 80, 40, k.accent, 22)},
		backdropGround(k),
	}
}

// themeBackdropSaltFlat is a white salt plain under a pale sky: a low horizon, and flattened
// polygon crust rings in perspective that shrink toward it, with a thin reflection of the sky.
func themeBackdropSaltFlat(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + h.warm + "' stop-opacity='0'/><stop offset='1' stop-color='" + h.warm + "' stop-opacity='" + k.op(.3, .3) + "'/></linearGradient></defs>")
	sb.WriteString("<rect x='0' y='340' width='1400' height='110' fill='url(#s)'/>")
	sb.WriteString("<rect x='0' y='450' width='1400' height='1.5' fill='" + h.accent + "' opacity='" + k.op(.5, .5) + "'/>")
	for i := 0; i < 34; i++ {
		t := float64(k.rnd(i*5, 100)) / 100
		y := 470 + t*t*320
		sc := 0.1 + t*1.3
		cx := float64(k.rnd(i*5+1, 1500)) - 50
		r := (40 + float64(k.rnd(i*5+2, 70))) * sc
		var pts []string
		n := 6
		for a := 0; a < n; a++ {
			ang := (float64(a) + float64(k.rnd(i*9+a, 40))/100) * 2 * math.Pi / float64(n)
			rr := r * (0.8 + float64(k.rnd(i*11+a, 40))/100)
			pts = append(pts, fmt.Sprintf("%.1f,%.1f", cx+rr*math.Cos(ang), y+rr*math.Sin(ang)*0.22))
		}
		col := []string{h.accent, h.cool, h.warm}[i%3]
		sb.WriteString(fmt.Sprintf("<polygon points='%s' fill='%s' fill-opacity='.05' stroke='%s' stroke-width='%.1f' opacity='%.2f'/>", strings.Join(pts, " "), col, col, 0.8+t, 0.3+t*0.4))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, transparent 40%, " + k.veil(k.accent, 14) + " 100%)"},
		backdropGround(k),
	}
}

// themeBackdropSatinNickel is brushed metal catching the light: a fine horizontal grain, a broad
// slanted sheen and a conic fan of highlight from the lower corner.
func themeBackdropSatinNickel(k backdropKit) []backdropLayer {
	h := k.hex
	grain := func(seed int, c, a string) backdropLayer {
		body := fmt.Sprintf("<filter id='n' x='0' y='0' width='1' height='1'><feTurbulence type='fractalNoise' baseFrequency='.003 .9' numOctaves='2' seed='%d' stitchTiles='stitch'/>"+
			"<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.2 0 0 0 -.95' result='m'/><feFlood flood-color='%s' flood-opacity='%s' result='f'/><feComposite in='f' in2='m' operator='in'/></filter>"+
			"<rect width='320' height='320' filter='url(#n)'/>", seed, c, a)
		return svgTile(k, 320, 320, body)
	}
	return []backdropLayer{
		{image: "conic-gradient(from 195deg at 12% 118%, transparent 0deg, " + k.veil(k.accent, 16) + " 14deg, transparent 28deg, " + k.veil(k.cool, 10) + " 44deg, transparent 60deg)"},
		{image: "linear-gradient(105deg, transparent 28%, " + k.veil(k.accent, 8) + " 42%, " + k.veil(k.cool, 12) + " 48%, " + k.veil(k.accent, 6) + " 54%, transparent 66%)"},
		grain(5, h.accent, k.op(.35, .4)),
		grain(21, h.warm, k.op(.2, .22)),
		backdropGround(k),
	}
}

// themeBackdropSeaGlass is beach glass: a loose scatter of frosted, rounded pebbles of different
// sizes, each translucent with a pale rim and a small highlight.
func themeBackdropSeaGlass(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cols := []string{h.accent, h.cool, h.accent, h.warm}
	for i := 0; i < 15; i++ {
		x, y := k.rnd(i*7, 1400), 160+k.rnd(i*7+1, 640)
		rx := 40 + k.rnd(i*7+2, 110)
		ry := rx * (55 + k.rnd(i*7+3, 35)) / 100
		rot := k.rnd(i*7+4, 180)
		c := cols[i%4]
		sb.WriteString(fmt.Sprintf("<g transform='rotate(%d %d %d)'><ellipse cx='%d' cy='%d' rx='%d' ry='%d' fill='%s' fill-opacity='%s' stroke='%s' stroke-opacity='%s' stroke-width='2'/>", rot, x, y, x, y, rx, ry, c, k.op(.09, .1), c, k.op(.35, .32)))
		sb.WriteString(fmt.Sprintf("<path d='M%d %dA%d %d 0 0 1 %d %d' stroke='#fff' stroke-width='3' fill='none' stroke-linecap='round' opacity='%s'/></g>", x-rx*6/10, y-ry/4, rx*7/10, ry*7/10, x-rx/5, y-ry*8/10, k.op(.45, .3)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 55) + " 0, transparent 40%)"},
		{image: k.blob(70, 100, 90, 40, k.cool, 22)},
		backdropGround(k),
	}
}

// themeBackdropSignalFlare is a flare going up in the dark: a hot core low on the right with
// crossing light streaks, and lens ghosts strung out along the diagonal toward the upper left.
func themeBackdropSignalFlare(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><radialGradient id='c'><stop offset='0' stop-color='#fff' stop-opacity='" + k.op(.75, .9) + "'/><stop offset='.12' stop-color='" + h.warm + "' stop-opacity='" + k.op(.55, .65) + "'/><stop offset='.45' stop-color='" + h.accent + "' stop-opacity='" + k.op(.2, .28) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></radialGradient>" +
		"<linearGradient id='l' x1='0' x2='1'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='0'/><stop offset='.5' stop-color='" + h.warm + "' stop-opacity='" + k.op(.55, .7) + "'/><stop offset='1' stop-color='" + h.accent + "' stop-opacity='0'/></linearGradient></defs>")
	fx, fy := 1080.0, 650.0
	sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='300' fill='url(#c)'/>", fx, fy))
	sb.WriteString(fmt.Sprintf("<rect x='%.0f' y='%.0f' width='1000' height='4' fill='url(#l)'/>", fx-500, fy-2))
	sb.WriteString(fmt.Sprintf("<g transform='rotate(-34 %.0f %.0f)'><rect x='%.0f' y='%.0f' width='760' height='3' fill='url(#l)'/></g>", fx, fy, fx-380, fy-1))
	cols := []string{h.second, h.cool, h.accent, h.warm, h.second}
	for i, t := range []float64{.28, .42, .55, .7, .86} {
		x, y := fx+(280-fx)*t, fy+(150-fy)*t
		r := 16 + float64((i*37)%34)
		if i%2 == 0 {
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='%s' opacity='%s'/>", x, y, r, cols[i], k.op(.2, .22)))
		} else {
			sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-width='2.5' opacity='%s'/>", x, y, r*1.4, cols[i], k.op(.38, .4)))
		}
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMaxYMax slice", sb.String()),
		{image: k.blob(80, 100, 70, 30, k.second, 16)},
		backdropGround(k),
	}
}

// themeBackdropSlate is cleaved slate: broad angular sheets that overlap like split stone, each
// a slightly different cool tint with one lighter cut edge.
func themeBackdropSlate(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	quads := [][8]int{
		{-80, 380, 520, 300, 640, 560, -40, 700},
		{380, 460, 980, 330, 1120, 640, 520, 800},
		{860, 360, 1500, 420, 1480, 760, 1000, 700},
		{140, 600, 700, 560, 820, 820, 100, 820},
		{700, 220, 1100, 200, 1180, 420, 760, 440},
		{-60, 130, 340, 110, 420, 330, -40, 360},
	}
	for i, q := range quads {
		c := []string{h.accent, h.cool, h.accent}[i%3]
		sb.WriteString(fmt.Sprintf("<polygon points='%d,%d %d,%d %d,%d %d,%d' fill='%s' fill-opacity='%s'/>", q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], c, k.op(.05+float64(i%3)*.015, .06+float64(i%3)*.02)))
		sb.WriteString(fmt.Sprintf("<path d='M%d %dL%d %d' stroke='%s' stroke-width='1.6' opacity='%s'/>", q[0], q[1], q[2], q[3], h.accent, k.op(.4, .38)))
		sb.WriteString(fmt.Sprintf("<path d='M%d %dL%d %d' stroke='#000' stroke-width='3' opacity='%s'/>", q[6], q[7], q[4], q[5], k.op(.06, .22)))
	}
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(k.ground, 50) + " 0, transparent 35%)"},
		{image: k.blob(80, 20, 80, 50, k.accent, 14)},
		backdropGround(k),
	}
}

// themeBackdropSlateOne is the left edge of a code editor: a gutter of line-number ticks with
// green, red and amber change bars, dotted indent guides and one lit current line with a cursor.
func themeBackdropSlateOne(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<rect x='0' y='418' width='1400' height='26' fill='" + h.accent + "' opacity='" + k.op(.06, .07) + "'/>")
	for i := 0; i < 32; i++ {
		y := 20 + i*26
		w := 8 + k.rnd(i, 14)
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='3' rx='1.5' fill='%s' opacity='%s'/>", 70-w, y+10, w, h.accent, k.op(.3, .26)))
	}
	for i, c := range []string{h.cool, h.second, h.warm, h.cool, h.cool, h.warm, h.second} {
		y := 80 + i*105 + k.rnd(i, 40)
		sb.WriteString(fmt.Sprintf("<rect x='88' y='%d' width='4' height='%d' rx='2' fill='%s' opacity='%s'/>", y, 26+k.rnd(i+9, 3)*26, c, k.op(.6, .62)))
	}
	for i := 0; i < 4; i++ {
		sb.WriteString(fmt.Sprintf("<path d='M%d 0V800' stroke='%s' stroke-width='1.4' stroke-dasharray='2 7' opacity='%s'/>", 150+i*42, h.accent, k.op(.4, .36)))
	}
	sb.WriteString("<rect x='330' y='422' width='12' height='19' fill='" + h.accent + "' opacity='" + k.op(.55, .6) + "'/>")
	return []backdropLayer{
		svgScene(1400, 800, "xMinYMid slice", sb.String()),
		{image: "linear-gradient(90deg, transparent 20%, " + k.veil(k.ground, 40) + " 55%)"},
		backdropGround(k),
	}
}

// themeBackdropSmokedPlum is smoke in a dark room: three wisps of plum-coloured smoke that rise,
// curl and thin out, blurred and torn by a turbulence so no two folds repeat.
func themeBackdropSmokedPlum(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	sb.WriteString("<defs><filter id='w' x='-30%' y='-30%' width='160%' height='160%'><feTurbulence type='fractalNoise' baseFrequency='.007 .011' numOctaves='2' seed='4' result='t'/><feDisplacementMap in='SourceGraphic' in2='t' scale='140'/><feGaussianBlur stdDeviation='14'/></filter>" +
		"<linearGradient id='f' gradientUnits='userSpaceOnUse' x1='0' y1='800' x2='0' y2='200'><stop offset='0' stop-color='" + h.accent + "' stop-opacity='" + k.op(.4, .5) + "'/><stop offset='1' stop-color='" + h.second + "' stop-opacity='0'/></linearGradient></defs>")
	sb.WriteString("<g filter='url(#w)' fill='none' stroke='url(#f)' stroke-linecap='round'>")
	sb.WriteString("<path d='M300 860C220 700 420 600 330 450C270 350 380 280 340 190' stroke-width='60'/>")
	sb.WriteString("<path d='M780 880C700 740 900 640 800 520C720 430 860 360 780 250' stroke-width='84'/>")
	sb.WriteString("<path d='M1180 860C1120 720 1280 640 1200 520C1150 440 1240 380 1190 300' stroke-width='52'/>")
	sb.WriteString("</g>")
	return []backdropLayer{
		svgScene(1400, 800, "xMidYMax slice", sb.String()),
		{image: k.blob(50, 112, 90, 34, k.accent, 22)},
		backdropGround(k),
	}
}
