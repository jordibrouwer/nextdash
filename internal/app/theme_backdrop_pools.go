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
	"lacquer":  {"band", "glow", "sunset", "dawn", "rack", "checker", "deco", "diamonds", "scales", "seigaiha", "bokeh"},
	"glass":    {"mesh", "haze", "bokeh", "aurora", "isocube", "moire", "seigaiha", "stitch", "triangles", "bubbles", "prism", "terrazzo"},
	"frost":    {"bokeh", "haze", "mesh", "stars", "rings", "herring", "moire", "rays", "scales", "seigaiha", "stitch", "triangles", "zigzag", "chevron", "sunset", "waves"},
	"aurora":   {"aurora", "nebula", "dawn", "bauhaus", "dotsoff", "moire", "rays", "seigaiha", "zigzag", "petals", "stars", "sunset", "waves", "bubbles"},
	"neon":     {"glow", "perspective", "spotlight", "wireframe", "prism", "waves", "grain", "rack", "bauhaus", "circuit", "isocube", "moire", "terrazzo", "zigzag", "windows", "bubbles", "chevron"},
	"velvet":   {"nebula", "glow", "stars", "spotlight", "checker", "deco", "diamonds", "herring", "moire", "scales", "stitch", "tartan", "pinstripe"},
	"enamel":   {"dunes", "sunset", "rings", "band", "checker", "dotsoff", "scales", "seigaiha", "tartan", "terrazzo", "diamonds", "petals"},
	"brushed":  {"pinstripe", "band", "linen", "ruled", "glow", "rack", "bricks", "herring", "circuit", "diamonds", "grain"},
	"carbon":   {"hexagons", "dotgrid", "wireframe", "crosshatch", "pinstripe", "chevron", "linen", "rack", "grain", "herring", "waves", "bamboo"},
	"paper":    {"topo", "linen", "ruled", "crosshatch", "halftone", "dunes", "mountains", "bamboo", "blueprint", "herring", "hexagons", "rings"},
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
