package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func postCheckModeAll(t *testing.T, h *Handlers, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/health/check-mode-all", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.SetAllCheckModes(rec, req)
	return rec
}

// Enabling checks is only allowed against a named list. Without targets the
// request means "the whole collection", which is the pattern the per-bookmark
// opt-in exists to prevent.
func TestSetAllCheckModesRejectsBulkEnableWithoutTargets(t *testing.T) {
	for _, mode := range []string{checkModeMonitor, checkModePeriodic} {
		t.Run(mode, func(t *testing.T) {
			h := checkModeTestHandlers(t)
			rec := postCheckModeAll(t, h, `{"mode":"`+mode+`"}`)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d (%s)", rec.Code, rec.Body.String())
			}
			for _, bm := range h.store.GetBookmarksByPage(1) {
				if bm.Monitor || bm.CheckStatus {
					t.Errorf("%s was enabled by a rejected request", bm.Name)
				}
			}
		})
	}
}

func TestSetAllCheckModesEnablesNamedTargets(t *testing.T) {
	h := checkModeTestHandlers(t)
	rec := postCheckModeAll(t, h, `{"mode":"monitor","targets":[
		{"pageId":1,"index":0,"url":"https://first.example"},
		{"pageId":1,"index":2,"url":"https://third.example"}
	]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	var body struct {
		Mode    string `json:"mode"`
		Changed int    `json:"changed"`
		Skipped int    `json:"skipped"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Changed != 2 || body.Skipped != 0 || body.Mode != checkModeMonitor {
		t.Errorf("unexpected response: %#v", body)
	}

	bookmarks := h.store.GetBookmarksByPage(1)
	for _, i := range []int{0, 2} {
		if !bookmarks[i].Monitor {
			t.Errorf("%s was not monitored", bookmarks[i].Name)
		}
		if bookmarks[i].MonitorIntervalMinutes != defaultMonitorIntervalMinutes {
			t.Errorf("%s interval = %d, want the default", bookmarks[i].Name, bookmarks[i].MonitorIntervalMinutes)
		}
	}
	// Bookmarks outside the target list must be untouched — that is the whole
	// point of naming them.
	for _, i := range []int{1, 3} {
		if bookmarks[i].Monitor || bookmarks[i].CheckStatus {
			t.Errorf("%s was changed but was not a target", bookmarks[i].Name)
		}
	}
}

// One moved bookmark should not discard the rest of a batch.
func TestSetAllCheckModesSkipsStaleTargets(t *testing.T) {
	h := checkModeTestHandlers(t)
	rec := postCheckModeAll(t, h, `{"mode":"periodic","targets":[
		{"pageId":1,"index":0,"url":"https://first.example"},
		{"pageId":1,"index":1,"url":"https://moved.example"},
		{"pageId":1,"index":99,"url":"https://gone.example"},
		{"pageId":0,"index":0,"url":"https://bad-page.example"},
		{"pageId":1,"index":3,"url":""}
	]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	var body struct {
		Changed int `json:"changed"`
		Skipped int `json:"skipped"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Changed != 1 || body.Skipped != 4 {
		t.Errorf("changed=%d skipped=%d, want 1 and 4", body.Changed, body.Skipped)
	}

	bookmarks := h.store.GetBookmarksByPage(1)
	if !bookmarks[0].CheckStatus {
		t.Error("the valid target was not enabled")
	}
	for _, i := range []int{1, 2, 3} {
		if bookmarks[i].CheckStatus || bookmarks[i].Monitor {
			t.Errorf("%s was changed by a stale target", bookmarks[i].Name)
		}
	}
}

func TestSetAllCheckModesTargetsSpanPages(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	for _, page := range []struct {
		id   int
		json string
	}{
		{1, `{"id":1,"name":"One","bookmarks":[{"name":"A","url":"https://a.example"}]}`},
		{2, `{"id":2,"name":"Two","bookmarks":[{"name":"B","url":"https://b.example"}]}`},
	} {
		name := filepath.Join(dir, "bookmarks-"+strconv.Itoa(page.id)+".json")
		if err := os.WriteFile(name, []byte(page.json), 0o644); err != nil {
			t.Fatalf("write page %d: %v", page.id, err)
		}
	}

	rec := postCheckModeAll(t, h, `{"mode":"monitor","targets":[
		{"pageId":1,"index":0,"url":"https://a.example"},
		{"pageId":2,"index":0,"url":"https://b.example"}
	]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !h.store.GetBookmarksByPage(1)[0].Monitor || !h.store.GetBookmarksByPage(2)[0].Monitor {
		t.Error("targets on separate pages were not both applied")
	}
}

func TestSetAllCheckModesRejectsUnknownTargetMode(t *testing.T) {
	h := checkModeTestHandlers(t)
	rec := postCheckModeAll(t, h, `{"mode":"hourly","targets":[
		{"pageId":1,"index":0,"url":"https://first.example"}
	]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}
