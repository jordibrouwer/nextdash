package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

func statusRouter(h *Handlers) *mux.Router {
	r := mux.NewRouter()
	r.NotFoundHandler = http.HandlerFunc(h.NotFoundHandler)
	r.HandleFunc("/s/{token}", h.StatusPageView).Methods("GET")
	r.HandleFunc("/s/{token}/data.json", h.StatusPageData).Methods("GET")
	return r
}

func statusGet(r http.Handler, path, remote string, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", path, nil)
	req.RemoteAddr = remote
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func enableStatusPage(t *testing.T, cfg StatusPageConfig) string {
	t.Helper()
	cfg.Enabled = true
	if err := writeStatusPage(cfg); err != nil {
		t.Fatal(err)
	}
	tok, err := ensureStatusToken()
	if err != nil {
		t.Fatal(err)
	}
	statusPageLimiter.reset()
	return tok
}

func TestStatusPageFailuresAreTheSame404(t *testing.T) {
	h := newTestHandlers(t)
	fakeStatusContainers(t, nil, nil)
	r := statusRouter(h)
	unknown := statusGet(r, "/no-such-page", "203.0.113.9:1", nil)

	same := func(name string, rec *httptest.ResponseRecorder) {
		t.Helper()
		if rec.Code != 404 || rec.Body.String() != unknown.Body.String() || rec.Header().Get("Content-Type") != unknown.Header().Get("Content-Type") {
			t.Errorf("%s: got %d, or a body that differs from an unknown path", name, rec.Code)
		}
		if rec.Header().Get("X-Robots-Tag") != "" {
			t.Errorf("%s: a 404 must not carry the page's own headers", name)
		}
	}

	tok := enableStatusPage(t, StatusPageConfig{})
	if err := writeStatusPage(StatusPageConfig{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	same("disabled", statusGet(r, "/s/"+tok, "203.0.113.9:1", nil))

	tok = enableStatusPage(t, StatusPageConfig{})
	same("wrong token", statusGet(r, "/s/"+strings.Repeat("x", 43), "203.0.113.9:1", nil))
	same("wrong token data", statusGet(r, "/s/"+strings.Repeat("x", 43)+"/data.json", "203.0.113.9:1", nil))

	enableStatusPage(t, StatusPageConfig{LANOnly: true})
	same("LAN only from public IP", statusGet(r, "/s/"+tok, "203.0.113.9:1", nil))
	if rec := statusGet(r, "/s/"+tok, "192.168.1.20:1", nil); rec.Code != 200 {
		t.Errorf("LAN only from a private IP = %d, want 200", rec.Code)
	}

	enableStatusPage(t, StatusPageConfig{})
	for i := 0; i < 60; i++ {
		statusGet(r, "/s/"+strings.Repeat("y", 43), "198.51.100.7:1", nil)
	}
	same("rate limited, right token", statusGet(r, "/s/"+tok, "198.51.100.7:1", nil))
}

func TestStatusPageServesWithHeaders(t *testing.T) {
	h := newTestHandlers(t)
	fakeStatusContainers(t, nil, nil)
	r := statusRouter(h)
	tok := enableStatusPage(t, StatusPageConfig{Title: "Home services", Notice: "Guest wifi: HomeGuest"})

	page := statusGet(r, "/s/"+tok, "203.0.113.9:1", map[string]string{"Accept-Language": "nl-NL,nl;q=0.9,en;q=0.5"})
	if page.Code != 200 {
		t.Fatalf("page = %d", page.Code)
	}
	body := page.Body.String()
	for _, want := range []string{"Home services", "Guest wifi: HomeGuest", `lang="nl"`, `name="robots" content="noindex, nofollow"`, "/s/" + tok + "/data.json", `id="status-strings"`, "/static/status/status.js"} {
		if !strings.Contains(body, want) {
			t.Errorf("page lacks %q", want)
		}
	}
	if strings.Contains(strings.ToLower(body), "nextdash") {
		t.Error("the status page must not name nextDash")
	}
	for k, v := range map[string]string{
		"Cache-Control":   "no-store",
		"X-Robots-Tag":    "noindex, nofollow",
		"Referrer-Policy": "no-referrer",
	} {
		if got := page.Header().Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	if csp := page.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") || strings.Contains(csp, "unsafe-inline") || !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("CSP = %q", csp)
	}

	data := statusGet(r, "/s/"+tok+"/data.json", "203.0.113.9:1", nil)
	var snap statusSnapshot
	if data.Code != 200 || json.Unmarshal(data.Body.Bytes(), &snap) != nil || snap.Title != "Home services" {
		t.Fatalf("data.json = %d %s", data.Code, data.Body.String())
	}
	if data.Header().Get("X-Robots-Tag") == "" || data.Header().Get("Cache-Control") != "no-store" {
		t.Error("data.json lacks the page headers")
	}
}

func TestStatusPageLang(t *testing.T) {
	cases := map[string]string{"": "en", "de-DE,de;q=0.9": "de", "pt-BR,fr;q=0.8": "fr", "zh-CN": "zh", "ja": "en", "es;q=0, nl": "nl"}
	for in, want := range cases {
		if got := statusPageLang(in); got != want {
			t.Errorf("%q = %q, want %q", in, got, want)
		}
	}
}

func TestIsHomeNetworkIP(t *testing.T) {
	for ip, want := range map[string]bool{"192.168.1.2": true, "10.0.0.1": true, "127.0.0.1": true, "::1": true, "fd00::1": true, "8.8.8.8": false, "": false, "nonsense": false} {
		if got := isHomeNetworkIP(ip); got != want {
			t.Errorf("%s = %v", ip, got)
		}
	}
}

func TestStatusRequestIsHomeBehindProxies(t *testing.T) {
	req := func(remote string, headers map[string]string) *http.Request {
		r := httptest.NewRequest("GET", "/s/x", nil)
		r.RemoteAddr = remote
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		return r
	}
	t.Setenv("NEXTDASH_TRUSTED_PROXIES", "")
	cases := []struct {
		name string
		r    *http.Request
		want bool
	}{
		{"direct LAN", req("192.168.1.20:5000", nil), true},
		{"direct internet", req("203.0.113.9:5000", nil), false},
		{"untrusted LAN proxy, XFF", req("192.168.1.2:5000", map[string]string{"X-Forwarded-For": "203.0.113.9"}), false},
		{"untrusted LAN proxy, XFF claims LAN", req("192.168.1.2:5000", map[string]string{"X-Forwarded-For": "192.168.1.50"}), false},
		{"untrusted LAN proxy, Forwarded", req("192.168.1.2:5000", map[string]string{"Forwarded": "for=203.0.113.9"}), false},
		{"untrusted LAN proxy, X-Real-IP", req("192.168.1.2:5000", map[string]string{"X-Real-IP": "203.0.113.9"}), false},
	}
	for _, c := range cases {
		if got := statusRequestIsHome(c.r); got != c.want {
			t.Errorf("%s = %v, want %v", c.name, got, c.want)
		}
	}

	t.Setenv("NEXTDASH_TRUSTED_PROXIES", "192.168.1.2")
	if !statusRequestIsHome(req("192.168.1.2:5000", map[string]string{"X-Forwarded-For": "192.168.1.50"})) {
		t.Error("trusted proxy forwarding a LAN client is home")
	}
	if statusRequestIsHome(req("192.168.1.2:5000", map[string]string{"X-Forwarded-For": "203.0.113.9"})) {
		t.Error("trusted proxy forwarding an internet client is not home")
	}
	// A trusted proxy that forwards no address cannot vouch for anyone.
	if statusRequestIsHome(req("192.168.1.2:5000", nil)) {
		t.Error("trusted proxy without X-Forwarded-For is not home")
	}
	// nginx's $proxy_add_x_forwarded_for keeps what the client wrote first.
	if statusRequestIsHome(req("192.168.1.2:5000", map[string]string{"X-Forwarded-For": "192.168.1.50, 203.0.113.9"})) {
		t.Error("a client-written LAN address left of the real one must not count as home")
	}
}

func TestStatusVisitorStopsAtAnUnreadableHop(t *testing.T) {
	t.Setenv("NEXTDASH_TRUSTED_PROXIES", "192.168.1.2")
	req := func(xff string) *http.Request {
		r := httptest.NewRequest("GET", "/s/x", nil)
		r.RemoteAddr = "192.168.1.2:5000"
		r.Header.Set("X-Forwarded-For", xff)
		return r
	}
	// A proxy that writes a port: the real hop is still read, not skipped.
	if statusRequestIsHome(req("192.168.1.50, 203.0.113.9:443")) {
		t.Error("a forged LAN entry left of a hop with a port must not count as home")
	}
	if got := statusVisitorKey(req("10.0.0.1, 203.0.113.9:443")); got != "203.0.113.9" {
		t.Errorf("rate-limit key = %q, want the real hop", got)
	}
	// A hop that is no address at all: unknown, so not home.
	if statusRequestIsHome(req("192.168.1.50, unknown")) {
		t.Error("an unreadable hop must not let the walk reach client-written entries")
	}
}

func TestStatusVisitorKeyIgnoresClientWrittenHops(t *testing.T) {
	t.Setenv("NEXTDASH_TRUSTED_PROXIES", "192.168.1.2")
	key := func(xff string) string {
		r := httptest.NewRequest("GET", "/s/x", nil)
		r.RemoteAddr = "192.168.1.2:5000"
		r.Header.Set("X-Forwarded-For", xff)
		return statusVisitorKey(r)
	}
	if a, b := key("10.0.0.1, 203.0.113.9"), key("10.0.0.2, 203.0.113.9"); a != b || a != "203.0.113.9" {
		t.Fatalf("keys %q and %q: a forged left entry must not buy a new rate-limit bucket", a, b)
	}
}

func TestStatusPageLANOnlyRefusesUntrustedProxy(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_TRUSTED_PROXIES", "")
	fakeStatusContainers(t, nil, nil)
	r := statusRouter(h)
	tok := enableStatusPage(t, StatusPageConfig{LANOnly: true})
	unknown := statusGet(r, "/no-such-page", "192.168.1.2:1", nil)
	rec := statusGet(r, "/s/"+tok, "192.168.1.2:1", map[string]string{"X-Forwarded-For": "203.0.113.9"})
	if rec.Code != 404 || rec.Body.String() != unknown.Body.String() {
		t.Fatalf("internet visitor via an untrusted LAN proxy got %d", rec.Code)
	}
}
