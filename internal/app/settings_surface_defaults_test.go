package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/*
The three Surfaces answers, agreed once.

Backdrop, glow and depth are one question asked three ways — how much of a
theme is drawn — and they had drifted apart: the backdrop shipped on, the depth
shipped rich, and the glow arrived later with no answer at all in any settings
file written before it. Depth is flat now — the theme's colours with nothing drawn on
top of them — and depthDefaultFlatMigrated is what carries an install that
already took the first pass over to it. This is the pass that puts an existing install on the
same footing as a fresh one, and the marker that stops it happening twice.
*/

func writeSurfaceSettingsFile(t *testing.T, payload map[string]any) {
	t.Helper()
	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
		t.Fatal(err)
	}
}

func TestFreshInstallStartsOnBackdropOnGlowSoftDepthGlass(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	settings := NewStore().GetSettings()

	if settings.ThemeBackdrop != "on" {
		t.Fatalf("fresh install: themeBackdrop is %q", settings.ThemeBackdrop)
	}
	// A fresh install opens on Tarnished Brass, which is built for glass and a
	// soft glow; an install that predates this keeps the flat, unlit answer the
	// migration below gave it.
	if settings.GlowStrength != "soft" {
		t.Fatalf("fresh install: glowStrength is %q", settings.GlowStrength)
	}
	if settings.ThemeDepth != "glass" {
		t.Fatalf("fresh install: themeDepth is %q", settings.ThemeDepth)
	}
}

// A settings file that carries the marker but never answered the question --
// hand written, half restored, written by a build that did not know the
// setting -- is not an upgrade, and gets what a fresh install gets.
func TestAnIncompleteSettingsFileGetsTheFreshLook(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	writeSurfaceSettingsFile(t, map[string]any{
		"currentPage":              1,
		"surfaceDefaultsMigrated":  true,
		"depthDefaultFlatMigrated": true,
	})

	settings := NewStore().GetSettings()

	if settings.Theme != defaultThemeID {
		t.Fatalf("incomplete file: theme is %q", settings.Theme)
	}
	if settings.ThemeDepth != "glass" || settings.GlowStrength != "soft" {
		t.Fatalf("incomplete file: depth %q glow %q", settings.ThemeDepth, settings.GlowStrength)
	}
	if settings.ThemeBackdrop != "on" || settings.BackgroundPattern != "auto" {
		t.Fatalf("incomplete file: backdrop %q pattern %q", settings.ThemeBackdrop, settings.BackgroundPattern)
	}
}

// And one that did answer keeps its answer.
func TestAStoredLookIsKept(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	writeSurfaceSettingsFile(t, map[string]any{
		"currentPage":              1,
		"surfaceDefaultsMigrated":  true,
		"depthDefaultFlatMigrated": true,
		"theme":                    "cherry-graphite-dark",
		"themeDepth":               "flat",
		"glowStrength":             "off",
	})

	settings := NewStore().GetSettings()

	if settings.Theme != "cherry-graphite-dark" || settings.ThemeDepth != "flat" || settings.GlowStrength != "off" {
		t.Fatalf("stored look was overwritten: theme %q depth %q glow %q",
			settings.Theme, settings.ThemeDepth, settings.GlowStrength)
	}
}

func TestExistingInstallIsMovedOntoTheSameThree(t *testing.T) {
	t.Chdir(t.TempDir())

	// An install from before the glow dial, with a backdrop switched off and a
	// depth left on flat.
	writeSurfaceSettingsFile(t, map[string]any{
		"currentPage":   1,
		"theme":         "cherry-graphite-dark",
		"themeBackdrop": "off",
		"themeDepth":    "flat",
	})

	settings := NewStore().GetSettings()

	if settings.ThemeBackdrop != "on" {
		t.Fatalf("migration: themeBackdrop is %q", settings.ThemeBackdrop)
	}
	if settings.GlowStrength != "off" {
		t.Fatalf("migration: glowStrength is %q", settings.GlowStrength)
	}
	if settings.ThemeDepth != "flat" {
		t.Fatalf("migration: themeDepth is %q", settings.ThemeDepth)
	}
	if !settings.SurfaceDefaultsMigrated {
		t.Fatal("migration: the marker was not written")
	}
}

func TestSurfaceDefaultsRunOnlyOnce(t *testing.T) {
	t.Chdir(t.TempDir())

	// The same install, one pass later: these are the reader's own answers now.
	writeSurfaceSettingsFile(t, map[string]any{
		"currentPage":              1,
		"themeBackdrop":            "off",
		"themeDepth":               "glass",
		"glowStrength":             "full",
		"surfaceDefaultsMigrated":  true,
		"depthDefaultFlatMigrated": true,
	})

	settings := NewStore().GetSettings()

	if settings.ThemeBackdrop != "off" || settings.ThemeDepth != "glass" || settings.GlowStrength != "full" {
		t.Fatalf("the pass ran twice: %q/%q/%q",
			settings.ThemeBackdrop, settings.ThemeDepth, settings.GlowStrength)
	}
}

/*
The depth default moved once more, from rich to flat.

An install that had already taken the first Surfaces pass carries
surfaceDefaultsMigrated, so that block never runs again — which is exactly why
the second move needs a marker of its own. It must reach those installs, and it
must leave everything else they have chosen alone.
*/
func TestDepthMovesToFlatForInstallsThatTookTheFirstPass(t *testing.T) {
	t.Chdir(t.TempDir())

	writeSurfaceSettingsFile(t, map[string]any{
		"currentPage":             1,
		"themeBackdrop":           "off",
		"themeDepth":              "rich",
		"glowStrength":            "full",
		"surfaceDefaultsMigrated": true,
	})

	settings := NewStore().GetSettings()

	if settings.ThemeDepth != "flat" {
		t.Fatalf("depth is %q", settings.ThemeDepth)
	}
	if !settings.DepthDefaultFlatMigrated {
		t.Fatal("the marker was not written")
	}
	// Their own answers to the other two are theirs.
	if settings.ThemeBackdrop != "off" || settings.GlowStrength != "full" {
		t.Fatalf("the pass took more than the depth: %q/%q",
			settings.ThemeBackdrop, settings.GlowStrength)
	}
}

func TestDepthFlatPassRunsOnlyOnce(t *testing.T) {
	t.Chdir(t.TempDir())

	writeSurfaceSettingsFile(t, map[string]any{
		"currentPage":              1,
		"themeDepth":               "glass",
		"surfaceDefaultsMigrated":  true,
		"depthDefaultFlatMigrated": true,
	})

	if depth := NewStore().GetSettings().ThemeDepth; depth != "glass" {
		t.Fatalf("the pass ran twice: %q", depth)
	}
}

/*
The clock and the weather stand on a line of their own.

Beside the view's name they shared a row with the page tabs and the actions,
and the weather was the first thing that row gave up when it ran out of width.
A fresh install starts on the classic placement; an install that predates it is
moved there once, and a placement chosen after that is kept.
*/
func TestFreshInstallPutsTheClockOnItsOwnLine(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	if got := NewStore().GetSettings().HeaderClockPlacement; got != "classic" {
		t.Fatalf("fresh install: headerClockPlacement = %q, want classic", got)
	}
}

func TestExistingInstallIsMovedOntoTheClassicClockOnce(t *testing.T) {
	for name, seed := range map[string]map[string]any{
		"never answered":     {"currentPage": 1},
		"stored beside-name": {"currentPage": 1, "headerClockPlacement": "beside-name"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
			t.Chdir(t.TempDir())
			writeSurfaceSettingsFile(t, seed)

			if got := NewStore().GetSettings().HeaderClockPlacement; got != "classic" {
				t.Fatalf("existing install: headerClockPlacement = %q, want classic", got)
			}
		})
	}
}

func TestAClockPlacementChosenAfterTheMoveIsKept(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"currentPage":                1,
		"headerClockPlacement":       "own-zone",
		"headerClockClassicMigrated": true,
	})

	if got := NewStore().GetSettings().HeaderClockPlacement; got != "own-zone" {
		t.Fatalf("headerClockPlacement = %q, want the stored own-zone", got)
	}
}
