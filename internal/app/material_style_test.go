package app

import "testing"

func TestNormalizeMaterialStyle(t *testing.T) {
	for in, want := range map[string]string{
		"signature": "signature", " Signature ": "signature", "SIGNATURE": "signature",
		"classic": "classic", "": "classic", "nonsense": "classic", "follow": "classic",
	} {
		if got := normalizeMaterialStyle(in); got != want {
			t.Errorf("normalizeMaterialStyle(%q) = %q, want %q", in, got, want)
		}
	}
}

// Everyone starts on signature, a settings file from before the setting
// included: it has no key, and no key is signature. Classic is a choice.
func TestMaterialStyleDefaults(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	if got := NewStore().GetSettings().MaterialStyle; got != "signature" {
		t.Errorf("a fresh install reads %q, want signature", got)
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
	})
	if got := NewStore().GetSettings().MaterialStyle; got != "signature" {
		t.Errorf("an install from before the setting reads %q, want signature", got)
	}

	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writeSurfaceSettingsFile(t, map[string]any{
		"theme": "dark", "materialStyle": "classic",
		"surfaceDefaultsMigrated": true, "depthDefaultFlatMigrated": true, "surfaceFollowMigrated": true,
	})
	if got := NewStore().GetSettings().MaterialStyle; got != "classic" {
		t.Errorf("a stored classic reads %q", got)
	}
}

// The attribute the stylesheet matches on is the theme's material, or nothing
// for a theme that names none or names one that does not exist.
func TestMaterialAttr(t *testing.T) {
	for in, want := range map[string]string{"glass": "glass", " Neon ": "neon", "": "", "plasma": ""} {
		if got := materialAttr(ThemeColors{Character: in}); got != want {
			t.Errorf("materialAttr(%q) = %q, want %q", in, got, want)
		}
	}
}
