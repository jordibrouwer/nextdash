package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteFileAtomicCreatesAndReplaces(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")

	if err := writeFileAtomic(path, []byte(`{"v":1}`), 0644); err != nil {
		t.Fatalf("first write: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read first: %v", err)
	}
	if string(data) != `{"v":1}` {
		t.Fatalf("first content = %q", string(data))
	}

	if err := writeFileAtomic(path, []byte(`{"v":2}`), 0644); err != nil {
		t.Fatalf("second write: %v", err)
	}
	data, err = os.ReadFile(path)
	if err != nil {
		t.Fatalf("read second: %v", err)
	}
	if string(data) != `{"v":2}` {
		t.Fatalf("second content = %q", string(data))
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	for _, entry := range entries {
		if entry.Name() != "settings.json" {
			t.Fatalf("leftover temp file: %s", entry.Name())
		}
	}
}

func TestWriteIndentJSONFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "pages.json")

	if err := writeIndentJSONFile(path, map[string]int{"page": 1}); err != nil {
		t.Fatalf("write: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(data) != "{\n  \"page\": 1\n}" {
		t.Fatalf("unexpected JSON: %q", string(data))
	}
}
