package app

import "testing"

/*
 * A store that lets a test slip one write in between a read and the write that
 * follows it.
 *
 * The archive writers read a page, edit the copy, and hand the whole slice back
 * -- so anything saved in between is overwritten by a slice that predates it.
 * That window is real but narrow, and a test that hunts it with goroutines is a
 * test that passes on a quiet machine. Reaching in through GetBookmarksByPage
 * makes it exact: the interleaving write happens once, at the only moment it
 * can do any harm.
 *
 * Under the fix the window is gone, because the read and the write happen
 * inside one MutateBookmarksOnPage call while the store holds its lock. So the
 * hook no longer fires -- which is the point, and why these tests assert what
 * survived rather than how it was written.
 */
type interleavingStore struct {
	Store
	onRead func(pageID int)
	fired  bool
}

func (s *interleavingStore) GetBookmarksByPage(pageID int) []Bookmark {
	out := s.Store.GetBookmarksByPage(pageID)
	if s.onRead != nil && !s.fired {
		s.fired = true
		s.onRead(pageID)
	}
	return out
}

// archiveTestPage puts one failing bookmark on a page and returns the page id.
func archiveTestPage(t *testing.T, store Store, url string) int {
	t.Helper()
	pages := store.GetPages()
	if len(pages) == 0 {
		t.Fatal("a fresh store has no pages to write to")
	}
	pageID := pages[0].ID
	if err := store.SaveBookmarksByPage(pageID, []Bookmark{
		{Name: "the dead one", URL: url, LastError: "404"},
	}); err != nil {
		t.Fatalf("seed the page: %v", err)
	}
	return pageID
}

func hasBookmark(bookmarks []Bookmark, url string) bool {
	for _, b := range bookmarks {
		if b.URL == url {
			return true
		}
	}
	return false
}

/*
 * The six-hourly backfill must not undo a bookmark saved while it was working.
 *
 * recordArchiveHistory read the page, stamped its copy, and wrote the whole
 * slice back -- outside the store lock every other write path holds. A bookmark
 * added in that window was silently gone, with nothing anywhere to say so.
 */
func TestRecordArchiveHistoryKeepsAWriteThatLandsMidRound(t *testing.T) {
	h := newTestHandlers(t)
	real := h.store
	const dead = "https://dead.example/gone"
	const added = "https://added.example/new"
	pageID := archiveTestPage(t, real, dead)

	var addErr error
	h.store = &interleavingStore{Store: real, onRead: func(pid int) {
		// The reader adds a bookmark while the round is in flight.
		addErr = real.AddBookmarkToPage(pid, Bookmark{Name: "just added", URL: added})
	}}

	h.recordArchiveHistory(pageID, dead, ArchiveHistory{
		DiedAt:   1700000000000,
		Snapshot: archiveSnapshot{URL: "https://web.archive.org/web/1/" + dead, Available: true},
	}, true)

	if addErr != nil {
		t.Fatalf("the interleaving add failed, so nothing was tested: %v", addErr)
	}

	after := real.GetBookmarksByPage(pageID)
	if !hasBookmark(after, added) {
		t.Error("the bookmark added while the backfill was working was overwritten")
	}

	// And the round still did its job, rather than passing by doing nothing.
	var stamped bool
	for _, b := range after {
		if b.URL == dead && b.ArchiveCheckedAt != 0 && b.ArchiveSnapshotURL != "" {
			stamped = true
		}
	}
	if !stamped {
		t.Error("the archive history was not written onto the bookmark it was about")
	}
}

/*
 * The same window, on the request path rather than the timer.
 *
 * recordArchiveJob walks every page and does the same read-edit-write per page,
 * so one Save Page Now request could drop a write on any of them.
 */
func TestRecordArchiveJobKeepsAWriteThatLandsMidRound(t *testing.T) {
	h := newTestHandlers(t)
	real := h.store
	const target = "https://dead.example/gone"
	const added = "https://added.example/new"
	pageID := archiveTestPage(t, real, target)

	var addErr error
	h.store = &interleavingStore{Store: real, onRead: func(pid int) {
		addErr = real.AddBookmarkToPage(pid, Bookmark{Name: "just added", URL: added})
	}}

	h.recordArchiveJob(target, "spn2-abc123")

	if addErr != nil {
		t.Fatalf("the interleaving add failed, so nothing was tested: %v", addErr)
	}

	after := real.GetBookmarksByPage(pageID)
	if !hasBookmark(after, added) {
		t.Error("the bookmark added while the capture was recorded was overwritten")
	}

	var stamped bool
	for _, b := range after {
		if b.URL == target && b.ArchiveJobID == "spn2-abc123" {
			stamped = true
		}
	}
	if !stamped {
		t.Error("the capture receipt was not written onto the bookmark it was about")
	}
}
