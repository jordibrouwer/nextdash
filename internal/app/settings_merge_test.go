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

// Fresh's page scope is written by the config view like every other smart
// collection's. The field used to be missing from Settings, so the save quietly
// dropped it and the scope reset to "all pages" on the next load.
func TestSmartFreshPageIdsSurvivesSaveAndReload(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	merged, err := mergeSettingsFromBody(NewStore().GetSettings(), []byte(`{"smartFreshPageIds":[2,3]}`))
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if err := NewStore().SaveSettings(merged); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	got := NewStore().GetSettings().SmartFreshPageIds
	if len(got) != 2 || got[0] != 2 || got[1] != 3 {
		t.Fatalf("smartFreshPageIds after reload = %v, want [2 3]", got)
	}
}

// A settings file from before the field existed loads as an empty list, not
// null, so the client reads it as "every page".
func TestSmartFreshPageIdsDefaultsToEmptyList(t *testing.T) {
	settings := writeSettings(t, `{"currentPage":1}`)
	if settings.SmartFreshPageIds == nil || len(settings.SmartFreshPageIds) != 0 {
		t.Fatalf("smartFreshPageIds = %#v, want []int{}", settings.SmartFreshPageIds)
	}
}
