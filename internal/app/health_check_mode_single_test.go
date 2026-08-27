package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// checkModeTestHandlers sets up a handler with one page of four bookmarks, all
// starting with checking off.
func checkModeTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"First","url":"https://first.example"},
		{"name":"Second","url":"https://second.example"},
		{"name":"Third","url":"https://third.example"},
		{"name":"Fourth","url":"https://fourth.example"}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	return h
}

func postCheckMode(t *testing.T, h *Handlers, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/health/check-mode", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.SetBookmarkCheckMode(rec, req)
	return rec
}

func TestSetBookmarkCheckModeAppliesEachMode(t *testing.T) {
	cases := []struct {
		mode         string
		wantMonitor  bool
		wantPeriodic bool
		wantInterval int
	}{
		{checkModePeriodic, false, true, 0},
		{checkModeMonitor, true, false, defaultMonitorIntervalMinutes},
		{checkModeOff, false, false, 0},
	}

	for _, tc := range cases {
		t.Run(tc.mode, func(t *testing.T) {
			h := checkModeTestHandlers(t)
			rec := postCheckMode(t, h, fmt.Sprintf(
				`{"pageId":1,"index":0,"url":"https://first.example","mode":%q}`, tc.mode))
			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
			}

			bm := h.store.GetBookmarksByPage(1)[0]
			if bm.Monitor != tc.wantMonitor || bm.CheckStatus != tc.wantPeriodic {
				t.Errorf("mode %s: monitor=%v checkStatus=%v, want monitor=%v checkStatus=%v",
					tc.mode, bm.Monitor, bm.CheckStatus, tc.wantMonitor, tc.wantPeriodic)
			}
			// A monitor must state its own cadence rather than inheriting one
			// implicitly, and turning checking off must not leave one behind.
			if bm.MonitorIntervalMinutes != tc.wantInterval {
				t.Errorf("mode %s: interval=%d, want %d", tc.mode, bm.MonitorIntervalMinutes, tc.wantInterval)
			}

			var body struct {
				Mode string `json:"mode"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Mode != tc.mode {
				t.Errorf("response mode = %q, want %q", body.Mode, tc.mode)
			}

			// The other bookmarks must be untouched.
			for _, other := range h.store.GetBookmarksByPage(1)[1:] {
				if other.Monitor || other.CheckStatus {
					t.Errorf("%s was changed as a side effect", other.Name)
				}
			}
		})
	}
}

func TestSetBookmarkCheckModeKeepsExplicitMonitorInterval(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"First","url":"https://first.example","monitor":true,"monitorIntervalMinutes":5}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	rec := postCheckMode(t, h, `{"pageId":1,"index":0,"url":"https://first.example","mode":"monitor"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	// Re-selecting monitor must not reset a deliberately chosen interval.
	if got := h.store.GetBookmarksByPage(1)[0].MonitorIntervalMinutes; got != 5 {
		t.Errorf("interval = %d, want the existing 5", got)
	}
}

func TestSetBookmarkCheckModeRejectsBadRequests(t *testing.T) {
	cases := []struct {
		name string
		body string
		want int
	}{
		{"unknown mode", `{"pageId":1,"index":0,"url":"https://first.example","mode":"sometimes"}`, http.StatusBadRequest},
		{"empty mode", `{"pageId":1,"index":0,"url":"https://first.example","mode":""}`, http.StatusBadRequest},
		{"missing url", `{"pageId":1,"index":0,"mode":"monitor"}`, http.StatusBadRequest},
		{"negative index", `{"pageId":1,"index":-1,"url":"https://first.example","mode":"monitor"}`, http.StatusBadRequest},
		{"zero page", `{"pageId":0,"index":0,"url":"https://first.example","mode":"monitor"}`, http.StatusBadRequest},
		{"index out of range", `{"pageId":1,"index":99,"url":"https://first.example","mode":"monitor"}`, http.StatusNotFound},
		{"url mismatch", `{"pageId":1,"index":0,"url":"https://moved.example","mode":"monitor"}`, http.StatusConflict},
		{"broken json", `{`, http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := checkModeTestHandlers(t)
			rec := postCheckMode(t, h, tc.body)
			if rec.Code != tc.want {
				t.Fatalf("expected %d, got %d (%s)", tc.want, rec.Code, rec.Body.String())
			}
			for _, bm := range h.store.GetBookmarksByPage(1) {
				if bm.Monitor || bm.CheckStatus {
					t.Errorf("%s was changed by a rejected request", bm.Name)
				}
			}
		})
	}
}

// A stale index that happens to be in range is the case the URL check exists
// for: without it, a row from an out-of-date report would rewrite its neighbour.
func TestSetBookmarkCheckModeRejectsStaleIndex(t *testing.T) {
	h := checkModeTestHandlers(t)
	rec := postCheckMode(t, h, `{"pageId":1,"index":2,"url":"https://first.example","mode":"monitor"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d (%s)", rec.Code, rec.Body.String())
	}
	if h.store.GetBookmarksByPage(1)[2].Monitor {
		t.Error("the bookmark at the stale index was modified")
	}
}

func TestSetBookmarkCheckModeRejectsNonPost(t *testing.T) {
	h := checkModeTestHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/api/health/check-mode", nil)
	rec := httptest.NewRecorder()
	h.SetBookmarkCheckMode(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestCheckModeForReportsCurrentMode(t *testing.T) {
	cases := []struct {
		bm   Bookmark
		want string
	}{
		{Bookmark{}, checkModeOff},
		{Bookmark{CheckStatus: true}, checkModePeriodic},
		{Bookmark{Monitor: true}, checkModeMonitor},
		// A bookmark carrying both flags from an older version reads as the
		// stronger mode, which is the one actually doing the work.
		{Bookmark{Monitor: true, CheckStatus: true}, checkModeMonitor},
	}
	for _, tc := range cases {
		if got := checkModeFor(tc.bm); got != tc.want {
			t.Errorf("checkModeFor(%+v) = %q, want %q", tc.bm, got, tc.want)
		}
	}
}
