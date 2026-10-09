package app

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

	// Nothing ever removed a key, so every distinct client IP seen since boot
	// kept a permanent map entry. Swept opportunistically while the lock is
	// already held rather than from a goroutine, so an idle instance stays idle.
	if len(l.events) > limiterSweepThreshold {
		for k, v := range l.events {
			if k == key {
				continue
			}
			if len(v) == 0 || !v[len(v)-1].After(cutoff) {
				delete(l.events, k)
			}
		}
	}

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

// saturated reports whether key has used its whole window, without counting
// a request of its own.
func (l *slidingWindowLimiter) saturated(key string) bool {
	if l == nil || l.limit <= 0 {
		return false
	}
	cutoff := time.Now().Add(-l.window)
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for _, ts := range l.events[key] {
		if ts.After(cutoff) {
			n++
		}
	}
	return n >= l.limit
}

// limiterSweepThreshold is the map size above which allow() drops keys whose
// whole window has expired. High enough that a normal instance never sweeps.
const limiterSweepThreshold = 1024

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

/*
trustedProxies is who may speak for somebody else.

NEXTDASH_TRUSTED_PROXIES takes a comma-separated list of addresses and CIDR
ranges -- "10.0.0.0/8, 192.168.1.5". Empty, which is the default, means nobody:
X-Forwarded-For is then read by nothing.

Default-deny because of what these limiters guard. They are the only throttle on
/api/bookmark-preview, /api/icon/from-url and /api/ping, all of which make the
server fetch an address for you. Believing an unverifiable header meant a client
could hand itself a fresh bucket per request simply by inventing a new value,
which is not a rate limit at all.

The cost of the default is that everyone behind a reverse proxy shares one
bucket, since every request genuinely does arrive from the proxy. Anyone who
wants the limits counted per reader names their proxy here -- which is the one
piece of information the server cannot work out for itself.
*/
func trustedProxies() []*net.IPNet {
	raw := strings.TrimSpace(os.Getenv("NEXTDASH_TRUSTED_PROXIES"))
	if raw == "" {
		return nil
	}
	var nets []*net.IPNet
	for _, part := range strings.Split(raw, ",") {
		entry := strings.TrimSpace(part)
		if entry == "" {
			continue
		}
		if _, network, err := net.ParseCIDR(entry); err == nil {
			nets = append(nets, network)
			continue
		}
		// A bare address is the range that holds only itself.
		if ip := net.ParseIP(entry); ip != nil {
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			nets = append(nets, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
		}
	}
	return nets
}

func isTrustedProxy(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, network := range trustedProxies() {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func clientIP(r *http.Request) string {
	peer := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(peer); err == nil && host != "" {
		peer = host
	}

	/*
	 * X-Forwarded-For is read only when the peer is one of the proxies this
	 * install named. Anyone can set the header; only a named proxy is taken at
	 * its word for it.
	 *
	 * Read from the right. A proxy appends the address it saw and keeps what
	 * the request already carried, so the leftmost entries are whatever the
	 * client chose to send. Each named proxy in the chain is skipped; the
	 * first address before them that is not one is the client. Garbage on the
	 * way stops the walk and the peer counts, as it did before.
	 */
	if isTrustedProxy(peer) {
		// Every header line: a proxy may add its own line rather than append
		// to the one the client sent, and that line alone is the client's.
		if xff := strings.TrimSpace(strings.Join(r.Header.Values("X-Forwarded-For"), ",")); xff != "" {
			hops := strings.Split(xff, ",")
			client := ""
			for i := len(hops) - 1; i >= 0; i-- {
				hop := strings.TrimSpace(hops[i])
				if h, _, err := net.SplitHostPort(hop); err == nil {
					hop = h
				}
				hop = strings.Trim(hop, "[]")
				if net.ParseIP(hop) == nil {
					break
				}
				client = hop
				if !isTrustedProxy(hop) {
					return hop
				}
			}
			// Every hop was a named proxy (a LAN reader inside the trusted
			// range): the leftmost one reached is the reader.
			if client != "" {
				return client
			}
		}
	}
	return peer
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

// reset drops everything the limiter has recorded.
//
// The outbound limiter is a package-level singleton keyed on one bucket, so in
// a test binary every test shares it: a suite that makes more than the limit's
// worth of requests inside its window starts failing tests that have nothing
// wrong with them, and which ones fail depends on the order they ran in. Tests
// call this so each starts from an empty window.
func (l *slidingWindowLimiter) reset() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = make(map[string][]time.Time)
}
