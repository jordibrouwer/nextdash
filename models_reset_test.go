package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResetAllDataDoesNotDeadlock(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()

	done := make(chan error, 1)
	go func() { done <- store.ResetAllData() }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ResetAllData error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ResetAllData deadlocked")
	}
}

func TestResetAllDataClearsUserAssets(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	if err := os.MkdirAll(filepath.Join(ResolveDataDir(), "icons"), 0755); err != nil {
		t.Fatal(err)
	}
	removedAfterReset := map[string][]byte{
		filepath.Join(ResolveDataDir(), "icons", "icon-test.png"): []byte("icon"),
		filepath.Join(ResolveDataDir(), "preview-cache.json"):     []byte(`{"cache":{}}`),
		filepath.Join(ResolveDataDir(), "health-cache.json"):      []byte(`{}`),
		filepath.Join(ResolveDataDir(), "favicon.png"):            []byte("fav"),
		filepath.Join(ResolveDataDir(), "font.woff2"):             []byte("font"),
	}
	for path, content := range removedAfterReset {
		if err := os.WriteFile(path, content, 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "colors.json"), []byte(`{"custom":{"old":{}}}`), 0644); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	if err := store.ResetAllData(); err != nil {
		t.Fatalf("ResetAllData error: %v", err)
	}

	for path := range removedAfterReset {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("expected %s removed after reset, stat err=%v", path, err)
		}
	}
	if _, err := os.Stat(filepath.Join(ResolveDataDir(), "icons")); !os.IsNotExist(err) {
		t.Fatal("expected data/icons directory removed after reset")
	}

	colors, err := os.ReadFile(filepath.Join(ResolveDataDir(), "colors.json"))
	if err != nil {
		t.Fatalf("expected default colors.json recreated, err=%v", err)
	}
	if strings.Contains(string(colors), `"old"`) {
		t.Fatalf("colors.json should be reset to defaults, got %s", colors)
	}
}
