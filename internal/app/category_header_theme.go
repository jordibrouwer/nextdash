package app

/*
What "Follow the theme" means for a category header.

The header style is one setting for the install, and its default, "theme", draws
the header the way the theme and the layout do. A theme can state a header of its
own instead: while the setting is on "Follow the theme" it is drawn with that,
and a reader who picks a style is not asked again. Confetti starts clean, the
name alone, because its panes and its backdrop already carry the colour.

static/js/theme-loader.js has the same table, for a theme switched on a page that
is already open.
*/
var themeCategoryHeads = map[string]string{
	"look-confetti-dark":  "clean",
	"look-confetti-light": "clean",
}

// resolveCategoryHeader is the style a header is drawn with: the one the reader
// chose, or, on "Follow the theme", the theme's own when it states one.
func resolveCategoryHeader(style, themeID string) string {
	style = normalizeCategoryHeaderStyle(style)
	if style != categoryHeaderThemeOwn {
		return style
	}
	if own, ok := themeCategoryHeads[themeID]; ok {
		return own
	}
	return style
}
