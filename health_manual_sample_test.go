package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// manualSampleHandlers sets up one monitored and one unmonitored bookmark.
func manualSampleHandlers(t *testing.T) *Handlers {
	t.Helper()
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"https://mon.example","monitor":true,"monitorIntervalMinutes":15},
		{"name":"Plain","url":"https://plain.example"},
		{"name":"Periodic","url":"https://per.example","checkStatus":true}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	return h
}

func postCacheScan(t *testing.T, h *Handlers, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/health/cache-scan", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.CacheScanResult(rec, req)
	return rec
}

// The bug this covers: pressing Re-check on a freshly monitored bookmark left
// the row reading "awaiting first check", because the monitor view is derived
// only from sample history and nothing but the scheduler wrote to it.
func TestCacheScanRecordsSampleForMonitoredBookmark(t *testing.T) {
	h := manualSampleHandlers(t)
	key := canonicalBookmarkURLKey("https://mon.example")

	if got := h.healthHistoryFor(key); len(got) != 0 {
		t.Fatalf("expected no history to start with, got %d samples", len(got))
	}

	rec := postCacheScan(t, h, `{"url":"https://mon.example","status":"online","pingMs":42,"code":200}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	samples := h.healthHistoryFor(key)
	if len(samples) != 1 {
		t.Fatalf("expected one sample, got %d", len(samples))
	}
	s := samples[0]
	if !s.Up || s.PingMs != 42 || s.Code != 200 {
		t.Errorf("sample = %+v, want up with ping 42 and code 200", s)
	}
	if s.T == 0 {
		t.Error("sample has no timestamp")
	}

	// The whole point: stats now exist, so the UI stops saying "awaiting first
	// check" the moment the user's own check finishes.
	if buildMonitorStats(samples, 15, time.Now()) == nil {
		t.Error("expected monitor stats to be derivable after a manual check")
	}
}

func TestCacheScanRecordsOfflineSample(t *testing.T) {
	h := manualSampleHandlers(t)
	key := canonicalBookmarkURLKey("https://mon.example")

	rec := postCacheScan(t, h, `{"url":"https://mon.example","status":"offline","pingMs":0,"error":"HTTP 500","code":500}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	samples := h.healthHistoryFor(key)
	if len(samples) != 1 {
		t.Fatalf("expected one sample, got %d", len(samples))
	}
	if samples[0].Up {
		t.Error("an offline check was recorded as up")
	}
	if samples[0].Code != 500 {
		t.Errorf("code = %d, want 500", samples[0].Code)
	}
}

// History serves the monitor view only, so bookmarks nobody monitors must not
// accumulate samples the report will never read.
func TestCacheScanSkipsHistoryForUnmonitoredBookmarks(t *testing.T) {
	for _, url := range []string{"https://plain.example", "https://per.example"} {
		t.Run(url, func(t *testing.T) {
			h := manualSampleHandlers(t)
			rec := postCacheScan(t, h, `{"url":"`+url+`","status":"online","pingMs":10,"code":200}`)
			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
			}
			if got := h.healthHistoryFor(canonicalBookmarkURLKey(url)); len(got) != 0 {
				t.Errorf("expected no history for an unmonitored bookmark, got %d samples", len(got))
			}
		})
	}
}

func TestCacheScanAppendsRatherThanReplaces(t *testing.T) {
	h := manualSampleHandlers(t)
	key := canonicalBookmarkURLKey("https://mon.example")

	postCacheScan(t, h, `{"url":"https://mon.example","status":"online","pingMs":10,"code":200}`)
	postCacheScan(t, h, `{"url":"https://mon.example","status":"offline","pingMs":0,"code":503}`)

	samples := h.healthHistoryFor(key)
	if len(samples) != 2 {
		t.Fatalf("expected two samples, got %d", len(samples))
	}
	// Order matters: the heartbeat and incident derivation both assume samples
	// run oldest to newest.
	if !samples[0].Up || samples[1].Up {
		t.Errorf("samples out of order or wrong state: %+v", samples)
	}
}

func TestIsMonitoredURL(t *testing.T) {
	h := manualSampleHandlers(t)
	cases := []struct {
		url  string
		want bool
	}{
		{"https://mon.example", true},
		{"https://plain.example", false},
		{"https://per.example", false},
		{"https://nowhere.example", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := h.isMonitoredURL(canonicalBookmarkURLKey(tc.url)); got != tc.want {
			t.Errorf("isMonitoredURL(%q) = %v, want %v", tc.url, got, tc.want)
		}
	}
}
