package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The read APIs carry a content ETag so the dashboard's repeated reads — every
// page load, page switch and cross-tab sync — can come back as a bodyless 304.
// These pin the contract: a validator is offered, a matching one is honoured,
// a stale one is not, and the body is identical to what the plain request
// returns (an ETag on the wrong bytes would be worse than none).

// readEndpoints are the handlers that serve cacheable dashboard state.
func readEndpoints(h *Handlers) map[string]struct {
	path    string
	handler http.HandlerFunc
} {
	return map[string]struct {
		path    string
		handler http.HandlerFunc
	}{
		"bookmarks":  {"/api/bookmarks?page=1", h.GetBookmarks},
		"categories": {"/api/categories?page=1", h.GetCategories},
		"pages":      {"/api/pages", h.GetPages},
		"settings":   {"/api/settings", h.GetSettings},
		"finders":    {"/api/finders", h.GetFinders},
	}
}

func TestReadAPIsServeConditionalRequests(t *testing.T) {
	h := NewHandlers(NewStore(), embeddedFiles)

	for name, ep := range readEndpoints(h) {
		t.Run(name, func(t *testing.T) {
			first := httptest.NewRecorder()
			ep.handler(first, httptest.NewRequest(http.MethodGet, ep.path, nil))
			if first.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", first.Code)
			}
			etag := first.Header().Get("ETag")
			if etag == "" {
				t.Fatal("no ETag: the client has no validator to send back")
			}
			// Must revalidate rather than serve from cache: a write from another
			// tab or the extension has to be visible immediately.
			if cc := first.Header().Get("Cache-Control"); cc != "no-cache, must-revalidate" {
				t.Errorf("Cache-Control = %q, want no-cache", cc)
			}

			cond := httptest.NewRequest(http.MethodGet, ep.path, nil)
			cond.Header.Set("If-None-Match", etag)
			second := httptest.NewRecorder()
			ep.handler(second, cond)
			if second.Code != http.StatusNotModified {
				t.Fatalf("matching If-None-Match => %d, want 304", second.Code)
			}
			if body := second.Body.Len(); body != 0 {
				t.Errorf("304 carried %d bytes; the point is to send none", body)
			}

			stale := httptest.NewRequest(http.MethodGet, ep.path, nil)
			stale.Header.Set("If-None-Match", `"stale"`)
			third := httptest.NewRecorder()
			ep.handler(third, stale)
			if third.Code != http.StatusOK {
				t.Fatalf("stale If-None-Match => %d, want 200", third.Code)
			}
			if third.Body.String() != first.Body.String() {
				t.Error("body differs between a plain and a stale-validator request")
			}
		})
	}
}

// An ETag that survived a write would serve deleted bookmarks from cache — the
// one failure mode that makes this worse than sending the body every time.
func TestBookmarkETagChangesAfterWrite(t *testing.T) {
	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	get := func() (string, int) {
		rec := httptest.NewRecorder()
		h.GetBookmarks(rec, httptest.NewRequest(http.MethodGet, "/api/bookmarks?page=1", nil))
		return rec.Header().Get("ETag"), rec.Code
	}

	before, _ := get()
	if before == "" {
		t.Fatal("no ETag on the first read")
	}

	if err := store.SaveBookmarksByPage(1, []Bookmark{{Name: "Added", URL: "https://example.com"}}); err != nil {
		t.Fatalf("save: %v", err)
	}

	after, _ := get()
	if after == before {
		t.Fatal("ETag unchanged after a write; clients would keep the stale list")
	}

	// The pre-write validator must no longer match, or the client never sees
	// the write.
	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks?page=1", nil)
	req.Header.Set("If-None-Match", before)
	rec := httptest.NewRecorder()
	h.GetBookmarks(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("pre-write validator => %d, want 200 with the new list", rec.Code)
	}
}

// Cross-origin callers (the browser extension) can only use this if the browser
// is allowed to send the validator and to read the one it was given.
func TestCORSAllowsConditionalRequests(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks?page=1", nil)
	req.Header.Set("Origin", "chrome-extension://abc")
	applyCORSHeaders(rec, req)

	if got := rec.Header().Get("Access-Control-Expose-Headers"); got != "ETag" {
		t.Errorf("Expose-Headers = %q, want ETag: JS cannot read the validator otherwise", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, "If-None-Match") {
		t.Errorf("Allow-Headers = %q, missing If-None-Match: the request would be blocked", got)
	}
}
