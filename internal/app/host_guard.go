package app

import (
	"net"
	"net/http"
	"os"
	"strings"
)

/*
hostGuard keeps the write token from a page that is not the dashboard.

The dashboard hands its write token to every browser that opens it, which is
fine while the only pages that can open it are the reader's own. DNS rebinding
breaks that: a hostile site gives its name the server's address, the browser
treats the dashboard as that site's own origin, and the page reads the token
out of the HTML and writes with it. Nothing in the request says so except the
Host header, which still carries the hostile name.

So with a write token set, a request must name the server by an address that
cannot be somebody else's domain: an IP, localhost, a name without dots, a
private suffix (.local, .lan, .home.arpa, .internal, .ts.net), or one listed in
NEXTDASH_ALLOWED_HOSTS. Without a token there is nothing to hand out and the
guard stays out of the way. Status pages (/s/) carry no token and stay open.
*/
func hostGuard(next http.Handler) http.Handler {
	if writeAccessToken() == "" {
		return next
	}
	extra := allowedHostsFromEnv()
	if extra.all {
		return next
	}
	logInfo("auth", "write token set: requests must use an IP, localhost, a private name or a host in NEXTDASH_ALLOWED_HOSTS")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/s/") || hostAllowed(r.Host, extra) {
			next.ServeHTTP(w, r)
			return
		}
		logAuthDenied(r, "host_not_allowed")
		http.Error(w, "Host not allowed. Add it to NEXTDASH_ALLOWED_HOSTS.", http.StatusMisdirectedRequest)
	})
}

type allowedHosts struct {
	all    bool
	exact  map[string]bool
	suffix []string // from "*.example.com", kept as ".example.com"
}

func allowedHostsFromEnv() allowedHosts {
	out := allowedHosts{exact: map[string]bool{}}
	for _, part := range strings.Split(os.Getenv("NEXTDASH_ALLOWED_HOSTS"), ",") {
		part = strings.ToLower(strings.TrimSpace(part))
		switch {
		case part == "":
		case part == "*":
			out.all = true
		case strings.HasPrefix(part, "*."):
			out.suffix = append(out.suffix, part[1:])
		default:
			out.exact[hostWithoutPort(part)] = true
		}
	}
	return out
}

func hostWithoutPort(hostport string) string {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	return strings.Trim(strings.ToLower(strings.TrimSuffix(host, ".")), "[]")
}

var privateHostSuffixes = []string{".local", ".lan", ".home.arpa", ".internal", ".localdomain", ".ts.net", ".localhost"}

func hostAllowed(hostport string, extra allowedHosts) bool {
	host := hostWithoutPort(hostport)
	if host == "" {
		return false
	}
	if net.ParseIP(host) != nil || host == "localhost" || !strings.Contains(host, ".") || extra.exact[host] {
		return true
	}
	for _, s := range privateHostSuffixes {
		if strings.HasSuffix(host, s) {
			return true
		}
	}
	for _, s := range extra.suffix {
		if strings.HasSuffix(host, s) {
			return true
		}
	}
	return false
}
