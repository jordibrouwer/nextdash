package app

import (
	"fmt"
	"math"
	"strings"
)

// Backdrop recipes of the riso theme group; see theme_groups.go. Each one is drawn for one family:
// it has to fit that theme's name, shape and colours.

// risoLCG is a small deterministic generator, so a recipe draws the same page on every load
// without importing math/rand into the output.
func risoLCG(seed uint32) func(n int) int {
	s := seed
	return func(n int) int {
		s = s*1664525 + 1013904223
		return int((s >> 8) % uint32(n))
	}
}

// themeBackdropStampField is the "stampfield" recipe: a page that has been stamped over and over
// with rubber stamps -- rings, stars, arrows, crosses and seals -- rotated by hand, in the two inks
// of the print, with ragged edges and patchy ink, some of them landing on top of each other.
func themeBackdropStampField(k backdropKit) []backdropLayer {
	// The two inks are fixed by the family, not by the page: green and orange. On a light page the
	// kit's accent is the green and the orange has no slot in the palette; on a dark page it is the
	// other way round.
	green, orange := k.hex.accent, "#ff7a1a"
	if k.dark {
		green, orange = k.hex.cool, k.hex.accent
	}
	ops := k.op(.30, .34)
	rnd := risoLCG(11)

	shape := func(kind int, c string, r int) string {
		switch kind {
		case 0: // ring with a dot, the round date stamp
			return fmt.Sprintf("<circle r='%d' fill='none' stroke='%s' stroke-width='6'/><circle r='%d' fill='none' stroke='%s' stroke-width='2.5'/><circle r='%d' fill='%s'/>", r, c, r*7/10, c, r/7+2, c)
		case 1: // five-point star
			var pts []string
			for i := 0; i < 10; i++ {
				rad := float64(r)
				if i%2 == 1 {
					rad = float64(r) * 0.42
				}
				a := float64(i)*36 - 90
				pts = append(pts, fmt.Sprintf("%.1f,%.1f", rad*math.Cos(a*math.Pi/180), rad*math.Sin(a*math.Pi/180)))
			}
			return fmt.Sprintf("<polygon points='%s' fill='%s'/>", strings.Join(pts, " "), c)
		case 2: // arrow
			return fmt.Sprintf("<path d='M%d 0 H%d M%d %d L%d 0 L%d %d' fill='none' stroke='%s' stroke-width='9' stroke-linecap='square'/>", -r, r, r/3, -r/2, r, r/3, r/2, c)
		case 3: // cross
			return fmt.Sprintf("<path d='M%d %d L%d %d M%d %d L%d %d' stroke='%s' stroke-width='9'/>", -r*7/10, -r*7/10, r*7/10, r*7/10, r*7/10, -r*7/10, -r*7/10, r*7/10, c)
		default: // seal: a square with an inner frame
			return fmt.Sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='none' stroke='%s' stroke-width='6'/><rect x='%d' y='%d' width='%d' height='%d' fill='%s'/>", -r*8/10, -r*8/10, r*16/10, r*16/10, c, -r*3/10, -r*3/10, r*6/10, r*6/10, c)
		}
	}

	var sb strings.Builder
	sb.WriteString("<defs><filter id='r' x='-10%' y='-10%' width='120%' height='120%'>" +
		"<feTurbulence type='fractalNoise' baseFrequency='.045' numOctaves='2' seed='3' result='t'/>" +
		"<feDisplacementMap in='SourceGraphic' in2='t' scale='7' result='d'/>" +
		"<feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' seed='5' result='n'/>" +
		"<feColorMatrix in='n' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -10 7' result='m'/>" +
		"<feComposite in='d' in2='m' operator='in'/></filter></defs>")
	sb.WriteString("<g filter='url(#r)'>")
	// A jittered grid of stamps, so the field has no empty corner and no even rhythm.
	const cols, rows = 7, 5
	for j := 0; j < rows; j++ {
		for i := 0; i < cols; i++ {
			x := 110 + i*(1440-220)/(cols-1) + rnd(90) - 45
			y := 90 + j*(900-180)/(rows-1) + rnd(80) - 40
			kind := rnd(5)
			c, blend := green, ""
			if rnd(2) == 0 {
				c = orange
			}
			if !k.dark && rnd(3) == 0 {
				blend = " style='mix-blend-mode:multiply'"
			}
			r := 34 + rnd(34)
			sb.WriteString(fmt.Sprintf("<g transform='translate(%d %d) rotate(%d)' opacity='%s'%s>%s</g>", x, y, rnd(70)-35, ops, blend, shape(kind, c, r)))
			// Every third stamp is struck again, a little off and in the other ink: overprint.
			if (i+j)%3 == 0 {
				other := orange
				if c == orange {
					other = green
				}
				sb.WriteString(fmt.Sprintf("<g transform='translate(%d %d) rotate(%d)' opacity='%s'%s>%s</g>", x+rnd(30)-6, y+rnd(24)-4, rnd(40)-20, ops, blend, shape((kind+2)%5, other, r*7/10)))
			}
		}
	}
	sb.WriteString("</g>")
	return []backdropLayer{svgScene(1440, 900, "xMidYMid slice", sb.String()), backdropGround(k)}
}

// themeBackdropInkSpeckle is the "inkspeckle" recipe: a mimeograph sheet. One faded purple ink,
// laid on unevenly so the paper shows through in specks, with the streaks a roller leaves and a
// ghost of the whole sheet printed a few pixels off.
func themeBackdropInkSpeckle(k backdropKit) []backdropLayer {
	ink := k.hex.accent
	speck := k.op(.34, .30)
	ghost := k.op(.16, .14)
	streak := k.op(.12, .12)
	body := "<defs>" +
		// Speckled coverage: noise cut to a threshold, filled with the ink.
		"<filter id='s' x='0' y='0' width='100%' height='100%'>" +
		"<feTurbulence type='fractalNoise' baseFrequency='.55' numOctaves='3' seed='9' result='n'/>" +
		"<feColorMatrix in='n' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12 -7.6' result='m'/>" +
		"<feFlood flood-color='" + ink + "'/><feComposite in2='m' operator='in'/></filter>" +
		// A ghost: the same speckle, shifted, so the second pass is visibly out of register.
		"<filter id='g' x='0' y='0' width='100%' height='100%'>" +
		"<feTurbulence type='fractalNoise' baseFrequency='.55' numOctaves='3' seed='9' result='n'/>" +
		"<feColorMatrix in='n' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12 -7.6' result='m'/>" +
		"<feOffset in='m' dx='9' dy='6' result='o'/><feFlood flood-color='" + ink + "'/><feComposite in2='o' operator='in'/></filter>" +
		// Roller streaks: noise stretched along the roll, thresholded to long faint bands.
		"<filter id='l' x='0' y='0' width='100%' height='100%'>" +
		"<feTurbulence type='fractalNoise' baseFrequency='.0015 .045' numOctaves='2' seed='4' result='n'/>" +
		"<feColorMatrix in='n' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 6 -2.6' result='m'/>" +
		"<feFlood flood-color='" + ink + "'/><feComposite in2='m' operator='in'/></filter>" +
		"</defs>" +
		"<rect width='1440' height='900' filter='url(#l)' opacity='" + streak + "'/>" +
		"<rect width='1440' height='900' filter='url(#g)' opacity='" + ghost + "'/>" +
		"<rect width='1440' height='900' filter='url(#s)' opacity='" + speck + "'/>"
	return []backdropLayer{svgScene(1440, 900, "xMidYMid slice", body), backdropGround(k)}
}
