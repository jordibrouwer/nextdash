package app

import "testing"

func TestCategorySurfaceFollowsTheTheme(t *testing.T) {
	settings := Settings{ThemeDepth: "glass", CategorySurface: surfaceFollow}

	if got := resolveSurfaces(settings, "x", ThemeColors{}); got.CatSurface != "glass" {
		t.Errorf("a theme with no opinion resolved to %q, want glass", got.CatSurface)
	}
	if got := resolveSurfaces(settings, "x", ThemeColors{Surface: "card"}); got.CatSurface != "card" {
		t.Errorf("a theme that says card resolved to %q", got.CatSurface)
	}
	if got := resolveSurfaces(settings, "x", ThemeColors{Character: "terminal"}); got.CatSurface != "open" {
		t.Errorf("a terminal theme resolved to %q, want open", got.CatSurface)
	}
}

// A reader who asked for flat did not ask to see through things.
func TestCategorySurfaceIsOpenAtFlatDepth(t *testing.T) {
	settings := Settings{ThemeDepth: "flat", CategorySurface: surfaceFollow}
	if got := resolveSurfaces(settings, "x", ThemeColors{Surface: "glass"}); got.CatSurface != "open" {
		t.Errorf("flat depth resolved to %q, want open", got.CatSurface)
	}
	// An explicit answer still wins: it is a choice, not a default.
	settings.CategorySurface = "glass"
	if got := resolveSurfaces(settings, "x", ThemeColors{}); got.CatSurface != "glass" {
		t.Errorf("a forced glass lost to %q", got.CatSurface)
	}
}

func TestCategorySurfaceOrderOfAnswers(t *testing.T) {
	settings := Settings{
		ThemeDepth:        "glass",
		CategorySurface:   surfaceFollow,
		ThemeSurfacePrefs: map[string]ThemeSurfacePref{"a": {CatSurface: "open"}},
	}
	if got := resolveSurfaces(settings, "a", ThemeColors{Surface: "card"}); got.CatSurface != "open" {
		t.Errorf("the reader's change to the theme lost to %q", got.CatSurface)
	}
	if got := resolveSurfaces(settings, "b", ThemeColors{Surface: "card"}); got.CatSurface != "card" {
		t.Errorf("another theme was touched: %q", got.CatSurface)
	}
	settings.CategorySurface = "card"
	if got := resolveSurfaces(settings, "a", ThemeColors{}); got.CatSurface != "card" {
		t.Errorf("a forced card lost to %q", got.CatSurface)
	}
}

func TestCategorySurfaceWordsAreSanitised(t *testing.T) {
	out := sanitizeSurfacePrefs(map[string]ThemeSurfacePref{
		"good": {CatSurface: "CARD"},
		"bad":  {CatSurface: "frosted"},
	}, nil)
	if out["good"].CatSurface != "card" {
		t.Errorf("a good word came out as %+v", out["good"])
	}
	if _, ok := out["bad"]; ok {
		t.Errorf("an entry with nothing valid left was kept")
	}
}

func TestEveryThemeResolvesToAKnownCategorySurface(t *testing.T) {
	known := map[string]bool{"glass": true, "card": true, "open": true}
	settings := Settings{ThemeDepth: surfaceFollow, CategorySurface: surfaceFollow}
	for id, tc := range getDefaultBuiltInThemes() {
		if got := resolveSurfaces(settings, id, tc); !known[got.CatSurface] {
			t.Errorf("%s resolved to category surface %q", id, got.CatSurface)
		}
	}
}

// An install written before the setting existed has no key for it, and reads
// as follow: its theme draws it, and nothing else about its settings moves.
func TestCategorySurfaceMissingKeyReadsAsFollow(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	if got := NewStore().GetSettings().CategorySurface; got != surfaceFollow {
		t.Errorf("a fresh install reads %q, want follow", got)
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "slate-dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
		"auroraGlassMigrated": true, "themeDepth": "rich",
	})
	got := NewStore().GetSettings()
	if got.CategorySurface != surfaceFollow || got.Theme != "slate-dark" || got.ThemeDepth != "rich" {
		t.Errorf("an old file read as surface %q theme %q depth %q", got.CategorySurface, got.Theme, got.ThemeDepth)
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "slate-dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
		"categorySurface": "card",
	})
	if got := NewStore().GetSettings().CategorySurface; got != "card" {
		t.Errorf("a stored card read as %q", got)
	}
}

// Every save of the colours goes through the sanitiser, and a look's surface
// has to come out of it: one edit in the theme editor must not turn the card
// looks to glass and the open one to glass.
func TestSanitiserKeepsTheSurfaceAndRefillsIt(t *testing.T) {
	if got := sanitizeThemeColors(ThemeColors{Surface: " CARD "}).Surface; got != "card" {
		t.Errorf("a card surface came out as %q", got)
	}
	if got := sanitizeThemeColors(ThemeColors{Surface: "frosted"}).Surface; got != "" {
		t.Errorf("an unknown word came out as %q", got)
	}
	filled := fillThemeCharacter(ThemeColors{}, ThemeColors{Surface: "open"})
	if filled.Surface != "open" {
		t.Errorf("a stored theme that lost its surface was refilled with %q, want open", filled.Surface)
	}
	kept := fillThemeCharacter(ThemeColors{Surface: "card"}, ThemeColors{Surface: "open"})
	if kept.Surface != "card" {
		t.Errorf("the reader's own surface was overwritten with %q", kept.Surface)
	}
}

// The meta carries the theme's own word, without the depth rule: the browser
// applies flat itself, from the depth that is actually resolved.
func TestThemeMetaCatSurfaceDoesNotBakeInDepth(t *testing.T) {
	flat := themeMetaFor("x-dark", ThemeColors{Depth: "flat"})
	if flat.CatSurface != "glass" {
		t.Errorf("a theme that declares flat depth sent %q, want its own glass", flat.CatSurface)
	}
	if got := themeMetaFor("x-dark", ThemeColors{Surface: "card"}).CatSurface; got != "card" {
		t.Errorf("a card theme sent %q", got)
	}
}

// The archetypes that refuse to be seen through draw a solid card or nothing;
// the rest of the library draws glass. A theme's own word beats all of it.
func TestCategorySurfaceFollowsTheArchetype(t *testing.T) {
	want := map[string]string{
		"brushed": "card", "carbon": "card",
		"paper": "open", "velvet": "open", "aurora": "open", "ink": "open", "terminal": "open",
		"glass": "glass", "frost": "glass", "lacquer": "glass",
		"enamel": "glass", "neon": "glass", "": "glass",
	}
	for character, surface := range want {
		if got := themeIdealCatSurface(ThemeColors{Character: character}, "glass"); got != surface {
			t.Errorf("archetype %q draws %q, want %q", character, got, surface)
		}
	}
	if got := themeIdealCatSurface(ThemeColors{Character: "paper", Surface: "glass"}, "glass"); got != "glass" {
		t.Errorf("a paper theme that says glass drew %q", got)
	}
	if got := themeIdealCatSurface(ThemeColors{Character: "brushed"}, "flat"); got != "open" {
		t.Errorf("flat depth over brushed drew %q, want open", got)
	}
}

// The opacity of a pane can go as low as the card glass slider does, 0.2: a look
// at 0.2 keeps its number through a colours save and into the stylesheet, and
// anything lower is held there.
func TestSurfaceAlphaKeepsTheLowestSliderValues(t *testing.T) {
	if got := sanitizeThemeColors(ThemeColors{SurfaceAlpha: 0.2}).SurfaceAlpha; got != 0.2 {
		t.Errorf("a colours save turned 0.2 into %v", got)
	}
	if got := themeSurfaceAlpha(ThemeColors{SurfaceAlpha: 0.2}); got != "0.2" {
		t.Errorf("the stylesheet got %q for 0.2", got)
	}
	if got := themeSurfaceAlpha(ThemeColors{SurfaceAlpha: 0.05}); got != "0.2" {
		t.Errorf("0.05 came out as %q, want it held at 0.2", got)
	}
}
