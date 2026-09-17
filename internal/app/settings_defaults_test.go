package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFreshSettingsFileVisibilityDefaults(t *testing.T) {
	// Its own store: this one describes a fresh install, so it must not
	// inherit whatever an earlier test in the run left behind.
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	settings := store.GetSettings()

	if !settings.ShowConfigButton {
		t.Fatal("fresh install: showConfigButton should be true")
	}
	if !settings.ShowHealthDashboard {
		t.Fatal("fresh install: showHealthDashboard should be true")
	}
	// Every action button ships on: the bar is where a new reader learns what
	// the keys do.
	assertAllActionButtons(t, "fresh install", settings, true)
	if !settings.ShowIcons {
		t.Fatal("fresh install: showIcons should be true")
	}
	if !settings.AutoBackupEnabled {
		t.Fatal("fresh install: autoBackupEnabled should be true")
	}
}

func TestGetSettingsMigratesMissingVisibilityKeys(t *testing.T) {

	tmp := t.TempDir()
	t.Chdir(tmp)

	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}

	legacy := map[string]any{
		"currentPage": 1,
		"theme":       "cherry-graphite-dark",
	}
	body, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	settings := store.GetSettings()

	if !settings.ShowConfigButton {
		t.Fatal("migration: missing showConfigButton should default to true")
	}
	if !settings.ShowIcons {
		t.Fatal("migration: missing showIcons should default to true")
	}
	if !settings.ShowHealthDashboard {
		t.Fatal("migration: missing showHealthDashboard should default to true")
	}
	// And an older install gets them all back, once.
	assertAllActionButtons(t, "migration", settings, true)
	if !settings.AutoBackupEnabled {
		t.Fatal("migration: missing autoBackupEnabled should default to true")
	}
}

func TestGetSettingsRespectsExplicitAutoBackupDisabled(t *testing.T) {

	tmp := t.TempDir()
	t.Chdir(tmp)

	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark","autoBackupEnabled":false}`)
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	settings := store.GetSettings()

	if settings.AutoBackupEnabled {
		t.Fatal("explicit autoBackupEnabled:false should stay false")
	}
}

func TestMigrateConfigButtonDefaultOn(t *testing.T) {

	tmp := t.TempDir()
	t.Chdir(tmp)

	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark","showConfigButton":false}`)
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	settings := store.GetSettings()

	if !settings.ShowConfigButton {
		t.Fatal("migration: showConfigButton should be true after upgrade")
	}
	if !settings.ConfigButtonDefaultOnMigrated {
		t.Fatal("migration: configButtonDefaultOnMigrated should be set")
	}

	// Second boot: migration must not run again — an explicit off sticks.
	raw, err := os.ReadFile(filepath.Join(ResolveDataDir(), "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	patched := strings.Replace(string(raw), `"showConfigButton": true`, `"showConfigButton": false`, 1)
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), []byte(patched), 0644); err != nil {
		t.Fatal(err)
	}

	store2 := NewStore()
	settings2 := store2.GetSettings()
	if settings2.ShowConfigButton {
		t.Fatal("after migration, explicit showConfigButton:false should be respected")
	}
}

func TestGetSettingsRespectsExplicitShowConfigButtonFalse(t *testing.T) {

	tmp := t.TempDir()
	t.Chdir(tmp)

	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark","showConfigButton":false,"configButtonDefaultOnMigrated":true}`)
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	settings := store.GetSettings()

	if settings.ShowConfigButton {
		t.Fatal("explicit showConfigButton:false should stay false once migrated")
	}
}

func TestGetSettingsRespectsExplicitShowIconsFalse(t *testing.T) {

	tmp := t.TempDir()
	t.Chdir(tmp)

	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark","showIcons":false}`)
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	settings := store.GetSettings()

	if settings.ShowIcons {
		t.Fatal("explicit showIcons:false should stay false")
	}
}

// The dashboard reads this straight onto <body> and CSS keys off the value, so
// an empty or unknown string would mean no emphasis rule matched at all — the
// setting would silently behave like a fourth, undocumented mode.
func TestMonitorEmphasisDefaultsAndRejectsUnknownValues(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	if got := store.GetSettings().MonitorEmphasis; got != "problems" {
		t.Fatalf("fresh install: monitorEmphasis = %q, want %q", got, "problems")
	}

	for _, tc := range []struct {
		name  string
		value any
		want  string
	}{
		{"valid always", "always", "always"},
		{"valid never", "never", "never"},
		{"unknown value", "loud", "problems"},
		{"empty string", "", "problems"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			t.Chdir(dir)
			if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(map[string]any{
				"currentPage":     1,
				"monitorEmphasis": tc.value,
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
				t.Fatal(err)
			}
			if got := NewStore().GetSettings().MonitorEmphasis; got != tc.want {
				t.Fatalf("monitorEmphasis = %q, want %q", got, tc.want)
			}
		})
	}
}

// The fold-all button predates its own setting: it was always in the toolbar,
// and its visibility was a side effect of the group it sits in. An upgrade must
// therefore leave it on, or every existing dashboard silently loses a button.
func TestCollapseAllButtonDefaultsOnForExistingInstalls(t *testing.T) {
	// Its own store: this one describes a fresh install, so it must not
	// inherit whatever an earlier test in the run left behind.
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	tmp := t.TempDir()
	t.Chdir(tmp)

	// A fresh install starts without the button; an upgrade keeps it. The two
	// answers come from different places — the constructors and the absent-key
	// migration — and the point of this test is that they stay different.
	if got := NewStore().GetSettings().ShowCollapseAllButton; !got {
		t.Fatalf("fresh install: showCollapseAllButton = %v, want true", got)
	}

	for _, tc := range []struct {
		name     string
		settings map[string]any
		want     bool
	}{
		// The upgrade case: a settings file written before the key existed.
		{"key absent", map[string]any{"currentPage": 1}, true},
		// Off before the all-on pass is turned on by it, once; off after it stays.
		{"explicitly off, before the pass", map[string]any{"currentPage": 1, "showCollapseAllButton": false}, true},
		{"explicitly off, after the pass", map[string]any{"currentPage": 1, "showCollapseAllButton": false, "actionButtonsAllOnMigrated": true}, false},
		{"explicitly on", map[string]any{"currentPage": 1, "showCollapseAllButton": true}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			t.Chdir(dir)
			if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(tc.settings)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
				t.Fatal(err)
			}
			if got := NewStore().GetSettings().ShowCollapseAllButton; got != tc.want {
				t.Fatalf("showCollapseAllButton = %v, want %v", got, tc.want)
			}
		})
	}
}

// The count-mode cap must survive the upgrade path. Every settings.json written
// before the mode existed omits the key, and a zero there once snapped to the
// smallest offered size — capping the log at 100 lines while the config UI,
// which defaults the same field to 1000, said otherwise.
func TestServerLogMaxEntriesDefault(t *testing.T) {
	t.Run("fresh install records the default", func(t *testing.T) {
		t.Chdir(t.TempDir())
		if got := NewStore().GetSettings().ServerLogMaxEntries; got != serverLogDefaultMaxEntries {
			t.Fatalf("fresh install: serverLogMaxEntries = %d, want %d", got, serverLogDefaultMaxEntries)
		}
	})

	for _, tc := range []struct {
		name     string
		settings map[string]any
		want     int
	}{
		// The upgrade case: a settings file written before the key existed.
		{"key absent", map[string]any{"currentPage": 1}, serverLogDefaultMaxEntries},
		{"explicit zero", map[string]any{"currentPage": 1, "serverLogMaxEntries": 0}, serverLogDefaultMaxEntries},
		{"explicit choice kept", map[string]any{"currentPage": 1, "serverLogMaxEntries": 2500}, 2500},
		{"odd value snaps up", map[string]any{"currentPage": 1, "serverLogMaxEntries": 101}, 500},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			t.Chdir(dir)
			if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(tc.settings)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
				t.Fatal(err)
			}
			if got := NewStore().GetSettings().ServerLogMaxEntries; got != tc.want {
				t.Fatalf("serverLogMaxEntries = %d, want %d", got, tc.want)
			}
		})
	}
}

// A fresh install starts on Retro CRT, and everything keyed to the default theme
// starts with it.
//
// The theme is named in four places — the two constructors here, the client's
// own settings object and the config form's default map — because none of them
// can read the others at the moment they are needed. Only the first two are
// checkable from Go; the client pair is held to it by
// tests/config-field-defaults.spec.js.
func TestFreshInstallStartsOnTarnishedBrass(t *testing.T) {
	// Its own store: this one describes a fresh install, so it must not
	// inherit whatever an earlier test in the run left behind.
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	tmp := t.TempDir()
	t.Chdir(tmp)

	settings := NewStore().GetSettings()
	if settings.Theme != "tarnished-brass-dark" {
		t.Fatalf("fresh install theme = %q, want tarnished-brass-dark", settings.Theme)
	}

	// The look it is built for: glass surfaces, a soft glow, the theme's own
	// backdrop, and the contrast that reads as Normal in Appearance.
	if settings.ThemeDepth != "glass" || settings.GlowStrength != "soft" {
		t.Fatalf("fresh install depth %q glow %q, want glass and soft", settings.ThemeDepth, settings.GlowStrength)
	}
	if settings.ThemeBackdrop != "on" || settings.BackgroundPattern != "auto" {
		t.Fatalf("fresh install backdrop %q pattern %q, want on and auto", settings.ThemeBackdrop, settings.BackgroundPattern)
	}
	if settings.InkGap != defaultInkGap {
		t.Fatalf("fresh install inkGap = %v, want %v", settings.InkGap, defaultInkGap)
	}

	// Auto dark mode is on by default, so the light variant has to exist and be
	// the one the pair resolves to — a default that only holds after dark falls
	// is not a default.
	colors := NewStore().GetColors()
	for _, id := range []string{defaultThemeID, defaultThemeLightID} {
		if _, ok := colors.BuiltIn[id]; !ok {
			t.Fatalf("packaged themes have no %q", id)
		}
	}

	// Favicon harmonisation is seeded per displayed theme id, so both variants
	// carry an entry; with only one, it would apply for half the day.
	styling := settings.ThemeIconStyling
	for _, id := range []string{"tarnished-brass-dark", "tarnished-brass-light"} {
		entry, ok := styling[id]
		if !ok || !entry.Enabled {
			t.Fatalf("themeIconStyling[%q] = %+v, want an enabled entry", id, entry)
		}
	}
}

// A pre-existing settings.json with no includeFindersInSearch key at all --
// the shape every install had before this setting existed -- must come up
// with it on, once. The setting is a plain bool: absent and explicit-false
// are indistinguishable in JSON, so the migration marker is what lets a
// reader who has since turned it off keep it off across a second boot.
func TestMigrateIncludeFindersInSearchDefaultOn(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark"}`)
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	settings := store.GetSettings()

	if !settings.IncludeFindersInSearch {
		t.Fatal("migration: includeFindersInSearch should be true after upgrade")
	}
	if !settings.IncludeFindersInSearchMigrated {
		t.Fatal("migration: includeFindersInSearchMigrated should be set")
	}

	// Second boot: migration must not run again -- an explicit off sticks.
	// GetSettings() does not itself persist the computed defaults, so the
	// migrated values are written out through SaveSettings first, the same
	// way a real save from the running dashboard would.
	settings.IncludeFindersInSearch = false
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	store2 := NewStore()
	settings2 := store2.GetSettings()
	if settings2.IncludeFindersInSearch {
		t.Fatal("after migration, explicit includeFindersInSearch:false should be respected")
	}
	if !settings2.IncludeFindersInSearchMigrated {
		t.Fatal("the migration marker must survive the save")
	}
}

// Exposes a defect in SaveSettings shared by every migration marker, not
// just this one: the "preserve markers from disk" block reads the file as it
// was *before* this save and overwrites the incoming value with it -- so a
// marker set for the first time in this same call (GetSettings flips it in
// memory only; nothing had written it to disk yet) is discarded, and the
// migration is free to run again on the next boot.
func TestSaveSettingsDoesNotLoseAFreshMigrationMarker(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark"}`)
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	settings := store.GetSettings() // flips ConfigButtonDefaultOnMigrated true, in memory only
	if !settings.ConfigButtonDefaultOnMigrated {
		t.Fatal("expected GetSettings to flip the marker in memory")
	}

	// A save for an unrelated reason -- nothing about the marker changed.
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	raw, _ := os.ReadFile(filepath.Join(ResolveDataDir(), "settings.json"))
	if strings.Contains(string(raw), `"configButtonDefaultOnMigrated": true`) {
		return // marker persisted correctly
	}
	t.Fatalf("SaveSettings dropped a migration marker set in this same call; raw=%s", raw)
}

/*
The modern layout is folded away, and its one distinctive habit travels.

Modern lit a bookmark row much further across than classic does. Everything
else it changed -- bigger radii, more opaque surfaces, a softer shadow -- is
either expressible through --theme-radius-scale or is something the depth
ladder now does better, so the row treatment is all that has to survive the
layout itself. An install that had it keeps it, without being asked.

Read from the stored file rather than from a field, which is what lets it keep
working now that LayoutVersion is gone from the struct entirely.
*/
func TestGetSettingsCarriesTheModernRowTreatment(t *testing.T) {
	load := func(t *testing.T, stored map[string]any) Settings {
		t.Helper()
		tmp := t.TempDir()
		t.Chdir(tmp)
		if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
			t.Fatal(err)
		}
		body, err := json.Marshal(stored)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), body, 0644); err != nil {
			t.Fatal(err)
		}
		return NewStore().GetSettings()
	}

	t.Run("an install on modern keeps its rows", func(t *testing.T) {
		settings := load(t, map[string]any{"theme": "retro-crt-dark", "layoutVersion": "modern"})

		if settings.RowHighlight != "strong" {
			t.Errorf("rowHighlight = %q, want strong: the row treatment was lost with the layout", settings.RowHighlight)
		}
		// Nothing asserts on the layout itself: there is one layout now, and
		// the stored key is read for this migration and then ignored.
	})

	t.Run("an install on classic is left alone", func(t *testing.T) {
		settings := load(t, map[string]any{"theme": "retro-crt-dark", "layoutVersion": "classic"})

		if settings.RowHighlight != "subtle" {
			t.Errorf("rowHighlight = %q, want subtle: a classic install had nothing to carry", settings.RowHighlight)
		}
	})

	t.Run("and somebody who chose for themselves is not overruled", func(t *testing.T) {
		// On modern and deliberately subtle. The migration fills a silence; it
		// does not answer a question the reader already answered.
		settings := load(t, map[string]any{
			"theme":         "retro-crt-dark",
			"layoutVersion": "modern",
			"rowHighlight":  "subtle",
		})

		if settings.RowHighlight != "subtle" {
			t.Errorf("rowHighlight = %q, want subtle: a stated choice was overwritten", settings.RowHighlight)
		}
	})
}

func assertAllActionButtons(t *testing.T, when string, s Settings, want bool) {
	t.Helper()
	for name, got := range map[string]bool{
		"showAddBookmarkButton": s.ShowAddBookmarkButton,
		"showSearchButton":      s.ShowSearchButton,
		"showCommandsButton":    s.ShowCommandsButton,
		"showFindersButton":     s.ShowFindersButton,
		"showTagCloudButton":    s.ShowTagCloudButton,
		"showRecentButton":      s.ShowRecentButton,
		"showPagesButton":       s.ShowPagesButton,
		"showCollapseAllButton": s.ShowCollapseAllButton,
		"showCheatSheetButton":  s.ShowCheatSheetButton,
	} {
		if got != want {
			t.Errorf("%s: %s = %v, want %v", when, name, got, want)
		}
	}
}

// A button switched off after the all-on pass stays off.
func TestActionButtonChoicesAfterTheAllOnPassStick(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	seedSettingsFile(t, map[string]any{
		"currentPage": 1, "actionButtonsAllOnMigrated": true, "launcherDefaultsMigrated": true,
		"showRecentButton": false, "showCommandsButton": false,
	})
	s := NewStore().GetSettings()
	if s.ShowRecentButton || s.ShowCommandsButton {
		t.Fatalf("a choice made after the pass was undone: recent %v, commands %v", s.ShowRecentButton, s.ShowCommandsButton)
	}
}
