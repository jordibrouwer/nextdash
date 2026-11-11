package app

/*
Theme groups. A group is a set of theme families that share one idea beyond
colour -- one row per line with room between them, a page that follows the
health of your services, a row drawn as a label strip -- and a theme id prefix
(themeGroupPrefixes in theme_archetype.go).

Each group lives in its own files so a group can be built and changed without
touching the others:

	theme_group_<name>.go      the palettes, as <name>GroupThemes, and the lines
	                           that say what each family is like
	static/css/theme-group-<name>.css   what the group draws, keyed on
	                           html[data-theme^="<prefix>"]
	static/js/theme-group-<name>.js     only for a group that needs runtime

A group's themes still wear a real material underneath (Character), so the
page draws a surface it knows; the group only adds what that material lacks.
*/

// themeGroupSets lists every group's palettes. getDefaultBuiltInThemes merges
// them into the built-in map; an id that is already there is never replaced.
var themeGroupSets = []func() map[string]ThemeColors{
	stationeryGroupThemes,
	livingGroupThemes,
	instrumentGroupThemes,
	tactileGroupThemes,
	spatialGroupThemes,
	cartographicGroupThemes,
	risoGroupThemes,
	legibleGroupThemes,
}

func mergeThemeGroups(into map[string]ThemeColors) {
	for _, set := range themeGroupSets {
		for id, tc := range set() {
			if _, taken := into[id]; !taken {
				into[id] = tc
			}
		}
	}
}
