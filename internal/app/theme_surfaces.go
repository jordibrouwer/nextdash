package app

import "strings"

/*
Whose answer the surfaces are.

Depth, Glow and Effects were one answer per install. They are now three
questions a theme also has an opinion about, which is the whole point of the
archetypes: a glass palette and a paper one do not want the same depth, and
asking the reader to change it by hand every time they switch is asking them
not to switch.

So each setting gains one value, "follow", and it is the default:

	follow            the theme's answer, or the reader's answer for that theme
	flat/soft/rich/…  one answer, everywhere, whatever the theme says

The second is not a fallback -- it is a real choice, and the reason this is
not simply "themes now decide". Somebody who picked flat on purpose picked it
for the app, not for one theme, and a release that quietly overruled them
would be the kind of change people do not forgive.
*/

// surfaceFollow is the value that hands the question to the theme.
const surfaceFollow = "follow"

/*
ThemeSurfacePref is one reader's changes to one theme's surfaces.

Every field is optional and an empty one means the theme's own answer still
stands, so a reader who only ever changes the depth of one theme stores one
field and keeps the rest of that theme's intent.
*/
type ThemeSurfacePref struct {
	Depth   string `json:"depth,omitempty"`
	Glow    string `json:"glow,omitempty"`
	Effects string `json:"effects,omitempty"`

	// Backdrop is "off" or the name of a recipe. Empty is the theme's own.
	Backdrop string `json:"backdrop,omitempty"`
}

// ResolvedSurfaces is what a page is actually drawn with.
//
// Backdrop is the word the stylesheet switches on, "on" or "off". Recipe is the
// shape the reader chose to put there instead of the theme's own, or empty when
// the theme's own stands.
type ResolvedSurfaces struct {
	Depth    string
	Glow     string
	Effects  string
	Backdrop string
	Recipe   string
}

/*
resolveSurfaces works out the four values a page is drawn with.

The order is the same for all four and is the design in three lines: a forced
setting wins, then the reader's own change to this theme, then the theme's
answer. Nothing else gets a say -- in particular the theme cannot overrule a
reader who asked for one answer everywhere, which is what makes "force" mean
anything.
*/
func resolveSurfaces(settings Settings, themeID string, tc ThemeColors) ResolvedSurfaces {
	pref := settings.ThemeSurfacePrefs[themeID]

	pick := func(global, own, ideal string) string {
		if g := strings.ToLower(strings.TrimSpace(global)); g != "" && g != surfaceFollow {
			return g
		}
		if o := strings.ToLower(strings.TrimSpace(own)); o != "" {
			return o
		}
		return ideal
	}

	// The backdrop answers in three kinds of word: "off", a recipe, or
	// "follow". "on" is what "follow" was called before recipes could be
	// chosen, and still means it.
	backdrop := pick(legacyBackdropWord(settings.ThemeBackdrop), legacyBackdropWord(pref.Backdrop), surfaceFollow)
	resolved := ResolvedSurfaces{
		Depth:    pick(settings.ThemeDepth, pref.Depth, themeIdealDepth(tc)),
		Glow:     pick(settings.GlowStrength, pref.Glow, themeIdealGlow(tc)),
		Effects:  pick(settings.ThemeEffects, pref.Effects, themeIdealEffects(tc)),
		Backdrop: "on",
	}
	switch {
	case backdrop == "off":
		resolved.Backdrop = "off"
	case themeBackdropRecipeIndex(backdrop) >= 0:
		resolved.Recipe = backdrop
	}
	return resolved
}

// legacyBackdropWord reads the old "on" as the empty answer it has become.
func legacyBackdropWord(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "on") {
		return ""
	}
	return value
}

/*
sanitizeSurfacePrefs drops anything a reader could not have chosen.

The map is written by the client and read on every page render, so a value
that reaches an attribute has to be one of the words the stylesheet knows.
Themes that no longer exist are dropped with it: a preference for a theme
nobody can pick is a row that will sit there forever.
*/
func sanitizeSurfacePrefs(prefs map[string]ThemeSurfacePref, known map[string]bool) map[string]ThemeSurfacePref {
	if len(prefs) == 0 {
		return nil
	}
	depths := map[string]bool{"flat": true, "soft": true, "rich": true, "vivid": true, "glass": true}
	glows := map[string]bool{"off": true, "soft": true, "full": true}
	effects := map[string]bool{"off": true, "held": true, "full": true}

	keep := func(value string, allowed map[string]bool) string {
		value = strings.ToLower(strings.TrimSpace(value))
		if allowed[value] {
			return value
		}
		return ""
	}
	// "off", or one of the recipes. Anything else, including the old "on", is
	// the theme's own answer and so stores nothing.
	keepBackdrop := func(value string) string {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "off" || themeBackdropRecipeIndex(value) >= 0 {
			return value
		}
		return ""
	}

	out := make(map[string]ThemeSurfacePref, len(prefs))
	for id, pref := range prefs {
		id = strings.TrimSpace(id)
		if id == "" || (known != nil && !known[id]) {
			continue
		}
		clean := ThemeSurfacePref{
			Depth:    keep(pref.Depth, depths),
			Glow:     keep(pref.Glow, glows),
			Effects:  keep(pref.Effects, effects),
			Backdrop: keepBackdrop(pref.Backdrop),
		}
		// An entry with nothing left in it is not a preference.
		if clean == (ThemeSurfacePref{}) {
			continue
		}
		out[id] = clean
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

/*
themeColorsFor is the palette a theme id stands for, wherever it lives.

The same four places themeBackgroundPrimary walks, in the same order, because
the answer has to be the same one: the surfaces a page is drawn with and the
colour its theme-color meta tag carries both describe one theme.
*/
func themeColorsFor(themeID string, colors ColorTheme) ThemeColors {
	themeID = normalizeLegacyThemeID(themeID)
	switch themeID {
	case "light":
		return colors.Light
	case "dark":
		return colors.Dark
	}
	if tc, ok := colors.BuiltIn[themeID]; ok {
		return tc
	}
	if tc, ok := colors.Custom[themeID]; ok {
		return tc
	}
	return colors.BuiltIn[defaultThemeID]
}
