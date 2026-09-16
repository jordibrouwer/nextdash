package app

import "testing"

// Plain text with an underline is the page switcher every install draws now.
// The segmented control was the default before, so a stored "segmented" is
// moved once; a choice made after that stays.

func TestFreshInstallDrawsTheTextSwitcher(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	if got := NewStore().GetSettings().PageSwitcherStyle; got != "text" {
		t.Fatalf("fresh install: pageSwitcherStyle = %q, want text", got)
	}
}

func TestOldSwitcherDefaultMovesToTextOnce(t *testing.T) {
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1, "pageSwitcherStyle": "segmented"})

	settings := NewStore().GetSettings()
	if settings.PageSwitcherStyle != "text" {
		t.Fatalf("upgrade: pageSwitcherStyle = %q, want text", settings.PageSwitcherStyle)
	}
	if !settings.PageSwitcherTextMigrated {
		t.Fatal("upgrade: migration marker not set")
	}
}

func TestSwitcherChoicesAfterTheMigrationStick(t *testing.T) {
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

func TestUnknownSwitcherStyleFallsBackToText(t *testing.T) {
	s := Settings{PageSwitcherStyle: "tabs"}
	clampBookmarkSettings(&s)
	if s.PageSwitcherStyle != "text" {
		t.Fatalf("clamp: pageSwitcherStyle = %q, want text", s.PageSwitcherStyle)
	}
}
