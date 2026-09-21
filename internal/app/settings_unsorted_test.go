package app

import "testing"

func TestUnsortedEnabledDefaultsTrue(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	settings := store.GetSettings()
	if !settings.UnsortedEnabled {
		t.Error("UnsortedEnabled = false on a fresh install, want true")
	}
}

func TestUnsortedEnabledCanBeTurnedOff(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	store := NewStore()

	settings := store.GetSettings()
	settings.UnsortedEnabled = false
	if err := store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	reloaded := store.GetSettings()
	if reloaded.UnsortedEnabled {
		t.Error("UnsortedEnabled reverted to true after an explicit off")
	}
}
