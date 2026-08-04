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
