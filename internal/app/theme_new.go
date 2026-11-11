package app

/*
themeNewFamilies are the families the latest collection added, marked "new"
in the theme browser -- a badge on the card, and a word the search box finds,
so `new` narrows the grid to them. Both halves of a family count.

A list rather than a date on each theme: what is new is a decision about one
release, and the next collection replaces the list rather than touching the
hundred themes before it.
*/
var themeNewFamilies = map[string]bool{
	"stationery-ledger":          true,
	"stationery-gallery":         true,
	"stationery-typewriter":      true,
	"stationery-zen":             true,
	"living-tidewatch":           true,
	"living-daydrift":            true,
	"living-skywatch":            true,
	"instrument-cockpit":         true,
	"instrument-oscilloscope":    true,
	"instrument-dive-computer":   true,
	"tactile-label-maker":        true,
	"tactile-keycap":             true,
	"tactile-rack-unit":          true,
	"spatial-diorama":            true,
	"spatial-lightbox":           true,
	"spatial-orbit":              true,
	"cartographic-atlas":         true,
	"cartographic-nautical":      true,
	"cartographic-subway":        true,
	"riso-pink-blue":             true,
	"riso-green-orange":          true,
	"riso-mimeograph":            true,
	"legible-high-contrast-calm": true,
	"legible-low-vision-amber":   true,
	"legible-colour-blind-safe":  true,
}

// themeIsNew reports whether a theme belongs to the latest collection.
func themeIsNew(themeID string) bool {
	return themeNewFamilies[themeFamilyOf(themeID)]
}

// themeCollectionOrder is the order the browser lists collections in. A theme
// names its own in ThemeColors.Collection; one that is not listed here still
// filters, but after these.
var themeCollectionOrder = []string{"neutrals", "looks", "classic"}
