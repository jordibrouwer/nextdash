package app

import (
	"strings"
	"testing"
)

// The neutrals are the themes that stay out of the way, so they are the ones
// that must read well: one lightness ladder, and the text and the accent held
// to a contrast on the page they sit on. A ladder that drifts shows up here.
func TestNeutralsReadWell(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	found := 0
	for id, tc := range themes {
		if tc.Collection != "neutrals" {
			continue
		}
		found++
		bg, ok := parseHexColor(tc.BackgroundPrimary)
		if !ok {
			t.Errorf("%s: background %q is not a colour", id, tc.BackgroundPrimary)
			continue
		}
		for _, c := range []struct {
			name, value string
			min         float64
		}{
			{"text", tc.TextPrimary, 12},
			{"secondary text", tc.TextSecondary, 7},
			{"tertiary text", tc.TextTertiary, 4.5},
			{"accent", tc.AccentPrimary, 4.5},
		} {
			fg, ok := parseHexColor(c.value)
			if !ok {
				t.Errorf("%s: %s %q is not a colour", id, c.name, c.value)
				continue
			}
			if got := contrastRatio(fg, bg); got < c.min {
				t.Errorf("%s: %s is %.1f:1 on the page, want at least %.1f", id, c.name, got, c.min)
			}
		}
	}
	// Eight bases, a light and a dark half each.
	if found != 16 {
		t.Errorf("%d neutral themes, want 16", found)
	}
}

// Every neutral base is a pair, and both halves wear the same material.
func TestNeutralPairsShareAMaterial(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for id, tc := range themes {
		if tc.Collection != "neutrals" || !strings.HasSuffix(id, "-light") {
			continue
		}
		dark, ok := themes[strings.TrimSuffix(id, "-light")+"-dark"]
		if !ok {
			t.Errorf("%s has no dark half", id)
			continue
		}
		if dark.Collection != "neutrals" || dark.Character != tc.Character || dark.Backdrop != tc.Backdrop {
			t.Errorf("%s and its dark half differ in collection, material or backdrop", id)
		}
	}
}
