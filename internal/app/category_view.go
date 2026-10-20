package app

import "strings"

// categoryViewTiles is the one answer besides the default: the bookmarks of a
// category drawn as a grid of icon tiles, with the status dot on the corner.
// Rows are the default and are stored as nothing, so a category written before
// this field existed is rows.
const categoryViewTiles = "tiles"

// normalizeCategoryView is the view a stored word stands for: "tiles", or empty
// for rows. A word this build does not know is rows, so no attribute lands that
// the stylesheet has no rule for.
func normalizeCategoryView(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == categoryViewTiles {
		return categoryViewTiles
	}
	return ""
}
