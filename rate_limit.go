package main

import (
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type slidingWindowLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	events map[string][]time.Time
}

func newSlidingWindowLimiter(limit int, window time.Duration) *slidingWindowLimiter {
	if limit <= 0 {
		limit = 60
	}
	if window <= 0 {
		window = time.Minute
	}
	return &slidingWindowLimiter{
		limit:  limit,
		window: window,
		events: make(map[string][]time.Time),
	}
}

func (l *slidingWindowLimiter) allow(key string) bool {
	if l == nil || l.limit <= 0 {
		return true
	}
	if key == "" {
		key = "unknown"
	}

	now := time.Now()
	cutoff := now.Add(-l.window)

	l.mu.Lock()
	defer l.mu.Unlock()

	list := l.events[key]
	kept := list[:0]
	for _, ts := range list {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	if len(kept) >= l.limit {
		l.events[key] = kept
		return false
	}
	kept = append(kept, now)
	l.events[key] = kept
	return true
}

func envIntPositive(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func outboundRequestsPerMinute() int {
	return envIntPositive("NEXTDASH_OUTBOUND_REQUESTS_PER_MIN", 120)
}

func ssrfAPIRequestsPerMinute() int {
	return envIntPositive("NEXTDASH_SSRF_API_RATE_PER_MIN", 60)
}

func statusPingRequestsPerMinute() int {
	return envIntPositive("NEXTDASH_STATUS_PING_RATE_PER_MIN", 300)
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

type rateLimitedTransport struct {
	base    http.RoundTripper
	limiter *slidingWindowLimiter
}

func (t *rateLimitedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.limiter != nil && !t.limiter.allow("global") {
		return nil, errOutboundRateLimited
	}
	return t.base.RoundTrip(req)
}

var errOutboundRateLimited = &outboundRateLimitError{}

type outboundRateLimitError struct{}

func (e *outboundRateLimitError) Error() string {
	return "outbound rate limit exceeded"
}

var globalOutboundLimiter = newSlidingWindowLimiter(outboundRequestsPerMinute(), time.Minute)
