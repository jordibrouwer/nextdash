package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Clearing gives the disk back without giving up the pictures: the source
// address stays, so every one of them returns on its next hover.
func TestClearPreviewImagesEmptiesTheDiskAndKeepsTheSources(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.MkdirAll(previewImageDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewImageDir(), "pi-abc.png"), pngBytes(16), 0o644); err != nil {
		t.Fatal(err)
	}

	h := &Handlers{store: NewStore()}
	key := "https://example.com"
	if err := h.mergePreviewCacheUpdates(map[string]BookmarkPreview{key: {
		URL:            key,
		FetchedAt:      time.Now().UnixMilli(),
		Image:          "/data/preview-images/pi-abc.png",
		ImageSource:    "https://example.com/og.png",
		ImageFetchedAt: time.Now().UnixMilli(),
	}}); err != nil {
		t.Fatalf("seed cache: %v", err)
	}

	rec := httptest.NewRecorder()
	h.ClearPreviewImages(rec, httptest.NewRequest(http.MethodPost, "/api/previews/images/clear", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	if files, _ := previewImageCacheUsage(); files != 0 {
		t.Errorf("%d files left on disk", files)
	}
	entry, ok := h.getPreviewCacheEntry(key)
	if !ok {
		t.Fatal("the cache entry was dropped, and only the picture should have been")
	}
	if entry.Image != "" {
		t.Errorf("Image = %q, want it cleared", entry.Image)
	}
	if entry.ImageSource != "https://example.com/og.png" {
		t.Errorf("ImageSource = %q, want it kept so the picture can come back", entry.ImageSource)
	}
	if !previewMediaFetchDue(entry) {
		t.Error("a cleared entry is not due for a fetch, so the picture would never return")
	}
}

func TestPreviewImageStatsReportUsageAndCap(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.MkdirAll(previewImageDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewImageDir(), "pi-abc.png"), make([]byte, 512), 0o644); err != nil {
		t.Fatal(err)
	}

	h := &Handlers{store: NewStore()}
	rec := httptest.NewRecorder()
	h.PreviewImageStats(rec, httptest.NewRequest(http.MethodGet, "/api/previews/images", nil))

	var body struct {
		Files    int   `json:"files"`
		Bytes    int64 `json:"bytes"`
		CapBytes int64 `json:"capBytes"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Files != 1 || body.Bytes != 512 {
		t.Errorf("files/bytes = %d/%d, want 1/512", body.Files, body.Bytes)
	}
	if body.CapBytes != int64(200)<<20 {
		t.Errorf("capBytes = %d, want the 200 MB default", body.CapBytes)
	}
}
