package app

import (
	"context"
	"sync"
	"testing"
)

// A monitor added and re-checked while a round is running keeps that first
// sample: the sweep at the end of the round reads the bookmarks again rather
// than trusting the list it took when the round started.
func TestRunDueMonitorsKeepsASampleRecordedDuringTheRound(t *testing.T) {
	h := guardFixture(t)
	const added = "https://added-mid-round.example.com/"
	key := canonicalBookmarkURLKey(added)

	var once sync.Once
	h.pingHook = func(ctx context.Context, urlStr string, expect expectation) PingResult {
		once.Do(func() {
			err := h.store.MutateBookmarksOnPage(1, func(current []Bookmark) ([]Bookmark, error) {
				return append(current, Bookmark{Name: "Added", URL: added, Monitor: true, CheckStatus: true}), nil
			})
			if err != nil {
				t.Errorf("adding the bookmark: %v", err)
				return
			}
			h.recordManualHealthSample(key, true, 15, 200, "")
		})
		return reachable
	}
	h.runDueMonitors()

	if got := len(h.healthHistoryFor(key)); got != 1 {
		t.Fatalf("the re-check of the monitor added mid-round left %d samples, want 1", got)
	}
}
