package app

import "testing"

// The action bar folds sooner now.
//
// Two buttons stand in the header before the rest go behind "+N", and a
// reader may ask for none at all -- every action behind the one control.
// Zero used to mean "never set" and was quietly turned into the default,
// which made that answer impossible to give.

func TestFreshInstallShowsTwoHeaderActions(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())

	if got := NewStore().GetSettings().MaxHeaderActions; got != 2 {
		t.Fatalf("fresh install: maxHeaderActions = %d, want 2", got)
	}
}

func TestSettingsFileWithoutHeaderActionsTakesTheDefault(t *testing.T) {
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1})

	if got := NewStore().GetSettings().MaxHeaderActions; got != 2 {
		t.Fatalf("absent key: maxHeaderActions = %d, want 2", got)
	}
}

func TestOldDefaultOfFourMovesToTwoOnce(t *testing.T) {
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1, "maxHeaderActions": 4})

	settings := NewStore().GetSettings()
	if settings.MaxHeaderActions != 2 {
		t.Fatalf("upgrade from 4: maxHeaderActions = %d, want 2", settings.MaxHeaderActions)
	}
	if !settings.HeaderActionsDefaultTwoMigrated {
		t.Fatal("upgrade from 4: migration marker not set")
	}
}

func TestFourChosenAfterTheMigrationSticks(t *testing.T) {
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{
		"currentPage":                     1,
		"maxHeaderActions":                4,
		"headerActionsDefaultTwoMigrated": true,
	})

	if got := NewStore().GetSettings().MaxHeaderActions; got != 4 {
		t.Fatalf("chosen after migration: maxHeaderActions = %d, want 4", got)
	}
}

func TestOtherChoicesAreLeftAlone(t *testing.T) {
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{"currentPage": 1, "maxHeaderActions": 6})

	if got := NewStore().GetSettings().MaxHeaderActions; got != 6 {
		t.Fatalf("upgrade from 6: maxHeaderActions = %d, want 6", got)
	}
}

func TestZeroHeaderActionsIsAChoice(t *testing.T) {
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{
		"currentPage":                     1,
		"maxHeaderActions":                0,
		"headerActionsDefaultTwoMigrated": true,
	})
	if got := NewStore().GetSettings().MaxHeaderActions; got != 0 {
		t.Fatalf("load: maxHeaderActions = %d, want 0", got)
	}

	s := Settings{MaxHeaderActions: 0}
	clampBookmarkSettings(&s)
	if s.MaxHeaderActions != 0 {
		t.Fatalf("clamp: maxHeaderActions = %d, want 0", s.MaxHeaderActions)
	}
	s.MaxHeaderActions = -3
	clampBookmarkSettings(&s)
	if s.MaxHeaderActions != 0 {
		t.Fatalf("clamp negative: maxHeaderActions = %d, want 0", s.MaxHeaderActions)
	}
}
