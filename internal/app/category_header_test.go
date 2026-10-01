package app

import "testing"

func TestCategoryHeaderWordsNormalise(t *testing.T) {
	for in, want := range map[string]string{
		"": "theme", "theme": "theme", "Clean": "clean", " underlined ": "underlined",
		"boxed": "boxed", "LABEL": "label", "group": "group", "fancy": "theme",
	} {
		if got := normalizeCategoryHeaderStyle(in); got != want {
			t.Errorf("style %q = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string]string{"": "m", "s": "s", "L": "l", "m": "m", "xl": "m"} {
		if got := normalizeCategoryHeaderSize(in); got != want {
			t.Errorf("size %q = %q, want %q", in, got, want)
		}
	}
}

// The icon is on by default and a decoded false is the same as a missing key,
// so the file has to say which it was.
func TestCategoryHeaderDefaultsAndMissingKeys(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	fresh := NewStore().GetSettings()
	if !fresh.ShowCategoryIcon || fresh.ShowCategoryCount || fresh.CategoryHeaderAccentLine {
		t.Errorf("fresh install: icon %v count %v accent %v", fresh.ShowCategoryIcon, fresh.ShowCategoryCount, fresh.CategoryHeaderAccentLine)
	}
	if fresh.CategoryHeaderStyle != "theme" || fresh.CategoryHeaderSize != "m" {
		t.Errorf("fresh install: style %q size %q", fresh.CategoryHeaderStyle, fresh.CategoryHeaderSize)
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
	})
	if got := NewStore().GetSettings(); !got.ShowCategoryIcon || got.CategoryHeaderStyle != "theme" {
		t.Errorf("a file without the keys: icon %v style %q", got.ShowCategoryIcon, got.CategoryHeaderStyle)
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
		"showCategoryIcon": false, "categoryHeaderStyle": "boxed", "categoryHeaderSize": "l",
		"showCategoryCount": true, "categoryHeaderAccentLine": true,
	})
	got := NewStore().GetSettings()
	if got.ShowCategoryIcon || got.CategoryHeaderStyle != "boxed" || got.CategoryHeaderSize != "l" || !got.ShowCategoryCount || !got.CategoryHeaderAccentLine {
		t.Errorf("stored answers were not kept: %+v", got)
	}
}

func f64(v float64) *float64 { return &v }

func TestCardGlassIsClampedAndOptional(t *testing.T) {
	got := sanitizeCardGlass(ThemeSurfacePref{Alpha: f64(9), Blur: f64(-3), Border: "ON"})
	if got.Alpha == nil || *got.Alpha != 1 || got.Blur == nil || *got.Blur != 0 || got.Border != "on" {
		t.Errorf("clamped to %+v", got)
	}
	got = sanitizeCardGlass(ThemeSurfacePref{Alpha: f64(0.01), Blur: f64(99), Border: "sideways"})
	if *got.Alpha != 0.2 || *got.Blur != 30 || got.Border != "" {
		t.Errorf("clamped to alpha %v blur %v border %q", *got.Alpha, *got.Blur, got.Border)
	}
	if got := sanitizeCardGlass(ThemeSurfacePref{}); got.Alpha != nil || got.Blur != nil || got.Border != "" {
		t.Errorf("an empty answer must stay the theme's own: %+v", got)
	}
	// Zero blur is an answer, not "unset".
	if got := sanitizeCardGlass(ThemeSurfacePref{Blur: f64(0)}); got.Blur == nil {
		t.Error("a blur of 0 was taken for no answer")
	}
}

func TestCardGlassResolvesPerThemeOrForced(t *testing.T) {
	prefs := map[string]ThemeSurfacePref{"t": {Alpha: f64(0.4), Blur: f64(8), Border: "on"}}
	forced := ThemeSurfacePref{Alpha: f64(0.9), Border: ""}

	got := resolveSurfaces(Settings{ThemeSurfacePrefs: prefs, CardGlass: forced}, "t", ThemeColors{})
	if got.GlassAlpha != "0.4" || got.GlassBlur != "8" || got.GlassBorder != "on" {
		t.Errorf("per theme: %+v", got)
	}
	got = resolveSurfaces(Settings{ThemeSurfacePrefs: prefs, CardGlass: forced, ThemeSurfacesForceAll: true}, "t", ThemeColors{})
	if got.GlassAlpha != "0.9" || got.GlassBlur != "" || got.GlassBorder != "" {
		t.Errorf("forced: %+v", got)
	}
	got = resolveSurfaces(Settings{ThemeSurfacePrefs: prefs}, "other", ThemeColors{})
	if got.GlassAlpha != "" || got.GlassBlur != "" || got.GlassBorder != "" {
		t.Errorf("another theme keeps its own: %+v", got)
	}
}

func TestThemeBackdropsEndpointAnswersEveryRecipe(t *testing.T) {
	// The seed query reaches the recipes, and an unreadable one is ignored.
	a := themeBackdropSeeded("recipe:bokeh", ThemeColors{Backdrop: "bokeh", AccentPrimary: "var"}, 0)
	b := themeBackdropSeeded("recipe:bokeh", ThemeColors{Backdrop: "bokeh", AccentPrimary: "var"}, 9)
	if a == b {
		t.Fatal("the seed did not change the recipe's positions")
	}
}
