package main

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// newTestHandlers points the data dir at a temp directory and returns a Handlers
// backed by a freshly initialized store.
func newTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	return &Handlers{store: NewStore()}
}

func TestWriteAutoBackupRotatesToThree(t *testing.T) {
	h := newTestHandlers(t)

	// Create more than the limit; names are timestamped, so force distinct names
	// by writing directly with controlled filenames after building a real ZIP.
	data, err := h.buildBackupZip()
	if err != nil {
		t.Fatalf("buildBackupZip: %v", err)
	}
	if err := os.MkdirAll(autoBackupDir(), 0755); err != nil {
		t.Fatal(err)
	}
	stamps := []string{
		"2026-01-01T000000Z",
		"2026-01-08T000000Z",
		"2026-01-15T000000Z",
		"2026-01-22T000000Z",
	}
	for _, s := range stamps {
		name := autoBackupPrefix + s + ".zip"
		if err := os.WriteFile(filepath.Join(autoBackupDir(), name), data, 0644); err != nil {
			t.Fatal(err)
		}
	}

	if err := pruneAutoBackups(); err != nil {
		t.Fatalf("pruneAutoBackups: %v", err)
	}

	names, err := listAutoBackupFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != maxAutoBackups {
		t.Fatalf("kept %d backups, want %d", len(names), maxAutoBackups)
	}
	// Newest-first; oldest (Jan 01) must be gone, newest (Jan 22) present.
	if names[0] != autoBackupPrefix+"2026-01-22T000000Z.zip" {
		t.Fatalf("newest = %q, want Jan 22", names[0])
	}
	for _, n := range names {
		if n == autoBackupPrefix+"2026-01-01T000000Z.zip" {
			t.Fatalf("oldest backup was not pruned")
		}
	}
}

func TestWriteAutoBackupCreatesAndPrunes(t *testing.T) {
	h := newTestHandlers(t)

	// No sleeps: uniqueAutoBackupName disambiguates same-second writes.
	for i := 0; i < 4; i++ {
		if err := h.writeAutoBackup(); err != nil {
			t.Fatalf("writeAutoBackup #%d: %v", i, err)
		}
	}

	names, err := listAutoBackupFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != maxAutoBackups {
		t.Fatalf("kept %d backups, want %d", len(names), maxAutoBackups)
	}
}

func TestWriteAutoBackupSameSecondDoesNotOverwrite(t *testing.T) {
	h := newTestHandlers(t)

	// Three writes within (almost certainly) the same second must produce three
	// distinct files, not one overwritten file.
	for i := 0; i < 3; i++ {
		if err := h.writeAutoBackup(); err != nil {
			t.Fatalf("writeAutoBackup #%d: %v", i, err)
		}
	}
	names, err := listAutoBackupFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 3 {
		t.Fatalf("got %d distinct backups, want 3 (same-second overwrite?)", len(names))
	}
	seen := map[string]bool{}
	for _, n := range names {
		if !autoBackupNameRe.MatchString(n) {
			t.Fatalf("name %q does not match the auto-backup pattern", n)
		}
		if seen[n] {
			t.Fatalf("duplicate name %q", n)
		}
		seen[n] = true
	}
}

func TestAutoBackupExcludedFromRegularBackup(t *testing.T) {
	h := newTestHandlers(t)

	if err := h.writeAutoBackup(); err != nil {
		t.Fatalf("writeAutoBackup: %v", err)
	}

	data, err := h.buildBackupZip()
	if err != nil {
		t.Fatalf("buildBackupZip: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range zr.File {
		if len(f.Name) >= len(autoBackupDirName) && f.Name[:len(autoBackupDirName)] == autoBackupDirName {
			t.Fatalf("regular backup contains auto-backup entry: %q", f.Name)
		}
	}
}

func TestDownloadAutoBackupRejectsBadNames(t *testing.T) {
	h := newTestHandlers(t)

	bad := []string{
		"",
		"../settings.json",
		"foo/bar.zip",
		"nextdash-auto-backup-2026-01-01T000000Z.zip/../x",
		"settings.json",
		"nextdash-auto-backup-bad.zip",
	}
	for _, name := range bad {
		req := httptest.NewRequest(http.MethodGet, "/api/auto-backups/download?name="+name, nil)
		rec := httptest.NewRecorder()
		h.DownloadAutoBackup(rec, req)
		if rec.Code == http.StatusOK {
			t.Fatalf("name %q was accepted, want rejection", name)
		}
	}
}

func TestDownloadAutoBackupServesValidFile(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.writeAutoBackup(); err != nil {
		t.Fatalf("writeAutoBackup: %v", err)
	}
	names, err := listAutoBackupFiles()
	if err != nil || len(names) == 0 {
		t.Fatalf("no backup created: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auto-backups/download?name="+names[0], nil)
	rec := httptest.NewRecorder()
	h.DownloadAutoBackup(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("content-type = %q, want application/zip", ct)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("empty backup body")
	}
}

func TestDeleteAutoBackupRemovesFile(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.writeAutoBackup(); err != nil {
		t.Fatalf("writeAutoBackup: %v", err)
	}
	names, err := listAutoBackupFiles()
	if err != nil || len(names) == 0 {
		t.Fatalf("no backup created: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/auto-backups?name="+names[0], nil)
	rec := httptest.NewRecorder()
	h.DeleteAutoBackup(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	remaining, err := listAutoBackupFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 0 {
		t.Fatalf("remaining = %d, want 0", len(remaining))
	}
}

func TestDeleteAutoBackupRejectsBadNames(t *testing.T) {
	h := newTestHandlers(t)

	bad := []string{"", "../settings.json", "foo/bar.zip", "settings.json", "nextdash-auto-backup-bad.zip"}
	for _, name := range bad {
		req := httptest.NewRequest(http.MethodDelete, "/api/auto-backups?name="+name, nil)
		rec := httptest.NewRecorder()
		h.DeleteAutoBackup(rec, req)
		if rec.Code == http.StatusOK {
			t.Fatalf("name %q was accepted, want rejection", name)
		}
	}
}

func TestDeleteAutoBackupMissingReturns404(t *testing.T) {
	h := newTestHandlers(t)
	name := autoBackupPrefix + "2026-01-01T000000Z.zip"
	req := httptest.NewRequest(http.MethodDelete, "/api/auto-backups?name="+name, nil)
	rec := httptest.NewRecorder()
	h.DeleteAutoBackup(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRestoreAutoBackupRoundTrip(t *testing.T) {
	h := newTestHandlers(t)

	// Use two valid theme IDs (invalid ones are reset on read). Set the first,
	// back it up, then switch to the second on disk.
	const backedUpTheme = "kelp-drift-dark"
	const changedTheme = "cherry-graphite-dark"

	original := h.store.GetSettings()
	original.Theme = backedUpTheme
	if err := h.store.SaveSettings(original); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if err := h.writeAutoBackup(); err != nil {
		t.Fatalf("writeAutoBackup: %v", err)
	}
	names, err := listAutoBackupFiles()
	if err != nil || len(names) == 0 {
		t.Fatalf("no backup: %v", err)
	}

	// Mutate so on-disk state differs from the backup.
	changed := h.store.GetSettings()
	changed.Theme = changedTheme
	if err := h.store.SaveSettings(changed); err != nil {
		t.Fatalf("SaveSettings (mutate): %v", err)
	}
	if h.store.GetSettings().Theme != changedTheme {
		t.Fatal("expected mutation to take effect")
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auto-backups/restore?name="+names[0], nil)
	rec := httptest.NewRecorder()
	h.RestoreAutoBackup(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// The store reads from disk, so the restored theme should match the backup.
	if got := h.store.GetSettings().Theme; got != backedUpTheme {
		t.Fatalf("after restore theme = %q, want %q", got, backedUpTheme)
	}
}

func TestRestoreAutoBackupRejectsBadNames(t *testing.T) {
	h := newTestHandlers(t)
	bad := []string{"", "../settings.json", "foo/bar.zip", "nextdash-auto-backup-bad.zip"}
	for _, name := range bad {
		req := httptest.NewRequest(http.MethodPost, "/api/auto-backups/restore?name="+name, nil)
		rec := httptest.NewRecorder()
		h.RestoreAutoBackup(rec, req)
		if rec.Code == http.StatusOK {
			t.Fatalf("name %q was accepted, want rejection", name)
		}
	}
}

func TestAutoBackupDueWhenEmpty(t *testing.T) {
	newTestHandlers(t)
	if !autoBackupDue() {
		t.Fatal("expected a backup to be due when none exist")
	}
}

func TestAutoBackupNotDueAfterRecentBackup(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.writeAutoBackup(); err != nil {
		t.Fatalf("writeAutoBackup: %v", err)
	}
	if autoBackupDue() {
		t.Fatal("did not expect a backup to be due right after one was made")
	}
}
