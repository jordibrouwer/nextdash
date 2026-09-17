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

// The bar can be switched off and can slide away after a delay. It was always
// drawn before the switch existed, and nothing slid.

func TestExistingInstallKeepsTheActionBarOnAndInView(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1})
	s := NewStore().GetSettings()
	if !s.ActionBarEnabled {
		t.Fatalf("existing install: actionBarEnabled = false, want true")
	}
	if s.ActionBarAutoHideSeconds != 0 {
		t.Fatalf("existing install: actionBarAutoHideSeconds = %d, want 0", s.ActionBarAutoHideSeconds)
	}
	if !s.ShowActionKeys {
		t.Fatalf("existing install: showActionKeys = false, want true")
	}
}

func TestSwitchingTheActionBarOffIsKept(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1, "actionBarEnabled": false})
	if NewStore().GetSettings().ActionBarEnabled {
		t.Fatalf("actionBarEnabled = true, want the stored false")
	}
}

func TestActionBarAutoHideKeepsOnlyTheOfferedDelays(t *testing.T) {
	for _, secs := range []int{0, 2, 5, 10, 30} {
		s := Settings{ActionBarAutoHideSeconds: secs}
		clampBookmarkSettings(&s)
		if s.ActionBarAutoHideSeconds != secs {
			t.Fatalf("clamp changed %d to %d", secs, s.ActionBarAutoHideSeconds)
		}
	}
	for _, secs := range []int{-1, 3, 60} {
		s := Settings{ActionBarAutoHideSeconds: secs}
		clampBookmarkSettings(&s)
		if s.ActionBarAutoHideSeconds != 0 {
			t.Fatalf("clamp kept %d, want 0", s.ActionBarAutoHideSeconds)
		}
	}
}

func TestHidingTheActionKeysIsKept(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1, "showActionKeys": false})
	if NewStore().GetSettings().ShowActionKeys {
		t.Fatalf("showActionKeys = true, want the stored false")
	}
}
