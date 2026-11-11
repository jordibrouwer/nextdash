package app

import (
	"math"
	"regexp"
	"strconv"
	"testing"
	"unicode/utf8"
)

func legibleLuminance(hex string) float64 {
	ch := func(s string) float64 {
		v, _ := strconv.ParseUint(s, 16, 8)
		c := float64(v) / 255
		if c <= 0.03928 {
			return c / 12.92
		}
		return math.Pow((c+0.055)/1.055, 2.4)
	}
	return 0.2126*ch(hex[1:3]) + 0.7152*ch(hex[3:5]) + 0.0722*ch(hex[5:7])
}

func legibleContrast(a, b string) float64 {
	la, lb := legibleLuminance(a), legibleLuminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

func TestLegibleThemesAreComplete(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	families := []string{"legible-high-contrast-calm", "legible-low-vision-amber", "legible-colour-blind-safe"}
	hex := regexpMustHex()
	for _, family := range families {
		if d := themeDescriptions[family]; d == "" || utf8.RuneCountInString(d) > 72 {
			t.Errorf("%s: description missing or too long: %q", family, d)
		}
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc, ok := themes[id]
			if !ok {
				t.Fatalf("%s is missing", id)
			}
			if g := themeGroupFor(id); g != "legible" {
				t.Errorf("%s: group %q", id, g)
			}
			if tc.Character == "" || tc.SurfaceAlpha != 1 || tc.Depth != "flat" || tc.Glow != "off" || tc.Effects != "off" || tc.SurfaceBlur != 0 {
				t.Errorf("%s: not flat, matte and opaque", id)
			}
			for name, v := range map[string]string{
				"text": tc.TextPrimary, "text2": tc.TextSecondary, "text3": tc.TextTertiary, "bg": tc.BackgroundPrimary,
				"bg2": tc.BackgroundSecondary, "bd": tc.BorderPrimary, "ac": tc.AccentPrimary,
				"ok": tc.AccentSuccess, "warn": tc.AccentWarning, "err": tc.AccentError,
			} {
				if !hex.MatchString(v) {
					t.Errorf("%s: %s %q is not #RRGGBB", id, name, v)
				}
			}
			for _, bg := range []string{tc.BackgroundPrimary, tc.BackgroundSecondary} {
				check := func(name, fg string, min float64) {
					if r := legibleContrast(fg, bg); r < min {
						t.Errorf("%s: %s %s on %s is %.2f:1, needs %.1f", id, name, fg, bg, r, min)
					}
				}
				check("text", tc.TextPrimary, 7)
				check("text2", tc.TextSecondary, 7)
				check("text3", tc.TextTertiary, 4.5)
				check("accent", tc.AccentPrimary, 4.5)
				check("border", tc.BorderPrimary, 3)
				check("success", tc.AccentSuccess, 4.5)
				check("warning", tc.AccentWarning, 4.5)
				check("error", tc.AccentError, 4.5)
			}
		}
	}
	n := 0
	for id := range themes {
		if themeGroupFor(id) == "legible" {
			n++
		}
	}
	if n != 6 {
		t.Errorf("%d legible themes, want 6", n)
	}
}

func regexpMustHex() *regexp.Regexp { return regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`) }
