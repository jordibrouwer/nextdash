package app

import "strings"

/*
The neutrals were redrawn: a lightness ladder, a material and a backdrop of
their own. Every built-in theme is written to colors.json the first time an
install runs, and fillThemeCharacter only puts back what is empty, so an install
that already stored Neutral, Stone, Gray, Zinc and Slate would never have seen
the new ones -- and would have been told, by markThemeMetaOrigin, that it had
edited them.

An old neutral is replaced by the new one when its five defining colours are
still the ones the old build shipped. A neutral whose colours the reader changed
is theirs and stays as it is, as every edited built-in does.
*/

// oldNeutralPalettes is what the previous build shipped for the five neutrals:
// the text, the page, the card, the border and the accent.
var oldNeutralPalettes = map[string][5]string{
	"slate-dark":    {"#E2E8F0", "#0F172A", "#1E293B", "#334155", "#38BDF8"},
	"slate-light":   {"#1E293B", "#F1F5F9", "#F8FAFC", "#CBD5E1", "#0369A1"},
	"zinc-dark":     {"#E4E4E7", "#18181B", "#27272A", "#3F3F46", "#A78BFA"},
	"zinc-light":    {"#27272A", "#F4F4F5", "#FAFAFA", "#D4D4D8", "#6D28D9"},
	"gray-dark":     {"#E5E7EB", "#111827", "#1F2937", "#374151", "#60A5FA"},
	"gray-light":    {"#1F2937", "#F3F4F6", "#F9FAFB", "#D1D5DB", "#1D4ED8"},
	"stone-dark":    {"#E7E5E4", "#1C1917", "#292524", "#44403C", "#F59E0B"},
	"stone-light":   {"#292524", "#F5F5F4", "#FAFAF9", "#D6D3D1", "#B45309"},
	"neutral-dark":  {"#E5E5E5", "#171717", "#262626", "#404040", "#34D399"},
	"neutral-light": {"#262626", "#F5F5F5", "#FAFAFA", "#D4D4D4", "#047857"},
}

// isShippedOldNeutral says whether a stored built-in is still exactly the
// neutral the previous build shipped.
func isShippedOldNeutral(id string, tc ThemeColors) bool {
	old, ok := oldNeutralPalettes[id]
	if !ok {
		return false
	}
	same := func(a, b string) bool { return strings.EqualFold(strings.TrimSpace(a), b) }
	return same(tc.TextPrimary, old[0]) && same(tc.BackgroundPrimary, old[1]) &&
		same(tc.BackgroundSecondary, old[2]) && same(tc.BorderPrimary, old[3]) && same(tc.AccentPrimary, old[4])
}
