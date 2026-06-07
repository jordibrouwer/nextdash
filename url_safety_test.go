package main

import (
	"strings"
	"testing"
)

func TestValidatePublicHTTPURL(t *testing.T) {
	t.Parallel()

	allowed := []string{
		"https://example.com/path",
		"http://github.com",
	}
	for _, u := range allowed {
		if err := validatePublicHTTPURL(u); err != nil {
			t.Fatalf("%q should be allowed: %v", u, err)
		}
	}

	blocked := []string{
		"",
		"javascript:alert(1)",
		"file:///etc/passwd",
		"http://127.0.0.1:8080",
		"http://localhost/",
		"http://10.0.0.1/internal",
	}
	for _, u := range blocked {
		if err := validatePublicHTTPURL(u); err == nil {
			t.Fatalf("%q should be blocked", u)
		}
	}
}

func TestSanitizeBookmarkIcon(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"":              "",
		"  ":            "",
		"my-icon.png":   "my-icon.png",
		"Icon_123.ico":  "Icon_123.ico",
		"../etc/passwd": "",
		"foo/bar.png":   "",
		`"><evil>`:      "",
	}
	long := strings.Repeat("a", 201) + ".png"
	cases[long] = ""

	for input, want := range cases {
		if got := sanitizeBookmarkIcon(input); got != want {
			t.Fatalf("sanitizeBookmarkIcon(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestValidateBookmarkURLAllowsLocalWhenEnabled(t *testing.T) {
	t.Parallel()

	if err := validateBookmarkURL("http://127.0.0.1:8080", false); err == nil {
		t.Fatal("localhost bookmark should be rejected by default")
	}
	if err := validateBookmarkURL("http://127.0.0.1:8080", true); err != nil {
		t.Fatalf("localhost bookmark should be allowed when enabled: %v", err)
	}
	if err := validateBookmarkURL("https://example.com", false); err != nil {
		t.Fatalf("public bookmark should be allowed: %v", err)
	}
}
