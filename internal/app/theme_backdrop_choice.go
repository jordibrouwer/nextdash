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
	"aluminium-deck-light":        "pinstripe",   // geborsteld metaal, fijne lijnen
	"andromeda-drift-light":       "nebula",      // sterrenstelsel
	"arctic-cyan-light":           "sunburst",    // kleurrijk (was haze)
	"aurora-glass-light":          "aurora",      // naam
	"bamboo-panda-light":          "halftone",    // zwart-wit, rasterpunten
	"bio-abyss-light":             "leak",        // kleurrijk (was grain)
	"blueprint-light":             "linen",       // uit het paper-pakket (was blueprint)
	"bone-china-light":            "rings",       // (blijft rings)
	"borealis-veil-light":         "aurora",      // noorderlicht; aurora past beter dan blooms
	"candlelit-study-light":       "ruled",       // uit het paper-pakket (was glow)
	"candy-pop-light":             "splash",      // uit het enamel-pakket (was chevron)
	"cerulean-skylark-light":      "burst",       // kleurrijk (was horizon)
	"champagne-flute-light":       "bokeh",       // bubbels; bokeh past beter dan rings
	"chartreuse-static-light":     "dotgrid",     // uit het carbon-pakket (was halftone)
	"cherry-graphite-light":       "pinstripe",   // krijtstreep op grafiet
	"city-lights-light":           "flare",       // kleurrijk (was spotlight)
	"cobalt-ink-light":            "crosshatch",  // inktarcering
	"cold-cathode-light":          "glow",        // gloeibuis
	"commit-grey-light":           "blueprint",   // diff-raster, strak en grijs
	"copper-circuit-light":        "linen",       // uit het brushed-pakket (was wireframe)
	"coral-reef-light":            "burst",       // uit het enamel-pakket (was waves)
	"cosmic-editor-light":         "splash",      // kleurrijk (was dawn)
	"deep-lagoon-light":           "leak",        // kleurrijk (was veil)
	"denim-fade-light":            "crosshatch",  // keperstof
	"desert-rose-light":           "dunes",       // woestijn
	"desert-sand-light":           "dunes",       // woestijn
	"dusk-horizon-light":          "flare",       // kleurrijk (was caustics)
	"editor-default-light":        "blueprint",   // raster van een editor
	"electric-orchid-light":       "prism",       // (blijft prism)
	"ember-ash-light":             "glow",        // gloeiende kolen
	"emerald-matrix-light":        "perspective", // (blijft perspective)
	"forest-everglade-light":      "sunburst",    // kleurrijk (was silk)
	"forest-moss-light":           "dotgrid",     // uit het carbon-pakket (was topo)
	"forged-titanium-light":       "hexagons",    // metaal, honingraat
	"foundry-iron-light":          "band",        // gietijzer, een bundel hitte
	"fox-night-light":             "tide",        // kleurrijk (was silk)
	"frost-fern-light":            "mesh",        // zachte koude wolken
	"frosted-juniper-light":       "bokeh",       // dauw op naalden
	"frozen-lavender-light":       "mesh",        // zachte wolken in paars
	"glacier-mint-light":          "tide",        // kleurrijk (was caustics)
	"gloss-amber-resin-light":     "sweep",       // (blijft sweep)
	"gloss-aubergine-light":       "blooms",      // donkere lak, twee wolken
	"gloss-butterscotch-light":    "sunset",      // (blijft sunset)
	"gloss-candy-lacquer-light":   "sweep",       // (blijft sweep)
	"gloss-cinnabar-light":        "glow",        // gloed van onderaf
	"gloss-emerald-enamel-light":  "burst",       // kleurrijk (was band)
	"gloss-jade-light":            "tide",        // kleurrijk (was sweep)
	"gloss-liquid-chrome-light":   "band",        // chroom, een felle band (teruggezet)
	"gloss-neon-tide-light":       "waves",       // (blijft waves)
	"gloss-obsidian-mirror-light": "confetti",    // kleurrijk (was dawn)
	"gloss-pearl-light":           "rings",       // (blijft rings)
	"gloss-rose-gold-light":       "blooms",      // zachte wolken in roze
	"gloss-sapphire-night-light":  "glow",        // diepe gloed
	"gloss-ultraviolet-light":     "prism",       // (blijft prism)
	"graphite-prism-light":        "spectrum",    // kleurrijk (was haze)
	"graphite-twill-light":        "crosshatch",  // keper
	"gray-light":                  "haze",        // (blijft haze)
	"great-wave-light":            "sunset",      // (blijft sunset)
	"gunmetal-bronze-light":       "ruled",       // uit het brushed-pakket (was hexagons)
	"harbour-fog-light":           "sunburst",    // kleurrijk (was caustics)
	"hermetic-teal-light":         "confetti",    // kleurrijk (was veil)
	"hoarfrost-light":             "tide",        // kleurrijk (was stars)
	"horizon-glow-light":          "flare",       // kleurrijk (was horizon)
	"iceberg-drift-light":         "ember",       // kleurrijk (was haze)
	"indigo-letterpress-light":    "pinstripe",   // drukwerk, fijne lijnen
	"iris-meadow-light":           "blooms",      // weide met bloemen
	"iron-gall-light":             "crosshatch",  // ijzergalinkt, arcering
	"jungle-neon-light":           "confetti",    // kleurrijk (was spotlight)
	"kelp-drift-light":            "chevron",     // uit het carbon-pakket (was waves)
	"kevlar-weave-light":          "hexagons",    // weefsel
	"lavender-mist-light":         "mesh",        // zachte wolken
	"library-mahogany-light":      "confetti",    // kleurrijk (was silk)
	"licorice-layer-light":        "nebula",      // uit het velvet-pakket (was band)
	"lime-soda-light":             "bokeh",       // prik; bokeh past beter dan blooms
	"marigold-dusk-light":         "topo",        // uit het paper-pakket (was sunset)
	"matrix-bluepill-light":       "scanlines",   // bestaande keuze
	"matrix-construct-light":      "wireframe",   // bestaande keuze
	"matrix-rain-light":           "scanlines",   // bestaande keuze
	"matrix-redpill-light":        "scanlines",   // bestaande keuze
	"midnight-firefly-light":      "ember",       // kleurrijk (was grain)
	"midnight-ink-light":          "stars",       // nachthemel
	"midnight-neon-light":         "perspective", // (blijft perspective)
	"mirage-sand-light":           "dunes",       // fata morgana
	"monochrome-mist-light":       "confetti",    // kleurrijk (was caustics)
	"moonlit-steel-light":         "ember",       // kleurrijk (was haze)
	"moss-stone-light":            "topo",        // landkaart
	"mulberry-silk-light":         "blooms",      // zijde
	"nebula-nursery-light":        "nebula",      // naam; nebula past beter dan rings
	"neon-grid-light":             "splash",      // kleurrijk (was perspective)
	"neutral-light":               "stars",       // sterren, rustig grijs
	"nocturne-ink-light":          "stars",       // nachtstuk
	"nordic-frost-light":          "burst",       // kleurrijk (was rings)
	"obsidian-gold-light":         "burst",       // kleurrijk (was band)
	"ocean-depth-light":           "spectrum",    // kleurrijk (was veil)
	"oceanic-steel-light":         "splash",      // kleurrijk (was haze)
	"olive-drab-light":            "ruled",       // uit het paper-pakket (was chevron)
	"owl-hours-light":             "ember",       // kleurrijk (was stars)
	"oxblood-leather-light":       "burst",       // kleurrijk (was spotlight)
	"pale-night-light":            "aurora",      // uit het glass-pakket (was nebula)
	"paper-ink-light":             "halftone",    // drukwerk
	"pastel-mountain-light":       "mountains",   // naam
	"patina-verdigris-light":      "linen",       // uit het brushed-pakket (was rings)
	"peacock-light":               "leak",        // uit het enamel-pakket (was blooms)
	"pistachio-cream-light":       "splash",      // uit het enamel-pakket (was mesh)
	"polar-dawn-light":            "inkdrop",     // kleurrijk (was horizon)
	"polar-night-light":           "mesh",        // uit het frost-pakket (was aurora)
	"porcelain-blue-light":        "leak",        // kleurrijk (was rings)
	"porcelain-light":             "burst",       // uit het enamel-pakket (was mesh)
	"prism-veil-light":            "burst",       // kleurrijk (was veil)
	"race-livery-light":           "chevron",     // racestrepen
	"rain-window-light":           "bokeh",       // regen op glas; bokeh past beter dan scanlines
	"retro-crt-light":             "scanlines",   // beeldbuis
	"retro-crt-mk2-light":         "scanlines",   // beeldbuis
	"retro-groove-light":          "chevron",     // uit het carbon-pakket (was band)
	"rhubarb-tart-light":          "leak",        // uit het enamel-pakket (was crosshatch)
	"rose-pine-light":             "splash",      // kleurrijk (was silk)
	"rose-titanium-light":         "linen",       // uit het brushed-pakket (was mesh)
	"rosewater-pane-light":        "aurora",      // uit het glass-pakket (was horizon)
	"royal-amethyst-light":        "leak",        // kleurrijk (was spotlight)
	"rusted-rail-light":           "horizon",     // uit het brushed-pakket (was perspective)
	"saffron-robe-light":          "nebula",      // uit het velvet-pakket (was dunes)
	"sakura-night-light":          "splash",      // uit het enamel-pakket (was blooms)
	"salt-flat-light":             "topo",        // kale vlakte, kaartlijnen
	"satin-nickel-light":          "pinstripe",   // geborsteld
	"sea-glass-light":             "splash",      // kleurrijk (was caustics)
	"signal-flare-light":          "glow",        // lichtkogel
	"slate-light":                 "aurora",      // glas onder een zacht lichtgordijn
	"slate-one-light":             "wireframe",   // editorlijnen
	"smoked-plum-light":           "blooms",      // donkere vrucht
	"solar-ember-light":           "sunburst",    // kleurrijk (was dawn)
	"solar-flats-light":           "ruled",       // uit het paper-pakket (was horizon)
	"solar-wind-light":            "tide",        // kleurrijk (was dawn)
	"squid-ink-light":             "halftone",    // uit het ink-pakket (was rings)
	"static-noise-light":          "hexagons",    // uit het carbon-pakket (was halftone)
	"steel-dawn-light":            "leak",        // kleurrijk (was rings)
	"stone-light":                 "dunes",       // zand en steen
	"storm-petrel-light":          "flare",       // kleurrijk (was rings)
	"sumi-ink-light":              "mountains",   // inktlandschap
	"sunflower-ink-light":         "topo",        // uit het ink-pakket (was rings)
	"synth-sunset-light":          "waves",       // (blijft waves)
	"tarnished-brass-light":       "sweep",       // uit het brushed-pakket (was crosshatch)
	"terminal-amber-light":        "scanlines",   // beeldbuis
	"terracotta-studio-light":     "dunes",       // aarde
	"thunderhead-light":           "bokeh",       // uit het frost-pakket (was glow)
	"tidal-slate-light":           "spectrum",    // kleurrijk (was haze)
	"tidepool-lens-light":         "leak",        // kleurrijk (was silk)
	"tomorrow-dusk-light":         "confetti",    // kleurrijk (was dawn)
	"tyrian-light":                "blooms",      // purperen vlakken
	"ultraviolet-light":           "flare",       // kleurrijk (was prism)
	"unraid-azure-light":          "band",        // statusbalk
	"unraid-black-light":          "wireframe",   // serverkast
	"unraid-blaze-light":          "splash",      // kleurrijk (was sunset)
	"unraid-ember-light":          "spectrum",    // kleurrijk (was waves)
	"vampire-castle-light":        "flare",       // kleurrijk (was stars)
	"velocity-ink-light":          "mountains",   // uit het ink-pakket (was chevron)
	"vermilion-seal-light":        "halftone",    // stempel
	"violet-shades-light":         "spectrum",    // kleurrijk (was spotlight)
	"vivid-hyper-light":           "inkdrop",     // kleurrijk (was perspective)
	"volcanic-ash-light":          "linen",       // uit het brushed-pakket (was mountains)
	"wheat-field-light":           "dunes",       // golvend graan
	"winter-ember-light":          "inkdrop",     // kleurrijk (was stars)
	"zen-ember-light":             "ruled",       // uit het paper-pakket (was rings)
	"zinc-light":                  "dotgrid",     // fijn stippenraster
	"chalk-light":                 "ruled",       // schriftlijnen op kalk
	"concrete-light":              "horizon",     // een lage horizon boven beton
	"black-light":                 "stars",       // sterren op zwart
}
