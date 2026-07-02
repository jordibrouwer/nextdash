package main

import (
	"encoding/json"
	"testing"
)

func TestMergeSettingsFromBodyPreservesStoredWhenIncomingEmpty(t *testing.T) {
	t.Parallel()

	stored := Settings{
		Theme:               "mulberry-silk-dark",
		ShowBackgroundDots:  true,
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
		ShowBackgroundDots:  true,
		AllowLocalBookmarks: false,
		LayoutVersion:       "classic",
	}

	merged, err := mergeSettingsFromBody(stored, []byte(`{"layoutVersion":"glass","allowLocalBookmarks":true}`))
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if merged.LayoutVersion != "glass" {
		t.Fatalf("layoutVersion = %q, want glass", merged.LayoutVersion)
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
	body, _ := json.Marshal(map[string]any{"showBackgroundDots": false})
	merged, err := mergeSettingsFromBody(stored, body)
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if merged.ShowBackgroundDots != false {
		t.Fatalf("showBackgroundDots = %v, want false", merged.ShowBackgroundDots)
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
			Confirmed: map[string]bool{"feature:inlineEdit": true},
		},
	}

	merged, err := mergeSettingsFromBody(stored, []byte(`{"discoverabilityState":{"confirmed":{"promo:gJump":true},"lastWhatsNewRelease":"v2026.07.01"}}`))
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if merged.DiscoverabilityState == nil {
		t.Fatal("discoverabilityState is nil")
	}
	if merged.DiscoverabilityState.Confirmed["promo:gJump"] != true {
		t.Fatalf("confirmed promo:gJump = %v, want true", merged.DiscoverabilityState.Confirmed["promo:gJump"])
	}
	if merged.DiscoverabilityState.LastWhatsNewRelease != "v2026.07.01" {
		t.Fatalf("lastWhatsNewRelease = %q, want v2026.07.01", merged.DiscoverabilityState.LastWhatsNewRelease)
	}
	if merged.Theme != "dark" {
		t.Fatalf("theme = %q, want dark", merged.Theme)
	}
}
