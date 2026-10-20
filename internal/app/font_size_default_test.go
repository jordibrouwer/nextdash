package app

import "testing"

func fontSizeFile(extra map[string]any) map[string]any {
	return gridFile(extra)
}

// A fresh install opens on medium type.
func TestFontSizeDefaultIsMOnAFreshInstall(t *testing.T) {
	got := gridSettings(t, nil)
	if got.FontSize != "m" || !got.FontSizeLgMigrated {
		t.Errorf("fresh install: size %q migrated %v", got.FontSize, got.FontSizeLgMigrated)
	}
}

// An install still on the old default moves once; one that chose a size keeps it.
func TestFontSizeMovesOnceFromTheOldDefault(t *testing.T) {
	old := gridSettings(t, fontSizeFile(map[string]any{"fontSize": "m"}))
	if old.FontSize != "lg" || !old.FontSizeLgMigrated {
		t.Errorf("old default: size %q", old.FontSize)
	}
	chose := gridSettings(t, fontSizeFile(map[string]any{"fontSize": "xl"}))
	if chose.FontSize != "xl" {
		t.Errorf("a reader's own size moved to %q", chose.FontSize)
	}
}

// After the one pass, going back to m is the reader's choice and stays.
func TestFontSizeDoesNotMoveTwice(t *testing.T) {
	got := gridSettings(t, fontSizeFile(map[string]any{"fontSize": "m", "fontSizeLgMigrated": true}))
	if got.FontSize != "m" {
		t.Errorf("size %q after the pass has run", got.FontSize)
	}
}
