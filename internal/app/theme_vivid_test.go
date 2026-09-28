package app

import (
	"strings"
	"testing"
)

/*
A colour that is always a colour.

Nine built-ins -- Gloss Chrome, Paper Ink, Monochrome Mist, Static Noise and
one Storm Petrel -- carry a grey accent on purpose, and so does --accent-info,
which is derived from it. That is right for the theme and wrong for the few
marks that exist to point: the container nextDash runs in, a row with an
update. --accent-vivid is the accent where the accent has colour, and a chosen
colour where it has none.
*/
func TestAccentVividIsTheAccentWhenItHasColour(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	if got := themeAccentVivid(themes["tarnished-brass-dark"]); got != "var(--accent-primary)" {
		t.Fatalf("a coloured accent must be used as it is, got %q", got)
	}
}

func TestAccentVividHasColourOnEveryGreyTheme(t *testing.T) {
	for id, tc := range allShippedThemes() {
		got := themeAccentVivid(tc)
		if got == "var(--accent-primary)" {
			primary := tc.AccentPrimary
			if primary == "" {
				primary = tc.AccentSuccess
			}
			if _, c, ok := hexOklch(primary); ok && c < accentVividMinChroma {
				t.Errorf("%s: grey accent %s passed through as the vivid one", id, primary)
			}
			continue
		}
		if !strings.HasPrefix(got, "oklch(") {
			t.Errorf("%s: vivid = %q", id, got)
		}
	}
}

func TestAccentVividForGlossChromeIsNotAVerdictColour(t *testing.T) {
	tc := getDefaultBuiltInThemes()["gloss-liquid-chrome-dark"]
	got := themeAccentVivid(tc)
	if !strings.HasPrefix(got, "oklch(") {
		t.Fatalf("vivid = %q, want a derived colour", got)
	}
	css := renderThemeCSSBlock("gloss-liquid-chrome-dark", tc)
	if !strings.Contains(css, "--accent-vivid: "+got+";") {
		t.Fatal("the theme block must carry --accent-vivid")
	}
}
