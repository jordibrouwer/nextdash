package app

import "net/http"

/*
The look as a fresh install has it.

The look studio's Reset all puts every look answer back to these: the backdrop,
the surfaces, the card glass and the headers, for every theme at once. The
Layout tab (type and grid) is not part of it. The studio asks the server
rather than keeping a copy, so the two cannot drift apart.

themeSurfacePrefs and cardGlass are written as empty objects, not left out: a
settings save keeps a field it is not sent.
*/
func lookDefaults() map[string]any {
	return map[string]any{
		"themeBackdrop":            surfaceFollow,
		"backdropTuning":           defaultBackdropTuning(),
		"backgroundPattern":        "auto",
		"themeSurfacePrefs":        map[string]ThemeSurfacePref{},
		"themeSurfacesForceAll":    false,
		"cardGlass":                ThemeSurfacePref{},
		"themeDepth":               surfaceFollow,
		"glowStrength":             surfaceFollow,
		"themeEffects":             surfaceFollow,
		"categoryHeaderStyle":      categoryHeaderThemeOwn,
		"categoryHeaderSize":       "m",
		"showCategoryIcon":         true,
		"showCategoryCount":        false,
		"categoryHeaderAccentLine": false,
		"headerButtonStyle":        defaultHeaderButtonStyle,
		"pageSwitcherStyle":        defaultPageSwitcherStyle,
	}
}

// GetLookDefaults serves lookDefaults to the look studio.
func (h *Handlers) GetLookDefaults(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, lookDefaults())
}
