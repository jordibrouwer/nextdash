package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateListenPort(t *testing.T) {
	t.Parallel()

	port, err := validateListenPort("")
	if err != nil || port != "8080" {
		t.Fatalf("empty PORT = %q, %v; want 8080", port, err)
	}

	port, err = validateListenPort("3000")
	if err != nil || port != "3000" {
		t.Fatalf("PORT 3000 = %q, %v", port, err)
	}

	if _, err := validateListenPort("0"); err == nil {
		t.Fatal("PORT 0 should be rejected")
	}
	if _, err := validateListenPort("70000"); err == nil {
		t.Fatal("PORT 70000 should be rejected")
	}
	if _, err := validateListenPort("abc"); err == nil {
		t.Fatal("non-numeric PORT should be rejected")
	}
}

func TestValidateDataDirAtStartup(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nextdash-data")
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if err := validateDataDirAtStartup(); err != nil {
		t.Fatalf("validateDataDirAtStartup() error: %v", err)
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		t.Fatalf("data dir was not created: %v", err)
	}
}

func TestWeakTokenReason(t *testing.T) {
	t.Parallel()

	for _, token := range []string{"", "   ", "3f9c1e7a5b2d8046c1e9f7a3b5d20486"} {
		if reason := weakTokenReason(token); reason != "" {
			t.Errorf("weakTokenReason(%q) = %q; want no warning", token, reason)
		}
	}
	for _, token := range []string{"change-me", "Change-Me-To-A-Long-Random-String", " a-second-long-random-string ", "hunter2"} {
		if reason := weakTokenReason(token); reason == "" {
			t.Errorf("weakTokenReason(%q) = no warning; want one", token)
		}
	}
}
