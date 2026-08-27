package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
)

func resetCORSConfigForTest(t *testing.T) {
	t.Helper()
	corsConfigOnce = sync.Once{}
	corsAllowAll = false
	corsOrigins = nil
	t.Cleanup(func() {
		os.Unsetenv("NEXTDASH_CORS_ORIGINS")
		corsConfigOnce = sync.Once{}
		corsAllowAll = false
		corsOrigins = nil
	})
}

/*
Unset means same origin: a web page gets no header and cannot read the API.

This was Access-Control-Allow-Origin: * until 1.4, which meant any site open in
a tab could read a bookmark collection off a nextDash it could guess the address
of -- the read routes need no token.
*/
func TestApplyCORSHeadersDefaultRefusesAWebPage(t *testing.T) {
	resetCORSConfigForTest(t)
	os.Unsetenv("NEXTDASH_CORS_ORIGINS")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
	req.Header.Set("Origin", "https://somebody-elses.example")
	applyCORSHeaders(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Allow-Origin = %q, want empty for a web page on the default", got)
	}
}

/*
The extension still gets its header on the default.

It would reach the API regardless -- host permissions grant a Manifest V3
extension cross-origin access without CORS -- but the header is what keeps it
working if a browser starts consulting one.
*/
func TestApplyCORSHeadersDefaultAllowsAnExtension(t *testing.T) {
	resetCORSConfigForTest(t)
	os.Unsetenv("NEXTDASH_CORS_ORIGINS")

	for _, origin := range []string{
		"chrome-extension://abc123",
		"moz-extension://9f1b2c3d-0000-4444-8888-aabbccddeeff",
		"safari-web-extension://ABCdef",
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
		req.Header.Set("Origin", origin)
		applyCORSHeaders(rec, req)

		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("Allow-Origin = %q, want %q", got, origin)
		}
		if got := rec.Header().Get("Vary"); got != "Origin" {
			t.Errorf("Vary = %q, want Origin for %q", got, origin)
		}
	}
}

// The prefix alone is not enough: an origin has no path and no spaces in it.
func TestApplyCORSHeadersRefusesAMalformedExtensionOrigin(t *testing.T) {
	resetCORSConfigForTest(t)
	os.Unsetenv("NEXTDASH_CORS_ORIGINS")

	for _, origin := range []string{
		"chrome-extension://abc/evil",
		"chrome-extension://",
		"chrome-extension://abc def",
		"chrome-extension://abc@evil.example",
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
		req.Header.Set("Origin", origin)
		applyCORSHeaders(rec, req)

		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("Allow-Origin = %q for %q, want empty", got, origin)
		}
	}
}

// The old behaviour, for somebody whose setup depends on it.
func TestApplyCORSHeadersExplicitWildcard(t *testing.T) {
	resetCORSConfigForTest(t)
	os.Setenv("NEXTDASH_CORS_ORIGINS", "*")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
	req.Header.Set("Origin", "https://anyone.example")
	applyCORSHeaders(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Allow-Origin = %q, want *", got)
	}
}

// A value that was set but names nothing usable used to fall through to the
// wildcard, so one stray comma opened the API to everyone.
func TestApplyCORSHeadersEmptyAllowlistIsNotAWildcard(t *testing.T) {
	resetCORSConfigForTest(t)
	os.Setenv("NEXTDASH_CORS_ORIGINS", " , ,")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
	req.Header.Set("Origin", "https://anyone.example")
	applyCORSHeaders(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Allow-Origin = %q, want empty", got)
	}
}

func TestApplyCORSHeadersAllowlistMatch(t *testing.T) {
	resetCORSConfigForTest(t)
	os.Setenv("NEXTDASH_CORS_ORIGINS", "https://dash.example.com, chrome-extension://abc123")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
	req.Header.Set("Origin", "https://dash.example.com")
	applyCORSHeaders(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://dash.example.com" {
		t.Fatalf("Allow-Origin = %q, want matched origin", got)
	}
	if got := rec.Header().Get("Vary"); got != "Origin" {
		t.Fatalf("Vary = %q, want Origin", got)
	}
}

func TestApplyCORSHeadersAllowlistNoMatch(t *testing.T) {
	resetCORSConfigForTest(t)
	os.Setenv("NEXTDASH_CORS_ORIGINS", "https://dash.example.com")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	applyCORSHeaders(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Allow-Origin = %q, want empty for disallowed origin", got)
	}
}
