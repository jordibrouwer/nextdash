package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Counting reads every page file, which the ordinary dashboard render does not
// do — it needs the one page you opened. Someone who opted out of analytics
// must not pay for that scan on every load, so "off" has to mean not counted
// rather than counted-and-discarded.
//
// Proven with a Handlers that has no store at all: any attempt to count would
// dereference it and panic, so returning empty is the only way this passes.
func TestAnalyticsContentNotCountedWhenDisabled(t *testing.T) {
	invalidateAnalyticsContentCache()
	h := &Handlers{}

	if got := h.analyticsContentJSON(false); got != "" {
		t.Fatalf("expected no counts while analytics is off, got %q", got)
	}
}

func TestAnalyticsContentCountsWhatIsThere(t *testing.T) {
	invalidateAnalyticsContentCache()
	t.Cleanup(invalidateAnalyticsContentCache)

	dir := t.TempDir()
	store := &FileStore{settingsFile: filepath.Join(dir, "settings.json"), dataDir: dir}
	h := &Handlers{store: store}

	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "one", URL: "https://example.com/1", Category: "work", Tags: []string{"a", "B"}, Monitor: true},
		{Name: "two", URL: "https://example.com/2", Category: "work", Tags: []string{"b"}, CheckStatus: true},
		{Name: "three", URL: "https://example.com/3", Category: "home"},
	}); err != nil {
		t.Fatalf("save bookmarks: %v", err)
	}
	if err := store.SaveCategoriesByPage(1, []Category{{ID: "work", Name: "Work"}, {ID: "home", Name: "Home"}}); err != nil {
		t.Fatalf("save categories: %v", err)
	}

	counts := h.countAnalyticsContent()

	if counts.Bookmarks != 3 {
		t.Errorf("bookmarks = %d, want 3", counts.Bookmarks)
	}
	if counts.Categories != 2 {
		t.Errorf("categories = %d, want 2", counts.Categories)
	}
	// "a" and "B" and "b" are two distinct tags, not three: the count is what
	// Config → Overview shows, which folds case.
	if counts.Tags != 2 {
		t.Errorf("tags = %d, want 2", counts.Tags)
	}
	// Monitored and merely-checked are separate tiers, and a monitored bookmark
	// is not also counted as periodic.
	if counts.Monitored != 1 || counts.Periodic != 1 {
		t.Errorf("monitored/periodic = %d/%d, want 1/1", counts.Monitored, counts.Periodic)
	}

	encoded := h.analyticsContentJSON(true)
	if !strings.Contains(encoded, `"bookmarks":3`) {
		t.Errorf("payload does not carry the count: %s", encoded)
	}
}
