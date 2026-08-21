package main

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
