package main

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestResetAllDataDoesNotDeadlock(t *testing.T) {
	t.Parallel()

	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

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
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

	if err := os.MkdirAll("data/icons", 0755); err != nil {
		t.Fatal(err)
	}
	removedAfterReset := map[string][]byte{
		"data/icons/icon-test.png": []byte("icon"),
		"data/preview-cache.json":  []byte(`{"cache":{}}`),
		"data/health-cache.json":   []byte(`{}`),
		"data/favicon.png":         []byte("fav"),
		"data/font.woff2":          []byte("font"),
	}
	for path, content := range removedAfterReset {
		if err := os.WriteFile(path, content, 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile("data/colors.json", []byte(`{"custom":{"old":{}}}`), 0644); err != nil {
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
	if _, err := os.Stat("data/icons"); !os.IsNotExist(err) {
		t.Fatal("expected data/icons directory removed after reset")
	}

	colors, err := os.ReadFile("data/colors.json")
	if err != nil {
		t.Fatalf("expected default colors.json recreated, err=%v", err)
	}
	if strings.Contains(string(colors), `"old"`) {
		t.Fatalf("colors.json should be reset to defaults, got %s", colors)
	}
}
