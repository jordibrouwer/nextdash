package app

import (
	"fmt"
	"math"
	"strings"
)

// themeBackdropSonar is the sea as a ship's sonar sees it: rings that spread from a point low in the
// left corner, a sweep of light fading behind its leading line, and a few echoes with their own
// ping rings, over a wash that is lightest at the surface and deepest at the bottom.
func themeBackdropSonar(k backdropKit) []backdropLayer {
	h := k.hex
	var sb strings.Builder
	cx, cy := 220.0, 760.0
	for i := 1; i <= 9; i++ {
		r := float64(i) * 150
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='%.0f' fill='none' stroke='%s' stroke-width='%.1f' opacity='%s'/>",
			cx, cy, r, h.accent, 1.2+float64(i%3)*0.5, k.op(0.62-float64(i)*0.04, 0.7-float64(i)*0.045)))
	}
	for a := 0; a < 360; a += 15 {
		x, y := cx+1500*math.Cos(float64(a)*math.Pi/180), cy+1500*math.Sin(float64(a)*math.Pi/180)
		sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='1' opacity='%s'/>", cx, cy, x, y, h.accent, k.op(.2, .22)))
	}
	// The sweep: a wedge that fades towards its trailing edge, ending in a bright leading line.
	const lead, span = -38.0, 62.0
	p := func(a float64) (float64, float64) {
		return cx + 1500*math.Cos(a*math.Pi/180), cy + 1500*math.Sin(a*math.Pi/180)
	}
	x0, y0 := p(lead)
	x1, y1 := p(lead - span)
	defs := fmt.Sprintf("<defs><linearGradient id='w' gradientUnits='userSpaceOnUse' x1='%.0f' y1='%.0f' x2='%.0f' y2='%.0f'><stop offset='0' stop-color='%s' stop-opacity='%s'/><stop offset='1' stop-color='%s' stop-opacity='0'/></linearGradient></defs>",
		x0, y0, x1, y1, h.accent, k.op(.55, .6), h.accent)
	sb.WriteString(defs)
	sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0fL%.0f %.0fZ' fill='url(#w)'/>", cx, cy, x0, y0, x1, y1))
	sb.WriteString(fmt.Sprintf("<path d='M%.0f %.0fL%.0f %.0f' stroke='%s' stroke-width='2.4' opacity='%s'/>", cx, cy, x0, y0, h.accent, k.op(.9, 1)))
	for _, e := range []struct {
		a, r float64
		c    string
	}{{-30, 560, h.cool}, {-52, 880, h.warm}, {-14, 1010, h.second}, {-70, 430, h.cool}} {
		x := cx + e.r*math.Cos(e.a*math.Pi/180)
		y := cy + e.r*math.Sin(e.a*math.Pi/180)
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='30' fill='none' stroke='%s' stroke-width='1.6' opacity='%s'/>", x, y, e.c, k.op(.55, .6)))
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='15' fill='none' stroke='%s' stroke-width='1.4' opacity='%s'/>", x, y, e.c, k.op(.7, .75)))
		sb.WriteString(fmt.Sprintf("<circle cx='%.0f' cy='%.0f' r='5' fill='%s' opacity='%s'/>", x, y, e.c, k.op(1, 1)))
	}
	return []backdropLayer{
		svgScene(1400, 900, "xMinYMax slice", sb.String()),
		{image: "linear-gradient(180deg, " + k.veil(h.accent, 30) + ", transparent 40%, " + k.veil(h.warm, 34) + " 100%)"},
		backdropGround(k),
	}
}
