package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// PreviewImageStats reports what the cache is using, for the read-out in
// Config → Icons & previews.
func (h *Handlers) PreviewImageStats(w http.ResponseWriter, r *http.Request) {
	files, used := previewImageCacheUsage()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"files":    files,
		"bytes":    used,
		"capBytes": h.previewImageCapBytes(),
	})
}

/*
 * ClearPreviewImages empties the directory and blanks the local paths.
 *
 * The *Source fields stay: the reader asked for the disk back, not for the
 * pictures to be gone for good, and keeping the address is what lets each one
 * return on its next hover. ImageFetchedAt is cleared too, so the backoff that
 * stops a failed source from being retried does not also hold back the ones the
 * reader just asked to refetch.
 */
func (h *Handlers) ClearPreviewImages(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	dir := previewImageDir()
	entries, err := os.ReadDir(dir)
	if err != nil && !os.IsNotExist(err) {
		http.Error(w, "Unable to read the preview image cache", http.StatusInternalServerError)
		return
	}
	removed := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err == nil {
			removed++
		}
	}

	prefix := "/data/" + previewImageDirName + "/"
	h.previewCacheMu.Lock()
	h.ensurePreviewCacheLoadedLocked()
	for key, entry := range h.previewCache.Cache {
		if !strings.HasPrefix(entry.Image, prefix) && !strings.HasPrefix(entry.Icon, prefix) {
			continue
		}
		entry.Image = ""
		entry.Icon = ""
		entry.ImageFetchedAt = 0
		h.previewCache.Cache[key] = entry
	}
	h.previewCacheDirty = true
	_ = h.flushPreviewCacheLocked()
	h.previewCacheMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "removed": removed})
}
