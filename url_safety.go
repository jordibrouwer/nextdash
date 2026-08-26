package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

const hostLookupTimeout = 3 * time.Second

// isPublicHost returns true when host resolves only to routable (non-private) addresses.
func isPublicHost(host string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), hostLookupTimeout)
	defer cancel()
	return isPublicHostCtx(ctx, host)
}

func isPublicHostCtx(ctx context.Context, host string) bool {
	if ctx.Err() != nil {
		return false
	}
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "" || host == "localhost" {
		return false
	}

	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return false
	}

	for _, ipAddr := range ips {
		addr, ok := netip.AddrFromSlice(ipAddr.IP)
		if !ok {
			return false
		}
		if addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified() {
			return false
		}
	}

	pinHostAddrs(host, netIPAddrsToPin(ips))
	return true
}

func validateHTTPURL(rawURL string, allowLocal bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), hostLookupTimeout)
	defer cancel()
	return validateHTTPURLCtx(ctx, rawURL, allowLocal)
}

func validateHTTPURLCtx(ctx context.Context, rawURL string, allowLocal bool) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return fmt.Errorf("URL is required")
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL format")
	}

	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("URL scheme '%s' is not allowed. Only http and https are permitted", parsedURL.Scheme)
	}

	if strings.TrimSpace(parsedURL.Hostname()) == "" {
		return fmt.Errorf("invalid URL host")
	}

	if allowLocal {
		return nil
	}

	if !isPublicHostCtx(ctx, parsedURL.Hostname()) {
		return fmt.Errorf("URL host is not allowed")
	}

	return nil
}

func isAllowedDialIP(addr netip.Addr, allowLocal bool) bool {
	if allowLocal {
		return true
	}
	return !(addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified())
}

// ssrfSafeDialContext validates resolved IPs at dial time to mitigate DNS rebinding.
func ssrfSafeDialContext(allowLocal bool, dialTimeout time.Duration) func(context.Context, string, string) (net.Conn, error) {
	if dialTimeout <= 0 {
		dialTimeout = 30 * time.Second
	}
	dialer := &net.Dialer{Timeout: dialTimeout}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}

		if ip, parseErr := netip.ParseAddr(host); parseErr == nil {
			if !isAllowedDialIP(ip, allowLocal) {
				return nil, fmt.Errorf("dial to disallowed IP")
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		}

		addrs, err := resolvePinnedHostAddrs(ctx, host, allowLocal)
		if err != nil {
			return nil, err
		}

		var lastErr error
		for _, addr := range addrs {
			conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(addr.String(), port))
			if dialErr == nil {
				return conn, nil
			}
			lastErr = dialErr
		}
		return nil, lastErr
	}
}

func newSSRFSafeTransport(allowLocal bool, dialTimeout time.Duration) *http.Transport {
	return newSSRFSafeTransportWithHeaderTimeout(allowLocal, dialTimeout, 10*time.Second)
}

// newSSRFSafeTransportWithHeaderTimeout is the same transport with a caller-set
// wait for the first response byte.
//
// Ten seconds is right for fetching a web page: a site that has not started
// answering by then is not going to. It is wrong for an API that computes
// before it answers -- the Wayback CDX index routinely takes thirteen seconds
// to start replying for a heavily captured URL, and the shared limit turned
// that into an intermittent failure that looked like the feature not working.
func newSSRFSafeTransportWithHeaderTimeout(allowLocal bool, dialTimeout, headerTimeout time.Duration) *http.Transport {
	if headerTimeout <= 0 {
		headerTimeout = 10 * time.Second
	}
	return &http.Transport{
		DialContext:           ssrfSafeDialContext(allowLocal, dialTimeout),
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: headerTimeout,
	}
}

// newOutboundHTTPClientWithHeaderTimeout builds the ordinary safe client but
// lets a slow-by-design API have longer to start answering.
func newOutboundHTTPClientWithHeaderTimeout(allowLocal bool, timeout, headerTimeout time.Duration, maxRedirects int) *http.Client {
	baseTransport := newSSRFSafeTransportWithHeaderTimeout(allowLocal, 0, headerTimeout)
	transport := http.RoundTripper(&rateLimitedTransport{
		base:    baseTransport,
		limiter: globalOutboundLimiter,
	})
	return &http.Client{
		Timeout:       timeout,
		Transport:     transport,
		CheckRedirect: safeRedirectCheck(allowLocal, maxRedirects),
	}
}

func newOutboundHTTPClient(allowLocal bool, timeout time.Duration, maxRedirects int) *http.Client {
	baseTransport := newSSRFSafeTransport(allowLocal, 0)
	transport := http.RoundTripper(&rateLimitedTransport{
		base:    baseTransport,
		limiter: globalOutboundLimiter,
	})
	return &http.Client{
		Timeout:       timeout,
		Transport:     transport,
		CheckRedirect: safeRedirectCheck(allowLocal, maxRedirects),
	}
}

// drainAndCloseResponse discards and closes an HTTP response body so connections can be reused.
func drainAndCloseResponse(resp *http.Response) {
	if resp == nil || resp.Body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
	_ = resp.Body.Close()
}

// redirectLocationFromResponseCtx resolves a 3xx Location header against baseURL.
func redirectLocationFromResponseCtx(ctx context.Context, baseURL string, resp *http.Response, allowLocal bool) string {
	if ctx.Err() != nil || resp == nil || resp.StatusCode < 300 || resp.StatusCode >= 400 {
		return ""
	}
	location := strings.TrimSpace(resp.Header.Get("Location"))
	if location == "" {
		return ""
	}
	base, parseErr := url.Parse(baseURL)
	locURL, locErr := url.Parse(location)
	if parseErr != nil || locErr != nil {
		return ""
	}
	resolved := strings.TrimSpace(base.ResolveReference(locURL).String())
	if resolved == "" || resolved == strings.TrimSpace(baseURL) {
		return ""
	}
	if err := validateHTTPURLCtx(ctx, resolved, allowLocal); err != nil {
		return ""
	}
	return resolved
}

// safeRedirectCheck validates each redirect target against the same host rules as the initial URL.
func safeRedirectCheck(allowLocal bool, maxRedirects int) func(*http.Request, []*http.Request) error {
	return func(req *http.Request, via []*http.Request) error {
		if len(via) >= maxRedirects {
			return fmt.Errorf("too many redirects")
		}
		host := strings.TrimSpace(req.URL.Hostname())
		if host == "" {
			return fmt.Errorf("invalid redirect host")
		}
		if allowLocal {
			return nil
		}
		lookupCtx, cancel := context.WithTimeout(req.Context(), hostLookupTimeout)
		defer cancel()
		if !isPublicHostCtx(lookupCtx, host) {
			return fmt.Errorf("redirect host is not allowed")
		}
		return nil
	}
}

// sanitizeBookmarkIcon returns a safe icon basename or empty string when invalid.
func sanitizeBookmarkIcon(icon string) string {
	icon = strings.TrimSpace(icon)
	if icon == "" {
		return ""
	}
	if strings.Contains(icon, "/") || strings.Contains(icon, "\\") || strings.Contains(icon, "..") {
		return ""
	}
	if len(icon) > 200 {
		return ""
	}
	for _, r := range icon {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			continue
		}
		return ""
	}
	return icon
}
