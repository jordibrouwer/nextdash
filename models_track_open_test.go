package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestTrackBookmarkOpenIncrementsAtomically(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	page := PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Bookmarks: []Bookmark{
			{Name: "Example", URL: "https://example.com"},
		},
	}
	data, err := json.MarshalIndent(page, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "bookmarks-1.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	fs := &FileStore{dataDir: ResolveDataDir()}
	const opens = 50
	var wg sync.WaitGroup
	for i := 0; i < opens; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fs.TrackBookmarkOpen(1, 0); err != nil {
				t.Errorf("TrackBookmarkOpen failed: %v", err)
			}
		}()
	}
	wg.Wait()

	bookmarks := fs.GetBookmarksByPage(1)
	if len(bookmarks) != 1 {
		t.Fatalf("len = %d, want 1", len(bookmarks))
	}
	if bookmarks[0].OpenCount != opens {
		t.Fatalf("OpenCount = %d, want %d", bookmarks[0].OpenCount, opens)
	}
	if bookmarks[0].LastOpened == 0 {
		t.Fatal("expected LastOpened to be set")
	}
}

func TestTrackBookmarkOpenRejectsInvalidIndex(t *testing.T) {
	// Its own store: this one describes a fresh install, so it must not
	// inherit whatever an earlier test in the run left behind.
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	tmp := t.TempDir()
	t.Chdir(tmp)

	fs := &FileStore{dataDir: ResolveDataDir()}
	err := fs.TrackBookmarkOpen(1, 0)
	if err == nil {
		t.Fatal("expected error for missing page file")
	}
	if !errors.Is(err, ErrBookmarkNotFound) {
		t.Fatalf("expected ErrBookmarkNotFound, got %v", err)
	}
}
