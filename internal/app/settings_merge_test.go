package app

import (
	"encoding/json"
	"testing"
)

func TestMergeSettingsFromBodyPreservesStoredWhenIncomingEmpty(t *testing.T) {
	t.Parallel()

	stored := Settings{
		Theme:               "mulberry-silk-dark",
		AllowLocalBookmarks: true,
		ColumnsPerRow:       4,
		Language:            "nl",
	}

	merged, err := mergeSettingsFromBody(stored, []byte(`{}`))
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if merged.Theme != stored.Theme {
		t.Fatalf("theme = %q, want %q", merged.Theme, stored.Theme)
	}
	if merged.AllowLocalBookmarks != true {
		t.Fatalf("allowLocalBookmarks = %v, want true", merged.AllowLocalBookmarks)
	}
	if merged.ColumnsPerRow != 4 {
		t.Fatalf("columnsPerRow = %d, want 4", merged.ColumnsPerRow)
	}
}

func TestMergeSettingsFromBodyUpdatesPresentFields(t *testing.T) {
	t.Parallel()

	stored := Settings{
		Theme:               "classic-dark",
		AllowLocalBookmarks: false,
		RowHighlight:        "subtle",
	}

	// Was layoutVersion, which no longer exists: one layout, and the row
	// treatment that told the two apart is a setting of its own now.
	merged, err := mergeSettingsFromBody(stored, []byte(`{"rowHighlight":"strong","allowLocalBookmarks":true}`))
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if merged.RowHighlight != "strong" {
		t.Fatalf("rowHighlight = %q, want strong", merged.RowHighlight)
	}
	if merged.AllowLocalBookmarks != true {
		t.Fatalf("allowLocalBookmarks = %v, want true", merged.AllowLocalBookmarks)
	}
	if merged.Theme != "classic-dark" {
		t.Fatalf("theme = %q, want classic-dark", merged.Theme)
	}
}

func TestMergeSettingsFromBodyRoundTripJSON(t *testing.T) {
	t.Parallel()

	stored := Settings{Theme: "cherry-graphite-dark", Language: "en"}
	body, _ := json.Marshal(map[string]any{"showTitle": false})
	merged, err := mergeSettingsFromBody(stored, body)
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if merged.ShowTitle != false {
		t.Fatalf("showTitle = %v, want false", merged.ShowTitle)
	}
	if merged.Theme != stored.Theme {
		t.Fatalf("theme = %q, want %q", merged.Theme, stored.Theme)
	}
}

func TestMergeSettingsFromBodyDiscoverabilityState(t *testing.T) {
	t.Parallel()

	stored := Settings{
		Theme: "dark",
		DiscoverabilityState: &DiscoverabilityState{
			LastWhatsNewRelease: "v2026.06.01",
		},
	}

	merged, err := mergeSettingsFromBody(stored, []byte(`{"discoverabilityState":{"lastWhatsNewRelease":"v2026.07.01","tipsNotBefore":1750000000}}`))
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if merged.DiscoverabilityState == nil {
		t.Fatal("discoverabilityState is nil")
	}
	if merged.DiscoverabilityState.LastWhatsNewRelease != "v2026.07.01" {
		t.Fatalf("lastWhatsNewRelease = %q, want v2026.07.01", merged.DiscoverabilityState.LastWhatsNewRelease)
	}
	if merged.DiscoverabilityState.TipsNotBefore != 1750000000 {
		t.Fatalf("tipsNotBefore = %d, want 1750000000", merged.DiscoverabilityState.TipsNotBefore)
	}
	if merged.Theme != "dark" {
		t.Fatalf("theme = %q, want dark", merged.Theme)
	}
}
