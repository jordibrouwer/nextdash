package app

import (
	"sort"
	"strings"
)

/*
Tag colours: a hue per tag, so a row's chips can be told apart at a glance.

The setting holds names from a small palette rather than colour values: the
page paints each name from its own tokens, so every theme, light or dark, gets
a chip that is readable on it, and a hand-edited settings file cannot put an
arbitrary string in a style rule. A key is a tag, lower-cased the way tags are
matched; an unknown colour name or an empty tag is dropped, and the count is
capped so the map stays a setting rather than becoming a second tag list.
*/

const (
	tagColorMaxEntries = 200
	tagColorMaxTagLen  = 60
)

var tagColorPalette = map[string]struct{}{
	"red": {}, "orange": {}, "yellow": {}, "green": {},
	"teal": {}, "blue": {}, "purple": {}, "pink": {},
}

// sanitizeTagColors returns the entries that name a tag and a palette colour,
// nil when none do.
func sanitizeTagColors(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	// In key order, so that when there are too many it is always the same ones
	// that are kept.
	keys := make([]string, 0, len(in))
	for tag := range in {
		keys = append(keys, tag)
	}
	sort.Strings(keys)
	out := make(map[string]string, len(in))
	for _, rawTag := range keys {
		tag, color := rawTag, in[rawTag]
		tag = strings.ToLower(strings.TrimSpace(tag))
		color = strings.ToLower(strings.TrimSpace(color))
		if tag == "" || len([]rune(tag)) > tagColorMaxTagLen {
			continue
		}
		if _, ok := tagColorPalette[color]; !ok {
			continue
		}
		if len(out) >= tagColorMaxEntries {
			break
		}
		out[tag] = color
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
