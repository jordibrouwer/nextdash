package app

import (
	"fmt"
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

/*
A rate limit keyed on a header anyone can set is not a rate limit.

clientIP returned the first X-Forwarded-For value whenever it parsed as an
address, with nothing deciding whether the sender was entitled to set it. Those
limiters are the only throttle on /api/bookmark-preview, /api/icon/from-url and
/api/ping, so rotating a made-up X-Forwarded-For gave every request its own
fresh bucket -- and turned the server into an unmetered fetcher pointed at other
people's hosts.
*/
func TestClientIPIgnoresForwardedForFromAnUntrustedPeer(t *testing.T) {
	t.Setenv("NEXTDASH_TRUSTED_PROXIES", "")

	req := httptest.NewRequest(http.MethodGet, "/api/ping?url=https://example.com/", nil)
	req.RemoteAddr = "203.0.113.9:51000"
	req.Header.Set("X-Forwarded-For", "198.51.100.7")

	if got := clientIP(req); got != "203.0.113.9" {
		t.Errorf("clientIP = %q, want the peer 203.0.113.9", got)
	}
}

// A hundred invented addresses from one peer are still one bucket.
func TestForwardedForCannotBuyExtraBuckets(t *testing.T) {
	t.Setenv("NEXTDASH_TRUSTED_PROXIES", "")

	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/ping", nil)
		req.RemoteAddr = "203.0.113.9:51000"
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
		seen[clientIP(req)] = true
	}
	if len(seen) != 1 {
		t.Errorf("one peer produced %d limiter keys, want 1", len(seen))
	}
}

/*
And a proxy that was named as one is believed, because behind a real reverse
proxy every request arrives from the proxy's own address and keying on that
would put every reader in one bucket.
*/
func TestClientIPTrustsForwardedForFromANamedProxy(t *testing.T) {
	t.Setenv("NEXTDASH_TRUSTED_PROXIES", "10.0.0.0/8, 203.0.113.9")

	cases := []struct {
		name   string
		peer   string
		header string
		want   string
	}{
		{"named by address", "203.0.113.9:51000", "198.51.100.7", "198.51.100.7"},
		{"inside a named range", "10.4.5.6:4000", "198.51.100.7", "198.51.100.7"},
		{"outside every range", "192.0.2.5:4000", "198.51.100.7", "192.0.2.5"},
		// The client's own address is the first entry; the rest are the hops
		// after it, which the proxy appended and which prove nothing.
		{"a chain", "203.0.113.9:51000", "198.51.100.7, 10.0.0.1", "198.51.100.7"},
		{"nonsense in the header", "203.0.113.9:51000", "not-an-address", "203.0.113.9"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, "/api/ping", nil)
		req.RemoteAddr = c.peer
		req.Header.Set("X-Forwarded-For", c.header)
		if got := clientIP(req); got != c.want {
			t.Errorf("%s: clientIP = %q, want %q", c.name, got, c.want)
		}
	}
}
