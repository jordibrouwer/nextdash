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
	"tidepool-lens":      true,
	"champagne-flute":    true,
	"prism-veil":         true,
	"rain-window":        true,
	"lime-soda":          true,
	"rosewater-pane":     true,
	"gloss-cinnabar":     true,
	"gloss-jade":         true,
	"gloss-aubergine":    true,
	"gloss-butterscotch": true,
	"kevlar-weave":       true,
	"graphite-twill":     true,
	"race-livery":        true,
	"forged-titanium":    true,
	"matrix-rain":        true,
	"matrix-redpill":     true,
	"matrix-bluepill":    true,
	"matrix-construct":   true,
	"borealis-veil":      true,
	"solar-wind":         true,
	"nebula-nursery":     true,
	"polar-dawn":         true,
	"hoarfrost":          true,
	"frozen-lavender":    true,
	"frost-fern":         true,
	"winter-ember":       true,
	"aluminium-deck":     true,
	"gunmetal-bronze":    true,
	"rose-titanium":      true,
	"satin-nickel":       true,
	"indigo-letterpress": true,
	"iron-gall":          true,
	"squid-ink":          true,
	"vermilion-seal":     true,
}

// themeIsNew reports whether a theme belongs to the latest collection.
func themeIsNew(themeID string) bool {
	return themeNewFamilies[themeFamilyOf(themeID)]
}

// themeCollectionOrder is the order the browser lists collections in. A theme
// names its own in ThemeColors.Collection; one that is not listed here still
// filters, but after these.
var themeCollectionOrder = []string{"homepage"}
