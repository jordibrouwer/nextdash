package main

import (
	"encoding/json"
	"os"
	"time"
)

func readPreviewCacheFile() PreviewCacheFile {
	data, err := os.ReadFile(previewCacheFilePath())
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
	if cache.Cache == nil {
		cache.Cache = map[string]BookmarkPreview{}
	}
	return writeIndentJSONFile(previewCacheFilePath(), cache)
}

func previewCacheEntryValid(entry BookmarkPreview) bool {
	return time.Now().UnixMilli()-entry.FetchedAt < previewCacheTTLMs
}

func (h *Handlers) ensurePreviewCacheLoadedLocked() {
	if h.previewLoaded {
		return
	}
	h.previewCache = readPreviewCacheFile()
	if h.previewCache.Cache == nil {
		h.previewCache.Cache = map[string]BookmarkPreview{}
	}
	h.previewLoaded = true
}

func (h *Handlers) getPreviewCacheEntry(key string) (BookmarkPreview, bool) {
	h.previewCacheMu.Lock()
	defer h.previewCacheMu.Unlock()

	h.ensurePreviewCacheLoadedLocked()
	entry, ok := h.previewCache.Cache[key]
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

	h.ensurePreviewCacheLoadedLocked()
	for key, entry := range updates {
		h.previewCache.Cache[key] = entry
	}
	return writePreviewCacheFile(h.previewCache)
}

func (h *Handlers) replacePreviewCache(cache PreviewCacheFile) error {
	h.previewCacheMu.Lock()
	defer h.previewCacheMu.Unlock()
	if cache.Cache == nil {
		cache.Cache = map[string]BookmarkPreview{}
	}
	h.previewCache = cache
	h.previewLoaded = true
	return writePreviewCacheFile(h.previewCache)
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
	data, err := os.ReadFile(healthCacheFilePath())
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
	if cache.Cache == nil {
		cache.Cache = map[string]HealthScanCache{}
	}
	return writeIndentJSONFile(healthCacheFilePath(), cache)
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
