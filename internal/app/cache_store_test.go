package app

import (
	"sync"
	"testing"
	"time"
)

func TestMergePreviewCacheUpdatesPreservesConcurrentWrites(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	// And the data directory, not just the working one: the caches live at
	// ResolveDataDir(), which TestMain points at one directory for the whole
	// suite. Without this the file being counted is everybody's.
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	h := &Handlers{}
	var wg sync.WaitGroup
	for i := 0; i < 25; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			url := "https://example.com/" + string(rune('a'+n%26))
			key := canonicalBookmarkURLKey(url)
			h.mergePreviewCacheUpdates(map[string]BookmarkPreview{
				key: {URL: url, Title: "title", FetchedAt: time.Now().UnixMilli()},
			})
		}(i)
	}
	wg.Wait()
	h.FlushCaches()

	cache := readPreviewCacheFile()
	if len(cache.Cache) != 25 {
		t.Fatalf("preview cache len = %d, want 25", len(cache.Cache))
	}
}

func TestMergeHealthCacheUpdatesPreservesConcurrentWrites(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	// See above: t.Chdir does not move the cache file, ResolveDataDir does.
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	seed := readHealthCacheFile()
	seed.Cache["https://existing.test"] = HealthScanCache{URL: "https://existing.test", Status: "online"}
	if err := writeHealthCacheFile(seed); err != nil {
		t.Fatal(err)
	}

	h := &Handlers{}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			url := "https://health.test/" + string(rune('a'+n%26))
			key := canonicalBookmarkURLKey(url)
			h.mergeHealthCacheUpdates(map[string]HealthScanCache{
				key: {URL: url, Status: "online", LastScanned: time.Now().UnixMilli()},
			})
		}(i)
	}
	wg.Wait()

	cache := readHealthCacheFile()
	if len(cache.Cache) != 21 {
		t.Fatalf("health cache len = %d, want 21 (20 new + 1 seeded)", len(cache.Cache))
	}
	if _, ok := cache.Cache["https://existing.test"]; !ok {
		t.Fatal("seeded health cache entry was lost")
	}
}

func TestNormalizeHealthCacheFileMergesURLVariants(t *testing.T) {
	t.Parallel()

	normalized := normalizeHealthCacheFile(HealthScanCacheFile{
		Cache: map[string]HealthScanCache{
			"https://example.com": {
				URL:         "https://example.com/",
				Status:      "online",
				LastScanned: 100,
			},
			"https://example.com/": {
				URL:         "https://example.com",
				Status:      "offline",
				LastScanned: 200,
			},
		},
	})

	if len(normalized.Cache) != 1 {
		t.Fatalf("len = %d, want 1 canonical entry", len(normalized.Cache))
	}
	entry := normalized.Cache["https://example.com"]
	if entry.Status != "offline" {
		t.Fatalf("status = %q, want newer offline entry to win", entry.Status)
	}
}

func TestReplacePreviewCache(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	h := &Handlers{}
	h.mergePreviewCacheUpdates(map[string]BookmarkPreview{
		"https://example.com": {URL: "https://example.com", Title: "keep briefly"},
	})
	h.FlushCaches()
	h.replacePreviewCache(PreviewCacheFile{Cache: map[string]BookmarkPreview{}})
	h.FlushCaches()

	cache := readPreviewCacheFile()
	if len(cache.Cache) != 0 {
		t.Fatalf("expected empty cache after replace, got %d entries", len(cache.Cache))
	}
}
