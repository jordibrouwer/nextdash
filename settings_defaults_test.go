package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestFreshSettingsFileVisibilityDefaults(t *testing.T) {

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
	if settings.ShowRecentButton {
		t.Fatal("fresh install: showRecentButton should be false")
	}
	if settings.ShowCheatSheetButton {
		t.Fatal("fresh install: showCheatSheetButton should be false")
	}
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

	if err := os.MkdirAll("data", 0755); err != nil {
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
	if err := os.WriteFile("data/settings.json", body, 0644); err != nil {
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
	if !settings.ShowRecentButton {
		t.Fatal("migration: missing showRecentButton should default to true")
	}
	if !settings.ShowCheatSheetButton {
		t.Fatal("migration: missing showCheatSheetButton should default to true")
	}
	if !settings.AutoBackupEnabled {
		t.Fatal("migration: missing autoBackupEnabled should default to true")
	}
}

func TestGetSettingsRespectsExplicitAutoBackupDisabled(t *testing.T) {

	tmp := t.TempDir()
	t.Chdir(tmp)

	if err := os.MkdirAll("data", 0755); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark","autoBackupEnabled":false}`)
	if err := os.WriteFile("data/settings.json", body, 0644); err != nil {
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

	if err := os.MkdirAll("data", 0755); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark","showConfigButton":false}`)
	if err := os.WriteFile("data/settings.json", body, 0644); err != nil {
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
	raw, err := os.ReadFile("data/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	patched := strings.Replace(string(raw), `"showConfigButton": true`, `"showConfigButton": false`, 1)
	if err := os.WriteFile("data/settings.json", []byte(patched), 0644); err != nil {
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

	if err := os.MkdirAll("data", 0755); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark","showConfigButton":false,"configButtonDefaultOnMigrated":true}`)
	if err := os.WriteFile("data/settings.json", body, 0644); err != nil {
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

	if err := os.MkdirAll("data", 0755); err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"currentPage":1,"theme":"cherry-graphite-dark","showIcons":false}`)
	if err := os.WriteFile("data/settings.json", body, 0644); err != nil {
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
			if err := os.MkdirAll("data", 0755); err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(map[string]any{
				"currentPage":     1,
				"monitorEmphasis": tc.value,
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile("data/settings.json", body, 0644); err != nil {
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
	tmp := t.TempDir()
	t.Chdir(tmp)

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
		{"explicitly off", map[string]any{"currentPage": 1, "showCollapseAllButton": false}, false},
		{"explicitly on", map[string]any{"currentPage": 1, "showCollapseAllButton": true}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			t.Chdir(dir)
			if err := os.MkdirAll("data", 0755); err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(tc.settings)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile("data/settings.json", body, 0644); err != nil {
				t.Fatal(err)
			}
			if got := NewStore().GetSettings().ShowCollapseAllButton; got != tc.want {
				t.Fatalf("showCollapseAllButton = %v, want %v", got, tc.want)
			}
		})
	}
}
