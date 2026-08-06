package main

import (
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func newTrashTestStore(t *testing.T) *FileStore {
	t.Helper()
	dir := t.TempDir()
	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	store.initializeDefaultFiles()
	return store
}

func TestTrashAddAndList(t *testing.T) {
	store := newTrashTestStore(t)

	err := store.AddTrashedBookmarks([]TrashedBookmark{
		{PageID: 1, Index: 2, Bookmark: Bookmark{Name: "GitHub", URL: "https://github.com"}},
	})
	if err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}

	items := store.GetTrashItems()
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].ID == "" {
		t.Fatal("expected a generated id")
	}
	if items[0].DeletedAt == 0 {
		t.Fatal("expected deletedAt to be stamped")
	}
	if items[0].Index != 2 {
		t.Fatalf("index = %d, want 2", items[0].Index)
	}
	if items[0].Bookmark.URL != "https://github.com" {
		t.Fatalf("url = %q", items[0].Bookmark.URL)
	}
}

func TestTrashSkipsEmptyBookmarks(t *testing.T) {
	store := newTrashTestStore(t)

	// A bookmark with neither name nor URL carries nothing to restore.
	err := store.AddTrashedBookmarks([]TrashedBookmark{
		{PageID: 1, Bookmark: Bookmark{}},
		{PageID: 1, Bookmark: Bookmark{Name: "Real", URL: "https://real.example"}},
	})
	if err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}

	items := store.GetTrashItems()
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1 (empty entry should be skipped)", len(items))
	}
	if items[0].Bookmark.Name != "Real" {
		t.Fatalf("kept the wrong entry: %q", items[0].Bookmark.Name)
	}
}

func TestTrashListIsNewestFirst(t *testing.T) {
	store := newTrashTestStore(t)

	now := time.Now().UnixMilli()
	err := store.AddTrashedBookmarks([]TrashedBookmark{
		{PageID: 1, DeletedAt: now - 5000, Bookmark: Bookmark{Name: "older", URL: "https://a.example"}},
		{PageID: 1, DeletedAt: now, Bookmark: Bookmark{Name: "newer", URL: "https://b.example"}},
	})
	if err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}

	items := store.GetTrashItems()
	if len(items) != 2 {
		t.Fatalf("items len = %d", len(items))
	}
	if items[0].Bookmark.Name != "newer" {
		t.Fatalf("first item = %q, want newer", items[0].Bookmark.Name)
	}
}

func TestTakeTrashItemRemovesIt(t *testing.T) {
	store := newTrashTestStore(t)

	if err := store.AddTrashedBookmarks([]TrashedBookmark{
		{PageID: 1, Index: 0, Bookmark: Bookmark{Name: "One", URL: "https://one.example"}},
		{PageID: 1, Index: 1, Bookmark: Bookmark{Name: "Two", URL: "https://two.example"}},
	}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}

	items := store.GetTrashItems()
	target := items[0]

	taken, err := store.TakeTrashItem(target.ID)
	if err != nil {
		t.Fatalf("TakeTrashItem: %v", err)
	}
	if taken.ID != target.ID {
		t.Fatalf("took id %q, want %q", taken.ID, target.ID)
	}
	if taken.Bookmark.URL != target.Bookmark.URL {
		t.Fatalf("took the wrong bookmark: %q", taken.Bookmark.URL)
	}

	remaining := store.GetTrashItems()
	if len(remaining) != 1 {
		t.Fatalf("remaining = %d, want 1", len(remaining))
	}
	if remaining[0].ID == target.ID {
		t.Fatal("taken item is still in the trash")
	}

	if _, err := store.TakeTrashItem(target.ID); err != ErrTrashItemNotFound {
		t.Fatalf("second take error = %v, want ErrTrashItemNotFound", err)
	}
}

func TestTakeTrashItemUnknownID(t *testing.T) {
	store := newTrashTestStore(t)

	if _, err := store.TakeTrashItem("trs_nope"); err != ErrTrashItemNotFound {
		t.Fatalf("err = %v, want ErrTrashItemNotFound", err)
	}
}

func TestEmptyTrash(t *testing.T) {
	store := newTrashTestStore(t)

	if err := store.AddTrashedBookmarks([]TrashedBookmark{
		{PageID: 1, Bookmark: Bookmark{Name: "One", URL: "https://one.example"}},
		{PageID: 1, Bookmark: Bookmark{Name: "Two", URL: "https://two.example"}},
	}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}

	count, err := store.EmptyTrash()
	if err != nil {
		t.Fatalf("EmptyTrash: %v", err)
	}
	if count != 2 {
		t.Fatalf("count = %d, want 2", count)
	}
	if len(store.GetTrashItems()) != 0 {
		t.Fatal("expected an empty trash")
	}

	// Emptying an already-empty trash reports zero rather than failing.
	count, err = store.EmptyTrash()
	if err != nil {
		t.Fatalf("EmptyTrash on empty: %v", err)
	}
	if count != 0 {
		t.Fatalf("count = %d, want 0", count)
	}
}

func TestPruneTrashDropsExpiredItems(t *testing.T) {
	store := newTrashTestStore(t)

	now := time.Now()
	expired := now.Add(-trashRetention - time.Hour).UnixMilli()
	fresh := now.Add(-time.Hour).UnixMilli()

	if err := store.AddTrashedBookmarks([]TrashedBookmark{
		{PageID: 1, DeletedAt: expired, Bookmark: Bookmark{Name: "old", URL: "https://old.example"}},
		{PageID: 1, DeletedAt: fresh, Bookmark: Bookmark{Name: "fresh", URL: "https://fresh.example"}},
	}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}

	// The add itself prunes, so the expired item never lands.
	items := store.GetTrashItems()
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].Bookmark.Name != "fresh" {
		t.Fatalf("kept %q, want fresh", items[0].Bookmark.Name)
	}
}

func TestPruneTrashKeepsItemsInsideRetention(t *testing.T) {
	store := newTrashTestStore(t)

	// One hour inside the window must survive — an off-by-one on the cutoff
	// comparison would destroy bookmarks a day early.
	justInside := time.Now().Add(-trashRetention + time.Hour).UnixMilli()
	if err := store.AddTrashedBookmarks([]TrashedBookmark{
		{PageID: 1, DeletedAt: justInside, Bookmark: Bookmark{Name: "edge", URL: "https://edge.example"}},
	}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}

	removed, err := store.PruneTrash()
	if err != nil {
		t.Fatalf("PruneTrash: %v", err)
	}
	if removed != 0 {
		t.Fatalf("removed = %d, want 0", removed)
	}
	if len(store.GetTrashItems()) != 1 {
		t.Fatal("item inside retention was dropped")
	}
}

func TestPruneTrashReportsRemovedCount(t *testing.T) {
	store := newTrashTestStore(t)

	// Write an expired item directly, bypassing the prune that AddTrashedBookmarks
	// applies, so PruneTrash has something to find — this is the restart case.
	expired := time.Now().Add(-trashRetention - time.Hour).UnixMilli()
	store.mutex.Lock()
	err := store.saveTrashDataLocked(TrashData{
		Version: trashDataVersion,
		Items: []TrashedBookmark{
			{ID: "trs_a", DeletedAt: expired, PageID: 1, Bookmark: Bookmark{Name: "old", URL: "https://old.example"}},
			{ID: "trs_b", DeletedAt: time.Now().UnixMilli(), PageID: 1, Bookmark: Bookmark{Name: "new", URL: "https://new.example"}},
		},
	})
	store.mutex.Unlock()
	if err != nil {
		t.Fatalf("saveTrashDataLocked: %v", err)
	}

	removed, err := store.PruneTrash()
	if err != nil {
		t.Fatalf("PruneTrash: %v", err)
	}
	if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
	items := store.GetTrashItems()
	if len(items) != 1 || items[0].Bookmark.Name != "new" {
		t.Fatalf("unexpected remaining items: %+v", items)
	}
}

func TestTrashCapsAtMaxItems(t *testing.T) {
	store := newTrashTestStore(t)

	now := time.Now().UnixMilli()
	entries := make([]TrashedBookmark, 0, trashMaxItems+50)
	for i := 0; i < trashMaxItems+50; i++ {
		entries = append(entries, TrashedBookmark{
			PageID: 1,
			// Ascending timestamps so the newest are the highest-numbered.
			DeletedAt: now + int64(i),
			Bookmark:  Bookmark{Name: "b", URL: "https://example.com/" + strconv.Itoa(i)},
		})
	}
	if err := store.AddTrashedBookmarks(entries); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}

	items := store.GetTrashItems()
	if len(items) != trashMaxItems {
		t.Fatalf("items len = %d, want %d", len(items), trashMaxItems)
	}
	// The cap must drop the oldest, not the newest.
	if items[0].DeletedAt != now+int64(trashMaxItems+49) {
		t.Fatalf("newest item was dropped: first deletedAt = %d", items[0].DeletedAt)
	}
}
