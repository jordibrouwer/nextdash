package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDeriveFaviconURL(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"https://github.com", "https://github.com/favicon.ico"},
		{"https://github.com/issues", "https://github.com/favicon.ico"},
		{"http://example.com/path", "http://example.com/favicon.ico"},
		{"", ""},
		{"ftp://example.com", ""},
		{"not-a-url", ""},
	}

	for _, tc := range tests {
		got := deriveFaviconURL(tc.input)
		if got != tc.want {
			t.Errorf("deriveFaviconURL(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestTakeDefaultBookmarkIconPrefetch(t *testing.T) {
	fs := &FileStore{}
	if fs.TakeDefaultBookmarkIconPrefetch() {
		t.Fatal("expected false on fresh store")
	}

	fs.markDefaultBookmarkIconPrefetch()
	if !fs.TakeDefaultBookmarkIconPrefetch() {
		t.Fatal("expected true when flag set")
	}
	if fs.TakeDefaultBookmarkIconPrefetch() {
		t.Fatal("expected flag to be consumed")
	}
}

func TestNewHandlersConsumesPrefetchFlag(t *testing.T) {
	// Its own store: this one describes a fresh install, so it must not
	// inherit whatever an earlier test in the run left behind.
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	fs, ok := store.(*FileStore)
	if !ok {
		t.Fatal("expected *FileStore")
	}
	if !store.TakeDefaultBookmarkIconPrefetch() {
		t.Fatal("expected prefetch flag on fresh default bookmarks")
	}
	fs.markDefaultBookmarkIconPrefetch()

	start := time.Now()
	NewHandlers(store, embeddedFiles)
	if elapsed := time.Since(start); elapsed > 200*time.Millisecond {
		t.Fatalf("NewHandlers blocked %v waiting for prefetch", elapsed)
	}
	if store.TakeDefaultBookmarkIconPrefetch() {
		t.Fatal("expected prefetch flag to be consumed by NewHandlers")
	}
}

func TestSaveIconBytesSanitizesSVG(t *testing.T) {
	t.Chdir(t.TempDir())

	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="1" onclick="evil()"/></svg>`)
	fileName, err := saveIconBytes(svg, ".svg")
	if err != nil {
		t.Fatal(err)
	}
	if fileName == "" {
		t.Fatal("expected saved svg file name")
	}

	stored, err := os.ReadFile(filepath.Join(ResolveDataDir(), "icons", fileName))
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(stored))
	if strings.Contains(lower, "<script") || strings.Contains(lower, "onclick") {
		t.Fatalf("stored svg still contains unsafe content: %s", stored)
	}
}
