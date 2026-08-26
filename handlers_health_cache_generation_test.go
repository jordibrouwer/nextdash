package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

/*
A bookmark added is a report rebuilt.

The report is kept for three minutes so that a dashboard load does not walk
every bookmark. That window used to be the only thing consulted, and a dozen
write paths each invalidated by hand -- so adding a bookmark, which did not,
left the header badge and the health widget quoting figures from before it
existed. The store counts its writes now and the cache checks that count, so
this holds for every write path rather than for the ones somebody remembered.
*/
func TestHealthReportSeesABookmarkAddedAfterItWasBuilt(t *testing.T) {
	h := newTestHandlers(t)

	summaryNow := func() HealthSummary {
		req := httptest.NewRequest(http.MethodGet, "/api/bookmark-health?view=facts", nil)
		rec := httptest.NewRecorder()
		h.GetBookmarkHealth(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		var body struct {
			Summary HealthSummary `json:"summary"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body.Summary
	}

	// Warm the cache, exactly as a dashboard load does.
	before := summaryNow()

	if err := h.store.AddBookmarkToPage(1, Bookmark{
		Name: "Dead", URL: "http://127.0.0.1:9/gone",
		LastError: "Connection refused", CheckStatus: true,
	}); err != nil {
		t.Fatal(err)
	}

	after := summaryNow()
	if after.TotalBookmarks != before.TotalBookmarks+1 {
		t.Errorf("total = %d, want %d — the cached report outlived the write",
			after.TotalBookmarks, before.TotalBookmarks+1)
	}
	if after.BrokenCount <= before.BrokenCount {
		t.Errorf("broken = %d, was %d — the new dead link was not counted",
			after.BrokenCount, before.BrokenCount)
	}
}

// And a read that changes nothing still comes from the cache: the generation
// only moves on a write, so this must not have turned the TTL into a no-op.
func TestHealthReportIsStillReusedWhenNothingChanged(t *testing.T) {
	h := newTestHandlers(t)
	ask := func() {
		req := httptest.NewRequest(http.MethodGet, "/api/bookmark-health?view=facts", nil)
		h.GetBookmarkHealth(httptest.NewRecorder(), req)
	}
	ask()
	h.healthReportMu.RLock()
	first := h.healthReportAt
	h.healthReportMu.RUnlock()

	ask()
	h.healthReportMu.RLock()
	second := h.healthReportAt
	h.healthReportMu.RUnlock()

	if !first.Equal(second) {
		t.Error("the report was rebuilt although no write had happened")
	}
}
