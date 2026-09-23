package app

import (
	"regexp"
	"strings"
)

/*
One line per theme family, for the browser to show under the name.

A theme's name is evocative and its swatch is four colours; neither says what
the theme is like to sit in front of for a day. The archetype says what kind
of surface it draws, and this says what the palette is doing -- together they
are the two sentences a reader needs to skip 120 themes and open the one they
want.

Keyed by family rather than by entry: the light and the dark half of a theme
are the same idea in two rooms, and writing the line twice would only give it
two chances to drift. English here, which is the same arrangement the rest of
the theme metadata has; a locale file can override any line under
`config.themeDesc.<family>` without this map changing.

House rules for a line: under about seventy characters, no colour names the
swatch already shows, and no superlatives -- 121 themes cannot all be
striking.
*/
var themeDescriptions = map[string]string{
	"absinthe":              "Bitter green on bone, like a café table at closing time",
	"andromeda-drift":       "Deep space with the accent drifting across it",
	"arctic-cyan":           "Ice and open water, lit from a long way off",
	"aurora-glass":          "Northern light behind a pane you can see through",
	"bamboo-panda":          "Ink and leaf on rice paper, nothing raised",
	"bio-abyss":             "Something luminous at a depth with no daylight",
	"blueprint":             "Drawing-office blue with the grid still showing",
	"bone-china":            "Glazed white with the thinnest possible line",
	"candlelit-study":       "One lamp, a lot of wood, and the rest of the room dark",
	"candy-pop":             "Sugar-shell brights on a surface wiped clean",
	"cerulean-skylark":      "Open sky with the horizon doing the work",
	"chartreuse-static":     "Acid green through a signal that is not quite tuned",
	"cherry-graphite":       "Pencil grey with one polished red edge",
	"city-lights":           "A skyline after dark, read from across the water",
	"cobalt-ink":            "Fountain-pen blue on a page that stays flat",
	"cold-cathode":          "Tube light in an empty room at three in the morning",
	"commit-grey":           "The grey a diff is read in, and nothing else",
	"copper-circuit":        "Brushed copper on board green, traces and all",
	"coral-reef":            "Warm water and hard glaze, lit from above",
	"cosmic-editor":         "Deep field with the accent burning through it",
	"deep-lagoon":           "Still water over a floor you cannot see",
	"denim-fade":            "Worn indigo with the weave showing at the knee",
	"desert-rose":           "Dust and bloom on a surface the sun has bleached",
	"desert-sand":           "Flat light on flat ground, the whole day long",
	"dusk-horizon":          "The last half hour, with everything going cold",
	"editor-default":        "What a text editor looks like before anyone touches it",
	"electric-orchid":       "A bloom under a blacklight, and nothing else lit",
	"ember-ash":             "The hour after the fire, still warm to the hand",
	"emerald-matrix":        "Green rain down a screen that was never off",
	"forest-everglade":      "Standing water under a canopy that does not open",
	"forest-moss":           "Damp ground cover, close up and unlit",
	"foundry-iron":          "Cast iron with the mill marks left on",
	"fox-night":             "Rust moving through a wood at an unsociable hour",
	"frosted-juniper":       "Cold needles behind a pane that has clouded",
	"glacier-mint":          "Old ice with the light coming through the far side",
	"gloss-amber-resin":     "Something caught in resin, polished on every face",
	"gloss-candy-lacquer":   "Lacquer laid on thick, with the light still wet on it",
	"gloss-emerald-enamel":  "Kiln-fired enamel with a hard, even shine",
	"gloss-liquid-chrome":   "Chrome that has not quite set, reflecting the room",
	"gloss-neon-tide":       "Tide under pier lights, with the colour running",
	"gloss-obsidian-mirror": "Volcanic glass polished until it looks back at you",
	"gloss-pearl":           "Nacre: pale, and different from every angle",
	"gloss-rose-gold":       "Warm metal with a mirror finish and no hurry",
	"gloss-sapphire-night":  "Cut stone at night, catching one light at a time",
	"gloss-ultraviolet":     "The end of the spectrum, lacquered",
	"graphite-prism":        "Grey that splits into colour where the light hits",
	"great-wave":            "Woodblock indigo, printed and pressed flat",
	"harbour-fog":           "A working harbour with the far side gone",
	"hermetic-teal":         "Sealed glass, laboratory quiet",
	"horizon-glow":          "One band of light doing everything for the page",
	"iceberg-drift":         "Nine tenths below, and all of it cold",
	"iris-meadow":           "A field in flower with the light behind it",
	"jungle-neon":           "Canopy green wired for after dark",
	"kelp-drift":            "Long fronds in slow water, woven and unlit",
	"lavender-mist":         "Soft, cool, and seen through a little distance",
	"library-mahogany":      "Dark wood, brass lamps, and a rule about talking",
	"licorice-layer":        "Layered black with a sweetness you find late",
	"marigold-dusk":         "Late flowers under a sky already going",
	"midnight-firefly":      "Dark field, small lights, none of them still",
	"midnight-ink":          "Ink at the hour when nothing else is open",
	"midnight-neon":         "Wet street, closed shops, signs still on",
	"mirage-sand":           "Heat over ground, and the far edge unreliable",
	"monochrome-mist":       "Grey on grey, with the edges given up",
	"moonlit-steel":         "Cold metal under a sky with no cloud",
	"moss-stone":            "Old stone with green in every joint",
	"mulberry-silk":         "Deep silk with the light lost in the pile",
	"neon-grid":             "A grid drawn in tube light and left running",
	"nocturne-ink":          "Written at night and not read again until morning",
	"nordic-frost":          "Short day, long shadow, clean line",
	"obsidian-gold":         "Black glass with gold worked into the surface",
	"ocean-depth":           "Down where the colour has gone but the light has not",
	"oceanic-steel":         "Working steel in weather, salt on everything",
	"olive-drab":            "Serviceable, matte, and not asking for attention",
	"owl-hours":             "The hours that belong to whoever is still up",
	"oxblood-leather":       "Bound in leather, read by people who came before",
	"pale-night":            "A night that never quite gets dark",
	"paper-ink":             "Ink on paper. Nothing raised, nothing lit",
	"pastel-mountain":       "A range in flat light, one ridge behind another",
	"patina-verdigris":      "Copper that has been outside long enough to change",
	"peacock":               "Iridescent blue-green, glazed and shown off",
	"pistachio-cream":       "Soft green with a sugar shell over it",
	"polar-night":           "Weeks without a sunrise, and the eye adjusting",
	"porcelain":             "Fired white, thin at the rim",
	"porcelain-blue":        "The same clay with the pattern painted in",
	"retro-crt":             "A tube, a phosphor, and the hum that comes with them",
	"retro-crt-mk2":         "The same tube after somebody adjusted the tint",
	"retro-groove":          "Seventies print, woven and warm",
	"rhubarb-tart":          "Sharp pink under a glaze, straight from the oven",
	"rose-pine":             "Muted rose against deep evergreen, entirely unlit",
	"royal-amethyst":        "Stone-deep purple with the light absorbed, not returned",
	"rusted-rail":           "Steel left in the weather, with the grain still in it",
	"saffron-robe":          "Warm cloth in a cool room, folded and still",
	"sakura-night":          "Blossom lit from below, against a dark sky",
	"salt-flat":             "White ground to the edge of vision, and glare",
	"sea-glass":             "Tumbled glass: transparent, and softened by years",
	"signal-flare":          "One colour doing all the shouting",
	"slate-one":             "The slate an editor is read on, square and quiet",
	"smoked-plum":           "Dark fruit through smoke, soft at every edge",
	"solar-ember":           "A star's last light with the page still warm",
	"solar-flats":           "High sun on flat land, matte and unforgiving",
	"static-noise":          "A channel between channels, woven with snow",
	"steel-dawn":            "First light on cold metal, before anything moves",
	"storm-petrel":          "Weather coming in, read from the deck",
	"sumi-ink":              "Brush, stone, water. One tone and its edges",
	"sunflower-ink":         "Drawn in yellow ink and left flat on the page",
	"synth-sunset":          "A sunset with the grid running out to meet it",
	"tarnished-brass":       "Brass nobody has polished, and the better for it",
	"terminal-amber":        "Amber phosphor, the way a terminal used to be",
	"terracotta-studio":     "Fired clay in a room that works for a living",
	"thunderhead":           "The front of a storm, still holding its rain",
	"tidal-slate":           "Wet slate between tides, cold and even",
	"tomorrow-dusk":         "Evening with the accent still to arrive",
	"tyrian":                "The purple that used to cost more than the cloth",
	"ultraviolet":           "Past the visible, and glowing where it lands",
	"vampire-castle":        "Red on black, with the candles down to nothing",
	"velocity-ink":          "Drawn fast and flat, with no time for a shine",
	"violet-shades":         "Layered violet, each one absorbing the last",
	"vivid-hyper":           "Everything turned up, and nothing apologising",
	"volcanic-ash":          "Fallen ash with the heat only just gone out",
	"wheat-field":           "A crop in flat light, waiting for the weather",
	"zen-ember":             "One warm point in a room kept deliberately empty",
}

// themeFamilySuffix strips the half a theme id names, so both halves of a
// family find the one line written for them.
var themeFamilySuffix = regexp.MustCompile(`-(dark|light)$`)

// themeFamilyOf is the family a theme id belongs to.
func themeFamilyOf(themeID string) string {
	return themeFamilySuffix.ReplaceAllString(strings.ToLower(strings.TrimSpace(themeID)), "")
}

// themeDescription is the line written for a theme, or empty for one nobody
// has written a line for -- a custom theme, or one added since.
func themeDescription(themeID string) string {
	return themeDescriptions[themeFamilyOf(themeID)]
}
