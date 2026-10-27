package app

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
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
	// Only "three" has no tag at all.
	if counts.Untagged != 1 {
		t.Errorf("untagged = %d, want 1", counts.Untagged)
	}

	encoded := h.analyticsContentJSON(true)
	if !strings.Contains(encoded, `"bookmarks":3`) {
		t.Errorf("payload does not carry the count: %s", encoded)
	}
}

// A new install starts with far more than ten example links, so its size cannot
// say it is new; the day-old settings file does. Without this the time to a
// first bookmark was never measured for an ordinary install.
func TestAnalyticsContentFreshFollowsFirstRun(t *testing.T) {
	for _, tc := range []struct {
		name  string
		first time.Time
		want  bool
	}{
		{"written an hour ago", time.Now().Add(-time.Hour), true},
		{"written last week", time.Now().Add(-7 * 24 * time.Hour), false},
		{"never stamped", time.Time{}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			store := &FileStore{settingsFile: filepath.Join(dir, "settings.json"), dataDir: dir}
			settings := store.GetSettings()
			settings.FirstRunAt = 0
			if !tc.first.IsZero() {
				settings.FirstRunAt = tc.first.UnixMilli()
			}
			if err := store.SaveSettings(settings); err != nil {
				t.Fatalf("save settings: %v", err)
			}
			h := &Handlers{store: store}
			if got := h.countAnalyticsContent().Fresh; got != tc.want {
				t.Errorf("fresh = %v, want %v", got, tc.want)
			}
		})
	}
}
