package app

import "testing"

func fontSettings(t *testing.T, extra map[string]any) Settings {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	if extra != nil {
		writeSurfaceSettingsFile(t, gridFile(extra))
	}
	return NewStore().GetSettings()
}

// A fresh install reads in Inter; code, addresses and the // stay on the mono.
func TestFontDefaultIsInterOnAFreshInstall(t *testing.T) {
	got := fontSettings(t, nil)
	if got.FontPreset != "inter" || !got.FontDefaultInterMigrated {
		t.Errorf("fresh install: preset %q migrated %v", got.FontPreset, got.FontDefaultInterMigrated)
	}
}

// Everyone on Source Code Pro moves once; every other choice stays, and so does
// a reader who goes back to it afterwards.
func TestFontDefaultMovesEveryoneOnSourceCodeProOnce(t *testing.T) {
	if got := fontSettings(t, map[string]any{"fontPreset": "source-code-pro"}); got.FontPreset != "inter" || !got.FontDefaultInterMigrated {
		t.Errorf("source-code-pro became %q", got.FontPreset)
	}
	for _, kept := range []string{"jetbrains-mono", "ibm-plex-mono", "dm-sans", "system", "inter"} {
		if got := fontSettings(t, map[string]any{"fontPreset": kept}); got.FontPreset != kept {
			t.Errorf("%s moved to %q", kept, got.FontPreset)
		}
	}
	custom := fontSettings(t, map[string]any{"fontPreset": "custom", "enableCustomFont": true, "customFontPath": "/data/fonts/mine.woff2"})
	if custom.FontPreset != "custom" {
		t.Errorf("an uploaded font became %q", custom.FontPreset)
	}
	back := fontSettings(t, map[string]any{"fontPreset": "source-code-pro", "fontDefaultInterMigrated": true})
	if back.FontPreset != "source-code-pro" {
		t.Errorf("a reader who went back to Source Code Pro after the move was moved again to %q", back.FontPreset)
	}
	missing := fontSettings(t, map[string]any{})
	if missing.FontPreset != "inter" {
		t.Errorf("an old file without the key read %q", missing.FontPreset)
	}
}
