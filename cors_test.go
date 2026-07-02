package main

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

func TestApplyCORSHeadersDefaultAllowAll(t *testing.T) {
	resetCORSConfigForTest(t)
	os.Unsetenv("NEXTDASH_CORS_ORIGINS")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
	applyCORSHeaders(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Allow-Origin = %q, want *", got)
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
