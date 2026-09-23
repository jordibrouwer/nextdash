package app

import (
	"fmt"
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

/*
The preview cache forgets what it can no longer serve.

Every fetched preview was written into the map and nothing ever took one out.
previewCacheEntryValid gates reads only, so an entry for a bookmark deleted
years ago stayed in memory and in preview-cache.json for ever -- and the whole
map is re-marshalled to disk on every flush, so the cost of keeping it grew with
it.
*/
func TestPreviewCacheDropsWhatItCannotServe(t *testing.T) {
	h := newTestHandlers(t)
	now := time.Now().UnixMilli()

	h.previewCacheMu.Lock()
	h.previewLoaded = true
	h.previewCache = PreviewCacheFile{Cache: map[string]BookmarkPreview{
		"https://fresh.example/": {URL: "https://fresh.example/", FetchedAt: now},
		"https://stale.example/": {URL: "https://stale.example/", FetchedAt: now - previewCacheTTLMs - 1},
		"https://gone.example/":  {URL: "https://gone.example/", FetchedAt: now - 400*24*60*60*1000},
	}}
	h.previewCacheDirty = true
	err := h.flushPreviewCacheLocked()
	h.previewCacheMu.Unlock()
	if err != nil {
		t.Fatalf("flush: %v", err)
	}

	onDisk := readPreviewCacheFile()
	if _, ok := onDisk.Cache["https://fresh.example/"]; !ok {
		t.Error("a preview still inside its TTL was dropped")
	}
	for _, gone := range []string{"https://stale.example/", "https://gone.example/"} {
		if _, ok := onDisk.Cache[gone]; ok {
			t.Errorf("%s outlived its TTL and is still cached", gone)
		}
	}
}

// And it has a ceiling, so a week of distinct addresses cannot grow it without
// limit either. What goes is what was fetched longest ago.
func TestPreviewCacheKeepsTheMostRecentUpToItsCap(t *testing.T) {
	h := newTestHandlers(t)
	now := time.Now().UnixMilli()

	cache := map[string]BookmarkPreview{}
	for i := 0; i < previewCacheMaxEntries+250; i++ {
		key := fmt.Sprintf("https://probe-%d.example/", i)
		// Higher i is more recently fetched.
		cache[key] = BookmarkPreview{URL: key, FetchedAt: now - int64(previewCacheMaxEntries+250-i)*1000}
	}

	h.previewCacheMu.Lock()
	h.previewLoaded = true
	h.previewCache = PreviewCacheFile{Cache: cache}
	h.previewCacheDirty = true
	err := h.flushPreviewCacheLocked()
	h.previewCacheMu.Unlock()
	if err != nil {
		t.Fatalf("flush: %v", err)
	}

	onDisk := readPreviewCacheFile()
	if len(onDisk.Cache) > previewCacheMaxEntries {
		t.Errorf("cache holds %d entries, cap is %d", len(onDisk.Cache), previewCacheMaxEntries)
	}
	newest := fmt.Sprintf("https://probe-%d.example/", previewCacheMaxEntries+249)
	if _, ok := onDisk.Cache[newest]; !ok {
		t.Error("the most recently fetched preview was dropped")
	}
	if _, ok := onDisk.Cache["https://probe-0.example/"]; ok {
		t.Error("the longest-ago fetch survived a full cache")
	}
}
