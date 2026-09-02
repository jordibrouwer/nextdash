package app

import (
	"crypto/sha256"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

/*
 * Fetching preview media off the card's path.
 *
 * The card is drawn from what the preview call returns, so downloading an image
 * inside that call makes the card inherit the latency of the slowest host a
 * reader has ever saved -- seconds, or a timeout. Instead the preview comes back
 * with no picture, the download runs here, and the image is on the card at the
 * next hover.
 *
 * That is the trade the design took deliberately: the first hover on a bookmark
 * shows text only. One slow host can never hold up the UI.
 */

// previewMediaFetchDue answers whether an entry still has media worth fetching.
// An attempt stamps ImageFetchedAt whether or not it succeeded, so a source that
// 404s is left alone until the entry's TTL brings it round again.
func previewMediaFetchDue(entry BookmarkPreview) bool {
	wantImage := entry.ImageSource != "" && !previewMediaPresent(entry.Image)
	wantIcon := entry.IconSource != "" && !previewMediaPresent(entry.Icon)
	if !wantImage && !wantIcon {
		return false
	}
	if entry.ImageFetchedAt == 0 {
		return true
	}
	return time.Now().UnixMilli()-entry.ImageFetchedAt >= previewMediaTTLMs(entry.ImageSource+entry.IconSource)
}

/*
 * How long a fetched picture is left alone, spread per source.
 *
 * A flat week meant a herd. Everything cached in one go -- a fresh install, or
 * one press of "Refresh all link previews" -- expires in one go, and a week
 * later every bookmark in the collection reaches out to its site inside the
 * same window. Nothing breaks, but it is a burst of outbound traffic to a
 * hundred hosts at once for no reason.
 *
 * The offset is derived from the source address rather than drawn at random, so
 * it survives restarts: the same picture keeps the same slot instead of
 * drifting to a new one every time the process starts.
 */
const previewMediaTTLSpreadMs = int64(3 * 24 * 60 * 60 * 1000) // three days

func previewMediaTTLMs(source string) int64 {
	if source == "" {
		return previewCacheTTLMs
	}
	sum := sha256.Sum256([]byte(source))
	offset := int64(binary.BigEndian.Uint64(sum[:8]) % uint64(previewMediaTTLSpreadMs))
	return previewCacheTTLMs + offset
}

/*
 * previewMediaPresent answers whether a stored local path still has its file.
 *
 * A path on its own is not proof. Eviction deletes files without touching the
 * entries that name them, and an orphan sweep does the same -- so an entry can
 * name a picture that is no longer there. Checking only the field left the
 * image gone for good: the entry looked complete, so nothing ever re-fetched
 * it, and the claim that eviction costs one background download was false.
 */
func previewMediaPresent(localPath string) bool {
	if localPath == "" {
		return false
	}
	prefix := "/data/" + previewImageDirName + "/"
	name := strings.TrimPrefix(localPath, prefix)
	if name == localPath || name == "" || strings.Contains(name, "/") {
		return false
	}
	_, err := os.Stat(filepath.Join(previewImageDir(), name))
	return err == nil
}

// Small and lossy on purpose: this is decoration, and dropping a job under load
// costs one missing picture that the next hover asks for again. Blocking to
// enqueue is the thing being avoided.
const previewMediaQueueDepth = 64

type previewMediaJob struct {
	key       string
	entry     BookmarkPreview
	wantImage bool
	wantIcon  bool
}

/*
 * What the reader has actually asked to see.
 *
 * Fetching is worth doing only for something that will be drawn. With preview
 * cards switched off the rows still ask the server for their tooltip text, so
 * without this the pictures were fetched and stored for a card that never
 * opens — and "turn it off" was not an answer anyone could give.
 *
 * The card's row checklist is the finer control: unticking Image stops the
 * pictures while the site icon, which is part of the card's header rather than
 * one of the rows, carries on.
 */
func (h *Handlers) previewMediaWanted() (image bool, icon bool) {
	settings := h.store.GetSettings()
	if normalizeLinkPreviewMode(settings.LinkPreviewMode, settings.ShowLinkPreviewCards) == "off" {
		return false, false
	}
	parts := settings.LinkPreviewParts
	if parts == nil {
		return true, true
	}
	for _, part := range parts {
		if part == "image" {
			return true, true
		}
	}
	return false, true
}

var (
	previewMediaQueue     chan previewMediaJob
	previewMediaQueueOnce sync.Once
)

func (h *Handlers) startPreviewMediaWorkers() {
	previewMediaQueueOnce.Do(func() {
		previewMediaQueue = make(chan previewMediaJob, previewMediaQueueDepth)
		// Two, not one: a single slow host would otherwise stall every other
		// bookmark's image behind it. Not more, because this is background work
		// competing with the reader's own requests for the same outbound path.
		for i := 0; i < 2; i++ {
			go func() {
				for job := range previewMediaQueue {
					h.runPreviewMediaJob(job)
				}
			}()
		}
	})
}

func (h *Handlers) queuePreviewMediaFetch(key string, entry BookmarkPreview) {
	if key == "" || !previewMediaFetchDue(entry) {
		return
	}
	wantImage, wantIcon := h.previewMediaWanted()
	if !wantImage && !wantIcon {
		return
	}
	h.startPreviewMediaWorkers()
	select {
	case previewMediaQueue <- previewMediaJob{key: key, entry: entry, wantImage: wantImage, wantIcon: wantIcon}:
	default:
		// Full. The next hover asks again.
	}
}

func (h *Handlers) runPreviewMediaJob(job previewMediaJob) {
	entry := job.entry
	allowLocal := h.allowLocalBookmarks()

	if job.wantImage && entry.ImageSource != "" && !previewMediaPresent(entry.Image) {
		if name, err := downloadPreviewImage(entry.ImageSource, allowLocal); err == nil && name != "" {
			entry.Image = "/data/" + previewImageDirName + "/" + name
		}
	}
	if job.wantIcon && entry.IconSource != "" && !previewMediaPresent(entry.Icon) {
		if name, err := downloadPreviewIcon(entry.IconSource, allowLocal); err == nil && name != "" {
			entry.Icon = "/data/" + previewImageDirName + "/" + name
		}
	}
	// Stamped even when both failed: that is what stops the retry loop.
	entry.ImageFetchedAt = time.Now().UnixMilli()

	_ = h.mergePreviewCacheUpdates(map[string]BookmarkPreview{job.key: entry})
	_, _ = evictPreviewImages(h.previewImageCapBytes())
}
