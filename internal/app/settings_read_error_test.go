package app

import (
	"os"
	"path/filepath"
	"testing"
)

// A settings.json that is there but cannot be read is not a fresh install:
// the defaults in its place were saved back over the real file by the next
// settings write.
func TestAnUnreadableSettingsFileIsNotReplacedByDefaults(t *testing.T) {
	h := newTestHandlers(t)
	s := h.store.GetSettings()
	s.CustomTitle = "Kept"
	s.EnableCustomTitle = true
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if got := h.store.GetSettings(); got.CustomTitle != "Kept" {
		t.Fatalf("saved title not read back: %q", got.CustomTitle)
	}

	path := filepath.Join(ResolveDataDir(), "settings.json")
	if err := os.Chmod(path, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o644) })
	if _, err := os.ReadFile(path); err == nil {
		t.Skip("the file is still readable (running as root?)")
	}
	h.store.(*FileStore).InvalidateReadCache()

	// A settings write in this state: read, change one field, save.
	if err := h.updateSettings(func(s *Settings) { s.DockerHostSeen = "nas.lan" }); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	h.store.(*FileStore).InvalidateReadCache()
	got := h.store.GetSettings()
	if got.CustomTitle != "Kept" || !got.EnableCustomTitle {
		t.Fatalf("the settings were replaced by defaults: title %q, custom %v", got.CustomTitle, got.EnableCustomTitle)
	}
	if got.DockerHostSeen != "nas.lan" {
		t.Fatalf("the change made meanwhile was lost: %q", got.DockerHostSeen)
	}
}
