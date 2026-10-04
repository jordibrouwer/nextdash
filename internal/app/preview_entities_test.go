package app

import (
	"os"
	"path/filepath"
	"testing"
)

// Preview text saved by an older version kept the page's HTML entities --
// "I&#039;m" -- and every screen that shows it printed them. They are read
// back as characters, from the bookmark files and from the preview cache.
func TestStoredPreviewEntitiesAreReadAsCharacters(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	page := `{"page":{"id":1,"name":"main"},"bookmarks":[{"name":"jordibrw.nl","url":"https://www.jordibrw.nl",` +
		`"previewTitle":"I&#039;m Jordi Brouwer. &#8211; Based in Leiden","previewDesc":"Fish &amp; chips"}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(page), 0o600); err != nil {
		t.Fatal(err)
	}
	cache := `{"cache":{"https://www.jordibrw.nl":{"url":"https://www.jordibrw.nl","title":"I&#039;m here","description":"A &amp; B"}}}`
	if err := os.WriteFile(filepath.Join(dir, "preview-cache.json"), []byte(cache), 0o600); err != nil {
		t.Fatal(err)
	}

	inbox := `{"version":1,"items":[{"id":"a","url":"https://www.jordibrw.nl","title":"I\u0026#039;m in","previewTitle":"I\u0026#039;m here","previewDesc":"A \u0026amp; B"}]}`
	if err := os.WriteFile(filepath.Join(dir, "inbox.json"), []byte(inbox), 0o600); err != nil {
		t.Fatal(err)
	}

	store := NewStore()
	got := store.GetBookmarksByPage(1)
	if len(got) != 1 {
		t.Fatalf("read %d bookmarks", len(got))
	}
	if got[0].PreviewTitle != "I'm Jordi Brouwer. – Based in Leiden" || got[0].PreviewDesc != "Fish & chips" {
		t.Errorf("bookmark preview = %q / %q", got[0].PreviewTitle, got[0].PreviewDesc)
	}

	items := store.(*FileStore).readInboxDataLocked().Items
	if len(items) != 1 || items[0].Title != "I'm in" || items[0].PreviewTitle != "I'm here" || items[0].PreviewDesc != "A & B" {
		t.Errorf("inbox = %+v", items)
	}

	entry := readPreviewCacheFile().Cache["https://www.jordibrw.nl"]
	if entry.Title != "I'm here" || entry.Description != "A & B" {
		t.Errorf("cache = %q / %q", entry.Title, entry.Description)
	}
}

// Decoded once: an inbox written since keeps its text as it is. Decoding on
// every read turned "&amp;nbsp;" into a space and "&param=" in a URL title
// into "¶m=".
func TestInboxTitlesAreNotDecodedTwice(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	inbox := `{"version":2,"items":[{"id":"a","url":"https://x.example/?id=1&param=2","title":"https://x.example/?id=1&param=2"},` +
		`{"id":"b","url":"https://y.example","title":"What is &nbsp;?"}]}`
	if err := os.WriteFile(filepath.Join(dir, "inbox.json"), []byte(inbox), 0o600); err != nil {
		t.Fatal(err)
	}
	items := NewStore().(*FileStore).readInboxDataLocked().Items
	if len(items) != 2 || items[0].Title != "https://x.example/?id=1&param=2" || items[1].Title != "What is &nbsp;?" {
		t.Fatalf("inbox = %+v", items)
	}
}
