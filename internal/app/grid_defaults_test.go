package app

import "testing"

var gridBase = map[string]any{
	"theme": "slate-dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
}

func gridFile(extra map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range gridBase {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func gridSettings(t *testing.T, file map[string]any) Settings {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	if file != nil {
		writeSurfaceSettingsFile(t, file)
	}
	return NewStore().GetSettings()
}

// A fresh install opens on masonry columns and the density that follows the
// screen.
func TestGridDefaultsOnAFreshInstall(t *testing.T) {
	got := gridSettings(t, nil)
	if got.LayoutPreset != "masonry" || got.DensityMode != "auto" || !got.GridDefaultsMigrated {
		t.Errorf("fresh install: layout %q density %q migrated %v", got.LayoutPreset, got.DensityMode, got.GridDefaultsMigrated)
	}
}

// An install still on the old defaults moves once; one that chose something
// else keeps it.
func TestGridDefaultsMoveOnceFromTheOldOnes(t *testing.T) {
	old := gridSettings(t, gridFile(map[string]any{"layoutPreset": "default", "densityMode": "compact"}))
	if old.LayoutPreset != "masonry" || old.DensityMode != "auto" || !old.GridDefaultsMigrated {
		t.Errorf("old defaults: layout %q density %q", old.LayoutPreset, old.DensityMode)
	}
	chose := gridSettings(t, gridFile(map[string]any{"layoutPreset": "cards", "densityMode": "dense"}))
	if chose.LayoutPreset != "cards" || chose.DensityMode != "dense" {
		t.Errorf("a reader's own choice moved to layout %q density %q", chose.LayoutPreset, chose.DensityMode)
	}
	oneOf := gridSettings(t, gridFile(map[string]any{"layoutPreset": "default", "densityMode": "comfortable"}))
	if oneOf.LayoutPreset != "masonry" || oneOf.DensityMode != "comfortable" {
		t.Errorf("only the old half moves: layout %q density %q", oneOf.LayoutPreset, oneOf.DensityMode)
	}
}

// After the one pass, going back to compact and default is the reader's choice
// and stays.
func TestGridDefaultsDoNotRunTwice(t *testing.T) {
	got := gridSettings(t, gridFile(map[string]any{"layoutPreset": "default", "densityMode": "compact", "gridDefaultsMigrated": true}))
	if got.LayoutPreset != "default" || got.DensityMode != "compact" {
		t.Errorf("a chosen default moved again: layout %q density %q", got.LayoutPreset, got.DensityMode)
	}
}
