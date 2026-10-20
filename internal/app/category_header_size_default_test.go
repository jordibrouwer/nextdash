package app

import "testing"

// A fresh install draws category headers small.
func TestCategoryHeaderSizeIsSmallOnAFreshInstall(t *testing.T) {
	got := gridSettings(t, nil)
	if got.CategoryHeaderSize != "s" || !got.CategoryHeaderSmallMigrated {
		t.Errorf("fresh install: size %q migrated %v", got.CategoryHeaderSize, got.CategoryHeaderSmallMigrated)
	}
}

// An install still on the old default moves once; one that chose large keeps it.
func TestCategoryHeaderSizeMovesOnceFromTheOldDefault(t *testing.T) {
	for _, stored := range []map[string]any{{"categoryHeaderSize": "m"}, {}} {
		old := gridSettings(t, gridFile(stored))
		if old.CategoryHeaderSize != "s" || !old.CategoryHeaderSmallMigrated {
			t.Errorf("old default %v: size %q", stored, old.CategoryHeaderSize)
		}
	}
	chose := gridSettings(t, gridFile(map[string]any{"categoryHeaderSize": "l"}))
	if chose.CategoryHeaderSize != "l" {
		t.Errorf("a reader's own size moved to %q", chose.CategoryHeaderSize)
	}
}

// After the one pass, going back to medium is the reader's choice and stays.
func TestCategoryHeaderSizeDoesNotMoveTwice(t *testing.T) {
	got := gridSettings(t, gridFile(map[string]any{"categoryHeaderSize": "m", "categoryHeaderSmallMigrated": true}))
	if got.CategoryHeaderSize != "m" {
		t.Errorf("size %q after the pass has run", got.CategoryHeaderSize)
	}
}
