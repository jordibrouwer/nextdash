package app

import "strings"

/*
Whether a widget draws a background of its own.

A widget is drawn on whatever a category is drawn on: on glass and card the
pane is its frame, on open there is none, and a widget then looks like a
category with a different title. So a widget can have a background of its own,
and it is a choice:

	auto        a background where nothing else frames it: on open. The default.
	background  always, also on glass and card
	none        never

Automatic follows the surface the page is drawn with, resolved the way the
category surface is, and not a list of themes: whatever sends a theme to open --
its own answer, its archetype, flat depth, a reader's choice for one theme or
for all of them -- gives its widgets the frame.
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
// ownGlass is a category pane the reader asked for with their own card glass:
// it frames the widget, so automatic steps back.
func resolveWidgetBackground(setting, catSurface string, ownGlass bool) string {
	switch normalizeWidgetSurface(setting) {
	case "background":
		return "background"
	case "none":
		return "none"
	}
	if catSurface == "open" && !ownGlass {
		return "background"
	}
	return "none"
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
