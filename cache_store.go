package main

import (
	"encoding/json"
	"os"
	"time"
)

const healthCachePath = "data/health-cache.json"

func readPreviewCacheFile() PreviewCacheFile {
	data, err := os.ReadFile(previewCachePath)
	if err != nil {
		return PreviewCacheFile{Cache: map[string]BookmarkPreview{}}
	}
	var cache PreviewCacheFile
	if err := json.Unmarshal(data, &cache); err != nil || cache.Cache == nil {
		return PreviewCacheFile{Cache: map[string]BookmarkPreview{}}
	}
	return cache
}

func writePreviewCacheFile(cache PreviewCacheFile) error {
	if err := os.MkdirAll("data", 0755); err != nil {
		return err
	}
	if cache.Cache == nil {
		cache.Cache = map[string]BookmarkPreview{}
	}
	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(previewCachePath, data, 0644)
}

func previewCacheEntryValid(entry BookmarkPreview) bool {
	return time.Now().UnixMilli()-entry.FetchedAt < previewCacheTTLMs
}

func (h *Handlers) getPreviewCacheEntry(key string) (BookmarkPreview, bool) {
	h.previewCacheMu.RLock()
	defer h.previewCacheMu.RUnlock()

	cache := readPreviewCacheFile()
	entry, ok := cache.Cache[key]
	if !ok || !previewCacheEntryValid(entry) {
		return BookmarkPreview{}, false
	}
	return entry, true
}

func (h *Handlers) mergePreviewCacheUpdates(updates map[string]BookmarkPreview) error {
	if len(updates) == 0 {
		return nil
	}

	h.previewCacheMu.Lock()
	defer h.previewCacheMu.Unlock()

	cache := readPreviewCacheFile()
	if cache.Cache == nil {
		cache.Cache = make(map[string]BookmarkPreview, len(updates))
	}
	for key, entry := range updates {
		cache.Cache[key] = entry
	}
	return writePreviewCacheFile(cache)
}

func (h *Handlers) replacePreviewCache(cache PreviewCacheFile) error {
	h.previewCacheMu.Lock()
	defer h.previewCacheMu.Unlock()
	if cache.Cache == nil {
		cache.Cache = map[string]BookmarkPreview{}
	}
	return writePreviewCacheFile(cache)
}

func normalizeHealthCacheFile(cache HealthScanCacheFile) HealthScanCacheFile {
	if len(cache.Cache) == 0 {
		cache.Cache = map[string]HealthScanCache{}
		return cache
	}

	normalized := make(map[string]HealthScanCache, len(cache.Cache))
	for key, entry := range cache.Cache {
		canonicalKey := canonicalBookmarkURLKey(entry.URL)
		if canonicalKey == "" {
			canonicalKey = canonicalBookmarkURLKey(key)
		}
		if canonicalKey == "" {
			continue
		}
		entry.URL = canonicalKey
		existing, ok := normalized[canonicalKey]
		if !ok || entry.LastScanned >= existing.LastScanned {
			normalized[canonicalKey] = entry
		}
	}
	cache.Cache = normalized
	return cache
}

func readHealthCacheFile() HealthScanCacheFile {
	data, err := os.ReadFile(healthCachePath)
	if err != nil {
		return HealthScanCacheFile{
			GeneratedAt: time.Now().UnixMilli(),
			Cache:       map[string]HealthScanCache{},
		}
	}
	var cache HealthScanCacheFile
	if err := json.Unmarshal(data, &cache); err != nil || cache.Cache == nil {
		return HealthScanCacheFile{
			GeneratedAt: time.Now().UnixMilli(),
			Cache:       map[string]HealthScanCache{},
		}
	}
	return normalizeHealthCacheFile(cache)
}

func writeHealthCacheFile(cache HealthScanCacheFile) error {
	if err := os.MkdirAll("data", 0755); err != nil {
		return err
	}
	if cache.Cache == nil {
		cache.Cache = map[string]HealthScanCache{}
	}
	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(healthCachePath, data, 0644)
}

func (h *Handlers) mergeHealthCacheUpdates(updates map[string]HealthScanCache) error {
	if len(updates) == 0 {
		return nil
	}

	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()

	cache := readHealthCacheFile()
	if cache.Cache == nil {
		cache.Cache = make(map[string]HealthScanCache, len(updates))
	}
	for key, entry := range updates {
		cache.Cache[key] = entry
	}
	cache.GeneratedAt = time.Now().UnixMilli()
	return writeHealthCacheFile(cache)
}
