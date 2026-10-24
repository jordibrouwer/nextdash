package app

/*
themeBackdropPools is the backdrops each material is drawn behind.

A material is a surface, and a backdrop that fights it spoils both: a hairline
grid behind a lacquered pane, a soft curtain behind a terminal. Each material
names the recipes that go with it, and the choice made for a theme
(themeBackdropChoice) comes from the pool of its own material.

That is what makes a material read as one thing from the page down. Two paper
themes can have different backdrops, and both are paper backdrops.

A recipe may be in several pools; a pool of six or seven keeps two themes of
one material from landing on the same one. A theme that names no material has
no pool, and its choice stands as it was made.
*/
var themeBackdropPools = map[string][]string{
	"lacquer":  {"sweep", "band", "glow", "sunset", "blooms", "dawn", "veil", "burst", "splash", "leak", "flare", "spectrum", "inkdrop", "sunburst", "tide", "confetti", "ember", "rack"},
	"glass":    {"mesh", "haze", "veil", "bokeh", "aurora", "caustics", "silk", "burst", "splash", "leak", "flare", "spectrum", "inkdrop", "sunburst", "tide", "confetti", "ember"},
	"frost":    {"bokeh", "haze", "mesh", "stars", "rings", "caustics", "burst", "splash", "leak", "flare", "spectrum", "inkdrop", "sunburst", "tide", "confetti", "ember"},
	"aurora":   {"aurora", "blooms", "veil", "silk", "nebula", "dawn", "horizon", "burst", "splash", "leak", "flare", "spectrum", "inkdrop", "sunburst", "tide", "confetti", "ember"},
	"neon":     {"glow", "perspective", "spotlight", "wireframe", "prism", "waves", "grain", "burst", "splash", "leak", "flare", "spectrum", "inkdrop", "sunburst", "tide", "confetti", "ember", "rack"},
	"velvet":   {"nebula", "blooms", "glow", "silk", "stars", "spotlight", "burst", "splash", "leak", "flare", "spectrum", "inkdrop", "sunburst", "tide", "confetti", "ember"},
	"enamel":   {"dunes", "sunset", "splash", "burst", "leak", "rings", "band", "flare", "spectrum", "inkdrop", "sunburst", "tide", "confetti", "ember"},
	"brushed":  {"pinstripe", "band", "linen", "horizon", "sweep", "ruled", "glow", "rack"},
	"carbon":   {"hexagons", "dotgrid", "wireframe", "crosshatch", "pinstripe", "chevron", "linen", "rack"},
	"paper":    {"topo", "linen", "ruled", "crosshatch", "halftone", "dunes", "mountains"},
	"terminal": {"perspective", "scanlines", "dotgrid", "wireframe", "blueprint", "stars", "grain"},
	"ink":      {"halftone", "crosshatch", "ruled", "pinstripe", "topo", "mountains", "stars"},
}

// themeBackdropPoolFor is the pool of a material, or nil for a theme that
// names none (or a word that is not one).
func themeBackdropPoolFor(material string) []string {
	return themeBackdropPools[material]
}

// themeBackdropInPool says whether a recipe belongs to the material's pool. A
// theme without a pool is never out of it.
func themeBackdropInPool(material, recipe string) bool {
	pool := themeBackdropPoolFor(material)
	if len(pool) == 0 {
		return true
	}
	for _, name := range pool {
		if name == recipe {
			return true
		}
	}
	return false
}
