package app

import (
	"archive/zip"
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
A multipart body has a ceiling like every other body.

securityHeaders wrapped every request in a MaxBytesReader except the multipart
ones, on the reasoning that those set their own limit through
ParseMultipartForm. They do not: that argument is maxMemory, the point at which
Go stops buffering in RAM and starts spilling to temp files, and the spilling
half has no limit at all. So one POST could fill memory and then the disk.
*/
func TestMultipartBodyIsBounded(t *testing.T) {
	original := multipartBodyLimit
	multipartBodyLimit = 4 << 10
	t.Cleanup(func() { multipartBodyLimit = original })

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(bytes.Repeat([]byte("x"), 64<<10)); err != nil {
		t.Fatal(err)
	}
	writer.Close()

	var readErr error
	handler := securityHeaders(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, readErr = io.Copy(io.Discard, r.Body)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/import", bytes.NewReader(body.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	handler.ServeHTTP(httptest.NewRecorder(), req)

	if readErr == nil {
		t.Fatal("the whole body was read: a multipart request is still unbounded")
	}
	if !strings.Contains(readErr.Error(), "too large") {
		t.Errorf("stopped for the wrong reason: %v", readErr)
	}
}

// A JSON body keeps the limit it always had: the multipart ceiling is a second
// limit beside it, not a replacement for it.
func TestJSONBodyKeepsItsOwnLimit(t *testing.T) {
	var readErr error
	handler := securityHeaders(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, readErr = io.Copy(io.Discard, r.Body)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/settings",
		bytes.NewReader(bytes.Repeat([]byte("x"), jsonBodyLimit+1024)))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(httptest.NewRecorder(), req)

	if readErr == nil {
		t.Fatal("a JSON body over the limit was read in full")
	}
}

/*
One entry inside a backup cannot be read without a ceiling either.

stagedFilesFromZip did io.ReadAll on each accepted entry. countBackupContents,
twelve lines further down the same file, caps the same read at 32 MB -- so an
entry named settings.json that unpacks to gigabytes was read into memory whole,
by the one path that accepts uploads from outside.
*/
func TestStagedFilesFromZipBoundsEachEntry(t *testing.T) {
	h := newTestHandlers(t)

	original := importEntryLimit
	importEntryLimit = 16 << 10
	t.Cleanup(func() { importEntryLimit = original })

	var raw bytes.Buffer
	zw := zip.NewWriter(&raw)
	entry, err := zw.Create("settings.json")
	if err != nil {
		t.Fatal(err)
	}
	/*
	 * Highly compressible, the way a zip bomb is: small on the wire, large once
	 * it is read -- and valid JSON, so the only thing that can refuse it is its
	 * size.
	 *
	 * A megabyte of "A" is refused too, but by the json.Valid check further
	 * down, which would make this test pass with no ceiling at all.
	 */
	payload := append([]byte(`{"theme":"`), bytes.Repeat([]byte("A"), 1<<20)...)
	payload = append(payload, []byte(`"}`)...)
	if _, err := entry.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := h.stagedFilesFromZip(raw.Bytes()); err == nil {
		t.Fatal("an entry far over the limit was accepted")
	}
}

// And an ordinary backup still restores: the ceiling is above anything a real
// file in one of these archives reaches.
func TestStagedFilesFromZipStillAcceptsAnOrdinaryBackup(t *testing.T) {
	h := newTestHandlers(t)

	var raw bytes.Buffer
	zw := zip.NewWriter(&raw)
	entry, err := zw.Create("settings.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte(`{"theme":"dark"}`)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	staged, err := h.stagedFilesFromZip(raw.Bytes())
	if err != nil {
		t.Fatalf("an ordinary backup was refused: %v", err)
	}
	if len(staged) != 1 || staged[0].filename != "settings.json" {
		t.Errorf("staged = %+v, want one settings.json", staged)
	}
}
