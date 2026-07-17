package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRedirectLocationFromResponse(t *testing.T) {
	t.Parallel()
	resp := &http.Response{
		StatusCode: http.StatusFound,
		Header:     http.Header{"Location": []string{"/moved"}},
	}
	got := redirectLocationFromResponseCtx(t.Context(), "https://example.com/old", resp, false)
	if got != "https://example.com/moved" {
		t.Fatalf("redirectLocationFromResponseCtx() = %q, want %q", got, "https://example.com/moved")
	}
}

func TestDetectRedirectURL_HeaderRedirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/old":
			http.Redirect(w, r, "/new", http.StatusFound)
		case "/new":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	h := testHandlersWithLocalBookmarks(t)
	got := h.detectRedirectURLCtx(t.Context(), server.URL+"/old", false)
	want := server.URL + "/new"
	if got != want {
		t.Fatalf("detectRedirectURLCtx() = %q, want %q", got, want)
	}
}

func testHandlersWithLocalBookmarks(t *testing.T) *Handlers {
	t.Helper()
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"allowLocalBookmarks":true}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	store := &FileStore{
		settingsFile: settingsPath,
		dataDir:      dir,
	}
	return &Handlers{store: store}
}
