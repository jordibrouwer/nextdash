package app

import (
	"fmt"
	"math"
	"strings"
)

/*
NeutralAccent is the one colour a reader may put on the neutral themes.

The neutrals are built to stay out of the way: eight bases on one lightness
ladder, none of them with much colour. The accent is what is left, and it is
the one thing about them people want to choose -- so the choice is made once,
here, instead of by making forty-eight themes of eight bases and six colours.

"theme" is the default and means each base keeps the accent it was drawn with.
A colour word replaces it, for every theme of the neutrals collection and for
nothing else: a theme of another collection has its own palette and its own
idea of what its accent is.

The colour is worked out in OKLCH, at the lightness the page asks for, so one
word reads the same on a dark base and on a light one and always clears the
contrast the neutrals are held to (TestNeutralAccentsReadOnEveryBase). It is
applied where the stylesheet is written (renderThemeCSS), which is the server's
side of the same split as everything else in a theme: the palette is data, the
page reads it.
*/
const neutralAccentTheme = "theme"

// neutralAccentHues are the six colours, as OKLCH hues.
var neutralAccentHues = map[string]float64{
	"blue": 255, "teal": 190, "green": 150, "amber": 75, "rose": 10, "violet": 295,
}

// neutralAccentOrder is how the six are shown.
var neutralAccentOrder = []string{"blue", "teal", "green", "amber", "rose", "violet"}

// normalizeNeutralAccent holds the setting to a word the server knows.
func normalizeNeutralAccent(value string) string {
	word := strings.ToLower(strings.TrimSpace(value))
	if _, ok := neutralAccentHues[word]; ok {
		return word
	}
	return neutralAccentTheme
}

// applyNeutralAccent gives a theme of the neutrals the reader's accent. Any
// other theme, and the word "theme", come back as they were.
func applyNeutralAccent(tc ThemeColors, word string) ThemeColors {
	hue, ok := neutralAccentHues[normalizeNeutralAccent(word)]
	if !ok || tc.Collection != "neutrals" {
		return tc
	}
	// Dark or light is read off the page itself: the neutrals are pairs, and
	// the lightness that clears the contrast on one does not on the other.
	// Start where a base of that kind usually wants it and step until the
	// colour clears the floor on this page, which a mid-grey base (concrete)
	// needs a step or two for.
	dark := false
	if lum, ok := hexLuminance(tc.BackgroundPrimary); ok && lum < 0.4 {
		dark = true
	}
	lightness, step := 0.5, -0.01
	if dark {
		lightness, step = 0.76, 0.01
	}
	// The page and the card: accent text sits on both, and the card is a step
	// from the page, so a colour that clears one can miss the other.
	bg, bgOK := wcagLuminance(tc.BackgroundPrimary)
	card, cardOK := wcagLuminance(tc.BackgroundSecondary)
	accent := oklchHex(lightness, 0.14, hue)
	for i := 0; bgOK && i < 40; i++ {
		if fg, ok := wcagLuminance(accent); ok && wcagRatio(fg, bg) >= neutralAccentFloor &&
			(!cardOK || wcagRatio(fg, card) >= neutralAccentFloor) {
			break
		}
		lightness += step
		accent = oklchHex(lightness, 0.14, hue)
	}
	tc.AccentPrimary = accent
	return tc
}

// neutralAccentFloor is the contrast an accent keeps on its page: a little over
// the 4.5 the neutrals are held to, so rounding to a hex cannot take it under.
const neutralAccentFloor = 4.6

// wcagLuminance is the WCAG relative luminance of a #RRGGBB colour.
func wcagLuminance(hex string) (float64, bool) {
	h := strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(h) != 6 {
		return 0, false
	}
	var channel [3]float64
	for i := 0; i < 3; i++ {
		var v int
		if _, err := fmt.Sscanf(h[i*2:i*2+2], "%02x", &v); err != nil {
			return 0, false
		}
		c := float64(v) / 255
		if c <= 0.04045 {
			c /= 12.92
		} else {
			c = math.Pow((c+0.055)/1.055, 2.4)
		}
		channel[i] = c
	}
	return 0.2126*channel[0] + 0.7152*channel[1] + 0.0722*channel[2], true
}

func wcagRatio(a, b float64) float64 {
	if a < b {
		a, b = b, a
	}
	return (a + 0.05) / (b + 0.05)
}

// oklchHex is an OKLCH colour as #RRGGBB, clipped into sRGB.
func oklchHex(l, c, hueDegrees float64) string {
	a := c * math.Cos(hueDegrees*math.Pi/180)
	b := c * math.Sin(hueDegrees*math.Pi/180)
	l_ := l + 0.3963377774*a + 0.2158037573*b
	m_ := l - 0.1055613458*a - 0.0638541728*b
	s_ := l - 0.0894841775*a - 1.2914855480*b
	l3, m3, s3 := l_*l_*l_, m_*m_*m_, s_*s_*s_
	linear := [3]float64{
		4.0767416621*l3 - 3.3077115913*m3 + 0.2309699292*s3,
		-1.2684380046*l3 + 2.6097574011*m3 - 0.3413193965*s3,
		-0.0041960863*l3 - 0.7034186147*m3 + 1.7076147010*s3,
	}
	var out [3]int
	for i, v := range linear {
		v = math.Max(0, math.Min(1, v))
		if v <= 0.0031308 {
			v *= 12.92
		} else {
			v = 1.055*math.Pow(v, 1/2.4) - 0.055
		}
		out[i] = int(math.Round(v * 255))
	}
	return fmt.Sprintf("#%02X%02X%02X", out[0], out[1], out[2])
}
