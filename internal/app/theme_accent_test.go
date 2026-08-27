package app

import (
	"strings"
	"testing"
)

/*
A theme without an accent of its own keeps the one it always had.

The field is new; 133 of the built-in themes and every custom theme somebody
already made are without it. If an absent value did not fall back, all of them
would lose their accent at once — and the failure is silent, because
sanitizeCSSColor answers "transparent" for an empty string, which is a real
colour that paints nothing.
*/
func TestAThemeWithoutItsOwnAccentFallsBackToSuccess(t *testing.T) {
	css := renderThemeCSSBlock("example", ThemeColors{
		TextPrimary:       "#FFFFFF",
		BackgroundPrimary: "#000000",
		AccentSuccess:     "#22C55E",
	})

	if !strings.Contains(css, "--accent-primary: #22C55E;") {
		t.Errorf("accent-primary did not fall back to the success colour:\n%s", css)
	}
	if strings.Contains(css, "--accent-primary: transparent;") {
		t.Error("an empty accent was sanitised into transparent rather than left empty")
	}
}

// And a theme that names one gets that one, not the success colour.
func TestAThemeWithItsOwnAccentKeepsIt(t *testing.T) {
	css := renderThemeCSSBlock("example", ThemeColors{
		TextPrimary:       "#FFFFFF",
		BackgroundPrimary: "#000000",
		AccentPrimary:     "#C084FC",
		AccentSuccess:     "#22C55E",
	})

	if !strings.Contains(css, "--accent-primary: #C084FC;") {
		t.Errorf("accent-primary = not the theme's own colour:\n%s", css)
	}
	// Success stays success: the two are separate now, and a status colour is
	// not something a theme's identity may quietly rename.
	if !strings.Contains(css, "--accent-success: #22C55E;") {
		t.Errorf("accent-success was not left alone:\n%s", css)
	}
}

// A junk accent is refused rather than passed through, the way every other
// colour on a theme is.
func TestAnInvalidAccentIsRefused(t *testing.T) {
	got := sanitizeThemeColors(ThemeColors{AccentPrimary: "url(https://evil.example/x.png)"}).AccentPrimary
	if got != "transparent" {
		t.Errorf("AccentPrimary = %q, want it sanitised", got)
	}
}

/*
An install that already has colors.json gets the new accents too.

Every built-in theme is written to disk on first run, so the old
"add it if it is missing" merge would never touch them again — the accents
would sit in the binary and reach nobody who had already started the app once.
*/
func TestStoredBuiltInThemesAreBackfilledWithTheirAccent(t *testing.T) {
	defaults := getDefaultBuiltInThemes()
	const id = "mulberry-silk-dark"
	want := defaults[id].AccentPrimary
	if want == "" {
		t.Fatalf("%s has no default accent, so this proves nothing", id)
	}

	// What an install written before the field existed looks like: the theme is
	// present, with every colour except the new one.
	onDisk := defaults[id]
	onDisk.AccentPrimary = ""
	stored := map[string]ThemeColors{id: onDisk}

	merged := mergeBuiltInThemeDefaults(stored)
	if got := merged[id].AccentPrimary; got != want {
		t.Errorf("accent = %q, want %q backfilled from the default", got, want)
	}
}

// An edit somebody made to a built-in theme survives the merge.
func TestAnEditedBuiltInThemeKeepsItsEdits(t *testing.T) {
	const id = "mulberry-silk-dark"
	edited := getDefaultBuiltInThemes()[id]
	edited.AccentPrimary = ""
	edited.BackgroundPrimary = "#010203" // somebody's own choice

	merged := mergeBuiltInThemeDefaults(map[string]ThemeColors{id: edited})
	if got := merged[id].BackgroundPrimary; got != "#010203" {
		t.Errorf("BackgroundPrimary = %q, want the stored edit kept", got)
	}
	if merged[id].AccentPrimary == "" {
		t.Error("the accent was not backfilled alongside the kept edit")
	}
}
