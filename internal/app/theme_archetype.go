package app

import (
	"math"
	"strings"
)

/*
Archetypes -- one word for the nine numbers a theme would otherwise leave
blank.

The character fields on ThemeColors have been there since the character work
landed, and 218 of the 242 entries set none of them. That is not an oversight
repeated 218 times; it is what happens when nine separate decisions stand
between a palette and a theme with a character. An archetype is one decision
that answers all nine: a surface is lacquer, or glass, or paper, and what that
means is written down once here instead of once per theme.

Three rules hold this together, and the order matters:

 1. A field the theme states for itself always wins. The 24 entries that
    already carry character are untouched by everything below.
 2. Otherwise the archetype answers -- but as an adjustment to the derivation
    that already exists, not as a replacement for it. themeSurfaceAlpha and
    themeSurfaceGlow read the palette carefully (see the comments above them);
    an archetype that overwrote their answer with a constant would flatten the
    collection in a new way rather than fix the old one. So an archetype
    scales what the palette earned.
 3. Where there is no derivation -- sheen, radius, the label, the grain --
    the archetype states a value outright. There is nothing to scale.

Everything here is data. Adding an archetype is a row in themeArchetypes; it
is not a code path.
*/

// themeArchetype is what one word means, in the terms the tokens are in.
type themeArchetype struct {
	// Scales on the values the palette derivations work out. 1 leaves the
	// derivation exactly as it is, which is the neutral value for all three.
	AlphaScale float64
	BlurScale  float64
	GlowScale  float64

	// GlowLift picks the glow's geometry: 1 a halo around the surface, 0 a
	// tinted shadow under it. -1 leaves it to themeGlowLift, which reads the
	// page -- the right answer for every archetype that has no opinion.
	GlowLift int

	// Stated outright, because nothing derives these.
	Sheen          float64
	RadiusScale    float64
	LabelTransform string
	LabelSpacing   string
	LabelWeight    int
	GrainAngle     float64
	GrainScale     float64

	// Backdrop names a recipe from themeBackdropRecipes, for the one
	// archetype that is about the page rather than about the surfaces on it.
	// Empty leaves the recipe the theme's id hashes to.
	Backdrop string
}

/*
The catalogue.

Nine of these work with the tokens that were already here; brushed, carbon and
aurora are why --surface-grain and the backdrop binding exist. They are
ordered as they read in the theme browser: the ones about light first, then
the ones about material, then the ones about type.
*/
var themeArchetypes = map[string]themeArchetype{
	// What Gloss has been until now: a lacquered surface catching a band of
	// light. The only archetype whose sheen is the whole point.
	"lacquer": {
		AlphaScale: 1, BlurScale: 1, GlowScale: 1, GlowLift: -1,
		Sheen: 0.60, RadiusScale: 1.0, LabelWeight: 600,
	},

	// You look through it. Alpha down, blur up, corners generous -- the three
	// together are what separates glass from a window.
	"glass": {
		AlphaScale: 0.80, BlurScale: 1.30, GlowScale: 1.10, GlowLift: -1,
		Sheen: 0.25, RadiusScale: 1.40, LabelWeight: 500,
	},

	// Glass gone cold: it still blurs, but it has stopped being clear, so the
	// light on it is almost nothing.
	"frost": {
		AlphaScale: 0.93, BlurScale: 1.50, GlowScale: 0.75, GlowLift: -1,
		Sheen: 0.05, RadiusScale: 1.20, LabelWeight: 500,
	},

	// Opaque, matte, square-ish, and the label carries it. Paper does not
	// glow: the small glow left is the ink warming the page, not a light.
	"paper": {
		AlphaScale: 1.30, BlurScale: 0, GlowScale: 0.20, GlowLift: 0,
		Sheen: 0, RadiusScale: 0.35,
		LabelTransform: "uppercase", LabelSpacing: "0.12em", LabelWeight: 600,
	},

	// Square, unlit, tracked wide. The one archetype that is mostly about
	// what it refuses.
	"terminal": {
		AlphaScale: 1.20, BlurScale: 0, GlowScale: 0.35, GlowLift: -1,
		Sheen: 0, RadiusScale: 0.05,
		LabelTransform: "uppercase", LabelSpacing: "0.18em", LabelWeight: 700,
	},

	// The accent leaves the surface. A halo always, never a shadow: a shadow
	// is what light falling on a thing makes, and neon is the thing emitting.
	"neon": {
		AlphaScale: 0.95, BlurScale: 1.10, GlowScale: 1.90, GlowLift: 1,
		Sheen: 0.15, RadiusScale: 0.90, LabelWeight: 600,
	},

	// Deep and soft and entirely unlit: the light is absorbed rather than
	// reflected, so it goes into the shadow under the surface instead.
	"velvet": {
		AlphaScale: 1.10, BlurScale: 0.80, GlowScale: 0.85, GlowLift: 0,
		Sheen: 0, RadiusScale: 1.45, LabelWeight: 700,
	},

	// Confectionery, ceramic, a painted tin: the roundest and the shiniest at
	// once, which is a combination nothing else here makes.
	"enamel": {
		AlphaScale: 1.15, BlurScale: 0.60, GlowScale: 1.20, GlowLift: -1,
		Sheen: 0.70, RadiusScale: 1.55, LabelWeight: 600,
	},

	// No surface effects whatsoever. The type and the hairlines do the work,
	// which is the only way a flat theme can still have a character.
	"ink": {
		AlphaScale: 1.30, BlurScale: 0, GlowScale: 0.15, GlowLift: 0,
		Sheen: 0, RadiusScale: 0.50,
		LabelSpacing: "0.06em", LabelWeight: 700,
	},

	// Metal with a direction: the grain is the whole difference between this
	// and lacquer, and it is why --surface-grain has an angle at all.
	"brushed": {
		AlphaScale: 1.05, BlurScale: 0.70, GlowScale: 0.70, GlowLift: -1,
		Sheen: 0.35, RadiusScale: 0.70, LabelWeight: 600,
		GrainAngle: 100, GrainScale: 0.55,
	},

	// A weave rather than a polish: two directions at a low strength, and
	// almost no glow, because woven things do not shine.
	"carbon": {
		AlphaScale: 1.10, BlurScale: 0.50, GlowScale: 0.45, GlowLift: 0,
		Sheen: 0.20, RadiusScale: 0.60, LabelWeight: 600,
		GrainAngle: 45, GrainScale: 1.0,
	},

	// The one archetype about the page instead of the surfaces on it: it
	// binds a backdrop recipe and lets the surfaces stay quiet above it.
	"aurora": {
		AlphaScale: 0.88, BlurScale: 1.20, GlowScale: 1.40, GlowLift: 1,
		Sheen: 0.35, RadiusScale: 1.35, LabelWeight: 500,
		Backdrop: "blooms",
	},
}

/*
themeArchetypeOrder is the catalogue in the order it is shown and documented.

A map has no order, and the theme browser's chip row, the editor's dropdown
and the locale files all have to agree on one. Kept beside the map rather than
sorted out of it so the grouping above survives: light, then material, then
type.
*/
var themeArchetypeOrder = []string{
	"lacquer", "glass", "frost", "aurora", "neon",
	"velvet", "enamel", "brushed", "carbon",
	"paper", "terminal", "ink",
}

// archetypeFor returns the profile a theme names, and whether it named one.
// An unknown word is the same as no word: a theme file from somewhere else
// cannot invent an archetype by misspelling one.
func archetypeFor(tc ThemeColors) (themeArchetype, bool) {
	name := strings.ToLower(strings.TrimSpace(tc.Character))
	if name == "" {
		return themeArchetype{}, false
	}
	profile, ok := themeArchetypes[name]
	return profile, ok
}

// isKnownArchetype says whether a word names one. Used where a value arrives
// from outside -- a saved custom theme, an import -- and has to be checked
// before it is kept.
func isKnownArchetype(name string) bool {
	_, ok := themeArchetypes[strings.ToLower(strings.TrimSpace(name))]
	return ok
}

/*
archetypeSheen, archetypeRadius and the rest answer for one token each.

Each one is the same three lines -- an explicit field wins, then the
archetype, then what happened before -- and they are written out separately
rather than through one generic because the "what happened before" differs
per token and is the part worth reading.
*/

/*
clampFloat treats zero as "unset" and answers with its fallback, which is
right for a field decoded from JSON and wrong for arithmetic: paper multiplies
the derived blur by 0 and means it. This clamps a number that has already been
worked out, where 0 is a value like any other.
*/
func clampComputed(v, min, max float64) float64 {
	if math.IsNaN(v) {
		return min
	}
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// archetypeScaleAlpha applies the archetype to a derived alpha. Clamped to
// the same range the field allows, so an archetype cannot push a surface past
// what a theme could have asked for by hand.
func archetypeScaleAlpha(tc ThemeColors, derived float64) float64 {
	profile, ok := archetypeFor(tc)
	if !ok || profile.AlphaScale == 0 {
		return derived
	}
	return math.Round(clampComputed(derived*profile.AlphaScale, 0.3, 1)*100) / 100
}

// archetypeScaleBlur does the same for the blur. A zero scale is meaningful
// here and means no blur at all -- paper, terminal and ink all want that --
// so the neutral value has to be spelled out rather than assumed.
func archetypeScaleBlur(tc ThemeColors, derived float64) float64 {
	profile, ok := archetypeFor(tc)
	if !ok {
		return derived
	}
	return math.Round(clampComputed(derived*profile.BlurScale, 0, 32))
}

// archetypeScaleGlow does the same for the glow. Neon reaches 1 this way,
// which no derivation ever does on its own.
func archetypeScaleGlow(tc ThemeColors, derived float64) float64 {
	profile, ok := archetypeFor(tc)
	if !ok {
		return derived
	}
	return math.Round(clampComputed(derived*profile.GlowScale, 0, 1)*100) / 100
}

// archetypeGlowLift returns the geometry the archetype insists on, or -1 to
// leave it to the page.
func archetypeGlowLift(tc ThemeColors) int {
	profile, ok := archetypeFor(tc)
	if !ok {
		return -1
	}
	return profile.GlowLift
}

// archetypeSheen answers for a theme that states no sheen of its own.
func archetypeSheen(tc ThemeColors) float64 {
	if tc.Sheen != 0 {
		return clampFloat(tc.Sheen, 0, 1, 0)
	}
	profile, ok := archetypeFor(tc)
	if !ok {
		return 0
	}
	return clampComputed(profile.Sheen, 0, 1)
}

// archetypeRadius answers for a theme that states no radius scale.
func archetypeRadius(tc ThemeColors) float64 {
	if tc.RadiusScale != 0 {
		return clampFloat(tc.RadiusScale, 0.05, 1.6, 1)
	}
	profile, ok := archetypeFor(tc)
	if !ok || profile.RadiusScale == 0 {
		return 1
	}
	return clampFloat(profile.RadiusScale, 0.05, 1.6, 1)
}

// archetypeLabel answers for the three label fields at once: they describe
// one element and a theme that states any of them has an opinion about it.
func archetypeLabel(tc ThemeColors) (transform, spacing string, weight int) {
	transform, spacing, weight = tc.LabelTransform, tc.LabelSpacing, tc.LabelWeight
	profile, ok := archetypeFor(tc)
	if !ok {
		return transform, spacing, weight
	}
	if transform == "" {
		transform = profile.LabelTransform
	}
	if spacing == "" {
		spacing = profile.LabelSpacing
	}
	if weight == 0 {
		weight = profile.LabelWeight
	}
	return transform, spacing, weight
}

// archetypeGrain answers for the repeating light. Returns a zero scale for
// everything that does not weave or brush, which is most of the collection.
func archetypeGrain(tc ThemeColors) (angle, scale float64) {
	angle, scale = tc.GrainAngle, tc.GrainScale
	profile, ok := archetypeFor(tc)
	if ok {
		if angle == 0 {
			angle = profile.GrainAngle
		}
		if scale == 0 {
			scale = profile.GrainScale
		}
	}
	// The angle wraps rather than clamping: 370 degrees is 10, and refusing
	// it would be refusing arithmetic somebody did on purpose.
	angle = math.Mod(angle, 360)
	if angle < 0 {
		angle += 360
	}
	return angle, clampComputed(scale, 0, 1)
}

// archetypeBackdrop is the recipe the archetype binds, or the theme's own
// choice, or empty for the hash to decide as it always has.
func archetypeBackdrop(tc ThemeColors) string {
	if tc.Backdrop != "" {
		return tc.Backdrop
	}
	profile, ok := archetypeFor(tc)
	if !ok {
		return ""
	}
	return profile.Backdrop
}

/*
The surfaces a theme was drawn for.

Depth, Glow and Effects are the reader's settings, but every theme has an
answer that suits it, and with the setting on "follow" that answer is what a
theme brings with it when it is picked. A theme may state its own; these work
one out for the 121 that do not, from the archetype rather than the palette --
the archetype is the part that says how loud a theme means to be.
*/

// themeIdealDepth is the depth a theme is drawn for.
func themeIdealDepth(tc ThemeColors) string {
	if depth := strings.ToLower(strings.TrimSpace(tc.Depth)); depth != "" {
		return depth
	}
	switch strings.ToLower(strings.TrimSpace(tc.Character)) {
	case "glass", "frost", "aurora":
		// The three you look through. Depth cannot express that; glass can.
		return "glass"
	case "lacquer", "enamel", "neon":
		// The three that are about light, and have the most to lose from a
		// ladder that stops early.
		return "vivid"
	case "velvet", "brushed", "carbon":
		return "rich"
	case "paper", "terminal", "ink":
		// The three that refuse. Soft rather than flat: flat takes away the
		// step between a surface and the page, which these still want.
		return "soft"
	default:
		return defaultThemeDepth
	}
}

// themeIdealGlow is how much accent a theme means to let out.
func themeIdealGlow(tc ThemeColors) string {
	if glow := strings.ToLower(strings.TrimSpace(tc.Glow)); glow != "" {
		return glow
	}
	switch strings.ToLower(strings.TrimSpace(tc.Character)) {
	case "neon", "aurora":
		return "full"
	case "paper", "terminal", "ink":
		return "off"
	default:
		return defaultGlowStrength
	}
}

// themeIdealEffects is how loudly the archetype gets to speak. A theme with
// no archetype has nothing to turn up, so it sits at held rather than full --
// which is also exactly today's rendering.
func themeIdealEffects(tc ThemeColors) string {
	if effects := strings.ToLower(strings.TrimSpace(tc.Effects)); effects != "" {
		return effects
	}
	if _, ok := archetypeFor(tc); ok {
		return "full"
	}
	return "held"
}

/*
themeMeta is what the browser and the editor need about a theme beyond its
colours: what kind of thing it is, the line that describes it, and the
surfaces it was drawn for.

Assembled rather than stored: three of the five are derived, and an endpoint
that answered with only what is written down would make every caller repeat
the derivation.
*/
type themeMeta struct {
	Character   string `json:"character,omitempty"`
	Description string `json:"description,omitempty"`
	Depth       string `json:"depth"`
	Glow        string `json:"glow"`
	Effects     string `json:"effects"`
}

// themeMetaFor answers for one theme.
func themeMetaFor(themeID string, tc ThemeColors) themeMeta {
	character := strings.ToLower(strings.TrimSpace(tc.Character))
	if !isKnownArchetype(character) {
		character = ""
	}
	return themeMeta{
		Character:   character,
		Description: themeDescription(themeID),
		Depth:       themeIdealDepth(tc),
		Glow:        themeIdealGlow(tc),
		Effects:     themeIdealEffects(tc),
	}
}
