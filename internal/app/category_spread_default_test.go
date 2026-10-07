package app

import "testing"

// New categories spread unless the reader said otherwise: a fresh install and
// a file written before the key existed both say yes, a stored false stays.
func TestDefaultCategorySpreadDefaultsOn(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	if !NewStore().GetSettings().DefaultCategorySpread {
		t.Error("fresh install: defaultCategorySpread is off")
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
	})
	if !NewStore().GetSettings().DefaultCategorySpread {
		t.Error("a file without the key: defaultCategorySpread is off")
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
		"defaultCategorySpread": false,
	})
	if NewStore().GetSettings().DefaultCategorySpread {
		t.Error("a stored false was not kept")
	}
}
