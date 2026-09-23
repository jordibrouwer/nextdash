package app

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

/*
An upload does not overwrite whatever happens to share its name.

This test used to assert the opposite -- that posting site.png replaced an
existing site.png -- which was the behaviour, not a decision: nothing anywhere
argued for it, and two consequences followed. Two bookmarks given different
pictures both called icon.png meant the second silently replaced the first. And
/data/icons/ is served with a year-long immutable cache entry on the stated
premise that these names are never rewritten, so a replacement was invisible to
any browser that had already seen the old one, reload or no reload.

Uploads are now named the way the favicon prefetcher names what it fetches, and
the old file stays until the orphan sweep takes it.
*/
func TestUploadIconLeavesAnUnrelatedFileAlone(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	iconsDir := filepath.Join(ResolveDataDir(), "icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		t.Fatal(err)
	}
	existing := filepath.Join(iconsDir, "site.png")
	if err := os.WriteFile(existing, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("icon", "site.png")
	if err != nil {
		t.Fatal(err)
	}
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d}
	if _, err := part.Write(png); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	h := NewHandlers(NewStore(), embeddedFiles)
	req := httptest.NewRequest(http.MethodPost, "/api/icon", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	h.UploadIcon(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	untouched, err := os.ReadFile(existing)
	if err != nil {
		t.Fatal(err)
	}
	if string(untouched) != "old" {
		t.Errorf("site.png was overwritten: got %q", untouched)
	}

	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["icon"] == "site.png" || resp["icon"] == "" {
		t.Fatalf("icon = %q, want a generated name", resp["icon"])
	}
	stored, err := os.ReadFile(filepath.Join(iconsDir, resp["icon"]))
	if err != nil {
		t.Fatalf("read %s: %v", resp["icon"], err)
	}
	if !bytes.Equal(stored, png) {
		t.Errorf("%s does not hold what was uploaded", resp["icon"])
	}
}

func TestDetectFontType(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"woff", []byte("wOFF"), "font/woff"},
		{"woff2", []byte("wOF2"), "font/woff2"},
		{"otf", []byte("OTTO"), "font/otf"},
		{"ttf true", []byte("true"), "font/ttf"},
		{"ttf sfnt", []byte{0x00, 0x01, 0x00, 0x00}, "font/ttf"},
		{"png", []byte{0x89, 0x50, 0x4e, 0x47}, ""},
		{"empty", nil, ""},
	}
	for _, tc := range cases {
		if got := detectFontType(tc.data); got != tc.want {
			t.Fatalf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestUploadFontUsesMagicBytesNotClientType(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("font", "evil.woff2")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("wOFFfake-font-bytes")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	h := NewHandlers(NewStore(), embeddedFiles)
	req := httptest.NewRequest(http.MethodPost, "/api/font", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	h.UploadFont(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(ResolveDataDir(), "font.woff")); err != nil {
		t.Fatalf("expected font.woff from magic bytes, not .woff2 filename: %v", err)
	}

	body = &bytes.Buffer{}
	writer = multipart.NewWriter(body)
	part, err = writer.CreateFormFile("font", "fake.woff2")
	if err != nil {
		t.Fatal(err)
	}
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	if _, err := part.Write(png); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/font", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec = httptest.NewRecorder()
	h.UploadFont(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("png spoof status = %d, want 400", rec.Code)
	}
}
