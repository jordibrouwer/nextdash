package app

import "testing"

// The actions can leave the header: a dock at the bottom, a column on either
// side, or one menu. A new install starts with the dock; an install that
// predates the setting keeps its actions in the header, where they already were.

func TestFreshInstallDocksTheActionsAtTheBottom(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	if got := NewStore().GetSettings().ActionBarPosition; got != "bottom" {
		t.Fatalf("fresh install: actionBarPosition = %q, want bottom", got)
	}
}

func TestExistingInstallKeepsTheActionsInTheHeader(t *testing.T) {
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1})

	if got := NewStore().GetSettings().ActionBarPosition; got != "header" {
		t.Fatalf("existing install: actionBarPosition = %q, want header", got)
	}
}

func TestActionBarPositionChoicesAreKept(t *testing.T) {
	for _, pos := range []string{"header", "bottom", "left", "right", "menu"} {
		t.Run(pos, func(t *testing.T) {
			t.Chdir(t.TempDir())
			seedSettingsFile(t, map[string]any{"currentPage": 1, "actionBarPosition": pos})
			if got := NewStore().GetSettings().ActionBarPosition; got != pos {
				t.Fatalf("actionBarPosition = %q, want %q", got, pos)
			}
			s := Settings{ActionBarPosition: pos}
			clampBookmarkSettings(&s)
			if s.ActionBarPosition != pos {
				t.Fatalf("clamp changed %q to %q", pos, s.ActionBarPosition)
			}
		})
	}
}

func TestUnknownActionBarPositionFallsBackToTheHeader(t *testing.T) {
	s := Settings{ActionBarPosition: "top-left"}
	clampBookmarkSettings(&s)
	if s.ActionBarPosition != "header" {
		t.Fatalf("clamp: actionBarPosition = %q, want header", s.ActionBarPosition)
	}
}
