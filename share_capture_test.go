package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Android's share sheet is inconsistent about which field holds the URL, and
// often sends it inside a sentence. Everything downstream depends on this one
// function picking it out, so it is pinned against the shapes phones actually
// send.
func TestFirstHTTPURLReadsEveryShareShape(t *testing.T) {
	cases := []struct {
		name              string
		url, text, title  string
		want              string
	}{
		{"url field", "https://example.com/a", "", "", "https://example.com/a"},
		{"url in text", "", "https://example.com/b", "", "https://example.com/b"},
		{"title and url in text", "", "Some article https://example.com/c", "Some article",
			"https://example.com/c"},
		{"url only in title", "", "", "https://example.com/d", "https://example.com/d"},
		{"trailing punctuation", "", "Read this: https://example.com/e.", "", "https://example.com/e"},
		{"nothing usable", "", "no link here", "just a title", ""},
		{"non-http scheme is not a link", "javascript:alert(1)", "", "", ""},
	}
	for _, c := range cases {
		if got := firstHTTPURL(c.url, c.text, c.title); got != c.want {
			t.Errorf("%s: firstHTTPURL = %q, want %q", c.name, got, c.want)
		}
	}
}

// The title is what is left of the text once the URL is taken out — the raw
// text never is, and an empty title is better than a URL printed twice.
func TestTitleFromShare(t *testing.T) {
	if got := titleFromShare("", "Some article https://example.com/c", "https://example.com/c"); got != "Some article" {
		t.Errorf("text minus url = %q, want %q", got, "Some article")
	}
	if got := titleFromShare("A title", "https://example.com/c", "https://example.com/c"); got != "A title" {
		t.Errorf("explicit title = %q", got)
	}
	if got := titleFromShare("https://example.com/c", "https://example.com/c", "https://example.com/c"); got != "" {
		t.Errorf("a URL is not a title: %q", got)
	}
}

// Capture is guarded by its own token, not the write token: neither a share
// sheet nor a bookmarklet can send a header, so the write token could only
// travel in the URL — where it would end up in history, and it unlocks
// everything. With no write token set the app is already open to whoever can
// reach it, and capture is no different.
func TestCaptureAccessRules(t *testing.T) {
	req := func(query string) *http.Request {
		return httptest.NewRequest(http.MethodGet, "/add?"+query, nil)
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	t.Setenv("NEXTDASH_CAPTURE_TOKEN", "")
	if !captureAccessAllowed(req("url=https://example.com")) {
		t.Fatal("with no write token, capture should be allowed")
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret-write")
	if captureAccessAllowed(req("url=https://example.com")) {
		t.Fatal("a locked install must not accept an unauthenticated capture")
	}
	if captureAccessAllowed(req("url=https://example.com&token=wrong")) {
		t.Fatal("a wrong token was accepted")
	}
	if !captureAccessAllowed(req("url=https://example.com&token=secret-write")) {
		t.Fatal("the write token itself should work, for a script that has it")
	}

	t.Setenv("NEXTDASH_CAPTURE_TOKEN", "capture-only")
	if !captureAccessAllowed(req("url=https://example.com&token=capture-only")) {
		t.Fatal("the capture token should open the capture routes")
	}
	if captureAccessAllowed(req("url=https://example.com&token=capture-onl")) {
		t.Fatal("a near-miss token was accepted")
	}
}

// The share target answers with a redirect the app can read, whatever happened:
// a share sheet has nowhere to show an error, so the outcome travels in the URL.
func TestShareTargetRedirects(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[]}`)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "")

	rec := httptest.NewRecorder()
	h.ShareTargetCapture(rec, httptest.NewRequest(http.MethodGet,
		"/share?title=Example&text=Example%20https://example.com/one", nil))
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", rec.Code)
	}
	if loc := rec.Header().Get("Location"); !strings.Contains(loc, "captured=ok") {
		t.Fatalf("location = %q, want captured=ok", loc)
	}

	// The same link again is a success from the sharer's point of view: it is in
	// the inbox, which is what they asked for.
	rec2 := httptest.NewRecorder()
	h.ShareTargetCapture(rec2, httptest.NewRequest(http.MethodGet,
		"/share?url=https://example.com/one", nil))
	if loc := rec2.Header().Get("Location"); !strings.Contains(loc, "captured=") {
		t.Fatalf("second share location = %q", loc)
	}

	// Nothing usable is its own outcome rather than a silent success.
	rec3 := httptest.NewRecorder()
	h.ShareTargetCapture(rec3, httptest.NewRequest(http.MethodGet, "/share?text=no+link+here", nil))
	if loc := rec3.Header().Get("Location"); !strings.Contains(loc, "captured=nourl") {
		t.Fatalf("no-url location = %q, want captured=nourl", loc)
	}
}

// /add answers with a page, not JSON: a bookmarklet opens a tab, and a tab
// showing {"status":"ok"} is a bad ending.
func TestAddCaptureAnswersWithAPage(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[]}`)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "")

	rec := httptest.NewRecorder()
	h.AddCapture(rec, httptest.NewRequest(http.MethodGet,
		"/add?url=https://example.com/two&title=Two", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("content-type = %q, want html", ct)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Saved to the inbox") || !strings.Contains(body, "Two") {
		t.Fatalf("body does not confirm the save: %q", body[:min(len(body), 200)])
	}

	// A locked install says what to do rather than failing silently.
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret-write")
	locked := httptest.NewRecorder()
	h.AddCapture(locked, httptest.NewRequest(http.MethodGet, "/add?url=https://example.com/three", nil))
	if locked.Code != http.StatusUnauthorized {
		t.Fatalf("locked status = %d, want 401", locked.Code)
	}
	if !strings.Contains(locked.Body.String(), "capture token") {
		t.Fatal("the refusal should name the token it wants")
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
