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

func TestUploadIconOverwritesExistingFile(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	iconsDir := filepath.Join(ResolveDataDir(), "icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		t.Fatal(err)
	}
	iconPath := filepath.Join(iconsDir, "site.png")
	if err := os.WriteFile(iconPath, []byte("old"), 0644); err != nil {
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

	got, err := os.ReadFile(iconPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, png) {
		t.Fatalf("file not overwritten: got %q, want PNG header bytes", got)
	}

	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["icon"] != "site.png" {
		t.Fatalf("icon = %q, want site.png", resp["icon"])
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
