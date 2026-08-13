package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// fetchBookmarkPreview used to parse the response body regardless of status
// code. A 404/500 error page frequently ships its own <title> and social meta
// tags, so a dead link would get a plausible-looking preview cached against it
// for up to a week — masking exactly the breakage the health checker exists to
// surface.
func TestFetchBookmarkPreviewIgnoresErrorPageBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`<html><head><title>Page Not Found</title>
			<meta property="og:title" content="Not Found - Example Site">
			<meta property="og:description" content="This page could not be found.">
			</head><body>404</body></html>`))
	}))
	defer srv.Close()

	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	settings := store.GetSettings()
	settings.AllowLocalBookmarks = true
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	h := &Handlers{store: store}
	preview := h.fetchBookmarkPreview(t.Context(), srv.URL, nil, false)

	if preview.Title != "" {
		t.Fatalf("Title = %q, want empty — a 404 body must not be parsed as a preview", preview.Title)
	}
	if preview.Description != "" {
		t.Fatalf("Description = %q, want empty", preview.Description)
	}
}

func TestFetchBookmarkPreviewParsesSuccessPageBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<html><head><title>Real Page</title></head><body></body></html>`))
	}))
	defer srv.Close()

	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()
	settings := store.GetSettings()
	settings.AllowLocalBookmarks = true
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	h := &Handlers{store: store}
	preview := h.fetchBookmarkPreview(t.Context(), srv.URL, nil, false)

	if preview.Title != "Real Page" {
		t.Fatalf("Title = %q, want %q", preview.Title, "Real Page")
	}
}
