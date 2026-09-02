package app

import (
	"encoding/json"
	"os"
	"strings"
	"time"
)

// normalizePreviewCacheFile migrates entries written before preview media was
// cached locally: their Image and Icon hold remote URLs, which is now what the
// *Source fields mean. Anything that is not an http(s) address is left alone —
// a local path is already migrated, and a bare Icon filename is a data/icons/
// name that was never ours to move.
func normalizePreviewCacheFile(cache PreviewCacheFile) PreviewCacheFile {
	if cache.Cache == nil {
		cache.Cache = map[string]BookmarkPreview{}
		return cache
	}
	isRemote := func(v string) bool {
		return strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://")
	}
	for key, entry := range cache.Cache {
		if isRemote(entry.Image) {
			entry.ImageSource = entry.Image
			entry.Image = ""
		}
		if isRemote(entry.Icon) {
			entry.IconSource = entry.Icon
			entry.Icon = ""
		}
		cache.Cache[key] = entry
	}
	return cache
}

func readPreviewCacheFile() PreviewCacheFile {
	data, err := os.ReadFile(previewCacheFilePath())
	if err != nil {
		return PreviewCacheFile{Cache: map[string]BookmarkPreview{}}
	}
	var cache PreviewCacheFile
	if err := json.Unmarshal(data, &cache); err != nil || cache.Cache == nil {
		return PreviewCacheFile{Cache: map[string]BookmarkPreview{}}
	}
	return normalizePreviewCacheFile(cache)
}

func writePreviewCacheFile(cache PreviewCacheFile) error {
	if cache.Cache == nil {
		cache.Cache = map[string]BookmarkPreview{}
	}
	return writeIndentJSONFile(previewCacheFilePath(), cache)
}

const previewCacheFlushInterval = 30 * time.Second

func (h *Handlers) flushPreviewCacheLocked() error {
	if !h.previewLoaded || !h.previewCacheDirty {
		return nil
	}
	err := writePreviewCacheFile(h.previewCache)
	if err == nil {
		h.previewCacheDirty = false
	}
	return err
}

func (h *Handlers) startPreviewCacheFlushLoop() {
	go func() {
		ticker := time.NewTicker(previewCacheFlushInterval)
		defer ticker.Stop()
		for range ticker.C {
			h.previewCacheMu.Lock()
			_ = h.flushPreviewCacheLocked()
			h.previewCacheMu.Unlock()
		}
	}()
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

/*
 * Handing out a cached preview is also where its media gets chased.
 *
 * The queueing used to sit on the cache-hit branch inside fetchBookmarkPreview,
 * which the preview endpoint never reaches: it looks the entry up here first
 * and returns. So every bookmark whose picture had not been fetched yet stayed
 * that way no matter how often it was hovered — never even attempted.
 *
 * It belongs here instead. This is the one place a stored preview is served, so
 * anything that reads one keeps the promise that a missing picture is on its
 * way. Queueing happens after the lock is released: the check stats a file, and
 * that has no business running under the cache mutex.
 */
func (h *Handlers) getPreviewCacheEntry(key string) (BookmarkPreview, bool) {
	h.previewCacheMu.Lock()
	h.ensurePreviewCacheLoadedLocked()
	entry, ok := h.previewCache.Cache[key]
	h.previewCacheMu.Unlock()

	if !ok || !previewCacheEntryValid(entry) {
		return BookmarkPreview{}, false
	}
	h.queuePreviewMediaFetch(key, entry)
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
	h.previewCacheDirty = true
	return nil
}

func (h *Handlers) replacePreviewCache(cache PreviewCacheFile) error {
	h.previewCacheMu.Lock()
	defer h.previewCacheMu.Unlock()
	if cache.Cache == nil {
		cache.Cache = map[string]BookmarkPreview{}
	}
	h.previewCache = cache
	h.previewLoaded = true
	h.previewCacheDirty = true
	return nil
}

func normalizeHealthCacheFile(cache HealthScanCacheFile) HealthScanCacheFile {
	// Certificates are optional and absent from every file written before they
	// existed, so normalise them before the early return below — otherwise a
	// cache with no entries yet would hand back a nil map for callers to write
	// into. Done here rather than at each use so there is one place that
	// guarantees the map exists.
	if cache.Certificates == nil {
		cache.Certificates = map[string]HostCertificate{}
	}
	for host, cert := range cache.Certificates {
		if strings.TrimSpace(host) == "" || cert.ExpiresAt <= 0 {
			delete(cache.Certificates, host)
		}
	}
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
