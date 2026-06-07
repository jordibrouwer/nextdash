package main

import (
	"encoding/json"
	"testing"
)

func TestValidateBookmarkURL(t *testing.T) {
	t.Parallel()

	if err := validateBookmarkURL("", false); err != nil {
		t.Fatalf("empty URL should be allowed: %v", err)
	}
	if err := validateBookmarkURL("https://example.com/path", false); err != nil {
		t.Fatalf("https URL should be allowed: %v", err)
	}
	if err := validateBookmarkURL("http://127.0.0.1:8080", true); err != nil {
		t.Fatalf("localhost should be allowed when allowLocal is true: %v", err)
	}

	bad := []string{
		"javascript:alert(1)",
		"file:///etc/passwd",
		"http://localhost:8080",
		"http://127.0.0.1:8080",
		"not a url",
	}
	for _, u := range bad {
		if err := validateBookmarkURL(u, false); err == nil {
			t.Fatalf("expected error for %q", u)
		}
	}
}

func TestSanitizeImportedBookmarkFile(t *testing.T) {
	t.Parallel()

	raw, _ := json.Marshal(PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Bookmarks: []Bookmark{
			{Name: "OK", URL: "https://example.com"},
			{Name: "Local", URL: "http://127.0.0.1:8080"},
			{Name: "Empty", URL: ""},
		},
	})

	out, skipped, err := sanitizeImportedBookmarkFile(raw, false)
	if err != nil || skipped != 1 {
		t.Fatalf("skipped = %d, err = %v", skipped, err)
	}

	var page PageWithBookmarks
	if err := json.Unmarshal(out, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Bookmarks) != 2 {
		t.Fatalf("len = %d, want 2", len(page.Bookmarks))
	}

	outLocal, skippedLocal, err := sanitizeImportedBookmarkFile(raw, true)
	if err != nil || skippedLocal != 0 {
		t.Fatalf("allowLocal skipped = %d, err = %v", skippedLocal, err)
	}
	if err := json.Unmarshal(outLocal, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Bookmarks) != 3 {
		t.Fatalf("allowLocal len = %d, want 3", len(page.Bookmarks))
	}
}
