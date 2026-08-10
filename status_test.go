package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// PingURL (the manual "Re-check" button, GET /api/ping) must judge a bookmark
// by its own expectText, not the bare reachability rule — otherwise a keyword
// check configured on a bookmark is silently ignored by the one button meant
// to test it on demand.
func TestPingURLHonoursExpectText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html><body>Something else entirely</body></html>"))
	}))
	defer server.Close()

	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"allowLocalBookmarks":true}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[{"name":"Watched","url":"` + server.URL + `","monitor":true,"expectText":"Expected Phrase"}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	h := &Handlers{store: &FileStore{settingsFile: settingsPath, dataDir: dir}}

	req := httptest.NewRequest(http.MethodGet, "/api/ping?url="+server.URL, nil)
	rec := httptest.NewRecorder()
	h.PingURL(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Status      string `json:"status"`
		ErrorDetail string `json:"errorDetail"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Status != "offline" {
		t.Fatalf("expected offline (content mismatch), got %q — expectText was ignored", resp.Status)
	}
	if !isContentFailure(resp.ErrorDetail) {
		t.Fatalf("errorDetail = %q, want a content-mismatch reason", resp.ErrorDetail)
	}
}

// A bookmark with no expectations must still behave exactly like the plain
// reachability check — the fix must not narrow what counts as online for the
// common case.
func TestPingURLWithoutExpectationsStillTreatsOKAsOnline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"allowLocalBookmarks":true}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[{"name":"Plain","url":"` + server.URL + `","checkStatus":true}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	h := &Handlers{store: &FileStore{settingsFile: settingsPath, dataDir: dir}}

	req := httptest.NewRequest(http.MethodGet, "/api/ping?url="+server.URL, nil)
	rec := httptest.NewRecorder()
	h.PingURL(rec, req)

	var resp struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Status != "online" {
		t.Fatalf("expected online, got %q", resp.Status)
	}
}
