package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeSettingsFile(t *testing.T, dir string, body string) string {
	t.Helper()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	return path
}

func readShortcutMode(t *testing.T, path string) (string, bool) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("parse settings: %v", err)
	}
	mode, _ := raw["shortcutOpenMode"].(string)
	done, _ := raw["shortcutOpenModeInstantMigrated"].(bool)
	return mode, done
}

func TestShortcutOpenModeMigration(t *testing.T) {
	cases := []struct {
		name  string
		start string
		want  string
	}{
		// The value v1.2.0 wrote everywhere, which nobody picked.
		{name: "enter is moved", start: `{"shortcutOpenMode":"enter"}`, want: "instant"},
		// Absent reads as the old default too.
		{name: "absent is moved", start: `{}`, want: "instant"},
		// This one can only be there because someone chose it.
		{name: "delay is left alone", start: `{"shortcutOpenMode":"delay"}`, want: "delay"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := writeSettingsFile(t, dir, tc.start)
			fs := &FileStore{settingsFile: path, dataDir: dir}

			fs.migrateShortcutOpenModeDefaultInstant()
			mode, done := readShortcutMode(t, path)
			if mode != tc.want {
				t.Fatalf("shortcutOpenMode = %q, want %q", mode, tc.want)
			}
			if !done {
				t.Fatal("expected the marker to be set")
			}
		})
	}
}

func TestShortcutOpenModeMigrationRunsOnce(t *testing.T) {
	dir := t.TempDir()
	path := writeSettingsFile(t, dir, `{"shortcutOpenMode":"enter"}`)
	fs := &FileStore{settingsFile: path, dataDir: dir}

	fs.migrateShortcutOpenModeDefaultInstant()

	// Someone who wants Enter back sets it back.
	data, _ := os.ReadFile(path)
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(data, &raw)
	raw["shortcutOpenMode"] = json.RawMessage(`"enter"`)
	out, _ := json.MarshalIndent(raw, "", "  ")
	_ = os.WriteFile(path, out, 0o644)

	// A restart must leave that alone: changing a default is not the same as
	// taking the choice away.
	fs.migrateShortcutOpenModeDefaultInstant()
	if mode, _ := readShortcutMode(t, path); mode != "enter" {
		t.Fatalf("second run changed a deliberate choice: %q", mode)
	}
}
