package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// The Bookmarks view's settings read as the view was before it had any: an
// install that never saw them, and one whose file predates them, both get the
// defaults; a value the view does not know goes back to the default.
func TestBookmarkViewSettingsDefaults(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	fresh := NewStore().GetSettings()
	check := func(label string, s Settings) {
		t.Helper()
		if s.BmViewGroup != "last" || s.BmViewDensity != "comfortable" || s.BmViewAddress != "full" ||
			s.BmViewRail != "open" || s.BmViewPanelTab != "last" || s.BmViewPanelWidth != "normal" ||
			s.BmViewClick != "panel" || s.BmViewDblClick != "open" || s.BmViewHealthRange != "30" ||
			s.BmViewBadgeCounts != "broken" || s.BmViewUsageDays != 30 || s.BmViewKeyLegend != "below" {
			t.Fatalf("%s: %+v", label, s)
		}
		if !s.BmViewRowColors || !s.BmViewCloseOutside || !s.BmViewBadge {
			t.Fatalf("%s: a switch that defaults on is off", label)
		}
		if s.BmViewColumns != nil || s.BmViewRailBlocks != nil {
			t.Fatalf("%s: lists should be nil (all)", label)
		}
	}
	check("fresh", fresh)

	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"theme":"x","bmViewDensity":"huge"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	check("older file", NewStore().GetSettings())
}

func TestBookmarkViewSettingsClamp(t *testing.T) {
	s := Settings{BmViewUsageDays: 9, BmViewColumns: []string{"score", "nope", "tags", "tags"}, BmViewRailBlocks: []string{}}
	clampBookmarkViewSettings(&s)
	if s.BmViewUsageDays != 30 {
		t.Fatalf("usage days %d", s.BmViewUsageDays)
	}
	if !reflect.DeepEqual(s.BmViewColumns, []string{"tags", "score"}) {
		t.Fatalf("columns %v", s.BmViewColumns)
	}
	// An empty list is a choice (none), not "all".
	if s.BmViewRailBlocks == nil || len(s.BmViewRailBlocks) != 0 {
		t.Fatalf("rail %v", s.BmViewRailBlocks)
	}
}
