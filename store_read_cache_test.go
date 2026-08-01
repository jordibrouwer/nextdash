package main

import (
	"testing"
)

func TestStoreReadCacheHitsUntilMutation(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{
		settingsFile: dir + "/settings.json",
		dataDir:      dir,
		readCache:    newStoreReadCache(),
	}
	store.initializeDefaultFiles()

	before := store.GetSettings().Theme
	store.readCache.settingsOK = true
	store.readCache.settings = store.GetSettings()
	store.readCache.settings.Theme = "cached-theme"

	if got := store.GetSettings().Theme; got != "cached-theme" {
		t.Fatalf("cached theme = %q, want cached-theme", got)
	}

	store.SaveSettings(Settings{Theme: before})
	if got := store.GetSettings().Theme; got == "cached-theme" {
		t.Fatalf("theme still cached after SaveSettings")
	}
}

func TestPrecomputedAssetHashesMatchRuntime(t *testing.T) {
	if len(precomputedAssetHashes) == 0 {
		t.Fatal("precomputedAssetHashes is empty; run go generate")
	}
	initAssetHashing(nil)
	for rel, want := range precomputedAssetHashes {
		if got := assetHash(rel); got != want {
			t.Fatalf("assetHash(%q) = %q, want precomputed %q", rel, got, want)
		}
	}
}
