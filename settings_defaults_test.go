package main

import (
	"encoding/json"
	"os"
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
	if !settings.ShowRecentButton {
		t.Fatal("fresh install: showRecentButton should be true")
	}
	if !settings.ShowCheatSheetButton {
		t.Fatal("fresh install: showCheatSheetButton should be true")
	}
	if !settings.ShowIcons {
		t.Fatal("fresh install: showIcons should be true")
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
