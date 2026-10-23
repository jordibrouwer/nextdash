package app

import "testing"

// An install that stored the old neutrals gets the new ones; one whose reader
// changed a neutral keeps their colours.
func TestOldNeutralsBecomeTheNewOnes(t *testing.T) {
	defaults := getDefaultBuiltInThemes()
	old := oldNeutralPalettes["zinc-dark"]
	stored := map[string]ThemeColors{
		"zinc-dark": {
			Name: "Zinc [dark]", TextPrimary: old[0], BackgroundPrimary: old[1], BackgroundSecondary: old[2],
			BorderPrimary: old[3], AccentPrimary: old[4], Character: "glass", Collection: "neutrals", Backdrop: "mesh",
		},
	}
	merged := mergeBuiltInThemeDefaults(stored)
	if got, want := merged["zinc-dark"], defaults["zinc-dark"]; got.BackgroundPrimary != want.BackgroundPrimary ||
		got.Character != want.Character || got.Backdrop != want.Backdrop {
		t.Errorf("the old zinc stayed: %+v", got)
	}

	edited := map[string]ThemeColors{
		"zinc-dark": {
			Name: "Zinc [dark]", TextPrimary: old[0], BackgroundPrimary: old[1], BackgroundSecondary: old[2],
			BorderPrimary: old[3], AccentPrimary: "#FF00AA", Character: "glass", Collection: "neutrals", Backdrop: "mesh",
		},
	}
	kept := mergeBuiltInThemeDefaults(edited)["zinc-dark"]
	if kept.AccentPrimary != "#FF00AA" || kept.BackgroundPrimary != old[1] {
		t.Errorf("an edited neutral was replaced: %+v", kept)
	}

	// The new ones are not old ones: merging twice changes nothing.
	again := mergeBuiltInThemeDefaults(merged)
	if again["zinc-dark"].BackgroundPrimary != defaults["zinc-dark"].BackgroundPrimary {
		t.Error("the new zinc was replaced on a second merge")
	}
}

// None of the new defaults is mistaken for an old shipped neutral.
func TestNoNewNeutralLooksLikeAnOldOne(t *testing.T) {
	for id, tc := range getDefaultBuiltInThemes() {
		if isShippedOldNeutral(id, tc) {
			t.Errorf("%s is still the neutral the previous build shipped", id)
		}
	}
}
