package app

import (
	"math"
	"strconv"
	"strings"
	"testing"
)

var instrumentFamilies = []string{"instrument-cockpit", "instrument-oscilloscope", "instrument-dive-computer"}

func instrumentLuminance(t *testing.T, hex string) float64 {
	t.Helper()
	if len(hex) != 7 || hex[0] != '#' {
		t.Fatalf("%q is not a #RRGGBB colour", hex)
	}
	channel := func(s string) float64 {
		v, err := strconv.ParseUint(s, 16, 8)
		if err != nil {
			t.Fatalf("%q: %v", hex, err)
		}
		c := float64(v) / 255
		if c <= 0.03928 {
			return c / 12.92
		}
		return math.Pow((c+0.055)/1.055, 2.4)
	}
	return 0.2126*channel(hex[1:3]) + 0.7152*channel(hex[3:5]) + 0.0722*channel(hex[5:7])
}

func instrumentContrast(t *testing.T, a, b string) float64 {
	la, lb := instrumentLuminance(t, a), instrumentLuminance(t, b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

func TestInstrumentThemesFormTheInstrumentGroup(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range instrumentFamilies {
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc, ok := themes[id]
			if !ok {
				t.Fatalf("%s is missing", id)
			}
			meta := themeMetaFor(id, tc)
			if meta.Group != "instrument" {
				t.Errorf("%s: group %q, want instrument", id, meta.Group)
			}
			if meta.Character == "" {
				t.Errorf("%s: no material underneath", id)
			}
			if !strings.HasSuffix(tc.Name, "["+strings.TrimPrefix(half, "-")+"]") {
				t.Errorf("%s: name %q does not carry its half", id, tc.Name)
			}
			if themeDescription(id) == "" {
				t.Errorf("%s: no description", id)
			}
		}
	}
	count := 0
	for id := range themes {
		if themeGroupFor(id) == "instrument" {
			count++
		}
	}
	if count != len(instrumentFamilies)*2 {
		t.Errorf("%d themes in Instrument, want %d", count, len(instrumentFamilies)*2)
	}
}

// The runtime paints numbers in the row, so the palette has to carry them:
// every ink and every status colour reads on both page and card.
func TestInstrumentPalettesAreLegible(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for _, family := range instrumentFamilies {
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc := themes[id]
			inks := map[string]string{
				"textPrimary": tc.TextPrimary, "textSecondary": tc.TextSecondary, "textTertiary": tc.TextTertiary,
				"accentPrimary": tc.AccentPrimary, "accentSuccess": tc.AccentSuccess,
				"accentWarning": tc.AccentWarning, "accentError": tc.AccentError,
			}
			for _, bgName := range []string{tc.BackgroundPrimary, tc.BackgroundSecondary} {
				for name, ink := range inks {
					if c := instrumentContrast(t, ink, bgName); c < 4.5 {
						t.Errorf("%s: %s %s on %s is %.2f:1, want 4.5", id, name, ink, bgName, c)
					}
				}
			}
			for _, hex := range []string{tc.BackgroundDots, tc.BorderPrimary, tc.BorderSecondary} {
				instrumentLuminance(t, hex)
			}
		}
	}
}
