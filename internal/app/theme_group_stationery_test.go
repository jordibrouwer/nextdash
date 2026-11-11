package app

import (
	"math"
	"regexp"
	"strconv"
	"testing"
	"unicode/utf8"
)

var stationeryFamilies = []string{"stationery-ledger", "stationery-gallery", "stationery-typewriter", "stationery-zen"}

// The three redrawn families each own a backdrop recipe.
var stationeryBackdrops = map[string]string{
	"stationery-gallery":    "gallerywall",
	"stationery-typewriter": "typesheet",
	"stationery-zen":        "zenwash",
}

var stationeryHex = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func stationeryLuminance(hex string) float64 {
	channel := func(s string) float64 {
		v, _ := strconv.ParseInt(s, 16, 32)
		c := float64(v) / 255
		if c <= 0.03928 {
			return c / 12.92
		}
		return math.Pow((c+0.055)/1.055, 2.4)
	}
	return 0.2126*channel(hex[1:3]) + 0.7152*channel(hex[3:5]) + 0.0722*channel(hex[5:7])
}

func stationeryContrast(a, b string) float64 {
	la, lb := stationeryLuminance(a), stationeryLuminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

// The Stationery group: four families, each in both halves, filed under one
// word and still wearing a real material.
func TestStationeryThemesFormTheStationeryGroup(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range stationeryFamilies {
		line := themeDescriptions[family]
		if line == "" || utf8.RuneCountInString(line) > 72 {
			t.Errorf("%s: description %q missing or too long", family, line)
		}
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc, ok := themes[id]
			if !ok {
				t.Fatalf("%s is missing", id)
			}
			meta := themeMetaFor(id, tc)
			if meta.Group != "stationery" {
				t.Errorf("%s: group %q, want stationery", id, meta.Group)
			}
			if meta.Character == "" {
				t.Errorf("%s: no material underneath", id)
			}
			if tc.Collection != "" {
				t.Errorf("%s: collection %q; the group is the filing mechanism", id, tc.Collection)
			}
			if want := stationeryBackdrops[family]; want != "" && tc.Backdrop != want {
				t.Errorf("%s: backdrop %q, want its own %q", id, tc.Backdrop, want)
			}
			for _, c := range []string{tc.TextPrimary, tc.TextSecondary, tc.BackgroundPrimary, tc.AccentPrimary} {
				if !stationeryHex.MatchString(c) {
					t.Fatalf("%s: %q is not a hex colour", id, c)
				}
			}
			if r := stationeryContrast(tc.TextPrimary, tc.BackgroundPrimary); r < 7 {
				t.Errorf("%s: text on page contrast %.2f, want 7 or more", id, r)
			}
			if r := stationeryContrast(tc.TextSecondary, tc.BackgroundPrimary); r < 4.5 {
				t.Errorf("%s: secondary text contrast %.2f, want 4.5 or more", id, r)
			}
			if r := stationeryContrast(tc.TextTertiary, tc.BackgroundPrimary); r < 4.5 {
				t.Errorf("%s: tertiary text contrast %.2f, want 4.5 or more", id, r)
			}
			if r := stationeryContrast(tc.AccentPrimary, tc.BackgroundPrimary); r < 4.5 {
				t.Errorf("%s: accent contrast %.2f, want 4.5 or more", id, r)
			}
		}
	}

	count := 0
	for id := range themes {
		if themeGroupFor(id) == "stationery" {
			count++
		}
	}
	if count != len(stationeryFamilies)*2 {
		t.Errorf("%d themes in Stationery, want %d", count, len(stationeryFamilies)*2)
	}
}
