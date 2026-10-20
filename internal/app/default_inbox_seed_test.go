package app

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A fresh install has ten links waiting in its Inbox, unread, and none of them
// is on the starter pages: the Inbox is for what is not yet in the collection.
func TestFreshInstallSeedsTheInbox(t *testing.T) {
	useDemoSeed(t)
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	store := NewStore()

	items := store.GetInboxItems()
	if len(items) != 10 {
		t.Fatalf("starter inbox has %d links, want 10", len(items))
	}
	onPages := map[string]bool{}
	hostsOnPages := map[string]bool{}
	for _, page := range defaultSeedPages() {
		for _, b := range page.Bookmarks {
			onPages[canonicalBookmarkURLKey(b.URL)] = true
			hostsOnPages[inboxDomainFromURL(b.URL)] = true
		}
	}
	seen := map[string]bool{}
	for _, item := range items {
		if item.ReadAt != 0 || item.SnoozedUntil != 0 {
			t.Errorf("%s is not unread", item.URL)
		}
		if item.Title == "" || item.PreviewDesc == "" || item.Domain == "" || item.AddedAt == 0 {
			t.Errorf("%s is missing its title, description, domain or date: %+v", item.URL, item)
		}
		key := canonicalBookmarkURLKey(item.URL)
		if onPages[key] {
			t.Errorf("%s is already on a starter page", item.URL)
		}
		if hostsOnPages[item.Domain] {
			t.Errorf("%s: its site is already on a starter page", item.URL)
		}
		if seen[key] {
			t.Errorf("%s is in the inbox twice", item.URL)
		}
		seen[key] = true
		if !isStarterInboxLink(item) {
			t.Errorf("%s is not recognised as a starter link (id %q)", item.URL, item.ID)
		}
	}
}

// The minimal seed has no inbox, and an inbox that is already there is never
// written over.
func TestStarterInboxStaysOutOfTheWay(t *testing.T) {
	t.Setenv("NEXTDASH_SEED", "minimal")
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if n := len(NewStore().GetInboxItems()); n != 0 {
		t.Fatalf("the minimal seed has %d inbox links", n)
	}

	useDemoSeed(t)
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	fs := NewStore().(*FileStore)
	if err := fs.ResetAllData(); err != nil {
		t.Fatal(err)
	}
	if n := len(fs.GetInboxItems()); n != 10 {
		t.Fatalf("after a reset the inbox has %d links, want 10", n)
	}
	// Seeded again over an inbox with something in it: nothing changes.
	mine, _, err := fs.AddInboxLink(InboxLink{URL: "https://mine.example/read-me", Title: "Mine"}, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	fs.seedStarterInbox(time.Now())
	if n := len(fs.GetInboxItems()); n != 11 {
		t.Fatalf("seeding over an inbox changed it: %d links, want 11 (%s)", n, mine.ID)
	}
}

// Start empty takes the starter links out of the Inbox too, but not one the
// reader has read, and not one they saved themselves.
func TestStartEmptyClearsTheStarterInbox(t *testing.T) {
	useDemoSeed(t)
	h := newTestHandlers(t)
	if err := h.store.ResetAllData(); err != nil {
		t.Fatal(err)
	}
	items := h.store.GetInboxItems()
	if len(items) != 10 {
		t.Fatalf("starter inbox has %d links before, want 10", len(items))
	}
	read := items[0].ID
	if _, err := h.store.UpdateInboxLink(read, func(l *InboxLink) error { l.ReadAt = time.Now().UnixMilli(); return nil }); err != nil {
		t.Fatal(err)
	}
	mine, _, err := h.store.AddInboxLink(InboxLink{URL: "https://mine.example/later", Title: "Mine"}, false, 0)
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	h.StartEmptyOnboarding(rec, httptest.NewRequest("POST", "/api/onboarding/start-empty", strings.NewReader("{}")))
	if rec.Code != 200 {
		t.Fatalf("start-empty: %d %s", rec.Code, rec.Body.String())
	}
	left := map[string]bool{}
	for _, item := range h.store.GetInboxItems() {
		left[item.ID] = true
	}
	if len(left) != 2 || !left[read] || !left[mine.ID] {
		t.Fatalf("inbox after start empty = %v, want the read starter link and the reader's own", left)
	}
}
