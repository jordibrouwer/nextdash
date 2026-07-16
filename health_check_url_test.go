package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// checkURLTestHandlers wires a Handlers backed by a temp data dir, matching the
// pattern used by the health-recheck tests.
func checkURLTestHandlers(t *testing.T, settingsJSON string) (*Handlers, string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(settingsJSON), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	return &Handlers{store: &FileStore{settingsFile: settingsPath, dataDir: dir}}, dir
}

func postCheckURL(t *testing.T, h *Handlers, url string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"url": url})
	req := httptest.NewRequest(http.MethodPost, "/api/health/check-url", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.CheckBookmarkHealthURL(rr, req)
	return rr
}

func TestCheckBookmarkHealthURLPersistsAndClearsError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	h, dir := checkURLTestHandlers(t, `{"allowLocalBookmarks":true}`)
	// Seed a matching bookmark that currently looks broken (has a LastError), so we
	// can assert the check clears it once the URL responds online.
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[{"name":"Promoted","url":"` + server.URL + `","checkStatus":true,"lastError":"Unreachable"}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	rr := postCheckURL(t, h, server.URL)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rr.Code, rr.Body.String())
	}

	var resp struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Status != "online" {
		t.Fatalf("expected online, got %q", resp.Status)
	}

	// Health cache should now carry the entry.
	key := canonicalBookmarkURLKey(server.URL)
	cache := readHealthCacheFile()
	entry, ok := cache.Cache[key]
	if !ok {
		t.Fatalf("expected a health cache entry for %q", key)
	}
	if entry.Status != "online" || entry.Error != "" {
		t.Fatalf("expected online/no-error cache entry, got %+v", entry)
	}

	// The bookmark's stored LastError should have been cleared.
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if canonicalBookmarkURLKey(bm.URL) == key {
			if bm.LastError != "" {
				t.Fatalf("expected LastError cleared, got %q", bm.LastError)
			}
			if bm.LastChecked == 0 {
				t.Fatalf("expected LastChecked to be stamped")
			}
			return
		}
	}
	t.Fatalf("seeded bookmark not found after check")
}

func TestCheckBookmarkHealthURLRejectsEmpty(t *testing.T) {
	h, _ := checkURLTestHandlers(t, `{}`)
	rr := postCheckURL(t, h, "")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty url, got %d", rr.Code)
	}
}

func TestCheckBookmarkHealthURLMethodNotAllowed(t *testing.T) {
	h, _ := checkURLTestHandlers(t, `{}`)
	req := httptest.NewRequest(http.MethodGet, "/api/health/check-url", nil)
	rr := httptest.NewRecorder()
	h.CheckBookmarkHealthURL(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET, got %d", rr.Code)
	}
}
