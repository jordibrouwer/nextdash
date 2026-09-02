package app

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/*
 * The walk in buildBackupZip takes the whole data directory and skips only what
 * it names, so a new directory falls in by default. Import, meanwhile, accepts
 * only icons/ and archives/ as subdirectories -- so leaving this in would make
 * ZIPs that carry up to the cache cap in images and are then refused on the way
 * back: fat backups that do not restore.
 *
 * It follows the doctrine already in backup.go. preview-cache.json and
 * health-cache.json are dropped on import because they are re-derived by
 * scanning; health-history.json and trash.json are kept because they are
 * measurements that cannot be recomputed. Cached media is purely fetched and
 * never authored by the reader, so it belongs with the first group. icons/ is
 * backed up precisely because an uploaded icon *is* irreplaceable, and
 * archives/ is where things worth keeping already go.
 */
func TestBackupZipExcludesCachedPreviewImages(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	imgDir := filepath.Join(dir, previewImageDirName)
	if err := os.MkdirAll(imgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(imgDir, "pi-abc123.png"), pngBytes(64), 0o644); err != nil {
		t.Fatal(err)
	}

	// An uploaded icon, to prove the exclusion is aimed and not a blanket one.
	iconDir := filepath.Join(dir, "icons")
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(iconDir, "icon-abc123.png"), pngBytes(64), 0o644); err != nil {
		t.Fatal(err)
	}

	h := &Handlers{store: NewStore()}
	data, err := h.buildBackupZip()
	if err != nil {
		t.Fatalf("buildBackupZip: %v", err)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}

	sawIcon := false
	for _, f := range reader.File {
		name := filepath.ToSlash(f.Name)
		if strings.HasPrefix(name, previewImageDirName+"/") {
			t.Errorf("the ZIP carries %s", name)
		}
		if name == "icons/icon-abc123.png" {
			sawIcon = true
		}
	}
	if !sawIcon {
		t.Error("the uploaded icon is missing, so the exclusion is too broad")
	}
}
