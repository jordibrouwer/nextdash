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

func TestFreshInstallStartsOnBackdropOnGlowOffDepthFlat(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	settings := NewStore().GetSettings()

	if settings.ThemeBackdrop != "on" {
		t.Fatalf("fresh install: themeBackdrop is %q", settings.ThemeBackdrop)
	}
	if settings.GlowStrength != "off" {
		t.Fatalf("fresh install: glowStrength is %q", settings.GlowStrength)
	}
	if settings.ThemeDepth != "flat" {
		t.Fatalf("fresh install: themeDepth is %q", settings.ThemeDepth)
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
