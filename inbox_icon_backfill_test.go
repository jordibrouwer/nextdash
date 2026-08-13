package main

import (
	"testing"
	"time"
)

// The startup favicon backfill skips items it has already tried.
//
// Without a record of the attempt, an item whose fetch legitimately fails —
// a 404, a site with no favicon, a dead domain — keeps Icon empty and is
// therefore indistinguishable from one that was never tried. Every restart then
// re-ran the same doomed fetches, forever, for every such item.
//
// IconFetchedAt is stamped on the attempt rather than on success, which is the
// distinction that makes the skip correct: "we looked" is the fact worth
// storing, not "we found something".

func TestBackfillSkipsItemsAlreadyAttempted(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)

	tried := InboxLink{
		ID: "inl_tried", URL: "https://no-favicon.example",
		AddedAt: time.Now().UnixMilli(), IconFetchedAt: time.Now().UnixMilli(),
	}
	untried := InboxLink{
		ID: "inl_untried", URL: "https://fresh.example",
		AddedAt: time.Now().UnixMilli(),
	}
	for _, link := range []InboxLink{tried, untried} {
		if _, _, err := h.store.AddInboxLink(link, false, 500); err != nil {
			t.Fatalf("seed %s: %v", link.ID, err)
		}
	}

	// Calls the loop's own predicate, not a copy of it: a test that restates the
	// rule passes whether or not the loop still applies it, which is exactly the
	// failure this is meant to catch.
	for _, item := range h.store.GetInboxItems() {
		switch item.ID {
		case "inl_tried":
			if inboxItemNeedsIconFetch(item) {
				t.Error("an item that was already attempted would be fetched again on every restart")
			}
		case "inl_untried":
			if !inboxItemNeedsIconFetch(item) {
				t.Error("an item that was never attempted was skipped")
			}
		}
	}
}

// An item that already has an icon is skipped regardless of the stamp, which is
// the pre-existing behaviour and must survive the change.
func TestBackfillSkipsItemsThatAlreadyHaveAnIcon(t *testing.T) {
	item := InboxLink{ID: "inl_has", URL: "https://a.example", Icon: "icon-abc.png"}
	if inboxItemNeedsIconFetch(item) {
		t.Error("an item with a stored icon would be re-fetched")
	}
}

// An item with no URL has nothing to fetch from.
func TestBackfillSkipsItemsWithoutAURL(t *testing.T) {
	if inboxItemNeedsIconFetch(InboxLink{ID: "inl_nourl"}) {
		t.Error("an item without a URL was queued for a favicon fetch")
	}
}

// The stamp survives a round trip through the store, or the skip would reset
// on the next read and the retry loop would come back.
func TestIconFetchedAtPersists(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	created, _, err := h.store.AddInboxLink(
		InboxLink{URL: "https://a.example", AddedAt: time.Now().UnixMilli()}, false, 500)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	stamp := time.Now().UnixMilli()
	if _, err := h.store.UpdateInboxLink(created.ID, func(link *InboxLink) error {
		link.IconFetchedAt = stamp
		return nil
	}); err != nil {
		t.Fatalf("stamp: %v", err)
	}

	for _, item := range h.store.GetInboxItems() {
		if item.ID == created.ID {
			if item.IconFetchedAt != stamp {
				t.Errorf("IconFetchedAt did not survive the round trip: got %d, want %d",
					item.IconFetchedAt, stamp)
			}
			return
		}
	}
	t.Error("item not found after stamping")
}
