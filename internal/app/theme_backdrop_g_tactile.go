package app

import (
	"fmt"
	"strings"
)

// Backdrop recipes of the tactile theme group; see theme_groups.go. Each one is drawn for one family:
// it has to fit that theme's name, shape and colours. They are scenes as big as the window, drawn
// as an SVG from the theme's own four colours (k.hex), quiet enough that rows can sit on top.

// tactileInk is the neutral a printed line or a key's shadow is drawn in.
func tactileInk(k backdropKit) string {
	if k.dark {
		return "#ffffff"
	}
	return "#000000"
}

// themeBackdropLabelTape is the "labeltape" recipe: strips of laminated tape run off a printer
// across the page, one cartridge colour each, with printed text and a cut end that has a bite out
// of it, and the scraps that were cut off lying about.
func themeBackdropLabelTape(k backdropKit) []backdropLayer {
	h := k.hex
	ink := tactileInk(k)
	var sb strings.Builder
	// strip draws one piece of tape from (x,y), len long and w wide, turned by deg: a chamfered
	// start, a V-shaped bite at the cut end, a line of print and a faint gloss along the top.
	strip := func(x, y, ln, w int, deg float64, fill string, text int) {
		const c, n = 7, 9
		sb.WriteString(fmt.Sprintf("<g transform='translate(%d %d) rotate(%.1f)'>", x, y, deg))
		sb.WriteString(fmt.Sprintf("<polygon points='%d,0 %d,0 %d,%d %d,%d %d,%d 0,%d 0,%d' fill='%s' opacity='%s'/>",
			c, ln, ln-n, w/2, ln, w, c, w, w, w-c, fill, k.op(.34, .30)))
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='1' width='%d' height='2' fill='#fff' opacity='.5'/>", c, ln-c-n))
		for i := 0; i < text; i++ {
			dx := 14 + i*13
			if dx > ln-30 {
				break
			}
			wd := 5 + k.rnd(x+y+i, 7)
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='1' fill='%s' opacity='.55'/>", dx, w/2-4, wd, 8, ink))
		}
		sb.WriteString("</g>")
	}
	strip(-60, 120, 700, 34, 8, h.accent, 40)
	strip(380, 250, 760, 40, -6, h.warm, 44)
	strip(-40, 420, 640, 30, -11, h.cool, 34)
	strip(520, 600, 700, 36, 5, h.second, 38)
	strip(60, 740, 520, 28, -4, ink, 28)
	strip(700, 60, 420, 26, 14, ink, 22)
	// Scraps: short pieces cut off the end of a strip.
	strip(300, 330, 90, 26, 24, h.warm, 5)
	strip(930, 470, 80, 24, -18, h.accent, 4)
	strip(210, 560, 100, 26, 12, h.second, 6)
	strip(1010, 790, 110, 24, -9, h.cool, 7)
	return []backdropLayer{
		svgScene(1200, 800, "xMidYMid slice", sb.String()),
		backdropGround(k),
	}
}

// themeBackdropKeycapField is a keyboard deck seen from above: rows of keycap tops on the
// stagger a real board has, each a dished top inside a darker skirt, a few in the theme's colours
// the way an Esc and an Enter are.
func themeBackdropKeycapField(k backdropKit) []backdropLayer {
	h := k.hex
	ink := tactileInk(k)
	accents := []string{h.accent, h.second, h.warm, h.cool}
	var sb strings.Builder
	const unit, gap = 58, 6
	widths := []int{2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2}
	for row := 0; row < 8; row++ {
		x := -(row%3)*unit/2 - 20
		y := 12 + row*(unit+gap)
		for i := 0; x < 1240; i++ {
			w := unit
			if (row+i)%7 == 3 {
				w = int(float64(unit) * 1.5)
			} else if i < len(widths) && row%4 == 1 && widths[i] == 2 {
				w = unit * 2
			}
			fill := ink
			skirt, top := k.op(.10, .08), k.op(.05, .06)
			if k.rnd(row*31+i, 11) == 0 {
				fill = accents[k.rnd(row*7+i, 4)]
				skirt, top = k.op(.32, .28), k.op(.18, .2)
			}
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='9' fill='%s' opacity='%s'/>", x, y, w, unit, fill, skirt))
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' rx='7' fill='%s' opacity='%s'/>", x+7, y+5, w-14, unit-16, fill, top))
			sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='2' rx='1' fill='#fff' opacity='%s'/>", x+10, y+7, w-20, k.op(.55, .12)))
			x += w + gap
		}
	}
	return []backdropLayer{
		svgScene(1200, 800, "xMidYMid slice", sb.String()),
		{image: k.blob(50, 0, 100, 40, k.accent, 22)},
		backdropGround(k),
	}
}

// themeBackdropRackCables is the front of a rack: two rows of patch ports, a patch cable in
// each colour of the theme looping from one to the other, cable ties holding the bundles and an
// LED over every port.
func themeBackdropRackCables(k backdropKit) []backdropLayer {
	h := k.hex
	ink := tactileInk(k)
	cols := []string{h.accent, h.second, h.warm, h.cool}
	var sb strings.Builder
	port := func(x, y int) {
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='26' height='22' rx='3' fill='%s' opacity='%s'/>", x, y, ink, k.op(.28, .22)))
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='18' height='12' rx='2' fill='%s' opacity='%s'/>", x+4, y+5, h.ground, k.op(.8, .9)))
	}
	for i := 0; i < 24; i++ {
		x := 24 + i*50
		port(x, 70)
		port(x, 700)
		led := cols[3]
		if i%5 == 2 {
			led = cols[2]
		}
		if i%11 == 7 {
			led = cols[1]
		}
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='60' r='3' fill='%s' opacity='.85'/>", x+13, led))
		sb.WriteString(fmt.Sprintf("<circle cx='%d' cy='690' r='3' fill='%s' opacity='.6'/>", x+13, led))
	}
	// Cables: each leaves a top port, drops, sags below the middle and rises into a bottom port.
	cable := func(from, to, sag, ci int) {
		x1, x2 := 37+from*50, 37+to*50
		c := cols[ci%4]
		d := fmt.Sprintf("M%d 92 C%d %d %d %d %d 700", x1, x1, 92+sag, x2, 700-sag/2, x2)
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='11' stroke-linecap='round' opacity='%s'/>", d, ink, k.op(.18, .26)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='%s' stroke-width='7' stroke-linecap='round' opacity='%s'/>", d, c, k.op(.55, .5)))
		sb.WriteString(fmt.Sprintf("<path d='%s' fill='none' stroke='#fff' stroke-width='1.5' stroke-linecap='round' opacity='.35' transform='translate(-2 0)'/>", d))
	}
	cable(2, 9, 420, 0)
	cable(5, 3, 480, 1)
	cable(8, 15, 400, 2)
	cable(12, 7, 460, 3)
	cable(14, 21, 430, 0)
	cable(18, 16, 500, 2)
	cable(20, 12, 380, 1)
	cable(1, 19, 520, 3)
	// Cable ties where the bundles run together near the top and bottom.
	for _, t := range [][2]int{{150, 150}, {350, 160}, {560, 150}, {760, 160}, {950, 150}, {200, 640}, {470, 630}, {700, 640}, {900, 630}} {
		sb.WriteString(fmt.Sprintf("<rect x='%d' y='%d' width='26' height='6' rx='2' fill='%s' opacity='%s'/>", t[0], t[1], ink, k.op(.4, .45)))
	}
	return []backdropLayer{
		svgScene(1200, 800, "xMidYMid slice", sb.String()),
		backdropGround(k),
	}
}
