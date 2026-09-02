package app

import "testing"

// Every preview cached before this feature holds a remote URL in Image, and a
// card built from it would load that address straight from the third party.
// Moving it to ImageSource hands it to the fetcher instead; clearing Image
// means the card shows no picture until the local copy lands.
func TestNormalizePreviewCacheMovesRemoteURLsToTheSource(t *testing.T) {
	in := PreviewCacheFile{Cache: map[string]BookmarkPreview{
		"https://claude.ai": {
			URL:   "https://claude.ai",
			Image: "https://claude.ai/images/claude_ogimage.png",
			Icon:  "https://claude.ai/favicon.ico",
		},
	}}

	got := normalizePreviewCacheFile(in).Cache["https://claude.ai"]

	if got.Image != "" {
		t.Errorf("Image = %q, want it cleared", got.Image)
	}
	if got.ImageSource != "https://claude.ai/images/claude_ogimage.png" {
		t.Errorf("ImageSource = %q, want the old remote URL", got.ImageSource)
	}
	if got.Icon != "" {
		t.Errorf("Icon = %q, want it cleared", got.Icon)
	}
	if got.IconSource != "https://claude.ai/favicon.ico" {
		t.Errorf("IconSource = %q, want the old remote URL", got.IconSource)
	}
}

// A local path is already migrated and must survive untouched, or every restart
// would blank the cache and re-fetch everything it had just stored.
func TestNormalizePreviewCacheLeavesLocalPathsAlone(t *testing.T) {
	in := PreviewCacheFile{Cache: map[string]BookmarkPreview{
		"https://example.com": {
			URL:         "https://example.com",
			Image:       "/data/preview-images/pi-abc123.png",
			ImageSource: "https://example.com/og.png",
		},
	}}

	got := normalizePreviewCacheFile(in).Cache["https://example.com"]

	if got.Image != "/data/preview-images/pi-abc123.png" {
		t.Errorf("Image = %q, want it kept", got.Image)
	}
	if got.ImageSource != "https://example.com/og.png" {
		t.Errorf("ImageSource = %q, want it kept", got.ImageSource)
	}
}

// A bare bookmark icon filename is a data/icons/ name, not a remote address,
// and predates this feature the same way. It is not ours to move.
func TestNormalizePreviewCacheLeavesStoredIconNamesAlone(t *testing.T) {
	in := PreviewCacheFile{Cache: map[string]BookmarkPreview{
		"https://example.com": {URL: "https://example.com", Icon: "icon-abc123.png"},
	}}

	got := normalizePreviewCacheFile(in).Cache["https://example.com"]

	if got.Icon != "icon-abc123.png" {
		t.Errorf("Icon = %q, want a stored icon name kept", got.Icon)
	}
	if got.IconSource != "" {
		t.Errorf("IconSource = %q, want it left empty", got.IconSource)
	}
}

func TestNormalizePreviewCacheHandlesAnEmptyFile(t *testing.T) {
	got := normalizePreviewCacheFile(PreviewCacheFile{})
	if got.Cache == nil {
		t.Error("Cache is nil, want an empty map callers can write into")
	}
}
