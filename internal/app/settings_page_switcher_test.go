package app

import "testing"

// Classic -- the page numbers beside the destinations -- is the page switcher
// every install draws now. Segmented was the default first and text after it,
// so a stored default moves once; a choice made after that stays.

func TestFreshInstallDrawsTheClassicSwitcher(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	if got := NewStore().GetSettings().PageSwitcherStyle; got != "classic" {
		t.Fatalf("fresh install: pageSwitcherStyle = %q, want classic", got)
	}
}

func TestOldSwitcherDefaultsMoveToClassicOnce(t *testing.T) {
	cases := []map[string]any{
		// Never migrated: the segmented default of old.
		{"currentPage": 1, "pageSwitcherStyle": "segmented"},
		// Moved to text by the first migration.
		{"currentPage": 1, "pageSwitcherStyle": "text", "pageSwitcherTextMigrated": true},
		// Never written at all.
		{"currentPage": 1},
	}
	for _, seed := range cases {
		t.Chdir(t.TempDir())
		seedSettingsFile(t, seed)

		settings := NewStore().GetSettings()
		if settings.PageSwitcherStyle != "classic" {
			t.Fatalf("upgrade from %v: pageSwitcherStyle = %q, want classic", seed, settings.PageSwitcherStyle)
		}
		if !settings.PageSwitcherTextMigrated || !settings.PageSwitcherClassicMigrated {
			t.Fatalf("upgrade from %v: migration markers not set", seed)
		}
	}
}

func TestChosenSwitchersAreNotMovedToClassic(t *testing.T) {
	for _, style := range []string{"segmented", "compact"} {
		t.Run(style, func(t *testing.T) {
			t.Chdir(t.TempDir())
			seedSettingsFile(t, map[string]any{
				"currentPage":              1,
				"pageSwitcherStyle":        style,
				"pageSwitcherTextMigrated": true,
			})
			if got := NewStore().GetSettings().PageSwitcherStyle; got != style {
				t.Fatalf("pageSwitcherStyle = %q, want %q", got, style)
			}
		})
	}
}

func TestSwitcherChoicesAfterTheClassicMigrationStick(t *testing.T) {
	for _, style := range []string{"text", "segmented", "compact"} {
		t.Run(style, func(t *testing.T) {
			t.Chdir(t.TempDir())
			seedSettingsFile(t, map[string]any{
				"currentPage":                 1,
				"pageSwitcherStyle":           style,
				"pageSwitcherTextMigrated":    true,
				"pageSwitcherClassicMigrated": true,
			})
			if got := NewStore().GetSettings().PageSwitcherStyle; got != style {
				t.Fatalf("pageSwitcherStyle = %q, want %q", got, style)
			}
		})
	}
}

func TestUnknownSwitcherStyleFallsBackToClassic(t *testing.T) {
	s := Settings{PageSwitcherStyle: "tabs"}
	clampBookmarkSettings(&s)
	if s.PageSwitcherStyle != "classic" {
		t.Fatalf("clamp: pageSwitcherStyle = %q, want classic", s.PageSwitcherStyle)
	}
}
