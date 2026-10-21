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

// A fresh install reads in Source Code Pro, the mono the app is named for.
func TestFontDefaultIsSourceCodeProOnAFreshInstall(t *testing.T) {
	got := fontSettings(t, nil)
	if got.FontPreset != "source-code-pro" || !got.FontDefaultMonoMigrated {
		t.Errorf("fresh install: preset %q migrated %v", got.FontPreset, got.FontDefaultMonoMigrated)
	}
}

// Everyone on Inter moves once; every other choice stays, and so does a reader
// who goes back to Inter afterwards.
func TestFontDefaultMovesEveryoneOnInterOnce(t *testing.T) {
	if got := fontSettings(t, map[string]any{"fontPreset": "inter", "fontDefaultInterMigrated": true}); got.FontPreset != "source-code-pro" || !got.FontDefaultMonoMigrated {
		t.Errorf("inter became %q", got.FontPreset)
	}
	// An install from before the Inter move passes both passes and ends on the mono.
	if got := fontSettings(t, map[string]any{"fontPreset": "source-code-pro"}); got.FontPreset != "source-code-pro" {
		t.Errorf("source-code-pro became %q", got.FontPreset)
	}
	for _, kept := range []string{"jetbrains-mono", "ibm-plex-mono", "ibm-plex-sans", "dm-sans", "system"} {
		if got := fontSettings(t, map[string]any{"fontPreset": kept}); got.FontPreset != kept {
			t.Errorf("%s moved to %q", kept, got.FontPreset)
		}
	}
	custom := fontSettings(t, map[string]any{"fontPreset": "custom", "enableCustomFont": true, "customFontPath": "/data/fonts/mine.woff2"})
	if custom.FontPreset != "custom" {
		t.Errorf("an uploaded font became %q", custom.FontPreset)
	}
	back := fontSettings(t, map[string]any{"fontPreset": "inter", "fontDefaultInterMigrated": true, "fontDefaultMonoMigrated": true})
	if back.FontPreset != "inter" {
		t.Errorf("a reader who went back to Inter after the move was moved again to %q", back.FontPreset)
	}
	missing := fontSettings(t, map[string]any{})
	if missing.FontPreset != "source-code-pro" {
		t.Errorf("an old file without the key read %q", missing.FontPreset)
	}
}
