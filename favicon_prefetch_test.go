package main

import (
	"testing"
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

	fs.prefetchDefaultBookmarkIcons = true
	if !fs.TakeDefaultBookmarkIconPrefetch() {
		t.Fatal("expected true when flag set")
	}
	if fs.TakeDefaultBookmarkIconPrefetch() {
		t.Fatal("expected flag to be consumed")
	}
}
