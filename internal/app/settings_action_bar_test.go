package app

import "testing"

// The actions can leave the header: a dock at the bottom, a column on either
// side, or one menu. Every install starts with the right column sliding away
// after ten seconds; an existing install is moved there once, and a choice
// made after that is kept.

func TestFreshInstallPutsTheActionsInASlidingRightColumn(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	s := NewStore().GetSettings()
	if s.ActionBarPosition != "right" || s.ActionBarAutoHideSeconds != 10 {
		t.Fatalf("fresh install: position %q after %ds, want right after 10s", s.ActionBarPosition, s.ActionBarAutoHideSeconds)
	}
}

func TestExistingInstallMovesTheActionsToTheRightOnce(t *testing.T) {
	for name, seed := range map[string]map[string]any{
		"never answered": {"currentPage": 1},
		"stored header":  {"currentPage": 1, "actionBarPosition": "header", "actionBarAutoHideSeconds": 0},
		"stored bottom":  {"currentPage": 1, "actionBarPosition": "bottom", "actionBarAutoHideSeconds": 2},
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
			t.Chdir(t.TempDir())
			seedSettingsFile(t, seed)
			s := NewStore().GetSettings()
			if s.ActionBarPosition != "right" || s.ActionBarAutoHideSeconds != 10 {
				t.Fatalf("existing install: position %q after %ds, want right after 10s", s.ActionBarPosition, s.ActionBarAutoHideSeconds)
			}
		})
	}
}

func TestActionBarPositionChoicesAreKept(t *testing.T) {
	for _, pos := range []string{"header", "bottom", "left", "right", "menu"} {
		t.Run(pos, func(t *testing.T) {
			t.Chdir(t.TempDir())
			seedSettingsFile(t, map[string]any{"currentPage": 1, "actionBarPosition": pos, "actionBarRightMigrated": true})
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

func TestExistingInstallKeepsTheActionBarOn(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1})
	if !NewStore().GetSettings().ActionBarEnabled {
		t.Fatalf("existing install: actionBarEnabled = false, want true")
	}
}

func TestAChosenDelayAfterTheMoveIsKept(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1, "actionBarPosition": "left",
		"actionBarAutoHideSeconds": 0, "actionBarRightMigrated": true})
	s := NewStore().GetSettings()
	if s.ActionBarPosition != "left" || s.ActionBarAutoHideSeconds != 0 {
		t.Fatalf("position %q after %ds, want the stored left, always in view", s.ActionBarPosition, s.ActionBarAutoHideSeconds)
	}
}

// Key chips: on for a fresh install, off once for a dashboard that already
// existed -- whether or not it had stored the setting -- and a choice made
// after that is kept.

func TestFreshInstallShowsTheActionKeys(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	if !NewStore().GetSettings().ShowActionKeys {
		t.Fatalf("fresh install: showActionKeys = false, want true")
	}
}

func TestExistingInstallHidesTheActionKeysOnce(t *testing.T) {
	for name, seed := range map[string]map[string]any{
		"never answered": {"currentPage": 1},
		"stored on":      {"currentPage": 1, "showActionKeys": true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
			t.Chdir(t.TempDir())
			seedSettingsFile(t, seed)
			if NewStore().GetSettings().ShowActionKeys {
				t.Fatalf("existing install: showActionKeys = true, want false")
			}
		})
	}
}

func TestTurningTheActionKeysBackOnIsKept(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1, "showActionKeys": true, "actionKeysOffMigrated": true})
	if !NewStore().GetSettings().ShowActionKeys {
		t.Fatalf("showActionKeys = false, want the stored true")
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
