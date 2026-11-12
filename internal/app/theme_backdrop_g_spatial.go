package app

import (
	"fmt"
	"strings"
)

// Backdrop recipes of the spatial theme group; see theme_groups.go. Each one is drawn for one family:
// it has to fit that theme's name, shape and colours.

// spatialJag is a repeatable pseudo-random number in 0..n-1 for the torn edges: the same sheet is
// cut the same way on every load, and no two edges of one backdrop share a pattern.
func spatialJag(i, salt, n int) int {
	h := uint32(i*2654435761) ^ uint32(salt*40503+17)
	h ^= h >> 13
	h *= 1274126177
	h ^= h >> 16
	return int(h % uint32(n))
}

// themeBackdropPaperCuts is a diorama looked down into: sheets of cut paper stacked from the far
// edge towards you, each with a torn or stepped upper edge and a hard shadow on the sheet below,
// in the paper tones of the theme.
func themeBackdropPaperCuts(k backdropKit) []backdropLayer {
	h := k.hex
	tones := []string{h.cool, h.second, h.warm, h.accent, h.second, h.warm}
	baseOp := k.op(0.34, 0.30)
	shadow := "#000"
	shadowOp := k.op(0.16, 0.38)
	var sb strings.Builder
	const w, ht = 1400, 900
	for i, tone := range tones {
		top := 120 + i*135
		var d strings.Builder
		fmt.Fprintf(&d, "M-20 %d", top)
		stepped := i%2 == 1
		y := top
		for x := 0; x <= w+40; x += 38 {
			j := spatialJag(x/38, i+1, 15)
			if stepped {
				// A stepped cut: straight runs with square shoulders, like scissor work.
				if j > 9 {
					y = top + (j-9)*5
				} else if j < 3 {
					y = top - j*4
				}
				fmt.Fprintf(&d, "H%d V%d", x+38, y)
			} else {
				// A torn edge: short uneven segments.
				fmt.Fprintf(&d, "L%d %d", x, top+j-6)
			}
		}
		fmt.Fprintf(&d, "V%d H-20Z", ht+20)
		path := d.String()
		// The shadow is the same cut, moved down and to the right and left hard.
		fmt.Fprintf(&sb, "<path d='%s' transform='translate(7 %d)' fill='%s' opacity='%s'/>", path, 8+i, shadow, shadowOp)
		fmt.Fprintf(&sb, "<path d='%s' fill='%s' opacity='%s'/>", path, tone, baseOp)
		// The paper's lit edge, a thin line along the cut.
		fmt.Fprintf(&sb, "<path d='%s' fill='none' stroke='#fff' stroke-width='1.4' opacity='%s'/>", strings.Split(path, "V"+fmt.Sprint(ht+20))[0], k.op(0.55, 0.16))
	}
	return []backdropLayer{
		svgScene(w, ht, "xMidYMid slice", sb.String()),
		{image: k.blob(50, 0, 90, 34, k.warm, 24)},
		backdropGround(k),
	}
}

// themeBackdropFilmstrip is strips of film lying at an angle across a light table: black rebate
// with sprocket holes along both edges, a coloured frame between them, amber edge print, and the
// glow of the table coming through.
func themeBackdropFilmstrip(k backdropKit) []backdropLayer {
	h := k.hex
	mount := "#0b0b0d"
	mountOp := k.op(0.55, 0.85)
	hole := "#ffffff"
	var sb strings.Builder
	const w, ht = 1400, 900
	strip := func(cy int, deg int, colours []string, frame int) {
		const sh = 150 // strip height
		fmt.Fprintf(&sb, "<g transform='translate(700 %d) rotate(%d)'>", cy, deg)
		fmt.Fprintf(&sb, "<rect x='-1500' y='%d' width='3000' height='%d' fill='%s' opacity='%s'/>", -sh/2, sh, mount, mountOp)
		for x := -1500; x < 1500; x += 26 {
			fmt.Fprintf(&sb, "<rect x='%d' y='%d' width='13' height='10' rx='2' fill='%s' opacity='%s'/>", x, -sh/2+9, hole, k.op(0.9, 0.7))
			fmt.Fprintf(&sb, "<rect x='%d' y='%d' width='13' height='10' rx='2' fill='%s' opacity='%s'/>", x, sh/2-19, hole, k.op(0.9, 0.7))
		}
		for n, x := 0, -1500+frame/3; x < 1500; n, x = n+1, x+frame+14 {
			c := colours[(n+spatialJag(n, cy, 3))%len(colours)]
			fmt.Fprintf(&sb, "<rect x='%d' y='%d' width='%d' height='%d' rx='2' fill='%s' opacity='%s'/>", x, -sh/2+26, frame, sh-52, c, k.op(0.55, 0.38))
			fmt.Fprintf(&sb, "<rect x='%d' y='%d' width='%d' height='%d' rx='2' fill='none' stroke='#fff' stroke-width='1' opacity='.28'/>", x+4, -sh/2+30, frame-8, sh-60)
		}
		// Edge print, in amber, between the holes and the frames.
		for n, x := 0, -1480; x < 1500; n, x = n+1, x+(frame+14)*2 {
			fmt.Fprintf(&sb, "<text x='%d' y='%d' font-family='monospace' font-size='9' font-weight='700' letter-spacing='2' fill='#f0a63c' opacity='.9'>&#9656; %d   %dA</text>", x, -sh/2+22, 10+n, 10+n)
		}
		sb.WriteString("</g>")
	}
	cols := []string{h.accent, h.warm, h.cool, h.second}
	strip(190, -14, cols, 120)
	strip(470, -14, []string{h.cool, h.accent, h.second, h.warm}, 150)
	strip(750, -14, []string{h.warm, h.second, h.accent, h.cool}, 120)
	return []backdropLayer{
		svgScene(w, ht, "xMidYMid slice", sb.String()),
		{image: k.blob(50, 28, 110, 80, "#ffffff", 70)},
		{image: k.blob(50, 28, 160, 120, k.accent, 22)},
		backdropGround(k),
	}
}
