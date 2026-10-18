package app

import "strings"

/*
How a category is drawn.

A category was a list of text on the page, in every theme. The surface is
what it sits on:

	glass   a see-through pane, blurred, with the backdrop showing through
	card    a solid pane
	open    no pane at all, the list as it was

It answers the way depth, glow and effects do: "follow" hands it to the theme,
the reader's change to one theme beats the theme, and any other word set for
the install is one answer for every theme.
*/

var categorySurfaces = []string{"glass", "card", "open"}

// normalizeCategorySurface is the answer a stored word stands for: follow, or
// one of the three. Anything this build does not know is follow, so no
// attribute lands that the stylesheet has no rule for.
func normalizeCategorySurface(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == surfaceFollow {
		return value
	}
	for _, known := range categorySurfaces {
		if value == known {
			return known
		}
	}
	return surfaceFollow
}

// themeIdealCatSurface is what a theme draws a category on when nothing
// overrides it: open at flat depth (a reader who asked for flat did not ask to
// see through things), else the theme's own word, else what its archetype is
// -- brushed and carbon are solid cards, paper, velvet, aurora, ink and
// terminal are drawn on the page itself -- else glass.
func themeIdealCatSurface(tc ThemeColors, depth string) string {
	if depth == "flat" {
		return "open"
	}
	own := strings.ToLower(strings.TrimSpace(tc.Surface))
	for _, known := range categorySurfaces {
		if own == known {
			return own
		}
	}
	switch strings.ToLower(strings.TrimSpace(tc.Character)) {
	case "brushed", "carbon":
		return "card"
	case "paper", "velvet", "aurora", "ink", "terminal":
		return "open"
	}
	return "glass"
}
