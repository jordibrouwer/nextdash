package app

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

/*
 * Preview media is fetched by the server and served from our own origin.
 *
 * Hot-linking made the reader's browser announce itself to every site they had
 * saved: hovering a bookmark fetched that site's og:image straight from the
 * source. It also failed outright against a host that sets
 * Cross-Origin-Resource-Policy, which is how this was noticed -- but the CORP
 * failure is the symptom. Measured against a real cache it was 2 images of 16;
 * the third-party traffic was all of them.
 *
 * The stored name hashes the *source URL*, not the bytes. Byte-addressing would
 * dedupe two bookmarks that share an image, but then the local path depends on
 * content we may not have, and a missing file needs a stored mapping to
 * recover. Hashing the URL makes the path a pure function of the source, so a
 * missing file heals itself and a restored backup needs no repair pass. The
 * cost is losing dedupe between two distinct URLs serving identical bytes,
 * which is rare enough to give away for that.
 */

const previewImageDirName = "preview-images"

// Larger than the 2 MB icons get: an og:image is a banner, not a favicon.
const maxPreviewImageBytes = 5 << 20

// The offered sizes are a short list rather than a free number: how much disk
// to give a cache of decoration is a choice between a few sizes, not a dial.
var previewImageCacheSizesMB = []int{50, 200, 500}

const defaultPreviewImageCacheMB = 200

func normalizePreviewImageCacheMB(mb int) int {
	for _, allowed := range previewImageCacheSizesMB {
		if mb == allowed {
			return mb
		}
	}
	return defaultPreviewImageCacheMB
}

func (h *Handlers) previewImageCapBytes() int64 {
	return int64(normalizePreviewImageCacheMB(h.store.GetSettings().PreviewImageCacheMB)) << 20
}

func previewImageDir() string {
	return filepath.Join(ResolveDataDir(), previewImageDirName)
}

func previewImageFileName(sourceURL, ext string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(sourceURL)))
	return "pi-" + hex.EncodeToString(sum[:])[:16] + ext
}

// downloadPreviewImage fetches one remote image and stores it, returning the
// bare filename. A refusal is silent -- an empty name and no error -- because
// every caller treats "no picture" as a normal card rather than a failure.
func downloadPreviewImage(sourceURL string, allowLocalHosts bool) (string, error) {
	return downloadPreviewMedia(sourceURL, allowLocalHosts, false)
}

// downloadPreviewIcon is the same fetch for the card's favicon, which may be an
// SVG -- unlike an og:image, that is common -- and is sanitised the way stored
// bookmark icons already are.
func downloadPreviewIcon(sourceURL string, allowLocalHosts bool) (string, error) {
	return downloadPreviewMedia(sourceURL, allowLocalHosts, true)
}

func downloadPreviewMedia(sourceURL string, allowLocalHosts, allowSVG bool) (string, error) {
	sourceURL = strings.TrimSpace(sourceURL)
	if sourceURL == "" {
		return "", nil
	}
	parsed, err := url.Parse(sourceURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return "", nil
	}
	if !allowLocalHosts && !isPublicHost(parsed.Hostname()) {
		return "", nil
	}

	client := newOutboundHTTPClient(allowLocalHosts, 8*time.Second, 3)
	req, err := http.NewRequest(http.MethodGet, sourceURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "nextDash-preview-image/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", nil
	}

	// One byte over the cap is read so an oversized body can be told apart from
	// one that exactly fills it.
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxPreviewImageBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxPreviewImageBytes {
		return "", err
	}

	ext, ok := iconExtensionFromContentType(detectImageType(data))
	if !ok {
		contentType := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
		if ext, ok = iconExtensionFromContentType(contentType); !ok {
			return "", nil
		}
	}
	if ext == ".svg" {
		// For an og:image, refused rather than sanitised: it is never legitimately
		// an SVG, so carrying sanitizeSVGContent's risk buys nothing. A favicon
		// often is one, and goes through the same sanitiser stored icons use.
		if !allowSVG {
			return "", nil
		}
		if data = sanitizeSVGContent(data); len(data) == 0 {
			return "", nil
		}
	}

	return storePreviewImage(sourceURL, ext, data)
}

// storePreviewImage writes through a temp file in the same directory and
// renames into place. Two bookmarks can share a source URL, so two workers can
// reach the same name at once, and a reader must never be served a
// half-written image.
func storePreviewImage(sourceURL, ext string, data []byte) (string, error) {
	dir := previewImageDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		_ = os.Remove(tmpName)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return "", err
	}
	name := previewImageFileName(sourceURL, ext)
	// CreateTemp makes the file 0600; stored icons beside it are 0644 and this
	// is served the same way, so it matches them rather than the temp default.
	if err := os.Chmod(tmpName, 0644); err != nil {
		_ = os.Remove(tmpName)
		return "", err
	}
	if err := os.Rename(tmpName, filepath.Join(dir, name)); err != nil {
		_ = os.Remove(tmpName)
		return "", err
	}
	return name, nil
}

/*
 * Eviction reads the directory rather than keeping an index.
 *
 * An index is a second source of truth that can drift from the disk; the disk
 * cannot drift from itself. A few hundred files makes the walk trivial, and it
 * only runs after a write.
 *
 * This is oldest-first, not LRU: modtime is the moment we fetched, so an image
 * looked at daily can still be evicted for age alone. The cost is one
 * background download on the next hover, never a permanent loss -- that is what
 * the stored source URL is for. True LRU would cost a write per hover, which is
 * not worth it for decoration.
 */
func previewImageCacheUsage() (int, int64) {
	entries, err := os.ReadDir(previewImageDir())
	if err != nil {
		return 0, 0
	}
	files, total := 0, int64(0)
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".tmp-") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files++
		total += info.Size()
	}
	return files, total
}

/*
 * pruneOrphanPreviewImages deletes cached media nothing points at any more.
 *
 * The cap already reaps orphans, which is the difference from the icons store:
 * one orphan per evicted inbox item accumulated there forever because nothing
 * bounded it. But an install that never fills the cap keeps them indefinitely,
 * so emptying the trash -- the moment a bookmark truly stops existing -- runs
 * a sweep.
 *
 * By reference rather than by name: two bookmarks sharing a URL share one file,
 * the same reason removeUnusedIconFile checks before deleting. The reference
 * set comes from live bookmarks through the preview cache, so an entry left
 * behind by a deleted bookmark does not keep its picture alive.
 */
func (h *Handlers) pruneOrphanPreviewImages() int {
	inUse := map[string]bool{}
	prefix := "/data/" + previewImageDirName + "/"
	claim := func(localPath string) {
		if name := strings.TrimPrefix(localPath, prefix); name != localPath && name != "" {
			inUse[name] = true
		}
	}
	for _, bm := range h.store.GetAllBookmarks() {
		entry, ok := h.getPreviewCacheEntry(canonicalBookmarkURLKey(bm.URL))
		if !ok {
			continue
		}
		claim(entry.Image)
		claim(entry.Icon)
	}

	entries, err := os.ReadDir(previewImageDir())
	if err != nil {
		return 0
	}
	removed := 0
	for _, entry := range entries {
		name := entry.Name()
		// A temp file has not been renamed into place yet, so nothing can claim
		// it and sweeping it would pull the rug from under a running worker.
		if entry.IsDir() || strings.HasPrefix(name, ".tmp-") || inUse[name] {
			continue
		}
		if err := os.Remove(filepath.Join(previewImageDir(), name)); err == nil {
			removed++
		}
	}
	return removed
}

func evictPreviewImages(capBytes int64) (int, error) {
	if capBytes <= 0 {
		return 0, nil
	}
	dir := previewImageDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}

	type aged struct {
		name string
		size int64
		when time.Time
	}
	var files []aged
	total := int64(0)
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".tmp-") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, aged{entry.Name(), info.Size(), info.ModTime()})
		total += info.Size()
	}
	if total <= capBytes {
		return 0, nil
	}

	sort.Slice(files, func(i, j int) bool { return files[i].when.Before(files[j].when) })
	removed := 0
	for _, f := range files {
		if total <= capBytes {
			break
		}
		if err := os.Remove(filepath.Join(dir, f.name)); err != nil {
			continue
		}
		total -= f.size
		removed++
	}
	return removed, nil
}
