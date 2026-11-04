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
	"absinthe-light":              "louche",              // absint die troebel wordt
	"aluminium-deck-light":        "planking",            // naden en klinknagels van een dek
	"andromeda-drift-light":       "orbits",              // banen rond een sterrenstelsel
	"arctic-cyan-light":           "floes",               // gebroken ijsschotsen
	"aurora-glass-light":          "curtains",            // gordijnen van noorderlicht
	"bamboo-panda-light":          "panda",               // pandagezichten
	"bio-abyss-light":             "plankton",            // lichtgevend plankton
	"blueprint-light":             "compass",             // passercirkels en hulplijnen
	"bone-china-light":            "craquelure",          // craquelé van oud glazuur
	"borealis-veil-light":         "ribbons",             // lint van noorderlicht
	"candlelit-study-light":       "candleglow",          // kaarslicht zonder kaarsen
	"candy-pop-light":             "candyglow",           // kleurvlakken met glitter
	"cerulean-skylark-light":      "cloudbank",           // één wolkendek langs de bovenrand
	"champagne-flute-light":       "fizz",                // opstijgende belletjesstromen
	"chartreuse-static-light":     "static",              // tv-ruis met rolbalk
	"cherry-graphite-light":       "graphiteglow",        // rode gloed op potloodgrafiet
	"city-lights-light":           "skyline",             // skyline met verlichte ramen
	"cobalt-ink-light":            "marbled",             // marmerpapier
	"cold-cathode-light":          "tubes",               // neonbuizen met gloed
	"commit-grey-light":           "contrib",             // contributiegrafiek
	"copper-circuit-light":        "pcb",                 // printplaatsporen
	"coral-reef-light":            "swells",              // golvende banen van onder naar boven
	"cosmic-editor-light":         "nebulabands",         // nevelbanen en stof
	"deep-lagoon-light":           "lightbands",          // lichtbanen onder water
	"denim-fade-light":            "twill",               // denim met stiksels en zak
	"desert-rose-light":           "sandripples",         // windribbels in zand
	"desert-sand-light":           "mirage",              // zon, mesa's en hitte
	"dusk-horizon-light":          "twilight",            // maan, sterren en schemerwolken
	"editor-default-light":        "minimap",             // minimap van code
	"electric-orchid-light":       "orchidbloom",         // orchideebloem
	"ember-ash-light":             "emberash",            // gloeiende kolen
	"emerald-matrix-light":        "emeraldmatrix",       // (blijft perspective)
	"forest-everglade-light":      "foresteverglade",     // patroon in plaats van een kleurvlak
	"forest-moss-light":           "forestmoss",          // uit het carbon-pakket (was topo)
	"forged-titanium-light":       "forgedtitanium",      // metaal, honingraat
	"foundry-iron-light":          "foundryiron",         // patroon in plaats van een kleurvlak
	"fox-night-light":             "foxnight",            // patroon in plaats van een kleurvlak
	"frost-fern-light":            "frostfern",           // past bij het thema
	"frosted-juniper-light":       "frostedjuniper",      // past bij het thema
	"frozen-lavender-light":       "frozenlavender",      // zachte wolken in paars
	"glacier-mint-light":          "glaciermint",         // patroon in plaats van een kleurvlak
	"gloss-amber-resin-light":     "glossamberresin",     // patroon in plaats van een kleurvlak
	"gloss-aubergine-light":       "glossaubergine",      // patroon in plaats van een kleurvlak
	"gloss-butterscotch-light":    "glossbutterscotch",   // (blijft sunset)
	"gloss-candy-lacquer-light":   "glosscandylacquer",   // patroon in plaats van een kleurvlak
	"gloss-cinnabar-light":        "glosscinnabar",       // gloed van onderaf
	"gloss-emerald-enamel-light":  "glossemeraldenamel",  // past bij het thema
	"gloss-jade-light":            "glossjade",           // patroon in plaats van een kleurvlak
	"gloss-liquid-chrome-light":   "glossliquidchrome",   // chroom, een felle band (teruggezet)
	"gloss-neon-tide-light":       "glossneontide",       // (blijft waves)
	"gloss-obsidian-mirror-light": "glossobsidianmirror", // patroon in plaats van een kleurvlak
	"gloss-pearl-light":           "glosspearl",          // (blijft rings)
	"gloss-rose-gold-light":       "glossrosegold",       // patroon in plaats van een kleurvlak
	"gloss-sapphire-night-light":  "glosssapphirenight",  // diepe gloed
	"gloss-ultraviolet-light":     "glossultraviolet",    // (blijft prism)
	"graphite-prism-light":        "graphiteprism",       // patroon in plaats van een kleurvlak
	"graphite-twill-light":        "graphitetwill",       // keper
	"gray-light":                  "gray",                // (blijft haze)
	"great-wave-light":            "greatwave",           // past bij het thema
	"gunmetal-bronze-light":       "gunmetalbronze",      // uit het brushed-pakket (was hexagons)
	"harbour-fog-light":           "harbourfog",          // past bij het thema
	"hermetic-teal-light":         "hermeticteal",        // patroon in plaats van een kleurvlak
	"hoarfrost-light":             "hoarfrost",           // past bij het thema
	"horizon-glow-light":          "horizonglow",         // patroon in plaats van een kleurvlak
	"iceberg-drift-light":         "icebergdrift",        // patroon in plaats van een kleurvlak
	"indigo-letterpress-light":    "indigoletterpress",   // drukwerk, fijne lijnen
	"iris-meadow-light":           "irismeadow",          // past bij het thema
	"iron-gall-light":             "irongall",            // ijzergalinkt, arcering
	"jungle-neon-light":           "jungleneon",          // past bij het thema
	"kelp-drift-light":            "kelpdrift",           // past bij het thema
	"kevlar-weave-light":          "kevlarweave",         // past bij het thema
	"lavender-mist-light":         "lavendermist",        // zachte wolken
	"library-mahogany-light":      "librarymahogany",     // patroon in plaats van een kleurvlak
	"licorice-layer-light":        "licoricelayer",       // uit het velvet-pakket (was band)
	"lime-soda-light":             "limesoda",            // past bij het thema
	"marigold-dusk-light":         "marigolddusk",        // uit het paper-pakket (was sunset)
	"matrix-bluepill-light":       "matrixbluepill",      // bestaande keuze
	"matrix-construct-light":      "matrixconstruct",     // bestaande keuze
	"matrix-rain-light":           "matrixrain",          // bestaande keuze
	"matrix-redpill-light":        "matrixredpill",       // bestaande keuze
	"midnight-firefly-light":      "midnightfirefly",     // patroon in plaats van een kleurvlak
	"midnight-ink-light":          "midnightink",         // nachthemel
	"midnight-neon-light":         "midnightneon",        // (blijft perspective)
	"mirage-sand-light":           "miragesand",          // fata morgana
	"monochrome-mist-light":       "monochromemist",      // patroon in plaats van een kleurvlak
	"moonlit-steel-light":         "moonlitsteel",        // past bij het thema
	"moss-stone-light":            "mossstone",           // landkaart
	"mulberry-silk-light":         "mulberrysilk",        // patroon in plaats van een kleurvlak
	"nebula-nursery-light":        "nebulanursery",       // naam; nebula past beter dan rings
	"neon-grid-light":             "neongrid",            // patroon in plaats van een kleurvlak
	"neutral-light":               "neutral",             // sterren, rustig grijs
	"nocturne-ink-light":          "nocturneink",         // nachtstuk
	"nordic-frost-light":          "nordicfrost",         // patroon in plaats van een kleurvlak
	"obsidian-gold-light":         "obsidiangold",        // patroon in plaats van een kleurvlak
	"ocean-depth-light":           "oceandepth",          // past bij het thema
	"oceanic-steel-light":         "oceanicsteel",        // patroon in plaats van een kleurvlak
	"olive-drab-light":            "olivedrab",           // uit het paper-pakket (was chevron)
	"owl-hours-light":             "owlhours",            // patroon in plaats van een kleurvlak
	"oxblood-leather-light":       "oxbloodleather",      // patroon in plaats van een kleurvlak
	"pale-night-light":            "palenight",           // uit het glass-pakket (was nebula)
	"paper-ink-light":             "paperink",            // drukwerk
	"pastel-mountain-light":       "pastelmountain",      // naam
	"patina-verdigris-light":      "patinaverdigris",     // uit het brushed-pakket (was rings)
	"peacock-light":               "peacock",             // patroon in plaats van een kleurvlak
	"pistachio-cream-light":       "pistachiocream",      // patroon in plaats van een kleurvlak
	"polar-dawn-light":            "polardawn",           // patroon in plaats van een kleurvlak
	"polar-night-light":           "polarnight",          // uit het frost-pakket (was aurora)
	"porcelain-blue-light":        "porcelainblue",       // patroon in plaats van een kleurvlak
	"porcelain-light":             "porcelain",           // patroon in plaats van een kleurvlak
	"prism-veil-light":            "prismveil",           // past bij het thema
	"race-livery-light":           "racelivery",          // racestrepen
	"rain-window-light":           "rainwindow",          // past bij het thema
	"retro-crt-light":             "retrocrt",            // beeldbuis
	"retro-crt-mk2-light":         "retrocrtmk2",         // beeldbuis
	"retro-groove-light":          "retrogroove",         // uit het carbon-pakket (was band)
	"rhubarb-tart-light":          "rhubarbtart",         // patroon in plaats van een kleurvlak
	"rose-pine-light":             "rosepine",            // patroon in plaats van een kleurvlak
	"rose-titanium-light":         "rosetitanium",        // uit het brushed-pakket (was mesh)
	"rosewater-pane-light":        "rosewaterpane",       // uit het glass-pakket (was horizon)
	"royal-amethyst-light":        "royalamethyst",       // patroon in plaats van een kleurvlak
	"rusted-rail-light":           "rustedrail",          // patroon in plaats van een kleurvlak
	"saffron-robe-light":          "saffronrobe",         // past bij het thema
	"sakura-night-light":          "sakuranight",         // past bij het thema
	"salt-flat-light":             "saltflat",            // past bij het thema
	"satin-nickel-light":          "satinnickel",         // geborsteld
	"sea-glass-light":             "seaglass",            // past bij het thema
	"signal-flare-light":          "signalflare",         // lichtkogel
	"slate-light":                 "slate",               // glas onder een zacht lichtgordijn
	"slate-one-light":             "slateone",            // editorlijnen
	"smoked-plum-light":           "smokedplum",          // patroon in plaats van een kleurvlak
	"solar-ember-light":           "solarember",          // patroon in plaats van een kleurvlak
	"solar-flats-light":           "solarflats",          // uit het paper-pakket (was horizon)
	"solar-wind-light":            "solarwind",           // patroon in plaats van een kleurvlak
	"squid-ink-light":             "squidink",            // uit het ink-pakket (was rings)
	"static-noise-light":          "staticnoise",         // past bij het thema
	"steel-dawn-light":            "steeldawn",           // patroon in plaats van een kleurvlak
	"stone-light":                 "stone",               // zand en steen
	"storm-petrel-light":          "stormpetrel",         // past bij het thema
	"sumi-ink-light":              "sumiink",             // inktlandschap
	"sunflower-ink-light":         "sunflowerink",        // uit het ink-pakket (was rings)
	"synth-sunset-light":          "synthsunset",         // (blijft waves)
	"tarnished-brass-light":       "tarnishedbrass",      // patroon in plaats van een kleurvlak
	"terminal-amber-light":        "terminalamber",       // beeldbuis
	"terracotta-studio-light":     "terracottastudio",    // aarde
	"thunderhead-light":           "thunderhead",         // past bij het thema
	"tidal-slate-light":           "tidalslate",          // past bij het thema
	"tidepool-lens-light":         "tidepoollens",        // patroon in plaats van een kleurvlak
	"tomorrow-dusk-light":         "tomorrowdusk",        // past bij het thema
	"tyrian-light":                "tyrian",              // patroon in plaats van een kleurvlak
	"ultraviolet-light":           "ultraviolet",         // patroon in plaats van een kleurvlak
	"unraid-azure-light":          "unraidazure",         // het tekenraster van een terminal
	"unraid-black-light":          "unraidblack",         // de groene regen uit The Matrix, hier in het accent
	"unraid-blaze-light":          "unraidblaze",         // rood fosfor: scanlines en een rollende band
	"unraid-ember-light":          "unraidember",         // een bootlog die voorbij scrolt
	"vampire-castle-light":        "vampirecastle",       // patroon in plaats van een kleurvlak
	"velocity-ink-light":          "velocityink",         // uit het ink-pakket (was chevron)
	"vermilion-seal-light":        "vermilionseal",       // stempel
	"violet-shades-light":         "violetshades",        // patroon in plaats van een kleurvlak
	"vivid-hyper-light":           "vividhyper",          // patroon in plaats van een kleurvlak
	"volcanic-ash-light":          "volcanicash",         // past bij het thema
	"wheat-field-light":           "wheatfield",          // past bij het thema
	"winter-ember-light":          "winterember",         // patroon in plaats van een kleurvlak
	"zen-ember-light":             "zenember",            // past bij het thema
	"zinc-light":                  "zinc",                // fijn stippenraster
	"chalk-light":                 "chalk",               // schriftlijnen op kalk
	"concrete-light":              "concrete",            // patroon in plaats van een kleurvlak
	"black-light":                 "black",               // sterren op zwart
}
