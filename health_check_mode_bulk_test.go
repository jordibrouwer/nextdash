package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSetAllCheckModesTurnsEverythingOff(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"https://mon.example","monitor":true,"monitorIntervalMinutes":5},
		{"name":"Periodic","url":"https://per.example","checkStatus":true},
		{"name":"Both","url":"https://both.example","monitor":true,"checkStatus":true},
		{"name":"Plain","url":"https://plain.example"}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	before := h.countCheckedBookmarks()
	if before.Changed != 3 {
		t.Fatalf("expected 3 bookmarks with checking on, got %d", before.Changed)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/health/check-mode-all", strings.NewReader(`{"mode":"off"}`))
	rec := httptest.NewRecorder()
	h.SetAllCheckModes(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Changed  int `json:"changed"`
		Periodic int `json:"periodic"`
		Monitor  int `json:"monitor"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	// Counts describe what was turned off, so they reflect the pre-change state.
	if body.Changed != 3 || body.Monitor != 2 || body.Periodic != 2 {
		t.Errorf("unexpected counts: %#v", body)
	}

	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.Monitor || bm.CheckStatus {
			t.Errorf("%s still has checking enabled: monitor=%v checkStatus=%v", bm.Name, bm.Monitor, bm.CheckStatus)
		}
		if bm.MonitorIntervalMinutes != 0 {
			t.Errorf("%s kept a monitor interval: %d", bm.Name, bm.MonitorIntervalMinutes)
		}
	}
	if after := h.countCheckedBookmarks(); after.Changed != 0 {
		t.Errorf("expected nothing checked afterwards, got %d", after.Changed)
	}
}

// Only "off" is supported: bulk-enabling would point the scheduler at the whole
// collection, which the per-bookmark opt-in exists to prevent.
func TestSetAllCheckModesRejectsOtherModes(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	req := httptest.NewRequest(http.MethodPost, "/api/health/check-mode-all", strings.NewReader(`{"mode":"monitor"}`))
	rec := httptest.NewRecorder()
	h.SetAllCheckModes(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for mode=monitor, got %d", rec.Code)
	}
}

// Turning checking off must not delete uptime history: the monitor sweep reclaims
// it, and discarding it here would destroy records on what may be a misclick.
func TestSetAllCheckModesKeepsHistory(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"https://mon.example","monitor":true}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	key := canonicalBookmarkURLKey("https://mon.example")
	if err := h.appendHealthSamples(map[string][]HealthSample{
		key: {{T: time.Now().Add(-time.Minute).UnixMilli(), Up: true}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/health/check-mode-all", strings.NewReader(`{"mode":"off"}`))
	h.SetAllCheckModes(httptest.NewRecorder(), req)

	if got := h.healthHistoryFor(key); len(got) != 1 {
		t.Errorf("history should survive turning checking off, got %#v", got)
	}
}
