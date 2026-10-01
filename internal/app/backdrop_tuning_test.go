package app

import (
	"math"
	"strings"
	"testing"
)

// The old on/off setting became follow/off/<recipe>. "on" was always the
// theme's own backdrop, so reading it as follow is the whole migration.
func TestBackdropOnMigratesToFollow(t *testing.T) {
	for in, want := range map[string]string{
		"on": "follow", "": "follow", "ON": "follow", "nonsense": "follow", "follow": "follow",
		"off": "off", " Off ": "off", "mesh": "mesh", "Hexagons": "hexagons",
	} {
		if got := normalizeThemeBackdrop(in); got != want {
			t.Errorf("normalizeThemeBackdrop(%q) = %q, want %q", in, got, want)
		}
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "themeBackdrop": "on",
		"surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
	})
	if got := NewStore().GetSettings().ThemeBackdrop; got != "follow" {
		t.Fatalf("a stored \"on\" reads as %q, want follow", got)
	}
}

func TestSurfacePrefsAcceptRecipesAndOff(t *testing.T) {
	got := sanitizeSurfacePrefs(map[string]ThemeSurfacePref{
		"a": {Backdrop: "Mesh"},
		"b": {Backdrop: "off"},
		"c": {Backdrop: "on"},     // the old word: stores nothing
		"d": {Backdrop: "plasma"}, // not a recipe
		"e": {Backdrop: "follow"}, // empty is follow
		"f": {Backdrop: "mesh", Depth: "rich"},
	}, nil)
	if got["a"].Backdrop != "mesh" || got["b"].Backdrop != "off" || got["f"].Backdrop != "mesh" {
		t.Fatalf("recipes and off were not kept: %+v", got)
	}
	for _, id := range []string{"c", "d", "e"} {
		if _, ok := got[id]; ok {
			t.Errorf("%s kept an entry for a word that is not a choice: %+v", id, got[id])
		}
	}
}

func TestResolveSurfacesCarriesTheRecipe(t *testing.T) {
	tc := ThemeColors{}
	prefs := map[string]ThemeSurfacePref{"t": {Backdrop: "waves"}}

	cases := []struct {
		name         string
		global       string
		wantBackdrop string
		wantRecipe   string
	}{
		{"follow takes the reader's choice for this theme", "follow", "on", "waves"},
		{"the old on is follow", "on", "on", "waves"},
		{"a forced recipe beats the theme's own choice", "mesh", "on", "mesh"},
		{"off is off everywhere", "off", "off", ""},
	}
	for _, c := range cases {
		got := resolveSurfaces(Settings{ThemeBackdrop: c.global, ThemeSurfacePrefs: prefs}, "t", tc)
		if got.Backdrop != c.wantBackdrop || got.Recipe != c.wantRecipe {
			t.Errorf("%s: got backdrop %q recipe %q, want %q %q", c.name, got.Backdrop, got.Recipe, c.wantBackdrop, c.wantRecipe)
		}
	}
	if got := resolveSurfaces(Settings{}, "other", tc); got.Backdrop != "on" || got.Recipe != "" {
		t.Errorf("a theme with no choice should keep its own: %+v", got)
	}
}

func TestBackdropTuningIsClamped(t *testing.T) {
	got := normalizeBackdropTuning(BackdropTuning{
		Strength: 9, Scale: 0.01, Seed: 99, Blur: -4, Brightness: 5, Saturate: -1, Tint: 3,
	})
	want := BackdropTuning{Strength: 2, Scale: 0.5, Seed: 40, Blur: 0, Brightness: 1.4, Saturate: 0, Tint: 0.9}
	if got != want {
		t.Errorf("clamped to %+v, want %+v", got, want)
	}
	if got := normalizeBackdropTuning(BackdropTuning{Strength: math.NaN(), Scale: math.Inf(1), Seed: -3}); got.Strength != 1 || got.Scale != 1 || got.Seed != 0 {
		t.Errorf("non-numbers should read as the defaults: %+v", got)
	}
	// Zero strength is a real answer and must survive.
	if got := normalizeBackdropTuning(BackdropTuning{Strength: 0, Scale: 1, Brightness: 1, Saturate: 1}); got.Strength != 0 {
		t.Errorf("a strength of 0 was changed to %v", got.Strength)
	}
}

// The zero value is not the default, so a file without the object, or with
// part of it, has to be read from the file and not from the decoded zeros.
func TestBackdropTuningMissingKeys(t *testing.T) {
	def := defaultBackdropTuning()

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
	})
	if got := NewStore().GetSettings().BackdropTuning; got != def {
		t.Errorf("a file without the object reads as %+v, want %+v", got, def)
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
		"backdropTuning": map[string]any{"scale": 1.5, "seed": 7},
	})
	got := NewStore().GetSettings().BackdropTuning
	if got.Scale != 1.5 || got.Seed != 7 {
		t.Errorf("stored values were lost: %+v", got)
	}
	if got.Strength != 1 || got.Brightness != 1 || got.Saturate != 1 {
		t.Errorf("missing keys did not take the default: %+v", got)
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
		"backdropTuning": map[string]any{"strength": 0, "scale": 1, "brightness": 1, "saturate": 0},
	})
	if got := NewStore().GetSettings().BackdropTuning; got.Strength != 0 || got.Saturate != 0 {
		t.Errorf("a stored 0 was replaced by the default: %+v", got)
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	if got := NewStore().GetSettings().BackdropTuning; got != def {
		t.Errorf("a fresh install reads as %+v, want %+v", got, def)
	}
}

func TestBackdropOverrideCSSHasARulePerRecipe(t *testing.T) {
	css := themeBackdropOverrideCSS(0)
	for _, name := range themeBackdropRecipes {
		rule := `html body[data-backdrop-recipe="` + name + `"] {`
		if strings.Count(css, rule) != 1 {
			t.Errorf("%s: want exactly one rule", name)
		}
	}
	if strings.Count(css, "--theme-backdrop-size:") != len(themeBackdropRecipes) {
		t.Error("a rule is missing its size list")
	}
	if themeBackdropOverrideCSS(5) == css {
		t.Error("the seed did not reach the override rules")
	}
}
