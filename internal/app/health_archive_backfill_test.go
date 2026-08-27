package app

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// Only failing bookmarks are asked about: a working link has no death to date,
// and asking about every bookmark would spend the budget on pages that are fine.
func TestArchiveBackfillOnlyAsksAboutFailingLinks(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name string
		bm   Bookmark
		want bool
	}{
		{"failing, never asked", Bookmark{URL: "https://x.example/", LastError: "404"}, true},
		{"working", Bookmark{URL: "https://x.example/"}, false},
		{"no url", Bookmark{LastError: "404"}, false},
		{"asked yesterday", Bookmark{
			URL: "https://x.example/", LastError: "404",
			ArchiveCheckedAt: now.Add(-24 * time.Hour).UnixMilli(),
		}, false},
		{"asked long ago", Bookmark{
			URL: "https://x.example/", LastError: "404",
			ArchiveCheckedAt: now.Add(-40 * 24 * time.Hour).UnixMilli(),
		}, true},
	}
	for _, tc := range cases {
		if got := archiveBackfillDue(tc.bm, now); got != tc.want {
			t.Errorf("%s: due = %v, want %v", tc.name, got, tc.want)
		}
	}
}

/*
A lookup that answers nothing still stamps the bookmark.

The stamp means "asked", not "answered". Without that, a URL the index has never
heard of would be retried on every single round, for ever -- which is exactly
the kind of quiet loop that turns a background job into a load problem.
*/
func TestArchiveBackfillStampsEvenWhenTheIndexSaysNothing(t *testing.T) {
	h := newTestHandlers(t)
	// A failing index, not an empty answer: an empty answer is a successful
	// lookup that found nothing, and the case that matters here is the one
	// where the lookup itself did not work. Without a stamp on that path, an
	// index that is down turns every round into a retry of everything.
	withCDXQueries(t, nil, nil, http.StatusInternalServerError)

	bookmarks := h.store.GetBookmarksByPage(1)
	bookmarks = append(bookmarks, Bookmark{
		Name: "Dead", URL: "https://dead.example/", PageID: 1, LastError: "404",
	})
	if err := h.store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatalf("save: %v", err)
	}

	if asked := h.BackfillArchiveHistory(context.Background()); asked == 0 {
		t.Fatal("asked about nothing although a link was failing")
	}

	var found bool
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.URL != "https://dead.example/" {
			continue
		}
		found = true
		if bm.ArchiveCheckedAt == 0 {
			t.Error("no stamp, so this URL would be asked again every round")
		}
		if bm.ArchiveDiedAt != 0 {
			t.Errorf("dated %d from an index that said nothing", bm.ArchiveDiedAt)
		}
	}
	if !found {
		t.Fatal("the bookmark disappeared")
	}
}

// What the index says lands on the bookmark, so the card and the row can read
// it without making a request of their own.
func TestArchiveBackfillRecordsTheDeathDate(t *testing.T) {
	h := newTestHandlers(t)
	withCDXQueries(t,
		[][]string{
			{"20240301120000", "http://dead.example/", "404", "d2"},
			{"20200601120000", "http://dead.example/", "404", "d1"},
			{"20190315120000", "http://dead.example/", "200", "d0"},
		},
		[][]string{{"20190315120000", "http://dead.example/", "200", "d0"}},
		http.StatusOK)

	bookmarks := append(h.store.GetBookmarksByPage(1), Bookmark{
		Name: "Dead", URL: "http://dead.example/", PageID: 1, LastError: "404",
	})
	if err := h.store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatalf("save: %v", err)
	}

	h.BackfillArchiveHistory(context.Background())

	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.URL != "http://dead.example/" {
			continue
		}
		want, _ := time.Parse("20060102150405", "20200601120000")
		if bm.ArchiveDiedAt != want.UnixMilli() {
			t.Errorf("archiveDiedAt = %d, want the first failing capture %d", bm.ArchiveDiedAt, want.UnixMilli())
		}
		if bm.ArchiveSnapshotURL == "" {
			t.Error("no snapshot recorded, so the card has nothing to offer")
		}
		return
	}
	t.Fatal("the bookmark disappeared")
}

/*
One round is bounded.

A dashboard where fifty links broke at once must not open fifty queries against
an index that takes upwards of ten seconds each -- that is a self-inflicted
outage dressed as a background job.
*/
func TestArchiveBackfillIsBounded(t *testing.T) {
	h := newTestHandlers(t)
	var asked int
	withCDXQueries(t, nil, nil, http.StatusOK)

	bookmarks := h.store.GetBookmarksByPage(1)
	for i := 0; i < archiveBackfillBudget*3; i++ {
		bookmarks = append(bookmarks, Bookmark{
			Name: fmt.Sprintf("Dead %d", i), PageID: 1, LastError: "404",
			URL: fmt.Sprintf("https://dead-%d.example/", i),
		})
	}
	if err := h.store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatalf("save: %v", err)
	}

	asked = h.BackfillArchiveHistory(context.Background())
	if asked > archiveBackfillBudget {
		t.Errorf("asked about %d in one round, want at most %d", asked, archiveBackfillBudget)
	}
	if asked == 0 {
		t.Error("asked about nothing")
	}
}
