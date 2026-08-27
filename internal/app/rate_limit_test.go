package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSlidingWindowLimiterBlocksAfterLimit(t *testing.T) {
	t.Parallel()

	limiter := newSlidingWindowLimiter(2, time.Minute)
	// Two statements rather than one ||: short-circuiting meant a failing first
	// request skipped the second call altogether, so the two that follow were
	// asking about a limiter that had seen one request, not two.
	if !limiter.allow("client-a") {
		t.Fatal("expected the first request to pass")
	}
	if !limiter.allow("client-a") {
		t.Fatal("expected the second request to pass")
	}
	if limiter.allow("client-a") {
		t.Fatal("expected third request to be blocked")
	}
	if !limiter.allow("client-b") {
		t.Fatal("expected separate client key to pass")
	}
}

func TestRequireStatusPingRateLimitReturns429(t *testing.T) {
	h := NewHandlers(NewStore(), embeddedFiles)
	h.statusPingLimiter = newSlidingWindowLimiter(1, time.Minute)

	req := httptest.NewRequest(http.MethodGet, "/api/ping?url=https://example.com", nil)
	req.RemoteAddr = "203.0.113.11:1234"

	rec := httptest.NewRecorder()
	if !h.requireStatusPingRateLimit(rec, req) {
		t.Fatal("expected first request to pass rate limit")
	}

	rec = httptest.NewRecorder()
	if h.requireStatusPingRateLimit(rec, req) {
		t.Fatal("expected second request to be rate limited")
	}
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
}

func TestRequireSSRFAPIRateLimitReturns429(t *testing.T) {
	h := NewHandlers(NewStore(), embeddedFiles)
	h.ssrfAPILimiter = newSlidingWindowLimiter(1, time.Minute)

	req := httptest.NewRequest(http.MethodGet, "/api/ping?url=https://example.com", nil)
	req.RemoteAddr = "203.0.113.10:1234"

	rec := httptest.NewRecorder()
	if !h.requireSSRFAPIRateLimit(rec, req) {
		t.Fatal("expected first request to pass rate limit")
	}

	rec = httptest.NewRecorder()
	if h.requireSSRFAPIRateLimit(rec, req) {
		t.Fatal("expected second request to be rate limited")
	}
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
}
