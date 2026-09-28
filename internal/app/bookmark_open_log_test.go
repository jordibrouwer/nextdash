package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeOpenLogTestPage(t *testing.T, bookmarks []Bookmark) *FileStore {
	t.Helper()
	tmp := t.TempDir()
	t.Chdir(tmp)
	page := PageWithBookmarks{Page: Page{ID: 1, Name: "main"}, Bookmarks: bookmarks}
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
	return &FileStore{dataDir: ResolveDataDir()}
}

func TestTrackBookmarkOpenRecordsWhen(t *testing.T) {
	fs := writeOpenLogTestPage(t, []Bookmark{{Name: "Example", URL: "https://example.com"}})
	before := time.Now().UnixMilli()
	for i := 0; i < 3; i++ {
		if err := fs.TrackBookmarkOpen(1, 0); err != nil {
			t.Fatal(err)
		}
	}
	got := fs.GetBookmarksByPage(1)[0].OpenLog
	if len(got) != 3 {
		t.Fatalf("OpenLog has %d entries, want 3", len(got))
	}
	for _, ts := range got {
		if ts < before {
			t.Fatalf("OpenLog entry %d is older than the opens", ts)
		}
	}
}

func TestOpenLogKeepsOnlyRecentOpens(t *testing.T) {
	now := time.Now().UnixMilli()
	day := int64(24 * time.Hour / time.Millisecond)
	old := now - (openLogMaxAgeDays+5)*day
	recent := now - 3*day
	log := pruneOpenLog([]int64{old, recent, now}, now)
	if len(log) != 2 || log[0] != recent || log[1] != now {
		t.Fatalf("pruneOpenLog = %v, want [%d %d]", log, recent, now)
	}

	many := make([]int64, 0, openLogMaxEntries+50)
	for i := 0; i < openLogMaxEntries+50; i++ {
		many = append(many, now-int64(openLogMaxEntries+50-i))
	}
	capped := pruneOpenLog(many, now)
	if len(capped) != openLogMaxEntries {
		t.Fatalf("capped to %d, want %d", len(capped), openLogMaxEntries)
	}
	if capped[len(capped)-1] != many[len(many)-1] {
		t.Fatal("the cap dropped the newest opens instead of the oldest")
	}
}

func TestPageSaveKeepsTheOpenLog(t *testing.T) {
	stored := []Bookmark{{Name: "Example", URL: "https://example.com", OpenCount: 2, OpenLog: []int64{1, 2}}}
	next := []Bookmark{{Name: "Renamed", URL: "https://example.com"}}
	carryServerOwnedBookmarkFields(next, stored)
	if len(next[0].OpenLog) != 2 {
		t.Fatalf("OpenLog after a save = %v, want the stored two", next[0].OpenLog)
	}
}

func TestMergingDuplicatesJoinsTheirOpenLogs(t *testing.T) {
	now := time.Now().UnixMilli()
	keeper := Bookmark{URL: "https://example.com", OpenLog: []int64{now - 30}}
	mergeBookmarkMetadata(&keeper, []Bookmark{{URL: "https://example.com", OpenLog: []int64{now - 40, now - 10}}})
	if len(keeper.OpenLog) != 3 || keeper.OpenLog[0] != now-40 || keeper.OpenLog[2] != now-10 {
		t.Fatalf("merged OpenLog = %v, want the three opens in order", keeper.OpenLog)
	}
}
