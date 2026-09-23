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

/*
Every one of the passes below is now followed by one more: depth, glow and
effects move to "follow", where the theme answers. So the older passes are
history rather than behaviour -- their markers still have to be written, and
an install that forced a value after the follow pass still has to keep it, but
what a reader ends up looking at is the theme's own surfaces.
*/
func TestFreshInstallFollowsTheTheme(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	settings := NewStore().GetSettings()

	if settings.ThemeBackdrop != "on" {
		t.Fatalf("fresh install: themeBackdrop is %q", settings.ThemeBackdrop)
	}
	// A fresh install asks the theme rather than carrying an answer of its
	// own: Tarnished Brass is brushed, and brushed knows what it wants.
	for label, got := range map[string]string{
		"glowStrength": settings.GlowStrength,
		"themeDepth":   settings.ThemeDepth,
		"themeEffects": settings.ThemeEffects,
	} {
		if got != surfaceFollow {
			t.Fatalf("fresh install: %s is %q, want follow", label, got)
		}
	}
	if !settings.SurfaceFollowMigrated {
		t.Fatal("fresh install: the follow marker was not written")
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
	if settings.ThemeDepth != surfaceFollow || settings.GlowStrength != surfaceFollow {
		t.Fatalf("incomplete file: depth %q glow %q", settings.ThemeDepth, settings.GlowStrength)
	}
	if settings.ThemeBackdrop != "on" || settings.BackgroundPattern != "auto" {
		t.Fatalf("incomplete file: backdrop %q pattern %q", settings.ThemeBackdrop, settings.BackgroundPattern)
	}
}

/*
An install that did answer is moved to follow anyway, once.

Settings are written as one whole struct, so a stored depth is present on
nearly every install whether or not anybody chose it -- "key present" is not
"choice made", and this release does not pretend it can tell them apart. The
theme is theirs and stays; the surfaces move, the What's new modal says so,
and one setting puts it back.
*/
func TestAStoredLookMovesToFollowOnce(t *testing.T) {
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

	if settings.Theme != "cherry-graphite-dark" {
		t.Fatalf("the theme was overwritten: %q", settings.Theme)
	}
	if settings.ThemeDepth != surfaceFollow || settings.GlowStrength != surfaceFollow {
		t.Fatalf("the surfaces did not move to follow: depth %q glow %q",
			settings.ThemeDepth, settings.GlowStrength)
	}
}

// And once moved, a value forced afterwards is the reader's and is kept.
func TestTheFollowPassRunsOnlyOnce(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	writeSurfaceSettingsFile(t, map[string]any{
		"currentPage":              1,
		"surfaceDefaultsMigrated":  true,
		"depthDefaultFlatMigrated": true,
		"surfaceFollowMigrated":    true,
		"themeDepth":               "flat",
		"glowStrength":             "off",
		"themeEffects":             "held",
	})

	settings := NewStore().GetSettings()

	if settings.ThemeDepth != "flat" || settings.GlowStrength != "off" || settings.ThemeEffects != "held" {
		t.Fatalf("a forced look was taken away: %q/%q/%q",
			settings.ThemeDepth, settings.GlowStrength, settings.ThemeEffects)
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
	// Glow and depth are on follow: this pass still runs and still writes its
	// marker, and the follow pass after it is what the reader ends up on.
	if settings.GlowStrength != surfaceFollow || settings.ThemeDepth != surfaceFollow {
		t.Fatalf("migration: glow %q depth %q, want follow",
			settings.GlowStrength, settings.ThemeDepth)
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

	if settings.ThemeBackdrop != "off" {
		t.Fatalf("the pass ran twice: backdrop %q", settings.ThemeBackdrop)
	}
	// Depth and glow are on follow: this file predates the follow marker, so
	// that pass has just run over it.
	if settings.ThemeDepth != surfaceFollow || settings.GlowStrength != surfaceFollow {
		t.Fatalf("depth %q glow %q, want follow", settings.ThemeDepth, settings.GlowStrength)
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

	// The marker is still written -- it is what stops that pass running again
	// for anybody who goes back to forcing a depth -- but the follow pass runs
	// after it and is what the reader ends up on.
	if !settings.DepthDefaultFlatMigrated {
		t.Fatal("the marker was not written")
	}
	if settings.ThemeDepth != surfaceFollow {
		t.Fatalf("depth is %q, want follow", settings.ThemeDepth)
	}
	// The backdrop is not part of the follow pass, so their answer stands.
	if settings.ThemeBackdrop != "off" {
		t.Fatalf("the pass took the backdrop too: %q", settings.ThemeBackdrop)
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

	// The flat pass leaves it alone; the follow pass then moves it, because
	// this file carries no follow marker.
	if depth := NewStore().GetSettings().ThemeDepth; depth != surfaceFollow {
		t.Fatalf("depth is %q, want follow", depth)
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

	settings := NewStore().GetSettings()
	if settings.HeaderClockPlacement != "classic" {
		t.Fatalf("fresh install: headerClockPlacement = %q, want classic", settings.HeaderClockPlacement)
	}
	// The weather joins that line: the card in the corner asks for a town, and
	// a town with the line switched off shows nothing.
	if !settings.ShowWeatherWithDate {
		t.Fatal("fresh install: showWeatherWithDate is false")
	}
}

// An install from before the weather line keeps the dashboard it had.
func TestExistingInstallKeepsTheWeatherLineOff(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{"currentPage": 1})

	if NewStore().GetSettings().ShowWeatherWithDate {
		t.Fatal("existing install: showWeatherWithDate is true")
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
