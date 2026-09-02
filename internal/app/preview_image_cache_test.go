package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// pngBytes is the shortest thing detectImageType calls a PNG: the magic number
// is all it reads, and a real image would only make the test slower to read.
func pngBytes(size int) []byte {
	data := make([]byte, size)
	copy(data, []byte{0x89, 0x50, 0x4E, 0x47})
	return data
}

// The stored name is a pure function of the source URL, which is what lets a
// missing file heal itself: the worker derives what to fetch from the path
// alone, so a restored backup needs no reconciliation pass.
func TestPreviewImageFileNameIsStableForASource(t *testing.T) {
	a := previewImageFileName("https://example.com/og.png", ".png")
	b := previewImageFileName("https://example.com/og.png", ".png")
	if a != b {
		t.Fatalf("same source gave %q and %q", a, b)
	}
	if a == previewImageFileName("https://example.com/other.png", ".png") {
		t.Error("different sources collided")
	}
	if !strings.HasSuffix(a, ".png") {
		t.Errorf("name = %q, want it to keep the extension", a)
	}
	if strings.ContainsAny(a, `/\`) {
		t.Errorf("name = %q, want a bare filename", a)
	}
}

func TestPreviewImageDirIsUnderTheDataDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if got, want := previewImageDir(), filepath.Join(dir, "preview-images"); got != want {
		t.Errorf("previewImageDir() = %q, want %q", got, want)
	}
}

// Refused before a connection is opened, so this makes no network call.
func TestDownloadPreviewImageRefusesPrivateHosts(t *testing.T) {
	name, err := downloadPreviewImage("http://192.168.0.4/og.png", false)
	if name != "" || err != nil {
		t.Fatalf("name = %q, err = %v; want a silent refusal", name, err)
	}
}

func TestDownloadPreviewImageStoresAnImage(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes(64))
	}))
	defer server.Close()

	// allowLocal, because httptest binds to a loopback address the SSRF gate
	// refuses by default -- which is the behaviour the previous test asserts.
	name, err := downloadPreviewImage(server.URL+"/og.png", true)
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if name == "" {
		t.Fatal("nothing stored")
	}
	if !strings.HasSuffix(name, ".png") {
		t.Errorf("name = %q, want a .png", name)
	}
	stored, err := os.ReadFile(filepath.Join(previewImageDir(), name))
	if err != nil {
		t.Fatalf("stored file: %v", err)
	}
	if len(stored) != 64 {
		t.Errorf("stored %d bytes, want 64", len(stored))
	}
}

// An og:image is never an SVG, and sanitizeSVGContent is a risk worth not
// carrying where nothing needs it. Icons keep their own path and sanitizer.
func TestDownloadPreviewImageRefusesSVG(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`))
	}))
	defer server.Close()

	name, err := downloadPreviewImage(server.URL+"/og.svg", true)
	if name != "" || err != nil {
		t.Fatalf("name = %q, err = %v; want SVG refused", name, err)
	}
	if files, _ := previewImageCacheUsage(); files != 0 {
		t.Errorf("%d files written for a refused SVG", files)
	}
}

func TestDownloadPreviewImageRefusesNonImages(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><body>not an image</body></html>"))
	}))
	defer server.Close()

	name, _ := downloadPreviewImage(server.URL+"/og.png", true)
	if name != "" {
		t.Errorf("name = %q, want a non-image refused", name)
	}
}

func TestEvictPreviewImagesRemovesOldestFirst(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	imgDir := previewImageDir()
	if err := os.MkdirAll(imgDir, 0755); err != nil {
		t.Fatal(err)
	}

	// 300 bytes each, stamped oldest to newest.
	names := []string{"pi-old.png", "pi-mid.png", "pi-new.png"}
	base := time.Now().Add(-3 * time.Hour)
	for i, n := range names {
		p := filepath.Join(imgDir, n)
		if err := os.WriteFile(p, make([]byte, 300), 0644); err != nil {
			t.Fatal(err)
		}
		stamp := base.Add(time.Duration(i) * time.Hour)
		if err := os.Chtimes(p, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}

	// A 700-byte cap fits two of the three.
	removed, err := evictPreviewImages(700)
	if err != nil {
		t.Fatalf("evict: %v", err)
	}
	if removed != 1 {
		t.Errorf("removed = %d, want 1", removed)
	}
	if _, err := os.Stat(filepath.Join(imgDir, "pi-old.png")); !os.IsNotExist(err) {
		t.Error("the oldest file survived")
	}
	for _, n := range []string{"pi-mid.png", "pi-new.png"} {
		if _, err := os.Stat(filepath.Join(imgDir, n)); err != nil {
			t.Errorf("%s was evicted but should have been kept", n)
		}
	}

	files, bytes := previewImageCacheUsage()
	if files != 2 || bytes != 600 {
		t.Errorf("usage = %d files / %d bytes, want 2 / 600", files, bytes)
	}
}

func TestEvictPreviewImagesLeavesAFittingCacheAlone(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.MkdirAll(previewImageDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewImageDir(), "pi-a.png"), make([]byte, 100), 0644); err != nil {
		t.Fatal(err)
	}
	removed, err := evictPreviewImages(700)
	if err != nil || removed != 0 {
		t.Errorf("removed = %d, err = %v; want 0, nil", removed, err)
	}
}

// A half-written image is not a cache entry yet, so it must not be counted
// towards the cap nor evicted out from under the worker that is writing it.
func TestPreviewImageUsageIgnoresTempFiles(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.MkdirAll(previewImageDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewImageDir(), ".tmp-halfway"), make([]byte, 999), 0644); err != nil {
		t.Fatal(err)
	}
	if files, bytes := previewImageCacheUsage(); files != 0 || bytes != 0 {
		t.Errorf("usage = %d/%d, want a temp file ignored", files, bytes)
	}
}

// The cap is enforced on the body as it is read, so a host that lies about
// Content-Length cannot make us hold an arbitrary amount of memory.
func TestDownloadPreviewImageRefusesOversizedBodies(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes(maxPreviewImageBytes + 1))
	}))
	defer server.Close()

	name, _ := downloadPreviewImage(server.URL+"/og.png", true)
	if name != "" {
		t.Errorf("name = %q, want an oversized body refused", name)
	}
}

// A card favicon often *is* an SVG -- claude.ai serves one -- so refusing them
// outright, as an og:image is refused, left those cards with no icon at all.
// They go through the same sanitiser stored bookmark icons already use.
func TestDownloadPreviewIconAcceptsSanitisedSVG(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><rect/><script>alert(1)</script></svg>`))
	}))
	defer server.Close()

	name, err := downloadPreviewIcon(server.URL+"/favicon.svg", true)
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if name == "" {
		t.Fatal("the icon was refused; a favicon may be an SVG")
	}
	stored, err := os.ReadFile(filepath.Join(previewImageDir(), name))
	if err != nil {
		t.Fatalf("stored file: %v", err)
	}
	if strings.Contains(strings.ToLower(string(stored)), "<script") {
		t.Error("the stored SVG still carries a script element")
	}

	// The og:image path must still refuse the same body.
	if img, _ := downloadPreviewImage(server.URL+"/og.svg", true); img != "" {
		t.Errorf("og:image path stored %q, want SVG still refused there", img)
	}
}

// Served the same way stored icons are, so it carries their permissions rather
// than the 0600 CreateTemp hands out.
func TestStoredPreviewImageIsReadable(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	name, err := storePreviewImage("https://example.com/og.png", ".png", pngBytes(16))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	info, err := os.Stat(filepath.Join(previewImageDir(), name))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Errorf("mode = %v, want 0644", info.Mode().Perm())
	}
}
