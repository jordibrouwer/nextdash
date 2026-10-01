package app

import (
	"os"
	"path/filepath"
	"testing"
)

// A restore puts a secret file back at 0600 even where one already stood at
// 0644: a plain overwrite keeps the old mode.
func TestImportCommitRestoresModeOnExistingFiles(t *testing.T) {
	dataDir := t.TempDir()
	dest := filepath.Join(dataDir, "webhooks.json")
	if err := os.WriteFile(dest, []byte(`[]`), 0o644); err != nil {
		t.Fatal(err)
	}
	prepared := []preparedImportFile{
		{relPath: "bookmarks-1.json", content: []byte(`[]`)},
		{relPath: "webhooks.json", content: []byte(`[{"url":"x"}]`)},
	}
	if err := commitPreparedImport(dataDir, prepared); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(dest)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("webhooks.json mode = %v, want 0600", info.Mode().Perm())
	}
}

// The store is locked while the files are replaced, so a click that writes a
// page cannot read it before the restore and write it back after.
func TestReplaceDataFilesHoldsTheStoreLock(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	fs := NewStore().(*FileStore)
	locked := false
	if err := fs.ReplaceDataFiles(func() error {
		locked = !fs.mutex.TryLock()
		if !locked {
			fs.mutex.Unlock()
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !locked {
		t.Fatal("the store was not locked while the files were replaced")
	}
}

// One file that cannot be written must leave every file as it was: renamed into
// place one by one, a full disk half-way left half the archive in place.
func TestImportCommitChangesNothingWhenOneFileCannotBeWritten(t *testing.T) {
	dataDir := t.TempDir()
	settings := filepath.Join(dataDir, "settings.json")
	if err := os.WriteFile(settings, []byte(`{"old":true}`), 0o644); err != nil {
		t.Fatal(err)
	}
	icons := filepath.Join(dataDir, "icons")
	if err := os.MkdirAll(icons, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(icons, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(icons, 0o755) })
	prepared := []preparedImportFile{
		{relPath: "settings.json", content: []byte(`{"new":true}`)},
		{relPath: "icons/a.png", content: []byte("png")},
	}
	if err := commitPreparedImport(dataDir, prepared); err == nil {
		t.Skip("the icons folder took the write anyway (running as root?)")
	}
	if got, _ := os.ReadFile(settings); string(got) != `{"old":true}` {
		t.Fatalf("settings.json = %s: replaced although the import failed", got)
	}
}
