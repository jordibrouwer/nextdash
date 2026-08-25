package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

/*
The preview refresh walks the collection in batches.

It used to do the whole thing inside one request: one page fetch per bookmark,
measured at 1.3 seconds for eight, so a real collection is minutes with nothing
moving on screen and a proxy free to time it out halfway through.

With an offset and a total the caller can draw a real bar and every round trip is
short. Without an offset it still does the lot, because the extension and any
existing script expect that.
*/
func refreshPreviews(t *testing.T, h *Handlers, query string) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/previews/refresh"+query, nil)
	rec := httptest.NewRecorder()
	h.RefreshAllBookmarkPreviews(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh%s = %d: %s", query, rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body
}

func TestPreviewRefreshReportsItsPosition(t *testing.T) {
	h := newTestHandlers(t)

	// Enough bookmarks to need more than one batch.
	bookmarks := h.store.GetBookmarksByPage(1)
	for i := 0; i < 7; i++ {
		bookmarks = append(bookmarks, Bookmark{
			Name: fmt.Sprintf("B%d", i), URL: fmt.Sprintf("https://batch-%d.example/", i), PageID: 1,
		})
	}
	if err := h.store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatalf("save: %v", err)
	}

	first := refreshPreviews(t, h, "?offset=0&limit=3")
	total := int(first["total"].(float64))
	if total < 7 {
		t.Fatalf("total = %d, want every bookmark counted", total)
	}
	// The caller needs a position to draw a bar from, and to ask for the rest.
	if got := int(first["next"].(float64)); got != 3 {
		t.Errorf("next = %d, want 3", got)
	}
	if first["done"].(bool) {
		t.Error("claimed done on the first of several batches")
	}

	// The last batch says so, whatever the arithmetic on this side thinks.
	last := refreshPreviews(t, h, fmt.Sprintf("?offset=%d&limit=100", total-1))
	if !last["done"].(bool) {
		t.Error("the final batch did not report itself done")
	}
	if got := int(last["next"].(float64)); got != total {
		t.Errorf("next = %d past the end, want %d", got, total)
	}
}

// An offset past the end is an answer, not a crash: a collection can shrink
// under a long walk.
func TestPreviewRefreshHandlesAnOffsetPastTheEnd(t *testing.T) {
	h := newTestHandlers(t)
	body := refreshPreviews(t, h, "?offset=9999&limit=5")
	if !body["done"].(bool) {
		t.Error("an offset past the end did not report done")
	}
	if got := int(body["refreshed"].(float64)); got != 0 {
		t.Errorf("refreshed %d past the end", got)
	}
}

// No offset keeps the old behaviour, which the extension and existing scripts
// still call.
func TestPreviewRefreshWithoutAnOffsetDoesEverything(t *testing.T) {
	h := newTestHandlers(t)
	body := refreshPreviews(t, h, "")
	total := int(body["total"].(float64))
	if !body["done"].(bool) {
		t.Error("a full run did not report done")
	}
	if got := int(body["refreshed"].(float64)); got != total {
		t.Errorf("refreshed %d of %d", got, total)
	}
}
