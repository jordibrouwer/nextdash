package app

import "strings"

/*
MaterialStyle is which of two drawings a theme's material gets.

Every theme names a material (Theme.Character): lacquer, glass, frost and so
on. Until now the word only scaled a few numbers on one surface, which is why
glass, frost and aurora read as the same pane in three colours. Signature
draws each material with a construction of its own -- edge, surface, header --
and classic is the surface as it was.

A fresh install starts on signature. An install from before the setting
existed has no key and reads classic (GetSettings), so nobody's dashboard
changes under them; they choose.
*/
const (
	materialSignature = "signature"
	materialClassic   = "classic"
)

// normalizeMaterialStyle holds the setting to the two words the stylesheet
// knows. Anything else is classic: the body attribute is what the rules match
// on, and an unknown value would draw neither.
func normalizeMaterialStyle(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == materialSignature {
		return materialSignature
	}
	return materialClassic
}

// materialAttr is the value of data-material on <body>: the theme's material,
// or empty for a theme that names none, which no signature rule matches.
func materialAttr(tc ThemeColors) string {
	name := strings.ToLower(strings.TrimSpace(tc.Character))
	if !isKnownArchetype(name) {
		return ""
	}
	return name
}
