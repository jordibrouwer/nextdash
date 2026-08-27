package app

import "testing"

func TestResolveDataDirDefault(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", "")
	if got := ResolveDataDir(); got != "data" {
		t.Fatalf("ResolveDataDir() = %q, want data", got)
	}
}

func TestResolveDataDirOverride(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", "/tmp/nextdash-custom-data")
	if got := ResolveDataDir(); got != "/tmp/nextdash-custom-data" {
		t.Fatalf("ResolveDataDir() = %q, want override path", got)
	}
}
