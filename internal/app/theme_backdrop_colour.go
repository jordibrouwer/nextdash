package app

import (
	"fmt"
	"strconv"
)

/*
backdropKit is what a recipe draws with: the theme's four colours, its ground, and the
helpers that turn a number into a colour share, a soft blob or a line. themeBackdropSeeded
makes one and hands it to themeBackdropColourLayers.
*/
type backdropKit struct {
	accent, second, warm, cool string
	ground                     string // the page colour, a step deeper (dark) or lighter (light)
	veil                       func(color string, p int) string
	soft                       func(color string, p int) string
	blob                       func(x, y, w, h int, color string, p int) string
	line                       func(color string, p, deg, gap int) string
	rnd                        func(n, span int) int
	dark                       bool
	px                         func(n int) string
	tile                       func(n int) string
}

// themeBackdropColourLayers draws a recipe. Every recipe is drawn with all four colours of the
// theme, over a deeper ground, with two colour fields and a diagonal wash in the spots the
// recipe leaves empty, so a recipe is a shape in colour and not a shape on black. The name
// decides the motif: a name with a line has real lines, a soft name has soft edges.
func themeBackdropColourLayers(name string, k backdropKit) []backdropLayer {
	// A server rack is drawn on its own, without the colour fields every other recipe leaves
	// behind it: it is rails, three status LEDs and one glow, and that is all it should be.
	switch name {
	case "rack":
		return themeBackdropRack(k)
	case "digirain":
		return themeBackdropDigiRain(k)
	case "cellgrid":
		return themeBackdropCellGrid(k)
	case "bootlog":
		return themeBackdropBootLog(k)
	case "crt":
		return themeBackdropCRT(k)
	}
	// A theme swaps two of its colours between roles, so two themes drawn with one recipe differ.
	A, E, W, C := k.accent, k.second, k.warm, k.cool
	switch k.rnd(900, 3) {
	case 1:
		E, W = W, E
	case 2:
		E, C = C, E
	}
	v, blob, line := k.veil, k.blob, k.line
	D := k.ground
	f := func(format string, a ...interface{}) string { return fmt.Sprintf(format, a...) }
	cs := []string{A, E, W, C}
	var body []backdropLayer
	plain := func(images ...string) {
		for _, image := range images {
			body = append(body, backdropLayer{image: image})
		}
	}
	switch name {
	case "blooms":
		plain(blob(40, 40, 70, 80, A, 72), blob(12, 90, 40, 40, E, 64), blob(92, 14, 36, 40, W, 64), blob(80, 86, 34, 36, C, 56))
	case "sweep":
		plain("conic-gradient(from 70deg at 0% 0%, transparent 0deg, "+v(A, 70)+" 30deg, "+v(E, 56)+" 60deg, transparent 100deg)",
			"conic-gradient(from 250deg at 100% 100%, transparent 0deg, "+v(W, 66)+" 30deg, "+v(C, 52)+" 60deg, transparent 100deg)")
	case "wireframe":
		plain(line(A, 30, 30, 30), line(E, 24, 150, 30), blob(24, 30, 34, 40, A, 50), blob(80, 70, 34, 40, W, 46))
	case "glow":
		plain(blob(50, -10, 90, 70, A, 76), blob(50, 112, 100, 80, W, 80), blob(100, 50, 36, 56, E, 60), blob(0, 50, 30, 50, C, 50))
	case "band":
		// One wide soft band across the page, not three: the calmer drawing it was given when
		// the Unraid themes left it for rack.
		plain("linear-gradient(112deg, transparent 26%, "+v(A, 44)+" 36%, "+v(E, 34)+" 46%, transparent 58%)",
			"linear-gradient(180deg, "+v(C, 16)+", transparent 60%)")
	case "rings":
		plain("repeating-radial-gradient(circle at 80% 90%, "+v(A, 56)+" 0 "+k.px(6)+", transparent "+k.px(6)+" "+k.px(14)+", "+v(E, 44)+" "+k.px(14)+" "+k.px(18)+", transparent "+k.px(18)+" "+k.px(34)+")",
			blob(80, 90, 40, 50, W, 56), blob(10, 10, 40, 40, C, 40))
	case "scanlines":
		plain("repeating-linear-gradient(0deg, "+v(A, 26)+" 0 2px, transparent 2px 8px)",
			"linear-gradient(180deg, "+v(E, 50)+", transparent 40%, "+v(A, 40)+" 100%)", blob(50, -6, 80, 50, W, 44))
	case "crosshatch":
		plain("repeating-linear-gradient(45deg, "+v(A, 36)+" 0 3px, transparent 3px 11px)",
			"linear-gradient(120deg, "+v(E, 50)+" 0%, "+v(W, 38)+" 50%, "+v(C, 44)+" 100%)")
	case "horizon":
		plain("linear-gradient(180deg, "+v(A, 66)+" 0%, "+v(E, 50)+" 36%, "+v(W, 66)+" 50%, transparent 50%)",
			"linear-gradient(180deg, transparent 50%, "+v(C, 34)+" 100%)", blob(50, 50, 40, 16, W, 70))
	case "mesh":
		plain("linear-gradient(135deg, "+v(A, 60)+", transparent 40%)", blob(100, 0, 60, 60, E, 60), blob(0, 100, 60, 60, C, 56),
			blob(100, 100, 60, 60, W, 56), blob(50, 50, 40, 40, A, 34))
	case "aurora":
		plain(blob(20, 24, 30, 60, C, 60), blob(46, 20, 30, 60, A, 66), blob(72, 26, 30, 60, E, 58), blob(92, 30, 24, 50, W, 48),
			"linear-gradient(180deg, transparent 50%, "+v(D, 60)+")")
	case "bokeh":
		// Bokeh is a small honeycomb now: fine hexagon outlines over a slow diagonal run of the
		// theme's colours. The id stays so a stored choice still finds its recipe.
		ink, share := "white", "0.10"
		if !k.dark {
			ink, share = "black", "0.08"
		}
		hex := "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cpath fill='" + ink + "' fill-opacity='" + share + "' fill-rule='evenodd' d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/svg%3E\")"
		body = append(body, backdropLayer{hex, k.px(24) + " " + k.px(42), ""})
		plain("linear-gradient(125deg, " + v(A, 56) + " 0%, " + v(E, 48) + " 36%, " + v(W, 40) + " 66%, " + v(C, 50) + " 100%)")
	case "nebula":
		plain(blob(24, 40, 46, 50, E, 66), blob(58, 30, 40, 50, A, 66), blob(76, 70, 40, 40, C, 56), blob(40, 80, 34, 34, W, 50))
		for i := 0; i < 16; i++ {
			plain(f("radial-gradient(1.6px 1.6px at %d%% %d%%, rgba(255, 255, 255, 0.8), transparent)", k.rnd(30+i, 100), k.rnd(60+i, 100)))
		}
	case "stars":
		for i := 0; i < 30; i++ {
			plain(f("radial-gradient(1.5px 1.5px at %d%% %d%%, %s, transparent)", k.rnd(30+i, 100), k.rnd(70+i, 100), cs[i%4]))
		}
		plain("linear-gradient(180deg, " + v(A, 40) + ", transparent 40%, " + v(E, 34) + " 100%)")
	case "sunset":
		plain("repeating-linear-gradient(180deg, transparent 0 6px, "+v(D, 60)+" 6px 8px)",
			"radial-gradient(circle at 50% 66%, "+v(W, 90)+" 0, "+v(W, 78)+" 16%, transparent 17%)",
			"linear-gradient(180deg, "+v(A, 60)+" 0%, "+v(E, 66)+" 40%, "+v(W, 60)+" 66%, transparent 80%)")
	case "dunes":
		plain("radial-gradient(80% 40% at 16% 108%, "+v(W, 70)+" 0 60%, transparent 61%)",
			"radial-gradient(80% 36% at 74% 110%, "+v(E, 64)+" 0 60%, transparent 61%)",
			"radial-gradient(60% 28% at 40% 114%, "+v(A, 60)+" 0 60%, transparent 61%)",
			"linear-gradient(180deg, "+v(C, 30)+" 0%, "+v(W, 36)+" 80%)")
	case "mountains":
		plain("linear-gradient(155deg, transparent 50%, "+v(A, 66)+" 50.4%, transparent 90%)",
			"linear-gradient(205deg, transparent 46%, "+v(E, 60)+" 46.4%, transparent 86%)",
			"linear-gradient(160deg, transparent 66%, "+v(W, 66)+" 66.4%)",
			"linear-gradient(180deg, "+v(C, 44)+" 0%, "+v(A, 26)+" 50%, transparent 70%)")
	case "waves":
		plain("repeating-radial-gradient(ellipse 120% 40% at 50% 130%, "+v(A, 56)+" 0 3px, transparent 3px 24px)",
			"repeating-radial-gradient(ellipse 100% 36% at 20% 140%, "+v(C, 50)+" 0 2px, transparent 2px 28px)",
			blob(50, 110, 80, 50, E, 56), blob(50, 0, 70, 40, W, 40))
	case "topo":
		plain("repeating-radial-gradient(ellipse 50% 40% at 30% 40%, "+v(A, 50)+" 0 1.5px, transparent 1.5px 12px)",
			"repeating-radial-gradient(ellipse 40% 50% at 74% 60%, "+v(E, 44)+" 0 1.5px, transparent 1.5px 14px)",
			blob(30, 40, 30, 30, C, 40), blob(74, 60, 30, 30, W, 40))
	case "perspective":
		plain("repeating-linear-gradient(90deg, "+v(E, 50)+" 0 1px, transparent 1px 38px)",
			"repeating-linear-gradient(180deg, "+v(A, 46)+" 0 1px, transparent 1px 24px)",
			"linear-gradient(180deg, "+v(D, 92)+" 0%, transparent 50%)",
			"radial-gradient(circle at 50% 50%, "+v(W, 80)+" 0, transparent 18%)", blob(50, 46, 70, 22, E, 56))
	case "blueprint":
		plain(line(A, 40, 0, 48), line(A, 40, 90, 48), line(C, 22, 0, 12), line(C, 22, 90, 12),
			"radial-gradient(circle at 50% 50%, transparent 24%, "+v(A, 50)+" 24.4%, transparent 25%)",
			"linear-gradient(160deg, "+v(A, 44)+", "+v(E, 24)+" 100%)")
	case "pinstripe":
		plain("repeating-linear-gradient(115deg, "+v(A, 36)+" 0 1px, transparent 1px 12px)",
			"linear-gradient(115deg, "+v(E, 50)+" 0%, "+v(W, 40)+" 50%, "+v(C, 44)+" 100%)")
	case "hexagons":
		plain(line(A, 34, 60, 28), line(E, 30, -60, 28), line(C, 30, 0, 28), blob(24, 24, 40, 44, W, 46), blob(80, 74, 40, 44, A, 44))
	case "halftone":
		body = append(body,
			backdropLayer{"radial-gradient(circle, " + v(E, 40) + " 0 3px, transparent 3.4px)", k.tile(16), ""},
			backdropLayer{"radial-gradient(circle, " + v(A, 34) + " 0 2px, transparent 2.4px)", k.tile(16), k.px(8) + " " + k.px(8)})
		plain("linear-gradient(135deg, transparent 30%, "+v(D, 94)+" 100%)", blob(14, 14, 40, 44, W, 48))
	case "prism":
		plain("conic-gradient(from -70deg at 30% 100%, transparent 0 0deg, "+v(A, 66)+" 0 30deg, "+v(E, 60)+" 30deg 60deg, "+v(W, 56)+" 60deg 90deg, "+v(C, 52)+" 90deg 120deg, transparent 120deg)",
			"linear-gradient(180deg, "+v(A, 22)+", transparent 60%)")
	case "chevron":
		plain("repeating-linear-gradient(120deg, "+v(A, 40)+" 0 3px, transparent 3px 22px)",
			"repeating-linear-gradient(60deg, "+v(E, 36)+" 0 3px, transparent 3px 22px)",
			"linear-gradient(180deg, "+v(W, 40)+", transparent 50%, "+v(C, 36)+")")
	case "haze":
		plain("linear-gradient(180deg, transparent 20%, "+v(A, 44)+" 44%, transparent 62%)",
			"linear-gradient(180deg, transparent 46%, "+v(E, 46)+" 66%, transparent 82%)",
			"linear-gradient(180deg, transparent 66%, "+v(W, 52)+" 86%, transparent 100%)", blob(30, 100, 90, 50, C, 44))
	case "veil":
		plain("linear-gradient(100deg, transparent 4%, "+v(A, 50)+" 22%, transparent 40%)",
			"linear-gradient(86deg, transparent 22%, "+v(E, 46)+" 42%, transparent 60%)",
			"linear-gradient(112deg, transparent 46%, "+v(W, 44)+" 64%, transparent 82%)",
			"linear-gradient(94deg, transparent 64%, "+v(C, 42)+" 82%, transparent 100%)")
	case "spotlight":
		plain("conic-gradient(from 0deg at 30% -6%, transparent 0 140deg, "+v(A, 64)+" 162deg, "+v(E, 52)+" 186deg, transparent 212deg)",
			"conic-gradient(from 0deg at 72% -6%, transparent 0 140deg, "+v(W, 60)+" 162deg, "+v(C, 48)+" 186deg, transparent 212deg)",
			blob(30, 100, 34, 20, A, 50), blob(72, 100, 34, 20, W, 50))
	case "silk":
		plain("linear-gradient(110deg, transparent 12%, "+v(A, 56)+" 28%, transparent 40%)",
			"linear-gradient(116deg, transparent 30%, "+v(E, 52)+" 46%, transparent 60%)",
			"linear-gradient(104deg, transparent 48%, "+v(W, 50)+" 62%, transparent 76%)",
			"linear-gradient(112deg, transparent 66%, "+v(C, 46)+" 80%, transparent 94%)")
	case "caustics":
		net := []string{C, A, W}
		for i := 0; i < 9; i++ {
			plain(f("radial-gradient(ellipse %d%% %d%% at %d%% %d%%, transparent 55%%, %s 62%%, transparent 70%%)",
				8+k.rnd(10+i, 9), 5+k.rnd(20+i, 6), k.rnd(30+i, 100), k.rnd(50+i, 100), v(net[i%3], 60)))
		}
		plain("linear-gradient(180deg, " + v(A, 40) + ", transparent 70%, " + v(C, 30) + ")")
	case "dawn":
		plain("linear-gradient(0deg, "+v(W, 72)+" 0%, "+v(E, 56)+" 20%, "+v(A, 44)+" 44%, "+v(C, 24)+" 66%, transparent 84%)", blob(50, 100, 60, 34, W, 76))
	case "linen":
		plain("repeating-linear-gradient(0deg, "+v(A, 30)+" 0 2px, transparent 2px 8px)",
			"repeating-linear-gradient(90deg, "+v(E, 28)+" 0 2px, transparent 2px 8px)",
			"linear-gradient(150deg, "+v(W, 40)+", transparent 50%, "+v(C, 34)+")")
	case "dotgrid":
		body = append(body,
			backdropLayer{"radial-gradient(circle, " + v(A, 66) + " 0 2px, transparent 2.4px)", k.tile(24), ""},
			backdropLayer{"radial-gradient(circle, " + v(E, 60) + " 0 2px, transparent 2.4px)", k.tile(24), k.px(12) + " " + k.px(12)})
		plain("linear-gradient(135deg, " + v(W, 34) + ", transparent 60%, " + v(C, 30) + ")")
	case "ruled":
		plain("repeating-linear-gradient(180deg, "+v(A, 40)+" 0 1px, transparent 1px 26px)",
			"repeating-linear-gradient(90deg, "+v(A, 26)+" 0 1px, transparent 1px 26px)",
			"linear-gradient(90deg, transparent 12%, "+v(E, 80)+" 12.2%, transparent 12.8%)",
			"linear-gradient(160deg, "+v(W, 34)+", transparent 60%)")
	case "grain":
		for i := 0; i < 80; i++ {
			plain(f("radial-gradient(1px 1px at %d%% %d%%, %s, transparent)", k.rnd(100+i, 100), k.rnd(200+i, 100), v(cs[i%4], 70)))
		}
		plain(blob(30, 30, 60, 60, E, 44), blob(74, 76, 60, 60, A, 40))
	case "flare":
		plain("radial-gradient(ellipse 50% 1.4% at 50% 36%, rgba(255, 255, 255, 0.7) 0, "+v(W, 66)+" 30%, "+v(A, 50)+" 60%, transparent 100%)",
			"radial-gradient(ellipse 50% 7% at 50% 36%, "+v(E, 34)+", transparent 100%)", blob(50, 36, 34, 30, W, 70), blob(50, 100, 70, 50, C, 44))
	case "spectrum":
		plain("linear-gradient(90deg, "+v(A, 60)+" 0%, "+v(E, 56)+" 33%, "+v(W, 56)+" 66%, "+v(C, 52)+" 100%)",
			"linear-gradient(180deg, transparent 30%, "+v(D, 70)+" 100%)")
	case "inkdrop":
		plain(blob(26, 34, 40, 50, A, 70), blob(70, 38, 38, 48, E, 66), blob(50, 74, 40, 50, C, 66),
			"radial-gradient(circle at 26% 34%, transparent 28%, "+v(W, 60)+" 29%, transparent 31%)",
			"radial-gradient(circle at 70% 38%, transparent 26%, "+v(W, 50)+" 27%, transparent 29%)")
	case "sunburst":
		// A low sun: a hot core, a wide halo in the accent, and the sky warming towards the horizon.
		plain(blob(74, 84, 26, 30, W, 86), blob(74, 84, 62, 70, A, 66), blob(74, 84, 120, 110, E, 44),
			"linear-gradient(0deg, "+v(W, 58)+", transparent 55%)", blob(12, 14, 46, 44, C, 42))
	case "tide":
		plain("linear-gradient(160deg, transparent 14%, "+v(A, 46)+" 30%, transparent 46%)",
			"linear-gradient(160deg, transparent 30%, "+v(C, 50)+" 48%, transparent 62%)",
			"linear-gradient(160deg, transparent 48%, "+v(W, 54)+" 66%, transparent 80%)",
			"linear-gradient(160deg, transparent 64%, "+v(E, 58)+" 84%, transparent 100%)")
	case "confetti":
		for i := 0; i < 14; i++ {
			s := 7 + k.rnd(10+i, 10)
			plain(blob(k.rnd(20+i, 100), k.rnd(40+i, 100), s, s, cs[i%4], 70))
		}
		plain("linear-gradient(135deg, " + v(A, 22) + ", transparent 50%, " + v(E, 22) + ")")
	case "ember":
		plain(blob(30, 100, 90, 70, W, 78), blob(74, 96, 70, 56, E, 70), blob(50, 0, 80, 58, A, 62))
		for i := 0; i < 18; i++ {
			plain(f("radial-gradient(1.6px 1.6px at %d%% %d%%, %s, transparent)", k.rnd(30+i, 100), 30+k.rnd(60+i, 70), v(W, 90)))
		}
	case "burst":
		plain("conic-gradient(from "+strconv.Itoa(k.rnd(0, 360))+"deg at 50% 40%, "+v(A, 72)+", "+v(W, 66)+", "+v(E, 68)+", "+v(C, 58)+", "+v(A, 72)+")",
			"radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.5) 0, transparent 16%)",
			"radial-gradient(130% 110% at 50% 50%, transparent 40%, "+v(D, 60)+" 100%)")
	case "splash":
		plain(blob(20, 28, 50, 60, A, 72), blob(70, 22, 50, 60, E, 70), blob(30, 76, 50, 56, C, 66), blob(88, 82, 42, 44, W, 64),
			"radial-gradient(circle at 20% 28%, transparent 30%, "+v(W, 50)+" 31%, transparent 33%)")
	case "leak":
		plain("linear-gradient(90deg, "+v(W, 72)+" 0%, "+v(E, 60)+" 14%, "+v(A, 36)+" 34%, transparent 60%)",
			"radial-gradient(70% 60% at 100% 0%, "+k.soft(C, 60)+")",
			"radial-gradient(60% 60% at 0% 100%, "+k.soft(A, 60)+")")
	}
	// What a recipe leaves empty: two colour fields and a diagonal wash on top of it, and the
	// ground underneath.
	layers := []backdropLayer{
		{image: blob(8+k.rnd(81, 30), 6+k.rnd(82, 26), 38, 42, W, 78)},
		{image: blob(70+k.rnd(83, 26), 74+k.rnd(84, 22), 40, 44, C, 72)},
		{image: blob(96, 40, 30, 46, E, 60)},
		{image: "linear-gradient(135deg, " + v(A, 26) + " 0%, transparent 38%, " + v(E, 26) + " 100%)"},
	}
	layers = append(layers, body...)
	return append(layers, backdropLayer{image: "linear-gradient(" + D + ", " + D + ")"})
}

/*
themeBackdropDots is the page the first release drew: the palette's own colour,
which the body already is, and a grid of dots in the palette's dot colour, one
pixel wide on a 15 pixel tile.

It is the one recipe that is not drawn in the accent colours and not under the
quiet centre: it is plain on purpose, edge to edge, and it keeps the dot colour
the palette chose. --bd-scale stretches the tile like it does for every other
recipe; strength, which is a share of an accent, has nothing to scale here.
*/
func themeBackdropDots() backdropLook {
	return joinBackdropLayers([]backdropLayer{{
		image: "radial-gradient(var(--background-dots) 1px, transparent 1px)",
		size:  "calc(15px * var(--bd-scale, 1)) calc(15px * var(--bd-scale, 1))",
	}})
}

/*
themeBackdropRack is the page behind the Unraid themes: the inside of a server cabinet seen from
a distance, and quiet on purpose.

Fine horizontal rails a rack unit apart (44 pixels), a perforated rail down each side, the three
status LEDs of a drive bay (green, orange, red) low in the left corner with one soft glow of the
accent under them. Nothing else: the accent is the only colour that spreads, the LEDs are a few
pixels each, and the rails are a share of the accent so low that they read as texture.

It does not use the colour fields and the diagonal wash that the other recipes leave behind them;
that is what made the Unraid pages busy.
*/
func themeBackdropRack(k backdropKit) []backdropLayer {
	v := k.veil
	ledAt := func(x int, color string) string {
		return "radial-gradient(circle at " + k.px(x) + " calc(100% - " + k.px(26) + "), " + v(color, 95) + " 0, " + v(color, 95) + " " + k.px(3) + ", transparent " + k.px(4) + ")"
	}
	hole := func(edge string) string {
		return "radial-gradient(circle at " + edge + " " + k.px(22) + ", " + v(k.accent, 26) + " 0, " + v(k.accent, 26) + " " + k.px(2) + ", transparent " + k.px(3) + ")"
	}
	return []backdropLayer{
		{image: ledAt(34, k.cool)},
		{image: ledAt(52, k.warm)},
		{image: ledAt(70, k.second)},
		{image: k.blob(0, 100, 62, 56, k.accent, 30)},
		{image: hole(k.px(11)), size: "100% " + k.px(44)},
		{image: hole("calc(100% - " + k.px(11) + ")"), size: "100% " + k.px(44)},
		{image: "linear-gradient(90deg, " + v(k.accent, 7) + " 0 " + k.px(22) + ", transparent " + k.px(22) + " calc(100% - " + k.px(22) + "), " + v(k.accent, 7) + " calc(100% - " + k.px(22) + "))"},
		{image: "repeating-linear-gradient(180deg, " + v(k.accent, 9) + " 0 1px, transparent 1px " + k.px(44) + ")"},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

/*
The four Unraid backdrops are drawn from the machine behind the web UI: a terminal, and the
green rain of the film that made one famous. Each is its own picture and none of them uses the
colour fields and diagonal wash of the generic recipes; the accent of the theme is the only
colour that spreads, so a page stays calm and the cards stay readable.

themeBackdropDigiRain is Unraid Black: columns of falling characters, drawn as thin streaks that
taper upward from a bright head. Five tiles of unrelated widths and heights, so the columns do
not line up into a pattern.

themeBackdropCellGrid is Unraid Azure: the character grid of a terminal, ten by twenty pixels a
cell, with scanlines and the glow of a prompt low in the corner.

themeBackdropBootLog is Unraid Ember: the lines of a boot log scrolling by. Each line is a streak
fading to the right, a gutter rail on the left, and a green OK at the start of every third line.

themeBackdropCRT is Unraid Blaze: a red phosphor screen with scanlines, one rolling band, two
glitch bars and a dark vignette.
*/
func themeBackdropDigiRain(k backdropKit) []backdropLayer {
	v := k.veil
	// One column per tile, so no two columns share a row of heads: the tile is wide and the
	// position moves the head to a height of its own.
	col := func(w, h, x, dy int, color string, p int) []backdropLayer {
		return []backdropLayer{
			{
				image: "radial-gradient(circle at " + k.px(x) + " calc(100% - " + k.px(3) + "), " + v("#fff", p+16) + " 0, " + v(k.accent, p+10) + " " + k.px(2) + ", transparent " + k.px(4) + ")",
				size:  k.px(w) + " " + k.px(h),
				pos:   "0 " + k.px(dy),
			},
			{
				image: "radial-gradient(ellipse " + k.px(2) + " " + k.px(h*9/10) + " at " + k.px(x) + " 100%, " + v(color, p) + " 0, " + v(color, p*62/100) + " 35%, " + v(color, p*22/100) + " 72%, transparent 100%)",
				size:  k.px(w) + " " + k.px(h),
				pos:   "0 " + k.px(dy),
			},
		}
	}
	var out []backdropLayer
	spec := []struct {
		w, h, x, dy int
		c           string
		p           int
	}{
		{97, 210, 11, 0, k.accent, 40}, {113, 150, 52, 37, k.accent, 36}, {127, 260, 23, 91, k.accent, 38},
		{139, 180, 77, 12, k.second, 32}, {151, 320, 34, 140, k.accent, 36}, {163, 130, 90, 55, k.accent, 34},
		{173, 240, 15, 18, k.warm, 28}, {181, 200, 120, 77, k.accent, 36}, {191, 290, 66, 160, k.accent, 34},
		{199, 170, 8, 100, k.cool, 24}, {211, 230, 140, 29, k.accent, 36}, {223, 140, 100, 66, k.second, 30},
	}
	for _, c := range spec {
		out = append(out, col(c.w, c.h, c.x, c.dy, c.c, c.p)...)
	}
	out = append(out,
		backdropLayer{image: k.blob(50, 112, 90, 40, k.accent, 22)},
		backdropLayer{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"})
	return out
}

func themeBackdropCellGrid(k backdropKit) []backdropLayer {
	v := k.veil
	return []backdropLayer{
		{image: "linear-gradient(90deg, " + v(k.accent, 17) + " 0 1px, transparent 1px)", size: k.px(10) + " " + k.px(20)},
		{image: "linear-gradient(180deg, " + v(k.accent, 13) + " 0 1px, transparent 1px)", size: k.px(10) + " " + k.px(20)},
		{image: "repeating-linear-gradient(180deg, " + v("#000", 14) + " 0 1px, transparent 1px " + k.px(3) + ")"},
		{image: k.blob(0, 100, 56, 48, k.accent, 34)},
		{image: k.blob(8, 96, 6, 4, k.cool, 50)},
		{image: k.blob(13, 96, 6, 4, k.warm, 46)},
		{image: "linear-gradient(180deg, " + v(k.second, 12) + ", transparent 38%)"},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

func themeBackdropBootLog(k backdropKit) []backdropLayer {
	v := k.veil
	// A line is a short streak: words, not a rule. The tile is wider than the streak, so a row
	// reads as a few words and a gap, and the rows of different layers differ in length.
	line := func(w, h, x, y, reach int, color string, p int) backdropLayer {
		return backdropLayer{
			image: "radial-gradient(ellipse " + k.px(reach) + " " + k.px(1) + " at 0 " + k.px(y) + ", " + v(color, p) + " 0, " + v(color, p*70/100) + " 55%, transparent 100%)",
			size:  k.px(w) + " " + k.px(h),
			pos:   k.px(x) + " 0",
		}
	}
	ok := func(w, h, x, y int) backdropLayer {
		return backdropLayer{
			image: "radial-gradient(ellipse " + k.px(6) + " " + k.px(2) + " at " + k.px(x) + " " + k.px(y) + ", " + v(k.cool, 70) + " 0, " + v(k.cool, 34) + " 60%, transparent 100%)",
			size:  k.px(w) + " " + k.px(h),
		}
	}
	return []backdropLayer{
		ok(900, 57, 28, 10), ok(900, 95, 28, 48),
		line(520, 19, 44, 10, 120, k.accent, 36),
		line(610, 38, 70, 29, 200, k.accent, 30),
		line(460, 57, 44, 48, 90, k.warm, 28),
		line(700, 76, 90, 67, 260, k.accent, 26),
		line(390, 95, 44, 86, 140, k.second, 22),
		line(850, 133, 60, 124, 320, k.accent, 24),
		{image: "linear-gradient(90deg, transparent " + k.px(33) + ", " + v(k.accent, 18) + " " + k.px(33) + " " + k.px(34) + ", transparent " + k.px(34) + ")"},
		{image: k.blob(100, 100, 52, 50, k.accent, 22)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

func themeBackdropCRT(k backdropKit) []backdropLayer {
	v := k.veil
	glitch := func(w, h, x, y, rx int, p int) backdropLayer {
		return backdropLayer{
			image: "radial-gradient(ellipse " + k.px(rx) + " " + k.px(4) + " at " + k.px(x) + " " + k.px(y) + ", " + v(k.accent, p) + " 0, " + v(k.accent, p*50/100) + " 70%, transparent 100%)",
			size:  k.px(w) + " " + k.px(h),
		}
	}
	return []backdropLayer{
		glitch(700, 230, 160, 70, 130, 70),
		glitch(520, 310, 380, 210, 90, 56),
		glitch(910, 170, 600, 120, 60, 48),
		{image: "repeating-linear-gradient(180deg, " + v("#000", 40) + " 0 1px, transparent 1px " + k.px(3) + ")"},
		{image: "linear-gradient(180deg, transparent 30%, " + v(k.accent, 30) + " 46%, " + v(k.second, 18) + " 52%, transparent 66%)"},
		{image: "radial-gradient(ellipse at 50% 50%, transparent 52%, " + v(k.ground, 70) + " 100%)"},
		{image: "linear-gradient(90deg, " + v(k.cool, 8) + ", transparent 6%, transparent 94%, " + v(k.warm, 8) + ")"},
		{image: k.blob(50, 0, 80, 40, k.accent, 24)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}
