package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Check mode and monitor interval were the only per-bookmark health settings
// that could be applied to several rows at once. Everything the expectations
// endpoint writes was strictly one bookmark per request, so muting twelve
// during a known outage was twelve dialogs.
func TestBulkExpectationsChangesOnlyWhatItIsGiven(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	h := &Handlers{store: NewStore()}

	if err := h.store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "A", URL: "https://a.test", ExpectText: "welcome", ExpectStatus: "200", WatchDrift: true},
		{Name: "B", URL: "https://b.test", ExpectText: "hello"},
	}); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{
		"targets": []map[string]any{
			{"pageId": 1, "index": 0, "url": "https://a.test"},
			{"pageId": 1, "index": 1, "url": "https://b.test"},
		},
		"notifyMuted": true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/health/expectations-bulk", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.SetBookmarkExpectationsBulk(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	stored := h.store.GetBookmarksByPage(1)
	for _, bm := range stored {
		if !bm.NotifyMuted {
			t.Fatalf("%s was not muted", bm.Name)
		}
	}
	// The fields the request said nothing about are untouched — sending these
	// through the single-bookmark endpoint, where everything replaces
	// everything, would have wiped them.
	if stored[0].ExpectText != "welcome" || stored[0].ExpectStatus != "200" || !stored[0].WatchDrift {
		t.Fatalf("bookmark A lost fields it was not asked about: %+v", stored[0])
	}
	if stored[1].ExpectText != "hello" {
		t.Fatalf("bookmark B lost its keyword: %+v", stored[1])
	}
}

// A row the report has gone stale on is skipped, not a failure that discards
// the rest of the batch.
func TestBulkExpectationsSkipsStaleTargets(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	h := &Handlers{store: NewStore()}
	if err := h.store.SaveBookmarksByPage(1, []Bookmark{{Name: "A", URL: "https://a.test"}}); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{
		"targets": []map[string]any{
			{"pageId": 1, "index": 0, "url": "https://a.test"},
			{"pageId": 1, "index": 0, "url": "https://moved.test"},
			{"pageId": 1, "index": 9, "url": "https://gone.test"},
		},
		"notifyMuted": true,
	})
	rec := httptest.NewRecorder()
	h.SetBookmarkExpectationsBulk(rec, httptest.NewRequest(http.MethodPost, "/x", bytes.NewReader(body)))

	var out struct {
		Changed int `json:"changed"`
		Skipped int `json:"skipped"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Changed != 1 || out.Skipped != 2 {
		t.Fatalf("changed/skipped = %d/%d, want 1/2", out.Changed, out.Skipped)
	}
}

// A request that names no field is a mistake worth reporting, not a no-op that
// looks like success.
func TestBulkExpectationsRejectsEmptyChange(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	h := &Handlers{store: NewStore()}
	body, _ := json.Marshal(map[string]any{
		"targets": []map[string]any{{"pageId": 1, "index": 0, "url": "https://a.test"}},
	})
	rec := httptest.NewRecorder()
	h.SetBookmarkExpectationsBulk(rec, httptest.NewRequest(http.MethodPost, "/x", bytes.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
