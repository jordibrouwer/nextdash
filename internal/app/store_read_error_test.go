package app

import (
	"os"
	"path/filepath"
	"testing"
)

// An inbox.json that cannot be decoded is not an empty inbox: the next add
// used to save that empty state over the file and lose every item in it.
func TestInboxAddRefusesUnreadableInbox(t *testing.T) {
	dir := t.TempDir()
	fs := &FileStore{settingsFile: filepath.Join(dir, "settings.json"), dataDir: dir}
	broken := []byte(`{"version":2,"items":[{"id":"a","url":"https://a.example"`)
	if err := os.WriteFile(fs.inboxFile(), broken, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fs.AddInboxLink(InboxLink{URL: "https://b.example/"}, true, 100); err == nil {
		t.Fatal("add on an unreadable inbox succeeded")
	}
	got, _ := os.ReadFile(fs.inboxFile())
	if string(got) != string(broken) {
		t.Fatalf("inbox.json was overwritten: %s", got)
	}
}

// Only a missing page file is a new page. A file that cannot be read was
// written back with no bookmarks when the pages were saved.
func TestSavePageRefusesUnreadablePageFile(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root reads a mode-0 file")
	}
	dir := t.TempDir()
	fs := &FileStore{settingsFile: filepath.Join(dir, "settings.json"), dataDir: dir}
	file := filepath.Join(dir, "bookmarks-1.json")
	if err := os.WriteFile(file, []byte(`{"id":1,"name":"P","bookmarks":[{"name":"A","url":"https://a.example"}]}`), 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(file, 0o644) })
	if err := fs.SavePage(Page{ID: 1, Name: "Renamed"}); err == nil {
		t.Fatal("SavePage on an unreadable file succeeded")
	}
	_ = os.Chmod(file, 0o644)
	if bms := fs.GetBookmarksByPage(1); len(bms) != 1 {
		t.Fatalf("bookmarks after SavePage = %d, want 1", len(bms))
	}
}
