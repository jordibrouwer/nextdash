package main

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
)

// isPublicHost returns true when host resolves only to routable (non-private) addresses.
func isPublicHost(host string) bool {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "" || host == "localhost" {
		return false
	}

	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return false
	}

	for _, ip := range ips {
		addr, ok := netip.AddrFromSlice(ip)
		if !ok {
			return false
		}
		if addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified() {
			return false
		}
	}

	return true
}

func validateHTTPURL(rawURL string, allowLocal bool) error {
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

	if !isPublicHost(parsedURL.Hostname()) {
		return fmt.Errorf("URL host is not allowed")
	}

	return nil
}

func validatePublicHTTPURL(rawURL string) error {
	return validateHTTPURL(rawURL, false)
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
		if !isPublicHost(host) {
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
