package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const stampNow = int64(1_700_000_000_000)

func TestStampBookmarkUpdatedAtMarksContentChange(t *testing.T) {
	prev := []Bookmark{{Name: "Old", URL: "https://example.com", UpdatedAt: 100}}
	next := []Bookmark{{Name: "New", URL: "https://example.com"}}

	stampBookmarkUpdatedAt(prev, next, stampNow)

	if next[0].UpdatedAt != stampNow {
		t.Fatalf("renamed bookmark should be stamped, got %d", next[0].UpdatedAt)
	}
}

// The whole point of the fingerprint: a health check or an open must not read
// as an edit, or every monitored bookmark claims to change on every ping.
func TestStampBookmarkUpdatedAtIgnoresNonContentFields(t *testing.T) {
	prev := []Bookmark{{
		Name: "Same", URL: "https://example.com",
		UpdatedAt: 100, LastChecked: 1, LastOpened: 1, OpenCount: 1,
	}}
	next := []Bookmark{{
		Name: "Same", URL: "https://example.com",
		LastChecked: 999, LastOpened: 999, OpenCount: 42, LastError: "boom",
	}}

	stampBookmarkUpdatedAt(prev, next, stampNow)

	if next[0].UpdatedAt != 100 {
		t.Fatalf("status-only change must keep the stored stamp, got %d", next[0].UpdatedAt)
	}
}

func TestStampBookmarkUpdatedAtCarriesStampForUnchanged(t *testing.T) {
	prev := []Bookmark{{Name: "Same", URL: "https://example.com", UpdatedAt: 12345}}
	// A client that round-trips without updatedAt must not clear the history.
	next := []Bookmark{{Name: "Same", URL: "https://example.com"}}

	stampBookmarkUpdatedAt(prev, next, stampNow)

	if next[0].UpdatedAt != 12345 {
		t.Fatalf("unchanged bookmark should keep its stamp, got %d", next[0].UpdatedAt)
	}
}

func TestStampBookmarkUpdatedAtStampsNewBookmark(t *testing.T) {
	next := []Bookmark{{Name: "Fresh", URL: "https://fresh.example"}}

	stampBookmarkUpdatedAt(nil, next, stampNow)

	if next[0].UpdatedAt != stampNow {
		t.Fatalf("new bookmark should be stamped, got %d", next[0].UpdatedAt)
	}
}

func TestStampBookmarkUpdatedAtEachContentField(t *testing.T) {
	base := Bookmark{
		Name: "N", URL: "https://example.com", Shortcut: "N", Category: "c",
		Tags: []string{"a"}, Icon: "i.png", Note: "note",
	}
	cases := map[string]func(*Bookmark){
		"name":        func(b *Bookmark) { b.Name = "changed" },
		"shortcut":    func(b *Bookmark) { b.Shortcut = "ZZ" },
		"category":    func(b *Bookmark) { b.Category = "other" },
		"tags":        func(b *Bookmark) { b.Tags = []string{"a", "b"} },
		"icon":        func(b *Bookmark) { b.Icon = "other.png" },
		"note":        func(b *Bookmark) { b.Note = "different" },
		"pinned":      func(b *Bookmark) { b.Pinned = true },
		"checkStatus": func(b *Bookmark) { b.CheckStatus = true },
	}

	for field, mutate := range cases {
		t.Run(field, func(t *testing.T) {
			prev := []Bookmark{base}
			prev[0].UpdatedAt = 100
			changed := base
			mutate(&changed)
			next := []Bookmark{changed}

			stampBookmarkUpdatedAt(prev, next, stampNow)

			if next[0].UpdatedAt != stampNow {
				t.Fatalf("changing %s should stamp, got %d", field, next[0].UpdatedAt)
			}
		})
	}
}

// Reordering rewrites the whole page; only genuinely edited rows may be stamped.
func TestStampBookmarkUpdatedAtReorderDoesNotRestamp(t *testing.T) {
	prev := []Bookmark{
		{Name: "A", URL: "https://a.example", UpdatedAt: 1},
		{Name: "B", URL: "https://b.example", UpdatedAt: 2},
	}
	next := []Bookmark{
		{Name: "B", URL: "https://b.example"},
		{Name: "A", URL: "https://a.example"},
	}

	stampBookmarkUpdatedAt(prev, next, stampNow)

	if next[0].UpdatedAt != 2 || next[1].UpdatedAt != 1 {
		t.Fatalf("reorder must not restamp, got %d and %d", next[0].UpdatedAt, next[1].UpdatedAt)
	}
}

func TestSaveBookmarksByPageStampsOnlyEditedRows(t *testing.T) {
	dir := t.TempDir()
	fs := &FileStore{dataDir: dir}

	original := []Bookmark{
		{Name: "Keep", URL: "https://keep.example"},
		{Name: "Edit", URL: "https://edit.example"},
	}
	if err := fs.SaveBookmarksByPage(1, original); err != nil {
		t.Fatalf("seed: %v", err)
	}

	stored := readPageBookmarks(t, dir, 1)
	keepStamp := stored[0].UpdatedAt

	edited := []Bookmark{
		{Name: "Keep", URL: "https://keep.example", UpdatedAt: stored[0].UpdatedAt},
		{Name: "Edited name", URL: "https://edit.example", UpdatedAt: stored[1].UpdatedAt},
	}
	if err := fs.SaveBookmarksByPage(1, edited); err != nil {
		t.Fatalf("save: %v", err)
	}

	after := readPageBookmarks(t, dir, 1)
	if after[0].UpdatedAt != keepStamp {
		t.Fatalf("untouched bookmark was restamped: %d -> %d", keepStamp, after[0].UpdatedAt)
	}
	if after[1].UpdatedAt <= stored[1].UpdatedAt {
		t.Fatalf("edited bookmark should have a newer stamp, got %d", after[1].UpdatedAt)
	}
}

func TestAddBookmarkToPageStampsUpdatedAt(t *testing.T) {
	dir := t.TempDir()
	fs := &FileStore{dataDir: dir}

	if err := fs.AddBookmarkToPage(1, Bookmark{Name: "Fresh", URL: "https://fresh.example"}); err != nil {
		t.Fatalf("add: %v", err)
	}

	stored := readPageBookmarks(t, dir, 1)
	if len(stored) != 1 || stored[0].UpdatedAt == 0 {
		t.Fatalf("added bookmark should carry a stamp, got %+v", stored)
	}
}

// Existing installs have no updatedAt; omitempty must keep it out of the file
// rather than writing a misleading zero.
func TestBookmarkUpdatedAtOmittedWhenUnset(t *testing.T) {
	data, err := json.Marshal(Bookmark{Name: "N", URL: "https://example.com"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got := string(data); strings.Contains(got, "updatedAt") {
		t.Fatalf("unset updatedAt should be omitted, got %s", got)
	}
}

func readPageBookmarks(t *testing.T, dir string, pageID int) []Bookmark {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, "bookmarks-1.json"))
	if err != nil {
		t.Fatalf("read page %d: %v", pageID, err)
	}
	var page PageWithBookmarks
	if err := json.Unmarshal(raw, &page); err != nil {
		t.Fatalf("decode page %d: %v", pageID, err)
	}
	return page.Bookmarks
}
