package app

import (
	"os"
	"path/filepath"
	"testing"
)

// Switches that default on stay on for a settings file written before they
// existed: an absent key means the install never answered, not "off".
func TestDefaultOnSwitchesSurviveAnOlderFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	t.Chdir(t.TempDir())
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"theme":"x"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewStore().GetSettings()
	if !s.RememberScrollPosition {
		t.Error("rememberScrollPosition is off for an older file")
	}
	if !s.DetectSoftNotFound {
		t.Error("detectSoftNotFound is off for an older file")
	}

	// An explicit false is kept.
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"rememberScrollPosition":false,"detectSoftNotFound":false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	s = NewStore().GetSettings()
	if s.RememberScrollPosition || s.DetectSoftNotFound {
		t.Error("an explicit false was turned back on")
	}
}
