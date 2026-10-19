package app

import "strings"

/*
Whether a widget draws a background of its own.

A widget is drawn on whatever a category is drawn on, and on glass a widget
and a category were the same pane under a different title. So a widget has a
background of its own: a header strip on its title, with a line under it, on
every surface, and on open a card round it as well (nothing else frames it
there). It is a choice:

	background  a strip on the title, and a card where nothing else is one.
	            The default.
	none        never

"auto" is the word an install from before this was settled has stored, and it
means the same as background.
*/

var widgetSurfaces = []string{"auto", "background", "none"}

// normalizeWidgetSurface is the answer a stored word stands for. Anything this
// build does not know is auto, so no attribute lands that the stylesheet has no
// rule for.
func normalizeWidgetSurface(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	for _, known := range widgetSurfaces {
		if value == known {
			return known
		}
	}
	return "auto"
}

// resolveWidgetBackground is what the page is drawn with: background or none.
func resolveWidgetBackground(setting string) string {
	if normalizeWidgetSurface(setting) == "none" {
		return "none"
	}
	return "background"
}

// defaultWidgetOpacity is how solid a widget's card is, in percent of the
// surface colour: mostly solid, so a widget reads as a card on any backdrop.
// maxWidgetOpacity is the most it can be.
const (
	defaultWidgetOpacity = 70
	maxWidgetOpacity     = 100
)

// normalizeWidgetOpacity keeps the answer between 0 and the most there is.
func normalizeWidgetOpacity(percent int) int {
	if percent < 0 {
		return 0
	}
	if percent > maxWidgetOpacity {
		return maxWidgetOpacity
	}
	return percent
}
