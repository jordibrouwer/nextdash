package app

/*
themeBackdropChoice is the backdrop each built-in theme was given.

One entry per light/dark pair, keyed the way themeBackdropHashID keys them (the
"-light" id), so both halves of a pair land on the same recipe. The choice came
from the theme's name, its palette and its archetype, and was reviewed one pair
at a time in docs/backdrop-assignments.html; it is not a hash, and it does not
move when the list of recipes grows. It is also held to the theme's material:
the recipe comes from that material's pool (theme_backdrop_pools.go), and the
entries marked "uit het ...-pakket" are the ones that were moved there.

The order a backdrop is looked up in, in themeBackdropSeeded: a recipe the
theme names itself (ThemeColors.Backdrop, which is how a custom theme chooses
one), then this map, then the recipe its archetype binds, then the hash of its
id. The last two only ever see a custom theme now.

Every recipe of the first twenty-six is used by at least two pairs and at most
ten, so no backdrop is a theme's alone and none is the whole library's. theme_backdrop_choice_test.go
holds the map to that, and to there being an entry for every built-in theme and
none for a theme that is gone.
*/
var themeBackdropChoice = map[string]string{
	"absinthe-light":              "crosshatch",  // gegraveerd papier, absintprent
	"aluminium-deck-light":        "diamonds",    // past bij het thema
	"andromeda-drift-light":       "nebula",      // sterrenstelsel
	"arctic-cyan-light":           "stitch",      // patroon in plaats van een kleurvlak
	"aurora-glass-light":          "aurora",      // naam
	"bamboo-panda-light":          "bamboo",      // past bij het thema
	"bio-abyss-light":             "bubbles",     // past bij het thema
	"blueprint-light":             "blueprint",   // past bij het thema
	"bone-china-light":            "rings",       // (blijft rings)
	"borealis-veil-light":         "aurora",      // noorderlicht; aurora past beter dan blooms
	"candlelit-study-light":       "ruled",       // uit het paper-pakket (was glow)
	"candy-pop-light":             "dotsoff",     // patroon in plaats van een kleurvlak
	"cerulean-skylark-light":      "rays",        // patroon in plaats van een kleurvlak
	"champagne-flute-light":       "bubbles",     // past bij het thema
	"chartreuse-static-light":     "dotgrid",     // uit het carbon-pakket (was halftone)
	"cherry-graphite-light":       "pinstripe",   // krijtstreep op grafiet
	"city-lights-light":           "windows",     // de lichtjes van een skyline
	"cobalt-ink-light":            "crosshatch",  // inktarcering
	"cold-cathode-light":          "glow",        // gloeibuis
	"commit-grey-light":           "blueprint",   // diff-raster, strak en grijs
	"copper-circuit-light":        "circuit",     // past bij het thema
	"coral-reef-light":            "scales",      // patroon in plaats van een kleurvlak
	"cosmic-editor-light":         "stars",       // past bij het thema
	"deep-lagoon-light":           "bubbles",     // past bij het thema
	"denim-fade-light":            "crosshatch",  // keperstof
	"desert-rose-light":           "dunes",       // woestijn
	"desert-sand-light":           "dunes",       // woestijn
	"dusk-horizon-light":          "sunset",      // past bij het thema
	"editor-default-light":        "blueprint",   // raster van een editor
	"electric-orchid-light":       "prism",       // (blijft prism)
	"ember-ash-light":             "glow",        // gloeiende kolen
	"emerald-matrix-light":        "perspective", // (blijft perspective)
	"forest-everglade-light":      "herring",     // patroon in plaats van een kleurvlak
	"forest-moss-light":           "dotgrid",     // uit het carbon-pakket (was topo)
	"forged-titanium-light":       "hexagons",    // metaal, honingraat
	"foundry-iron-light":          "bricks",      // patroon in plaats van een kleurvlak
	"fox-night-light":             "diamonds",    // patroon in plaats van een kleurvlak
	"frost-fern-light":            "chevron",     // past bij het thema
	"frosted-juniper-light":       "bubbles",     // past bij het thema
	"frozen-lavender-light":       "mesh",        // zachte wolken in paars
	"glacier-mint-light":          "triangles",   // patroon in plaats van een kleurvlak
	"gloss-amber-resin-light":     "bokeh",       // patroon in plaats van een kleurvlak
	"gloss-aubergine-light":       "diamonds",    // patroon in plaats van een kleurvlak
	"gloss-butterscotch-light":    "sunset",      // (blijft sunset)
	"gloss-candy-lacquer-light":   "checker",     // patroon in plaats van een kleurvlak
	"gloss-cinnabar-light":        "glow",        // gloed van onderaf
	"gloss-emerald-enamel-light":  "diamonds",    // past bij het thema
	"gloss-jade-light":            "seigaiha",    // patroon in plaats van een kleurvlak
	"gloss-liquid-chrome-light":   "band",        // chroom, een felle band (teruggezet)
	"gloss-neon-tide-light":       "waves",       // (blijft waves)
	"gloss-obsidian-mirror-light": "deco",        // patroon in plaats van een kleurvlak
	"gloss-pearl-light":           "rings",       // (blijft rings)
	"gloss-rose-gold-light":       "scales",      // patroon in plaats van een kleurvlak
	"gloss-sapphire-night-light":  "glow",        // diepe gloed
	"gloss-ultraviolet-light":     "prism",       // (blijft prism)
	"graphite-prism-light":        "triangles",   // patroon in plaats van een kleurvlak
	"graphite-twill-light":        "crosshatch",  // keper
	"gray-light":                  "haze",        // (blijft haze)
	"great-wave-light":            "seigaiha",    // past bij het thema
	"gunmetal-bronze-light":       "ruled",       // uit het brushed-pakket (was hexagons)
	"harbour-fog-light":           "haze",        // past bij het thema
	"hermetic-teal-light":         "bokeh",       // patroon in plaats van een kleurvlak
	"hoarfrost-light":             "moire",       // past bij het thema
	"horizon-glow-light":          "rays",        // patroon in plaats van een kleurvlak
	"iceberg-drift-light":         "triangles",   // patroon in plaats van een kleurvlak
	"indigo-letterpress-light":    "pinstripe",   // drukwerk, fijne lijnen
	"iris-meadow-light":           "petals",      // past bij het thema
	"iron-gall-light":             "crosshatch",  // ijzergalinkt, arcering
	"jungle-neon-light":           "chevron",     // past bij het thema
	"kelp-drift-light":            "bamboo",      // past bij het thema
	"kevlar-weave-light":          "herring",     // past bij het thema
	"lavender-mist-light":         "mesh",        // zachte wolken
	"library-mahogany-light":      "tartan",      // patroon in plaats van een kleurvlak
	"licorice-layer-light":        "nebula",      // uit het velvet-pakket (was band)
	"lime-soda-light":             "bubbles",     // past bij het thema
	"marigold-dusk-light":         "topo",        // uit het paper-pakket (was sunset)
	"matrix-bluepill-light":       "scanlines",   // bestaande keuze
	"matrix-construct-light":      "wireframe",   // bestaande keuze
	"matrix-rain-light":           "scanlines",   // bestaande keuze
	"matrix-redpill-light":        "scanlines",   // bestaande keuze
	"midnight-firefly-light":      "terrazzo",    // patroon in plaats van een kleurvlak
	"midnight-ink-light":          "stars",       // nachthemel
	"midnight-neon-light":         "perspective", // (blijft perspective)
	"mirage-sand-light":           "dunes",       // fata morgana
	"monochrome-mist-light":       "moire",       // patroon in plaats van een kleurvlak
	"moonlit-steel-light":         "rings",       // past bij het thema
	"moss-stone-light":            "topo",        // landkaart
	"mulberry-silk-light":         "diamonds",    // patroon in plaats van een kleurvlak
	"nebula-nursery-light":        "nebula",      // naam; nebula past beter dan rings
	"neon-grid-light":             "circuit",     // patroon in plaats van een kleurvlak
	"neutral-light":               "stars",       // sterren, rustig grijs
	"nocturne-ink-light":          "stars",       // nachtstuk
	"nordic-frost-light":          "zigzag",      // patroon in plaats van een kleurvlak
	"obsidian-gold-light":         "deco",        // patroon in plaats van een kleurvlak
	"ocean-depth-light":           "seigaiha",    // past bij het thema
	"oceanic-steel-light":         "scales",      // patroon in plaats van een kleurvlak
	"olive-drab-light":            "ruled",       // uit het paper-pakket (was chevron)
	"owl-hours-light":             "scales",      // patroon in plaats van een kleurvlak
	"oxblood-leather-light":       "stitch",      // patroon in plaats van een kleurvlak
	"pale-night-light":            "aurora",      // uit het glass-pakket (was nebula)
	"paper-ink-light":             "halftone",    // drukwerk
	"pastel-mountain-light":       "mountains",   // naam
	"patina-verdigris-light":      "linen",       // uit het brushed-pakket (was rings)
	"peacock-light":               "scales",      // patroon in plaats van een kleurvlak
	"pistachio-cream-light":       "terrazzo",    // patroon in plaats van een kleurvlak
	"polar-dawn-light":            "rays",        // patroon in plaats van een kleurvlak
	"polar-night-light":           "mesh",        // uit het frost-pakket (was aurora)
	"porcelain-blue-light":        "seigaiha",    // patroon in plaats van een kleurvlak
	"porcelain-light":             "checker",     // patroon in plaats van een kleurvlak
	"prism-veil-light":            "prism",       // past bij het thema
	"race-livery-light":           "chevron",     // racestrepen
	"rain-window-light":           "bubbles",     // past bij het thema
	"retro-crt-light":             "scanlines",   // beeldbuis
	"retro-crt-mk2-light":         "scanlines",   // beeldbuis
	"retro-groove-light":          "chevron",     // uit het carbon-pakket (was band)
	"rhubarb-tart-light":          "tartan",      // patroon in plaats van een kleurvlak
	"rose-pine-light":             "stitch",      // patroon in plaats van een kleurvlak
	"rose-titanium-light":         "linen",       // uit het brushed-pakket (was mesh)
	"rosewater-pane-light":        "aurora",      // uit het glass-pakket (was horizon)
	"royal-amethyst-light":        "diamonds",    // patroon in plaats van een kleurvlak
	"rusted-rail-light":           "herring",     // patroon in plaats van een kleurvlak
	"saffron-robe-light":          "pinstripe",   // past bij het thema
	"sakura-night-light":          "petals",      // past bij het thema
	"salt-flat-light":             "hexagons",    // past bij het thema
	"satin-nickel-light":          "pinstripe",   // geborsteld
	"sea-glass-light":             "terrazzo",    // past bij het thema
	"signal-flare-light":          "glow",        // lichtkogel
	"slate-light":                 "aurora",      // glas onder een zacht lichtgordijn
	"slate-one-light":             "wireframe",   // editorlijnen
	"smoked-plum-light":           "deco",        // patroon in plaats van een kleurvlak
	"solar-ember-light":           "rays",        // patroon in plaats van een kleurvlak
	"solar-flats-light":           "ruled",       // uit het paper-pakket (was horizon)
	"solar-wind-light":            "zigzag",      // patroon in plaats van een kleurvlak
	"squid-ink-light":             "halftone",    // uit het ink-pakket (was rings)
	"static-noise-light":          "grain",       // past bij het thema
	"steel-dawn-light":            "herring",     // patroon in plaats van een kleurvlak
	"stone-light":                 "dunes",       // zand en steen
	"storm-petrel-light":          "zigzag",      // past bij het thema
	"sumi-ink-light":              "mountains",   // inktlandschap
	"sunflower-ink-light":         "topo",        // uit het ink-pakket (was rings)
	"synth-sunset-light":          "waves",       // (blijft waves)
	"tarnished-brass-light":       "herring",     // patroon in plaats van een kleurvlak
	"terminal-amber-light":        "scanlines",   // beeldbuis
	"terracotta-studio-light":     "dunes",       // aarde
	"thunderhead-light":           "rays",        // past bij het thema
	"tidal-slate-light":           "seigaiha",    // past bij het thema
	"tidepool-lens-light":         "moire",       // patroon in plaats van een kleurvlak
	"tomorrow-dusk-light":         "sunset",      // past bij het thema
	"tyrian-light":                "deco",        // patroon in plaats van een kleurvlak
	"ultraviolet-light":           "isocube",     // patroon in plaats van een kleurvlak
	"unraid-azure-light":          "cellgrid",    // het tekenraster van een terminal
	"unraid-black-light":          "digirain",    // de groene regen uit The Matrix, hier in het accent
	"unraid-blaze-light":          "crt",         // rood fosfor: scanlines en een rollende band
	"unraid-ember-light":          "bootlog",     // een bootlog die voorbij scrolt
	"vampire-castle-light":        "checker",     // patroon in plaats van een kleurvlak
	"velocity-ink-light":          "mountains",   // uit het ink-pakket (was chevron)
	"vermilion-seal-light":        "halftone",    // stempel
	"violet-shades-light":         "moire",       // patroon in plaats van een kleurvlak
	"vivid-hyper-light":           "bauhaus",     // patroon in plaats van een kleurvlak
	"volcanic-ash-light":          "grain",       // past bij het thema
	"wheat-field-light":           "herring",     // past bij het thema
	"winter-ember-light":          "stitch",      // patroon in plaats van een kleurvlak
	"zen-ember-light":             "ruled",       // past bij het thema
	"zinc-light":                  "dotgrid",     // fijn stippenraster
	"chalk-light":                 "ruled",       // schriftlijnen op kalk
	"concrete-light":              "bricks",      // patroon in plaats van een kleurvlak
	"black-light":                 "stars",       // sterren op zwart
}
