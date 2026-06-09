package main

import (
	"os"
	"sync"
	"testing"
	"time"
)

func TestMergePreviewCacheUpdatesPreservesConcurrentWrites(t *testing.T) {
	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

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

	cache := readPreviewCacheFile()
	if len(cache.Cache) != 25 {
		t.Fatalf("preview cache len = %d, want 25", len(cache.Cache))
	}
}

func TestMergeHealthCacheUpdatesPreservesConcurrentWrites(t *testing.T) {
	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

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

func TestReplacePreviewCache(t *testing.T) {
	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

	h := &Handlers{}
	h.mergePreviewCacheUpdates(map[string]BookmarkPreview{
		"https://example.com": {URL: "https://example.com", Title: "keep briefly"},
	})
	h.replacePreviewCache(PreviewCacheFile{Cache: map[string]BookmarkPreview{}})

	cache := readPreviewCacheFile()
	if len(cache.Cache) != 0 {
		t.Fatalf("expected empty cache after replace, got %d entries", len(cache.Cache))
	}
}
