package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestLoggingSetsRequestID(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := requestLogging(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get(requestIDHeader); got == "" {
		t.Fatal("expected X-Request-ID response header")
	}
}

func TestRequestLoggingPreservesClientRequestID(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := requestLogging(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks?page=1", nil)
	req.Header.Set(requestIDHeader, "client-trace-99")
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get(requestIDHeader); got != "client-trace-99" {
		t.Fatalf("X-Request-ID = %q, want client-trace-99", got)
	}
}

func TestRequestLoggingSkipsStaticPaths(t *testing.T) {
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})
	handler := requestLogging(inner)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/static/js/app.js?v=1", nil)
	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("inner handler was not called")
	}
	if got := rec.Header().Get(requestIDHeader); got != "" {
		t.Fatalf("static path should not set X-Request-ID, got %q", got)
	}
}
