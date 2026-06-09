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
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

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
	if err := os.MkdirAll("data", 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join("data", "bookmarks-1.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	fs := &FileStore{dataDir: "data"}
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
	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(wd) })

	fs := &FileStore{dataDir: "data"}
	err = fs.TrackBookmarkOpen(1, 0)
	if err == nil {
		t.Fatal("expected error for missing page file")
	}
	if !errors.Is(err, ErrBookmarkNotFound) {
		t.Fatalf("expected ErrBookmarkNotFound, got %v", err)
	}
}
