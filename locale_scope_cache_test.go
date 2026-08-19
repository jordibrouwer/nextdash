package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A locale edited under a running server has to reach the next request.
//
// The narrowing costs a parse and a marshal per language and scope, so it is
// cached — and it used to be cached for the life of the process, which meant a
// translation change was invisible until someone restarted the server. The
// entry now carries the file's modification time and size, and a file that has
// moved on is narrowed again.
func TestLocaleScopeCacheFollowsTheFile(t *testing.T) {
	dir := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })

	if err := os.Mkdir("locales", 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("locales", "xx.json")
	write := func(body string) {
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(`{"config":{"helpStartBody":"first","other":"kept"}}`)

	read := func() map[string]string {
		data, err := localeScopedBytes(nil, "xx.json", "help")
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Config map[string]string `json:"config"`
		}
		if err := json.Unmarshal(data, &doc); err != nil {
			t.Fatal(err)
		}
		return doc.Config
	}

	if got := read()["helpStartBody"]; got != "first" {
		t.Fatalf("first read = %q, want %q", got, "first")
	}

	// Same size, later timestamp: the size alone would not notice this.
	write(`{"config":{"helpStartBody":"secnd","other":"kept"}}`)
	_ = os.Chtimes(path, time.Now().Add(time.Second), time.Now().Add(time.Second))

	if got := read()["helpStartBody"]; got != "secnd" {
		t.Fatalf("after the edit = %q, want %q — the cache did not follow the file", got, "secnd")
	}
}

// Served off disk the file is revalidated rather than held for a day, and the
// second request pays for nothing.
func TestLocaleFileRevalidatesFromDisk(t *testing.T) {
	dir := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })

	if err := os.Mkdir("locales", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join("locales", "yy.json"), []byte(`{"config":{"helpStartBody":"x"}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	h := &Handlers{}
	req := httptest.NewRequest(http.MethodGet, "/locales/yy.json?scope=help", nil)
	rec := httptest.NewRecorder()
	h.LocaleFile(rec, req)

	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("Cache-Control = %q, want no-cache for a file read off disk", got)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag, so a revalidating client has nothing to send back")
	}

	again := httptest.NewRequest(http.MethodGet, "/locales/yy.json?scope=help", nil)
	again.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	h.LocaleFile(rec2, again)
	if rec2.Code != http.StatusNotModified {
		t.Fatalf("second request = %d, want 304", rec2.Code)
	}
}
