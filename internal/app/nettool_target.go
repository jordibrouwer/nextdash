package app

import (
	"errors"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

var (
	errNetCustomHostOff = errors.New("custom hosts are turned off in the settings")
	errNetNoHost        = errors.New("the bookmark has no host to test")
	errNetNoPort        = errors.New("no port to test; set one on the check")
)

// netTarget is what a check will talk to. Never taken from a request body: it
// is always derived from the stored bookmark and check.
type netTarget struct {
	Host string // lowercase, without port
	Port int    // 0 for ping and dns
	URL  string // http/json: origin of the bookmark's URL (the endpoint is added by those phases)
	// FallbackPort is the port a ping tries over TCP when ICMP is not allowed:
	// the check's own or the URL's port, 0 when neither says (then 443, 80).
	FallbackPort int
}

// netCheckTarget works out host, port and URL for a check. The host is the
// bookmark's own unless the check names one and the setting allows it.
func netCheckTarget(bm Bookmark, c NetCheck, s Settings) (netTarget, error) {
	host := ""
	var origin string
	if u, err := url.Parse(strings.TrimSpace(bm.URL)); err == nil {
		host = strings.ToLower(u.Hostname())
		if u.Scheme != "" && u.Host != "" {
			origin = u.Scheme + "://" + u.Host
		}
	}
	if custom := strings.ToLower(strings.TrimSpace(c.Host)); custom != "" {
		if !s.NetToolsAllowCustomHost {
			return netTarget{}, errNetCustomHostOff
		}
		if !validNetCheckHost(custom) {
			return netTarget{}, errors.New("the custom host is not a valid host name or IP address")
		}
		host = custom
		origin = ""
	}
	if host == "" {
		return netTarget{}, errNetNoHost
	}
	t := netTarget{Host: host}
	switch c.Type {
	case netTypeTCP:
		t.Port = netDefaultPort(bm, c)
		if t.Port == 0 {
			return netTarget{}, errNetNoPort
		}
	case netTypeTLS:
		t.Port = netTLSPort(bm, c)
	case netTypePing:
		t.FallbackPort = netDefaultPort(bm, c)
	case netTypeHTTP, netTypeJSON:
		t.URL = origin
	}
	return t, nil
}

// validNetCheckHost accepts an RFC 1123 host name or an IP literal of at most
// 253 characters: no scheme, port, path, zone or trailing dot.
func validNetCheckHost(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	if strings.Contains(host, "%") {
		return false
	}
	// An IP literal (IPv6 has colons, which no host name may).
	if _, err := netip.ParseAddr(host); err == nil {
		return true
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			ch := label[i]
			isAlnum := ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9'
			if !isAlnum && ch != '-' {
				return false
			}
		}
	}
	return true
}

// netDefaultPort is the check's own port, else the port in the bookmark's URL,
// else 443 or 80 from the scheme; 0 when none of those says.
func netDefaultPort(bm Bookmark, c NetCheck) int {
	if c.Port > 0 {
		return c.Port
	}
	return bookmarkURLPort(bm)
}

// netTLSPort is the port a TLS check inspects: its own, else the port of an
// https address, else 443. The port of a plain http address is not a TLS port
// (an http bookmark on :8080 has nothing to inspect there), so it is not used.
func netTLSPort(bm Bookmark, c NetCheck) int {
	if c.Port > 0 {
		return c.Port
	}
	if u, err := url.Parse(strings.TrimSpace(bm.URL)); err == nil && strings.EqualFold(u.Scheme, "https") {
		if p := bookmarkURLPort(bm); p > 0 {
			return p
		}
	}
	return 443
}

func bookmarkURLPort(bm Bookmark) int {
	u, err := url.Parse(strings.TrimSpace(bm.URL))
	if err != nil {
		return 0
	}
	if p := u.Port(); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 && n < 65536 {
			return n
		}
		return 0
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		return 443
	case "http":
		return 80
	}
	return 0
}
