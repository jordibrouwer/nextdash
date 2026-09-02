package app

import "testing"

// The preview cache owns cached media; a bookmark does not.
//
// Bookmarks carried a previewImage of their own, and it was the remote address:
// the card's shortcut path builds its picture straight from the bookmark
// without asking the server, so those bookmarks kept loading the third party
// after the cache was in place. Measured on a real store it was 21 of 108, next
// to 16 entries in the cache itself -- the bigger of the two leaks.
func TestStripBookmarkPreviewImagesClearsThemAll(t *testing.T) {
	bookmarks := []Bookmark{
		{Name: "remote", PreviewImage: "https://claude.ai/images/claude_ogimage.png", PreviewTitle: "Claude"},
		{Name: "insecure", PreviewImage: "http://example.com/og.png"},
		{Name: "already local", PreviewImage: "/data/preview-images/pi-abc.png"},
		{Name: "none", PreviewTitle: "kept"},
	}

	stripped := stripBookmarkPreviewImages(bookmarks)

	if stripped != 3 {
		t.Errorf("stripped = %d, want 3", stripped)
	}
	for _, bm := range bookmarks {
		if bm.PreviewImage != "" {
			t.Errorf("%s kept PreviewImage %q", bm.Name, bm.PreviewImage)
		}
	}
	// The text is the bookmark's own and is not what leaked.
	if bookmarks[0].PreviewTitle != "Claude" || bookmarks[3].PreviewTitle != "kept" {
		t.Error("the title was cleared, and only the image should have been")
	}
}

// applyPreviewToBookmark runs while the media fetch is still queued, so there is
// never a local path to write at that moment. Writing preview.Image there put
// the remote address back on the bookmark on every refresh.
func TestApplyPreviewToBookmarkDoesNotStoreAnImage(t *testing.T) {
	bm := Bookmark{PreviewImage: "https://claude.ai/images/claude_ogimage.png"}

	applyPreviewToBookmark(&bm, BookmarkPreview{
		Title:       "Claude",
		Description: "An AI assistant",
		ImageSource: "https://claude.ai/images/claude_ogimage.png",
	})

	if bm.PreviewImage != "" {
		t.Errorf("PreviewImage = %q, want the bookmark to hold no image", bm.PreviewImage)
	}
	if bm.PreviewTitle != "Claude" || bm.PreviewDesc != "An AI assistant" {
		t.Errorf("the text was not applied: %q / %q", bm.PreviewTitle, bm.PreviewDesc)
	}
}
