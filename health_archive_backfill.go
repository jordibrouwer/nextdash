package main

import (
	"context"
	"strings"
	"time"
)

/*
When the web lost a page, recorded on the bookmark that points at it.

BrokenSince says when this install started seeing failures, which for a bookmark
added last week to a page that died in 2019 is "last week". True, and not the
fact anyone wants: the reader is looking at a row that says "broken since
Tuesday" about a page that has been gone for six years.

The index knows the difference, so a link that is failing gets asked once and
the answer is kept on the bookmark. Kept rather than fetched on demand because
the preview card is built from memory and never makes a request -- hovering a
row has to stay free, and that rule is worth more than a fresher number.
*/

const (
	// archiveBackfillTTL is how long an answer is trusted. A page that died in
	// 2019 did not die again this month, and the index gains captures for a
	// dead page slowly if at all.
	archiveBackfillTTL = 30 * 24 * time.Hour
	// archiveBackfillBudget bounds one round, so a dashboard where fifty links
	// broke at once does not open fifty index queries at a service that takes
	// upwards of ten seconds to answer.
	archiveBackfillBudget = 5
)

// archiveBackfillDue reports whether this bookmark should be asked about.
//
// Only failing ones: a working link has no death to date, and asking about
// every bookmark would spend the budget on pages that are fine.
func archiveBackfillDue(bm Bookmark, now time.Time) bool {
	if strings.TrimSpace(bm.URL) == "" || strings.TrimSpace(bm.LastError) == "" {
		return false
	}
	/*
	 * Only failures that say something about the page.
	 *
	 * A 403 from a bot check or a 429 from a rate limiter says this request did
	 * not get through, not that the page is gone -- and dating a live page's
	 * "death" from the archive would put "gone from the web since 2019" on a
	 * bookmark that opens fine in a browser. That is worse than saying nothing:
	 * it is confidently wrong, and it spends an expensive index query to be so.
	 */
	if failureIsUncertain(bm.LastError) {
		return false
	}
	if bm.ArchiveCheckedAt <= 0 {
		return true
	}
	return now.Sub(time.UnixMilli(bm.ArchiveCheckedAt)) > archiveBackfillTTL
}

/*
BackfillArchiveHistory asks the index about failing bookmarks that have not been
asked recently, and records what it learns.

Runs in the background and writes through the store, so a slow index never holds
up a check. A bookmark whose lookup fails is still stamped: the stamp means
"asked", not "answered", which is what stops a permanently unindexed URL being
retried on every round.
*/
func (h *Handlers) BackfillArchiveHistory(ctx context.Context) (asked int) {
	if ctx == nil {
		ctx = context.Background()
	}
	now := time.Now()

	type target struct {
		pageID int
		url    string
	}
	var targets []target
	seen := map[string]struct{}{}
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if !archiveBackfillDue(bm, now) {
				continue
			}
			key := canonicalBookmarkURLKey(bm.URL)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			targets = append(targets, target{pageID: page.ID, url: bm.URL})
			if len(targets) >= archiveBackfillBudget {
				break
			}
		}
		if len(targets) >= archiveBackfillBudget {
			break
		}
	}

	for _, t := range targets {
		if ctx.Err() != nil {
			return asked
		}
		history, err := h.lookupArchiveHistory(ctx, t.url)
		asked++
		// Stamped either way: "asked" is what stops a URL the index has nothing
		// on being retried every round.
		h.recordArchiveHistory(t.pageID, t.url, history, err == nil)
	}
	return asked
}

// recordArchiveHistory writes what the index said onto every bookmark with this
// address on the page.
func (h *Handlers) recordArchiveHistory(pageID int, url string, history ArchiveHistory, answered bool) {
	key := canonicalBookmarkURLKey(url)
	bookmarks := h.store.GetBookmarksByPage(pageID)
	changed := false
	for i := range bookmarks {
		if canonicalBookmarkURLKey(bookmarks[i].URL) != key {
			continue
		}
		bookmarks[i].ArchiveCheckedAt = time.Now().UnixMilli()
		if answered {
			bookmarks[i].ArchiveDiedAt = history.DiedAt
			bookmarks[i].ArchiveSnapshotURL = history.Snapshot.URL
		}
		changed = true
	}
	if !changed {
		return
	}
	_ = h.store.SaveBookmarksByPage(pageID, bookmarks)
}

// archiveBackfillInterval is how often the round runs. Slow on purpose: the
// answer changes on the timescale of the web, and the index is expensive to ask.
const archiveBackfillInterval = 6 * time.Hour

/*
StartArchiveBackfillScheduler dates dead links in the background until stop is
closed.

Its own scheduler rather than a step inside the feed poller: they answer
unrelated questions on unrelated timescales, and one that fails should not stop
the other.
*/
func (h *Handlers) StartArchiveBackfillScheduler(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(archiveBackfillInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
				h.BackfillArchiveHistory(ctx)
				cancel()
			}
		}
	}()
}
