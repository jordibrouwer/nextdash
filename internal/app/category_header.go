package app

import "strings"

/*
The category header.

What a category is called above its bookmarks is drawn five ways, and the
default is none of them: "theme" leaves the header exactly as the theme and the
layout draw it, which is what every install had before the choice existed.

	theme        the theme's own: the "//" and the icon, in its own type
	clean        the name alone, nothing before it
	underlined   a rule under the name, in the accent colour if asked
	boxed        the name on a pane of its own
	label        small capitals, tracked wide, like a label on a drawer
	group        the whole category on one pane, the name over a rule

The size is a step either side of the theme's own, and three switches decide
what stands next to the name: the icon, the number of bookmarks, and the
accent colour on the underline.
*/

// categoryHeaderThemeOwn is the style that changes nothing.
const categoryHeaderThemeOwn = "theme"

var categoryHeaderStyles = []string{categoryHeaderThemeOwn, "clean", "underlined", "boxed", "label", "group"}

// normalizeCategoryHeaderStyle is the style a stored word stands for. A word
// this build does not know is the theme's own rather than an attribute value
// the stylesheet has no rule for, which would draw nothing different and read
// as the setting not working.
func normalizeCategoryHeaderStyle(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	for _, known := range categoryHeaderStyles {
		if value == known {
			return known
		}
	}
	return categoryHeaderThemeOwn
}

// normalizeCategoryHeaderSize is s, m or l, and m when it is anything else.
func normalizeCategoryHeaderSize(value string) string {
	switch value = strings.ToLower(strings.TrimSpace(value)); value {
	case "s", "l":
		return value
	}
	return "m"
}
