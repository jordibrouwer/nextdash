package app

import "testing"

// The dashboard saves a page by sending the whole list back, and that list is
// whatever the browser had. Everything the server writes on its own is missing
// from it — so without carrying those fields over, an ordinary edit is a reset.
func TestAPageSaveKeepsWhatTheBrowserCannotSee(t *testing.T) {
	stored := []Bookmark{{
		Name: "GitHub", URL: "https://github.com",
		OpenCount: 12, LastOpened: 1_700_000_000_000, CreatedAt: 1_600_000_000_000,
		LastChecked: 1_700_000_100_000, LastError: "timeout",
		PreviewTitle: "GitHub", PreviewDesc: "Where the world builds software",
		PreviewImage: "https://github.com/og.png", CertHost: "github.com",
	}}
	// What the editor sends after someone changes the note: the fields the form
	// knows, and nothing else.
	next := []Bookmark{{Name: "GitHub", URL: "https://github.com", Note: "read the changelog"}}

	carryServerOwnedBookmarkFields(next, stored)

	got := next[0]
	if got.OpenCount != 12 || got.LastOpened != 1_700_000_000_000 {
		t.Fatalf("opens were reset: %d opens, last opened %d", got.OpenCount, got.LastOpened)
	}
	if got.CreatedAt != 1_600_000_000_000 {
		t.Fatalf("createdAt was reset to %d", got.CreatedAt)
	}
	if got.LastChecked != 1_700_000_100_000 || got.LastError != "timeout" {
		t.Fatalf("the last check was lost: %d / %q", got.LastChecked, got.LastError)
	}
	if got.PreviewTitle == "" || got.PreviewDesc == "" || got.PreviewImage == "" {
		t.Fatalf("the fetched preview was lost: %+v", got)
	}
	if got.CertHost != "github.com" {
		t.Fatalf("certHost was lost: %q", got.CertHost)
	}
	if got.Note != "read the changelog" {
		t.Fatalf("the edit itself did not survive: %q", got.Note)
	}
}

// A payload that does carry a value means it: an import brings its own counts,
// and a check writes its own result. Carrying over must never overrule that.
func TestAPageSaveThatCarriesAValueWins(t *testing.T) {
	stored := []Bookmark{{
		URL: "https://example.com", OpenCount: 12, LastError: "timeout",
		LastChecked: 1_700_000_000_000, PreviewDesc: "old",
	}}
	next := []Bookmark{{
		URL: "https://example.com", OpenCount: 3, LastChecked: 1_700_000_500_000,
		LastError: "", PreviewDesc: "new",
	}}

	carryServerOwnedBookmarkFields(next, stored)

	if next[0].OpenCount != 3 {
		t.Fatalf("a carried count was overwritten: %d", next[0].OpenCount)
	}
	if next[0].PreviewDesc != "new" {
		t.Fatalf("a carried description was overwritten: %q", next[0].PreviewDesc)
	}
	// A fresh check that found nothing wrong clears the error, because it says
	// so with a timestamp of its own.
	if next[0].LastError != "" {
		t.Fatalf("a clean check did not clear the error: %q", next[0].LastError)
	}
}

// A bookmark that was not on the page before has nothing to carry, and one
// whose URL changed is a different bookmark as far as this is concerned.
func TestAPageSaveCarriesNothingForANewURL(t *testing.T) {
	stored := []Bookmark{{URL: "https://old.example", OpenCount: 9}}
	next := []Bookmark{{URL: "https://new.example"}}

	carryServerOwnedBookmarkFields(next, stored)

	if next[0].OpenCount != 0 {
		t.Fatalf("a new URL inherited %d opens", next[0].OpenCount)
	}
}

// A tab sends back the opens and the check it loaded. Newer ones stored since
// -- an open on the phone, a failure the monitor found -- must not be undone by
// a drag on the desktop.
func TestAPageSaveKeepsNewerOpensAndChecks(t *testing.T) {
	stored := []Bookmark{{
		URL: "https://example.com", OpenCount: 5, LastOpened: 2_000, OpenLog: []int64{1_000, 1_500, 2_000},
		LastChecked: 9_000, LastError: "timeout", BrokenSince: 9_000,
	}}
	next := []Bookmark{{
		URL: "https://example.com", OpenCount: 2, LastOpened: 1_000, OpenLog: []int64{1_000},
		LastChecked: 5_000, LastError: "",
	}}
	carryServerOwnedBookmarkFields(next, stored)
	if next[0].OpenCount != 5 || next[0].LastOpened != 2_000 || len(next[0].OpenLog) != 3 {
		t.Fatalf("opens = %d %d %v, want the stored newer ones", next[0].OpenCount, next[0].LastOpened, next[0].OpenLog)
	}
	if next[0].LastError != "timeout" || next[0].BrokenSince != 9_000 || next[0].LastChecked != 9_000 {
		t.Fatalf("check = %q %d %d, want the stored newer failure", next[0].LastError, next[0].BrokenSince, next[0].LastChecked)
	}
}

// A tab loaded before a check sends its rows without the drift finding, its
// baseline and the archive's dates; stored as sent, they were wiped.
func TestCarryKeepsDriftAndArchiveBookkeeping(t *testing.T) {
	stored := []Bookmark{{
		URL: "https://shop.example", DriftURL: "https://shop.example/", DriftTitle: "Shop", DriftFingerprint: "abc",
		DriftNoticed: "host", DriftSince: 200, DriftReason: "Now redirects to parked.example",
		ArchiveDiedAt: 100, ArchiveSnapshotURL: "https://web.archive.org/x", ArchiveCheckedAt: 300,
		ArchiveJobID: "job-1", ArchiveJobAt: 300,
	}}
	next := []Bookmark{{URL: "https://shop.example", Name: "Shop, renamed"}}
	carryServerOwnedBookmarkFields(next, stored)
	got := next[0]
	if got.DriftNoticed != "host" || got.DriftURL == "" || got.DriftFingerprint != "abc" || got.DriftSince != 200 {
		t.Fatalf("drift lost: %+v", got)
	}
	if got.ArchiveDiedAt != 100 || got.ArchiveSnapshotURL == "" || got.ArchiveJobID != "job-1" {
		t.Fatalf("archive bookkeeping lost: %+v", got)
	}
}
