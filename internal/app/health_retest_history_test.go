package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Retest all pings monitored bookmarks, but used to write only the scan cache.
// The monitor view is derived from sample history alone, so a retest left a
// freshly monitored row reading "awaiting first check" — the same defect the
// single-bookmark re-check had, reached through a different button.
func TestRetestAllRecordsMonitorSamples(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"` + target.URL + `","monitor":true,"monitorIntervalMinutes":15}
	]}`
	h, _ := healthTestStore(t, pageJSON)
	key := canonicalBookmarkURLKey(target.URL)

	if got := h.healthHistoryFor(key); len(got) != 0 {
		t.Fatalf("expected empty history to start with, got %d samples", len(got))
	}

	rec := httptest.NewRecorder()
	h.RetestAll(rec, httptest.NewRequest(http.MethodPost, "/api/health/retest-all", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("retest = %d, body = %s", rec.Code, rec.Body.String())
	}

	samples := h.healthHistoryFor(key)
	if len(samples) != 1 {
		t.Fatalf("expected one sample after a retest, got %d", len(samples))
	}
	if !samples[0].Up || samples[0].Code != http.StatusOK {
		t.Errorf("sample = %+v, want up with code 200", samples[0])
	}
	// The point of recording it: the row can now show uptime instead of
	// "awaiting first check".
	if buildMonitorStats(samples, 15, time.Now()) == nil {
		t.Error("expected monitor stats to be derivable after a retest")
	}
}

// "Retest all" must judge a bookmark by its own expectText, not the bare
// reachability rule — otherwise a monitored bookmark with a keyword check can
// look healthy again on the next retest even though the page still fails its
// own content check, until the monitor scheduler's own tick catches up.
func TestRetestAllHonoursExpectText(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html><body>Something else entirely</body></html>"))
	}))
	defer target.Close()

	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Watched","url":"` + target.URL + `","monitor":true,"expectText":"Expected Phrase"}
	]}`
	h, _ := healthTestStore(t, pageJSON)

	rec := httptest.NewRecorder()
	h.RetestAll(rec, httptest.NewRequest(http.MethodPost, "/api/health/retest-all", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("retest = %d, body = %s", rec.Code, rec.Body.String())
	}

	report := healthReportVia(t, h)
	var issue *HealthIssue
	for i := range report.Issues {
		if report.Issues[i].Name == "Watched" {
			issue = &report.Issues[i]
		}
	}
	if issue == nil {
		t.Fatal("bookmark missing from report")
	}
	if !isContentFailure(issue.LastError) {
		t.Errorf("lastError = %q, want a content-mismatch reason — expectText was ignored by the retest path", issue.LastError)
	}

	samples := h.healthHistoryFor(canonicalBookmarkURLKey(target.URL))
	if len(samples) != 1 || samples[0].Up {
		t.Errorf("samples = %+v, want one sample recorded as down for the failed content check", samples)
	}
}

func TestRetestAllRecordsOfflineMonitorSamples(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer target.Close()

	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"` + target.URL + `","monitor":true}
	]}`
	h, _ := healthTestStore(t, pageJSON)

	rec := httptest.NewRecorder()
	h.RetestAll(rec, httptest.NewRequest(http.MethodPost, "/api/health/retest-all", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("retest = %d, body = %s", rec.Code, rec.Body.String())
	}

	samples := h.healthHistoryFor(canonicalBookmarkURLKey(target.URL))
	if len(samples) != 1 {
		t.Fatalf("expected one sample, got %d", len(samples))
	}
	if samples[0].Up {
		t.Error("a failing retest was recorded as up")
	}
}

// History exists to serve the monitor view, so a periodic-only bookmark must not
// accumulate samples the report never reads.
func TestRetestAllSkipsHistoryForUnmonitoredBookmarks(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Periodic","url":"` + target.URL + `","checkStatus":true}
	]}`
	h, _ := healthTestStore(t, pageJSON)

	rec := httptest.NewRecorder()
	h.RetestAll(rec, httptest.NewRequest(http.MethodPost, "/api/health/retest-all", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("retest = %d, body = %s", rec.Code, rec.Body.String())
	}

	if got := h.healthHistoryFor(canonicalBookmarkURLKey(target.URL)); len(got) != 0 {
		t.Errorf("expected no history for a periodic-only bookmark, got %d samples", len(got))
	}
}

// Repeated retests must extend the history rather than replace it, or the
// heartbeat would never show more than the latest check.
func TestRetestAllAppendsAcrossRuns(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"` + target.URL + `","monitor":true}
	]}`
	h, _ := healthTestStore(t, pageJSON)

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		h.RetestAll(rec, httptest.NewRequest(http.MethodPost, "/api/health/retest-all", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("retest %d = %d, body = %s", i, rec.Code, rec.Body.String())
		}
	}

	if got := h.healthHistoryFor(canonicalBookmarkURLKey(target.URL)); len(got) != 2 {
		t.Errorf("expected two samples after two retests, got %d", len(got))
	}
}
