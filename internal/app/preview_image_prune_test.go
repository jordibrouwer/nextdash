package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

/*
 * Deleting a bookmark leaves its cached picture behind, and the cap is what
 * eventually reaps it. That is bounded, unlike the icons store, where one
 * orphan per evicted inbox item accumulated forever -- but an install that
 * never fills the cap keeps them indefinitely, so emptying the trash is the
 * moment to sweep.
 *
 * Emptying the trash, not deleting the bookmark: a deleted bookmark is
 * restorable for 30 days, and taking its picture at that point is premature.
 * The check is by reference, because two bookmarks with the same URL share one
 * file -- the same reason removeUnusedIconFile exists.
 */
func TestPruneOrphanPreviewImagesKeepsWhatIsStillReferenced(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.MkdirAll(previewImageDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name string) {
		if err := os.WriteFile(filepath.Join(previewImageDir(), name), pngBytes(16), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("pi-kept.png")
	write("pi-kepticon.png")
	write("pi-orphan.png")

	h := &Handlers{store: NewStore()}
	page := h.store.GetPages()[0]
	if err := h.store.MutateBookmarksOnPage(page.ID, func(bookmarks []Bookmark) ([]Bookmark, error) {
		return append(bookmarks, Bookmark{Name: "Kept", URL: "https://kept.example"}), nil
	}); err != nil {
		t.Fatalf("add bookmark: %v", err)
	}

	// Two entries: one a live bookmark still points at, one nothing does.
	if err := h.mergePreviewCacheUpdates(map[string]BookmarkPreview{
		canonicalBookmarkURLKey("https://kept.example"): {
			URL:       "https://kept.example",
			FetchedAt: time.Now().UnixMilli(),
			Image:     "/data/preview-images/pi-kept.png",
			Icon:      "/data/preview-images/pi-kepticon.png",
		},
		canonicalBookmarkURLKey("https://deleted.example"): {
			URL:       "https://deleted.example",
			FetchedAt: time.Now().UnixMilli(),
			Image:     "/data/preview-images/pi-orphan.png",
		},
	}); err != nil {
		t.Fatalf("seed cache: %v", err)
	}

	removed := h.pruneOrphanPreviewImages()

	if removed != 1 {
		t.Errorf("removed = %d, want only the orphan", removed)
	}
	for _, name := range []string{"pi-kept.png", "pi-kepticon.png"} {
		if _, err := os.Stat(filepath.Join(previewImageDir(), name)); err != nil {
			t.Errorf("%s was swept but a bookmark still points at it", name)
		}
	}
	if _, err := os.Stat(filepath.Join(previewImageDir(), "pi-orphan.png")); !os.IsNotExist(err) {
		t.Error("the orphan survived the sweep")
	}
}

// A file nothing has claimed yet must not be swept out from under the worker
// that is about to rename onto it.
func TestPruneOrphanPreviewImagesLeavesTempFilesAlone(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.MkdirAll(previewImageDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewImageDir(), ".tmp-inflight"), pngBytes(16), 0o644); err != nil {
		t.Fatal(err)
	}

	h := &Handlers{store: NewStore()}
	if removed := h.pruneOrphanPreviewImages(); removed != 0 {
		t.Errorf("removed = %d, want a temp file left alone", removed)
	}
	if _, err := os.Stat(filepath.Join(previewImageDir(), ".tmp-inflight")); err != nil {
		t.Error("the in-flight temp file was swept")
	}
}
