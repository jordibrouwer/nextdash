package app

import (
	"encoding/json"
	"os"
	"sort"
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

/*
previewCacheMaxEntries is how many previews are worth keeping at once.

The TTL below takes most of it: an entry past seven days cannot be served to
anyone. This is the second half, for a collection that really does hold
thousands of live bookmarks, and for a week of distinct addresses asked for
through /api/bookmark-preview -- which answers any address, not only one that is
bookmarked.
*/
const previewCacheMaxEntries = 5000

/*
prunePreviewCacheLocked drops what the cache can no longer serve, and reports
whether it took anything.

Nothing ever removed an entry: previewCacheEntryValid gates reads, so a preview
for a bookmark deleted years ago stayed in the map and in preview-cache.json
for ever -- and the whole map is re-marshalled on every flush, so what it cost
to keep grew with it.

Pruning here rather than on write: this is the one place the file is rewritten,
so the map on disk and the map in memory are trimmed in the same breath.
*/
func (h *Handlers) prunePreviewCacheLocked() bool {
	removed := false
	for key, entry := range h.previewCache.Cache {
		if !previewCacheEntryValid(entry) {
			delete(h.previewCache.Cache, key)
			removed = true
		}
	}

	over := len(h.previewCache.Cache) - previewCacheMaxEntries
	if over <= 0 {
		return removed
	}

	// Oldest first, because the entry fetched longest ago is the one nearest
	// its TTL and so the one closest to being no use anyway.
	keys := make([]string, 0, len(h.previewCache.Cache))
	for key := range h.previewCache.Cache {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		return h.previewCache.Cache[keys[i]].FetchedAt < h.previewCache.Cache[keys[j]].FetchedAt
	})
	for _, key := range keys[:over] {
		delete(h.previewCache.Cache, key)
	}
	return true
}

func (h *Handlers) flushPreviewCacheLocked() error {
	if !h.previewLoaded {
		return nil
	}
	if h.prunePreviewCacheLocked() {
		h.previewCacheDirty = true
	}
	if !h.previewCacheDirty {
		return nil
	}
	err := writePreviewCacheFile(h.previewCache)
	if err == nil {
		h.previewCacheDirty = false
	}
	return err
}

/*
StartPreviewCacheFlushScheduler writes the preview cache out every so often,
until it is told to stop.

It was started inside NewHandlers and ran on `for range ticker.C` -- the only
background ticker here with no way out, while main.go wires a stop channel into
all six others. Moving it beside them makes it one of them, and it also means a
Handlers built for a test no longer has a goroutine writing preview-cache.json
underneath it.

Shutdown flushes once more through FlushCaches, so nothing written between the
last tick and the stop is lost.
*/
func (h *Handlers) StartPreviewCacheFlushScheduler(stop <-chan struct{}) {
	ticker := time.NewTicker(previewCacheFlushInterval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				h.previewCacheMu.Lock()
				_ = h.flushPreviewCacheLocked()
				h.previewCacheMu.Unlock()
			}
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
