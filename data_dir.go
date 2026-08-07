package main

import (
	"os"
	"path/filepath"
	"strings"
)

// ResolveDataDir returns the on-disk data root (settings, bookmarks, icons).
// Override with NEXTDASH_DATA_DIR for tests or alternate deployments.
func ResolveDataDir() string {
	if v := strings.TrimSpace(os.Getenv("NEXTDASH_DATA_DIR")); v != "" {
		return filepath.Clean(v)
	}
	return "data"
}

func previewCacheFilePath() string {
	return filepath.Join(ResolveDataDir(), "preview-cache.json")
}

func healthCacheFilePath() string {
	return filepath.Join(ResolveDataDir(), "health-cache.json")
}

func healthHistoryFilePath() string {
	return filepath.Join(ResolveDataDir(), "health-history.json")
}

func healthTrendFilePath() string {
	return filepath.Join(ResolveDataDir(), "health-trend.json")
}

func pushSubscriptionsFilePath() string {
	return filepath.Join(ResolveDataDir(), "push-subscriptions.json")
}
