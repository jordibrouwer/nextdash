package app

/*
themeBackdropChoice is the backdrop each built-in theme was given.

One entry per light/dark pair, keyed the way themeBackdropHashID keys them (the
"-light" id), so both halves of a pair land on the same recipe. The choice came
from the theme's name, its palette and its archetype, and was reviewed one pair
at a time in docs/backdrop-assignments.html; it is not a hash, and it does not
move when the list of recipes grows.

The order a backdrop is looked up in, in themeBackdropSeeded: a recipe the
theme names itself (ThemeColors.Backdrop, which is how a custom theme chooses
one), then this map, then the recipe its archetype binds, then the hash of its
id. The last two only ever see a custom theme now.

Every recipe is used by at least three pairs and at most ten, so no backdrop is
a theme's alone and none is the whole library's. theme_backdrop_choice_test.go
holds the map to that, and to there being an entry for every built-in theme and
none for a theme that is gone.
*/
var themeBackdropChoice = map[string]string{
	"neutral-light":               "bokeh",       // lichtpunten uit focus
	"stone-light":                 "dunes",       // zand en steen
	"gray-light":                  "mountains",   // verre heuvels in blauwgrijs
	"zinc-light":                  "mesh",        // zachte wolken in neutraal grijs
	"slate-light":                 "aurora",      // glas onder een zacht lichtgordijn
	"absinthe-light":              "crosshatch",  // gegraveerd papier, absintprent
	"aluminium-deck-light":        "pinstripe",   // geborsteld metaal, fijne lijnen
	"andromeda-drift-light":       "nebula",      // sterrenstelsel
	"arctic-cyan-light":           "waves",       // koud water
	"aurora-glass-light":          "aurora",      // naam
	"bamboo-panda-light":          "halftone",    // zwart-wit, rasterpunten
	"bio-abyss-light":             "bokeh",       // bioluminescentie in diep water
	"blueprint-light":             "blueprint",   // naam
	"bone-china-light":            "rings",       // porseleinen bord, concentrische ringen
	"borealis-veil-light":         "aurora",      // noorderlicht; aurora past beter dan blooms
	"candlelit-study-light":       "glow",        // kaarslicht van onderaf
	"candy-pop-light":             "chevron",     // speels patroon
	"cerulean-skylark-light":      "horizon",     // open lucht
	"champagne-flute-light":       "bokeh",       // bubbels; bokeh past beter dan rings
	"chartreuse-static-light":     "halftone",    // statische ruis, grof raster
	"cherry-graphite-light":       "pinstripe",   // krijtstreep op grafiet
	"city-lights-light":           "bokeh",       // stadslichten uit focus
	"cobalt-ink-light":            "crosshatch",  // inktarcering
	"cold-cathode-light":          "glow",        // gloeibuis
	"commit-grey-light":           "blueprint",   // diff-raster, strak en grijs
	"copper-circuit-light":        "wireframe",   // printplaat
	"coral-reef-light":            "waves",       // rif onder water
	"cosmic-editor-light":         "stars",       // kosmos
	"deep-lagoon-light":           "waves",       // lagune
	"denim-fade-light":            "crosshatch",  // keperstof
	"desert-rose-light":           "dunes",       // woestijn
	"desert-sand-light":           "dunes",       // woestijn
	"dusk-horizon-light":          "sunset",      // zon aan de horizon
	"editor-default-light":        "blueprint",   // raster van een editor
	"electric-orchid-light":       "prism",       // fel, gebroken licht
	"ember-ash-light":             "glow",        // gloeiende kolen
	"emerald-matrix-light":        "perspective", // digitaal raster naar de horizon
	"forest-everglade-light":      "mountains",   // bosrand en heuvels
	"forest-moss-light":           "topo",        // hoogtelijnen van een bos
	"forged-titanium-light":       "hexagons",    // metaal, honingraat
	"foundry-iron-light":          "band",        // gietijzer, een bundel hitte
	"fox-night-light":             "mountains",   // nachtelijk heuvelland
	"frost-fern-light":            "mesh",        // zachte koude wolken
	"frosted-juniper-light":       "bokeh",       // dauw op naalden
	"frozen-lavender-light":       "mesh",        // zachte wolken in paars
	"glacier-mint-light":          "mountains",   // gletsjer
	"gloss-amber-resin-light":     "sweep",       // lak met een lichtband
	"gloss-aubergine-light":       "blooms",      // donkere lak, twee wolken
	"gloss-butterscotch-light":    "sunset",      // warm als karamel
	"gloss-candy-lacquer-light":   "sweep",       // lak met een lichtband
	"gloss-cinnabar-light":        "glow",        // gloed van onderaf
	"gloss-emerald-enamel-light":  "band",        // glanzende band
	"gloss-jade-light":            "sweep",       // lak met een lichtband
	"gloss-liquid-chrome-light":   "band",        // chroom, een felle band
	"gloss-neon-tide-light":       "waves",       // getij
	"gloss-obsidian-mirror-light": "prism",       // spiegelend glas
	"gloss-pearl-light":           "rings",       // parelmoer
	"gloss-rose-gold-light":       "blooms",      // zachte wolken in roze
	"gloss-sapphire-night-light":  "glow",        // diepe gloed
	"gloss-ultraviolet-light":     "prism",       // uv en breking
	"graphite-prism-light":        "prism",       // naam
	"graphite-twill-light":        "crosshatch",  // keper
	"great-wave-light":            "waves",       // naam
	"gunmetal-bronze-light":       "hexagons",    // legering, honingraat
	"harbour-fog-light":           "horizon",     // mist boven water
	"hermetic-teal-light":         "blueprint",   // technische tekening, afgesloten en koel
	"hoarfrost-light":             "stars",       // ijskristallen
	"horizon-glow-light":          "horizon",     // naam
	"iceberg-drift-light":         "topo",        // drijvend ijs, hoogtelijnen
	"indigo-letterpress-light":    "pinstripe",   // drukwerk, fijne lijnen
	"iris-meadow-light":           "blooms",      // weide met bloemen
	"iron-gall-light":             "crosshatch",  // ijzergalinkt, arcering
	"jungle-neon-light":           "chevron",     // bladpatroon
	"kelp-drift-light":            "waves",       // zeewier in de stroming
	"kevlar-weave-light":          "hexagons",    // weefsel
	"lavender-mist-light":         "mesh",        // zachte wolken
	"library-mahogany-light":      "pinstripe",   // boekruggen en hout
	"licorice-layer-light":        "band",        // laagjes
	"lime-soda-light":             "bokeh",       // prik; bokeh past beter dan blooms
	"marigold-dusk-light":         "sunset",      // schemering
	"matrix-bluepill-light":       "scanlines",   // bestaande keuze
	"matrix-construct-light":      "wireframe",   // bestaande keuze
	"matrix-rain-light":           "scanlines",   // bestaande keuze
	"matrix-redpill-light":        "scanlines",   // bestaande keuze
	"midnight-firefly-light":      "bokeh",       // vuurvliegjes
	"midnight-ink-light":          "stars",       // nachthemel
	"midnight-neon-light":         "perspective", // neonraster
	"mirage-sand-light":           "dunes",       // fata morgana
	"monochrome-mist-light":       "glow",        // mist
	"moonlit-steel-light":         "mountains",   // maanlicht op een bergrug
	"moss-stone-light":            "topo",        // landkaart
	"mulberry-silk-light":         "blooms",      // zijde
	"nebula-nursery-light":        "nebula",      // naam; nebula past beter dan rings
	"neon-grid-light":             "perspective", // neonraster
	"nocturne-ink-light":          "stars",       // nachtstuk
	"nordic-frost-light":          "mountains",   // noordse bergen
	"obsidian-gold-light":         "band",        // een streep goud
	"ocean-depth-light":           "waves",       // oceaan
	"oceanic-steel-light":         "horizon",     // zee en horizon
	"olive-drab-light":            "chevron",     // legergroen, rangstrepen
	"owl-hours-light":             "stars",       // nachtelijke uren
	"oxblood-leather-light":       "crosshatch",  // leer
	"pale-night-light":            "nebula",      // bleke sterrennevel
	"paper-ink-light":             "halftone",    // drukwerk
	"pastel-mountain-light":       "mountains",   // naam
	"patina-verdigris-light":      "rings",       // oxidatie, ringen
	"peacock-light":               "blooms",      // kleurrijke waaier
	"pistachio-cream-light":       "mesh",        // zachte room
	"polar-dawn-light":            "horizon",     // bestaande keuze
	"polar-night-light":           "aurora",      // poolnacht
	"porcelain-light":             "mesh",        // zacht en glad
	"porcelain-blue-light":        "rings",       // bord, ringen
	"prism-veil-light":            "prism",       // naam; prism past beter dan sweep
	"race-livery-light":           "chevron",     // racestrepen
	"rain-window-light":           "bokeh",       // regen op glas; bokeh past beter dan scanlines
	"retro-crt-light":             "scanlines",   // beeldbuis
	"retro-crt-mk2-light":         "scanlines",   // beeldbuis
	"retro-groove-light":          "band",        // jaren zeventig, brede strepen
	"rhubarb-tart-light":          "crosshatch",  // taartrooster
	"rose-pine-light":             "mountains",   // dennen op een helling
	"rose-titanium-light":         "mesh",        // zacht metaal
	"rosewater-pane-light":        "horizon",     // bestaande keuze
	"royal-amethyst-light":        "prism",       // edelsteen
	"rusted-rail-light":           "perspective", // rails naar de horizon
	"saffron-robe-light":          "dunes",       // warm zand
	"sakura-night-light":          "blooms",      // bloesem
	"salt-flat-light":             "topo",        // kale vlakte, kaartlijnen
	"satin-nickel-light":          "pinstripe",   // geborsteld
	"sea-glass-light":             "waves",       // geslepen door de zee
	"signal-flare-light":          "glow",        // lichtkogel
	"slate-one-light":             "wireframe",   // editorlijnen
	"smoked-plum-light":           "blooms",      // donkere vrucht
	"solar-ember-light":           "sunset",      // zon en gloed
	"solar-flats-light":           "horizon",     // vlak land
	"solar-wind-light":            "sweep",       // bestaande keuze
	"squid-ink-light":             "rings",       // inktwolk, ringen
	"unraid-black-light":          "wireframe",   // serverkast
	"unraid-azure-light":          "band",        // statusbalk
	"unraid-ember-light":          "sunset",      // gloed aan de horizon
	"unraid-blaze-light":          "horizon",     // rode lucht boven de rack
	"static-noise-light":          "halftone",    // ruis
	"steel-dawn-light":            "band",        // ochtendlicht op staal
	"storm-petrel-light":          "waves",       // zeevogel
	"sumi-ink-light":              "mountains",   // inktlandschap
	"sunflower-ink-light":         "rings",       // zaadpatroon
	"synth-sunset-light":          "sunset",      // naam
	"tarnished-brass-light":       "crosshatch",  // gepatineerd koper
	"terminal-amber-light":        "scanlines",   // beeldbuis
	"terracotta-studio-light":     "dunes",       // aarde
	"thunderhead-light":           "glow",        // onweerswolk
	"tidal-slate-light":           "waves",       // getij
	"tidepool-lens-light":         "blooms",      // bestaande keuze
	"tomorrow-dusk-light":         "sunset",      // schemering
	"tyrian-light":                "blooms",      // purperen vlakken
	"ultraviolet-light":           "prism",       // naam
	"vampire-castle-light":        "stars",       // nacht boven een kasteel
	"velocity-ink-light":          "chevron",     // snelheid
	"vermilion-seal-light":        "halftone",    // stempel
	"violet-shades-light":         "mesh",        // tinten paars
	"vivid-hyper-light":           "perspective", // hyperruimte
	"volcanic-ash-light":          "mountains",   // vulkaan
	"wheat-field-light":           "dunes",       // golvend graan
	"winter-ember-light":          "glow",        // haardvuur
	"zen-ember-light":             "rings",       // zentuin
}
