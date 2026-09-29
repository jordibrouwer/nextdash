package app

import (
	"os"
	"path/filepath"
	"testing"
)

// Three backups means three: each rotation shifts .1 to .2 and .2 to .3, and
// the oldest falls off the end rather than being overwritten one step early.
func TestActivityLogRotateKeepsEveryBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "activity.log")
	f := &activityRotatingFile{path: path, backups: 3}
	for _, gen := range []string{"a", "b", "c", "d"} {
		if err := os.WriteFile(path, []byte(gen), 0o600); err != nil {
			t.Fatal(err)
		}
		f.mu.Lock()
		err := f.rotate()
		f.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
	}
	for i, want := range map[string]string{".1": "d", ".2": "c", ".3": "b"} {
		got, err := os.ReadFile(path + i)
		if err != nil || string(got) != want {
			t.Errorf("backup %s = %q (%v), want %q", i, got, err, want)
		}
	}
	if _, err := os.Stat(path + ".4"); err == nil {
		t.Error("a fourth backup exists")
	}
}
