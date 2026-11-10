package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// runHTTPTest runs an HTTP-detail check of a bookmark at rawURL.
func runHTTPTest(t *testing.T, g netGuard, bm Bookmark, c NetCheck) NetResult {
	t.Helper()
	h := &Handlers{}
	c.Type = netTypeHTTP
	target, err := netCheckTarget(bm, c, Settings{})
	if err != nil {
		t.Fatal(err)
	}
	return h.runHTTPDetail(context.Background(), g, target, bm, c)
}

var localGuard = netGuard{allowLocal: true}

func TestNetHTTPTimings(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(40 * time.Millisecond) // before the first byte
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(200)
		w.Write([]byte(strings.Repeat("x", 100)))
	}))
	defer srv.Close()
	res := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL + "/"}, NetCheck{ID: "h1"})
	if !res.OK || res.Class != "" || res.HTTP == nil || res.HTTP.Status != 200 {
		t.Fatalf("%+v %+v", res, res.HTTP)
	}
	tl := res.HTTP.Timings
	if tl == nil || tl.WaitMs < 40 || tl.TTFBMs < 40 || tl.TotalMs < tl.TTFBMs || tl.ConnectMs < 1 || tl.RedirectMs != 0 {
		t.Fatalf("timings %+v", tl)
	}
	if res.Ms != tl.TTFBMs {
		t.Fatalf("sample time %d is not the first byte %d", res.Ms, tl.TTFBMs)
	}
	if res.HTTP.Size != 100 || res.HTTP.Proto != "HTTP/1.1" || res.HTTP.IP != "127.0.0.1" || res.Detail != "200" {
		t.Fatalf("%+v detail %q", res.HTTP, res.Detail)
	}
	if res.HTTP.ExpectStatus != "200-299" {
		t.Fatalf("default rule %q", res.HTTP.ExpectStatus)
	}
}

func TestNetHTTPRedirectChain(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/a", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/b?token=secret", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/b", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/c", http.StatusFound) })
	mux.HandleFunc("/c", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("done")) })
	srv := httptest.NewServer(mux)
	defer srv.Close()
	res := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL + "/a"}, NetCheck{})
	if !res.OK || res.HTTP == nil || len(res.HTTP.Redirects) != 2 {
		t.Fatalf("%+v %+v", res, res.HTTP)
	}
	r := res.HTTP.Redirects
	if r[0].Status != 301 || !strings.HasSuffix(r[0].URL, "/a") || r[1].Status != 302 || !strings.HasSuffix(r[1].URL, "/b?…") {
		t.Fatalf("chain %+v", r)
	}
	if !strings.HasSuffix(res.HTTP.URL, "/c") || res.Detail != "200 · 2 redirects" || res.HTTP.Timings.RedirectMs < 1 {
		t.Fatalf("end %q detail %q timings %+v", res.HTTP.URL, res.Detail, res.HTTP.Timings)
	}
	raw, _ := json.Marshal(res)
	if strings.Contains(string(raw), "secret") {
		t.Fatalf("a query value reached the result: %s", raw)
	}
}

func TestNetHTTPRedirectLimit(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Redirect(w, r, "/again", http.StatusFound)
	}))
	defer srv.Close()
	res := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{})
	if res.OK || res.Class != "http" || !strings.Contains(res.Error, "More than 10 redirects") {
		t.Fatalf("%+v", res)
	}
	if n := hits.Load(); n != netHTTPMaxRedirects+1 {
		t.Fatalf("%d requests for a limit of %d redirects", n, netHTTPMaxRedirects)
	}
}

// A hop to a private address is shown and not requested when local bookmarks
// are off. The start is a public literal address whose dial is redirected to
// the test server (dialHook), so the guard itself is the real one.
func TestNetHTTPRedirectToPrivateBlocked(t *testing.T) {
	for _, target := range []string{"http://10.255.255.1/x", "http://127.0.0.1:%d/secret?token=abc", "http://[::1]/y", "http://169.254.169.254/latest/"} {
		var secretHits atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/secret" {
				secretHits.Add(1)
			}
			to := target
			if strings.Contains(to, "%d") {
				to = fmt.Sprintf(to, portOf(r.Context().Value(http.LocalAddrContextKey).(net.Addr)))
			}
			http.Redirect(w, r, to, http.StatusFound)
		}))
		g := netGuard{allowLocal: false, dialHook: func(ctx context.Context, network, address string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp", strings.TrimPrefix(srv.URL, "http://"))
		}}
		res := runHTTPTest(t, g, Bookmark{URL: "http://93.184.216.34/"}, NetCheck{})
		srv.Close()
		if res.OK || res.Class != "guard" || res.HTTP == nil {
			t.Fatalf("%s: %+v", target, res)
		}
		hops := res.HTTP.Redirects
		if len(hops) != 2 || hops[0].Status != 302 || hops[0].Blocked || !hops[1].Blocked || hops[1].Status != 0 {
			t.Fatalf("%s: chain %+v", target, hops)
		}
		if secretHits.Load() != 0 {
			t.Fatalf("%s: the blocked hop was requested", target)
		}
		if strings.Contains(hops[1].URL, "token") || !strings.Contains(res.Error, "address guard") {
			t.Fatalf("%s: %q %q", target, hops[1].URL, res.Error)
		}
	}
}

func portOf(a net.Addr) int { return a.(*net.TCPAddr).Port }

// The first request is guarded too: a private start with local bookmarks off.
func TestNetHTTPStartBlocked(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	res := runHTTPTest(t, netGuard{allowLocal: false}, Bookmark{URL: srv.URL}, NetCheck{})
	if res.OK || res.Class != "guard" {
		t.Fatalf("%+v", res)
	}
}

func TestNetHTTPHeaderLimits(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for i := 0; i < 70; i++ {
			w.Header().Set(fmt.Sprintf("X-Filler-%02d", i), strings.Repeat("v", 150))
		}
		w.Header().Set("X-Huge", strings.Repeat("z", 9000))
		w.Header().Set("Set-Cookie", "session=topsecretcookie; Path=/")
		w.Header().Set("Authorization", "Bearer topsecrettoken")
		w.Header().Set("Server", "testsrv")
		w.Write([]byte("ok"))
	}))
	defer srv.Close()
	res := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{})
	if !res.OK || res.HTTP == nil {
		t.Fatalf("%+v", res)
	}
	hs := res.HTTP.Headers
	if len(hs) > netHTTPMaxHeaders || len(hs) == 0 || res.HTTP.HeadersTotal < 73 {
		t.Fatalf("%d headers shown of %d", len(hs), res.HTTP.HeadersTotal)
	}
	bytes := 0
	for _, hd := range hs {
		bytes += len(hd.Name) + len(hd.Value)
		if len([]rune(hd.Value)) > netHTTPMaxHeaderValue+1 {
			t.Fatalf("%s is %d long", hd.Name, len(hd.Value))
		}
	}
	if bytes > netHTTPMaxHeaderBytes {
		t.Fatalf("%d bytes of headers", bytes)
	}
}

func TestNetHTTPHeadersRedacted(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Set-Cookie", "session=topsecretcookie; Path=/")
		w.Header().Add("Set-Cookie", "other=topsecretcookie2")
		w.Header().Set("Authorization", "Bearer topsecrettoken")
		w.Header().Set("Www-Authenticate", "Basic realm=x")
		w.WriteHeader(200)
	}))
	defer srv.Close()
	res := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{})
	raw, _ := json.Marshal(res)
	if strings.Contains(string(raw), "topsecret") {
		t.Fatalf("a secret header value reached the result: %s", raw)
	}
	seen := map[string]string{}
	for _, hd := range res.HTTP.Headers {
		seen[hd.Name] = hd.Value
	}
	if seen["set-cookie"] != "[hidden]" || seen["authorization"] != "[hidden]" || seen["www-authenticate"] != "Basic realm=x" {
		t.Fatalf("%v", seen)
	}
}

func TestNetHTTPBodyLimit(t *testing.T) {
	var sent atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chunk := []byte(strings.Repeat("a", 32<<10))
		for i := 0; i < 2048; i++ { // 64 MB
			n, err := w.Write(chunk)
			sent.Add(int64(n))
			if err != nil {
				return
			}
		}
	}))
	defer srv.Close()
	res := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{})
	if !res.OK || res.Class != "" || res.HTTP == nil {
		t.Fatalf("%+v", res)
	}
	if res.HTTP.Size != netHTTPMaxBody || !res.HTTP.SizeCapped {
		t.Fatalf("size %d capped=%v", res.HTTP.Size, res.HTTP.SizeCapped)
	}
	// The client stopped reading: the server could not push all 64 MB out.
	time.Sleep(50 * time.Millisecond)
	if n := sent.Load(); n >= 60<<20 {
		t.Fatalf("the server sent %d bytes: the body was read past the limit", n)
	}
}

func TestNetHTTPExpectStatusAndHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Server", "Fancy/2.1")
		if r.URL.Path == "/slow" {
			time.Sleep(60 * time.Millisecond)
			return
		}
		w.WriteHeader(404)
	}))
	defer srv.Close()
	bm := Bookmark{URL: srv.URL + "/missing"}

	// 404 against the default rule: down, class http.
	res := runHTTPTest(t, localGuard, bm, NetCheck{})
	if res.OK || res.Class != "http" || !strings.Contains(res.Error, "404") || res.Detail != "404" {
		t.Fatalf("default: %+v", res)
	}
	// 404 expected: up.
	res = runHTTPTest(t, localGuard, bm, NetCheck{ExpectStatus: "404"})
	if !res.OK || res.HTTP.ExpectStatus != "404" {
		t.Fatalf("404 expected: %+v", res)
	}
	// A list and a range.
	if res = runHTTPTest(t, localGuard, bm, NetCheck{ExpectStatus: "200,404-405"}); !res.OK {
		t.Fatalf("list: %+v", res)
	}
	// Header present and containing (case-insensitive).
	if res = runHTTPTest(t, localGuard, bm, NetCheck{ExpectStatus: "404", ExpectHeader: "Server: fancy"}); !res.OK {
		t.Fatalf("header contains: %+v", res)
	}
	if res = runHTTPTest(t, localGuard, bm, NetCheck{ExpectStatus: "404", ExpectHeader: "server"}); !res.OK {
		t.Fatalf("header exists: %+v", res)
	}
	// Header missing, and header with other text: down, class content.
	res = runHTTPTest(t, localGuard, bm, NetCheck{ExpectStatus: "404", ExpectHeader: "x-nope"})
	if res.OK || res.Class != "content" || !strings.Contains(res.Error, "x-nope") {
		t.Fatalf("missing header: %+v", res)
	}
	res = runHTTPTest(t, localGuard, bm, NetCheck{ExpectStatus: "404", ExpectHeader: "server: nginx"})
	if res.OK || res.Class != "content" {
		t.Fatalf("other text: %+v", res)
	}
	// Status wins over header when both fail.
	if res = runHTTPTest(t, localGuard, bm, NetCheck{ExpectStatus: "200", ExpectHeader: "x-nope"}); res.Class != "http" {
		t.Fatalf("status first: %+v", res)
	}
	// MaxMs: slow, still up.
	slow := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL + "/slow"}, NetCheck{MaxMs: 20})
	if !slow.OK || !slow.Slow || !strings.HasSuffix(slow.Detail, "slow") {
		t.Fatalf("slow: %+v", slow)
	}
	fast := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL + "/slow"}, NetCheck{MaxMs: 5000})
	if !fast.OK || fast.Slow || fast.Detail != "200" {
		t.Fatalf("not slow: %+v", fast)
	}
}

func TestNetHTTPUsesBookmarkCredential(t *testing.T) {
	const secret = "http-detail-secret-key"
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	var otherSaw atomic.Value
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		otherSaw.Store(r.Header.Get("X-Api-Key"))
		w.Write([]byte("other"))
	}))
	defer other.Close()
	var firstSaw atomic.Value
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/hop" {
			http.Redirect(w, r, other.URL+"/landing", http.StatusFound)
			return
		}
		firstSaw.Store(r.Header.Get("X-Api-Key"))
		w.Write([]byte("first"))
	}))
	defer first.Close()
	if err := saveHealthCredential("svc", HealthCredential{Label: "svc", Headers: map[string]string{"X-Api-Key": secret}}); err != nil {
		t.Fatal(err)
	}
	h := &Handlers{}
	run := func(path string) NetResult {
		bm := Bookmark{URL: first.URL + path, CredentialID: "svc"}
		c := NetCheck{Type: netTypeHTTP}
		target, _ := netCheckTarget(bm, c, Settings{})
		return h.runHTTPDetail(context.Background(), localGuard, target, bm, c)
	}
	// Same host: the key goes.
	res := run("/")
	if !res.OK || firstSaw.Load() != secret {
		t.Fatalf("same host: %+v saw %v", res, firstSaw.Load())
	}
	// After a redirect to another host: it does not.
	res = run("/hop")
	if !res.OK || len(res.HTTP.Redirects) != 1 {
		t.Fatalf("redirect: %+v", res)
	}
	if got, _ := otherSaw.Load().(string); got != "" {
		t.Fatalf("the credential followed a redirect to another host: %q", got)
	}
	raw, _ := json.Marshal(res)
	if strings.Contains(string(raw), secret) {
		t.Fatalf("the credential is in the result: %s", raw)
	}
}

// A transport error names the address it asked for, query and all. The
// credential of a bookmark may live in that query, so no failure sentence of any
// kind (plain, tls) carries it, nor the address with its query.
func TestNetHTTPFailureNeverShowsTheQuery(t *testing.T) {
	const secret = "query-credential-value-9"
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := saveHealthCredential("qry", HealthCredential{Label: "qry", Query: map[string]string{"apikey": secret}}); err != nil {
		t.Fatal(err)
	}
	dropper := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if conn, _, err := w.(http.Hijacker).Hijack(); err == nil {
			conn.Close()
		}
	}))
	defer dropper.Close()
	// A certificate the client does not trust: the tls class.
	untrusted := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer untrusted.Close()
	for name, base := range map[string]string{
		"dropped connection": dropper.URL,
		"untrusted tls":      untrusted.URL,
	} {
		for _, typed := range []string{"", "?token=" + secret} {
			bm := Bookmark{URL: base + "/api" + typed, CredentialID: "qry"}
			res := runHTTPTest(t, localGuard, bm, NetCheck{})
			raw, _ := json.Marshal(res)
			if res.OK || res.Error == "" || strings.Contains(string(raw), secret) || strings.Contains(res.Error, "/api") || strings.Contains(res.Error, "apikey") {
				t.Errorf("%s %q: %s", name, typed, raw)
			}
			if d := res.sample(false).D; strings.Contains(d, secret) {
				t.Errorf("%s: sample %q", name, d)
			}
		}
	}
	// The tls branch keeps its own sentence.
	res := runHTTPTest(t, localGuard, Bookmark{URL: untrusted.URL + "/api?apikey=" + secret}, NetCheck{})
	if res.Class != "tls" || strings.Contains(res.Error, secret) || !strings.HasPrefix(res.Error, "The secure connection failed:") {
		t.Fatalf("%+v", res)
	}
}

// netErrText takes the address out of a transport error, so a host that is
// called dns.example or tls.example cannot decide the class of a failure.
func TestNetFailureClassIgnoresTheHostName(t *testing.T) {
	for _, host := range []string{"dns.example", "tls.example", "timeout.example", "refused.example", "certificate.example", "redirect.example"} {
		err := &url.Error{Op: "Get", URL: "https://" + host + "/path?apikey=SECRET1234", Err: io.EOF}
		if got := netErrorClass(err); got != "other" {
			t.Errorf("%s: class %q, want other", host, got)
		}
		text := netErrText(err)
		if strings.Contains(text, host) || strings.Contains(text, "SECRET1234") {
			t.Errorf("%s: text %q carries the address", host, text)
		}
		out := (netGuard{}).netFail(context.Background(), NetResult{Host: host}, err, time.Second)
		if out.Class != "other" || strings.Contains(out.Error, "SECRET1234") || strings.Contains(out.Error, host) {
			t.Errorf("%s: %+v", host, out)
		}
	}
	// An address that is left in a sentence loses its query.
	if got := netErrText(errors.New("redirected to https://x.example/a?token=SECRET1234&b=1#frag next")); strings.Contains(got, "SECRET1234") || !strings.Contains(got, "https://x.example/a?…") {
		t.Fatalf("%q", got)
	}
	// A real failure is still classified by its cause.
	err := &url.Error{Op: "Get", URL: "https://dns.example/", Err: syscall.ECONNREFUSED}
	if got := netErrorClass(err); got != "refused" {
		t.Fatalf("refused: %q", got)
	}
	err = &url.Error{Op: "Get", URL: "https://dns.example/", Err: errors.New("net/http: TLS handshake timeout")}
	if got := netErrorClass(err); got != "timeout" {
		t.Fatalf("timeout text: %q", got)
	}
}

// A guard refusal says only what to change. The address it points at is its own
// field, for the owner's screen: the sentence reaches alerts and webhooks.
func TestNetGuardRefusalSentenceNamesNoAddress(t *testing.T) {
	out := (netGuard{allowLocal: false}).netFail(context.Background(), NetResult{Host: "192.168.1.20"}, errNetGuardBlocked, time.Second)
	if out.Class != "guard" || out.Error != netGuardSentence {
		t.Fatalf("%+v", out)
	}
	if strings.Contains(out.Error, "192.168") {
		t.Fatalf("the sentence names the address: %q", out.Error)
	}
	if out.GuardAddr != "192.168.1.20" {
		t.Fatalf("the owner's field: %q", out.GuardAddr)
	}
	if !strings.Contains(netGuardSentence, "allow local bookmarks to test it") {
		t.Fatal(netGuardSentence)
	}
}

// A check that aims at a host of its own never gets the bookmark's credential
// (it goes only to the bookmark's own scheme and host:port).
func TestNetHTTPCredentialNotSentToCustomHost(t *testing.T) {
	const secret = "http-custom-host-secret"
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	var saw atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		saw.Store(r.Header.Get("X-Api-Key") + "|" + r.URL.RawQuery)
		w.Write([]byte("ok"))
	}))
	defer srv.Close()
	if err := saveHealthCredential("svc", HealthCredential{Label: "svc", Headers: map[string]string{"X-Api-Key": secret}, Query: map[string]string{"apikey": secret}}); err != nil {
		t.Fatal(err)
	}
	port := srv.Listener.Addr().(*net.TCPAddr).Port
	bm := Bookmark{URL: fmt.Sprintf("http://127.0.0.1:%d", port), CredentialID: "svc"}
	h := &Handlers{}
	run := func(c NetCheck) NetResult {
		c.Type = netTypeHTTP
		target, err := netCheckTarget(bm, c, Settings{NetToolsAllowCustomHost: true})
		if err != nil {
			t.Fatal(err)
		}
		return h.runHTTPDetail(context.Background(), localGuard, target, bm, c)
	}
	if res := run(NetCheck{}); !res.OK || !strings.Contains(saw.Load().(string), secret) {
		t.Fatalf("own host: %+v saw %v", res, saw.Load())
	}
	saw.Store("")
	res := run(NetCheck{Host: "localhost"})
	if !res.OK {
		t.Fatalf("custom host: %+v", res)
	}
	if got := saw.Load().(string); strings.Contains(got, secret) {
		t.Fatalf("the credential went to the check's own host: %q", got)
	}
}

func TestNetHTTPInsecureTLSOnlyWhenTheBookmarkAllowsIt(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) }))
	defer srv.Close()
	// An untrusted certificate (httptest's own) fails verification by default.
	res := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{})
	if res.OK || res.Class != "tls" {
		t.Fatalf("untrusted: %+v", res)
	}
	res = runHTTPTest(t, localGuard, Bookmark{URL: srv.URL, AllowInsecureTLS: true}, NetCheck{})
	if !res.OK || res.HTTP.Timings.TLSMs < 1 || res.HTTP.Proto != "HTTP/2" && res.HTTP.Proto != "HTTP/1.1" {
		t.Fatalf("allowed: %+v", res)
	}
}

func TestNetHTTPRefusedAndDemo(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	res := runHTTPTest(t, localGuard, Bookmark{URL: fmt.Sprintf("http://127.0.0.1:%d", port)}, NetCheck{})
	if res.OK || res.Class != "refused" {
		t.Fatalf("refused: %+v", res)
	}
	t.Setenv("NEXTDASH_DEMO", "1")
	res = runHTTPTest(t, localGuard, Bookmark{URL: "http://127.0.0.1:1"}, NetCheck{})
	if res.OK || res.Class != "demo" {
		t.Fatalf("demo: %+v", res)
	}
}

func TestNetHTTPRequestURL(t *testing.T) {
	cases := []struct {
		bm, endpoint, host, want string
	}{
		{"https://a.example/x/y?z=1", "", "", "https://a.example/x/y?z=1"},
		{"https://a.example:8443/x", "/health?full=1", "", "https://a.example:8443/health?full=1"},
		{"https://a.example", "", "", "https://a.example/"},
		{"https://a.example/x", "/h", "b.example", "https://b.example/h"},
		{"http://a.example:8080/x", "", "10.0.0.5", "http://10.0.0.5:8080/"},
	}
	for _, tc := range cases {
		bm := Bookmark{URL: tc.bm}
		c := NetCheck{Type: netTypeHTTP, Endpoint: tc.endpoint, Host: tc.host}
		tgt, err := netCheckTarget(bm, c, Settings{NetToolsAllowCustomHost: true})
		if err != nil {
			t.Fatal(err)
		}
		u, err := netHTTPRequestURL(bm, c, tgt)
		if err != nil || u.String() != tc.want {
			t.Errorf("%+v: %v %v, want %s", tc, u, err, tc.want)
		}
	}
	if _, err := netHTTPRequestURL(Bookmark{URL: "ftp://a.example"}, NetCheck{}, netTarget{Host: "a.example", URL: "ftp://a.example"}); err == nil {
		t.Error("ftp is not an http address")
	}
}

func TestNetHTTPValidation(t *testing.T) {
	s := Settings{NetToolsMaxChecks: 10}
	bm := Bookmark{URL: "https://a.example"}
	bad := []NetCheck{
		{Type: netTypeHTTP, Endpoint: "health"},
		{Type: netTypeHTTP, Endpoint: "//evil.example/x"},
		{Type: netTypeHTTP, Endpoint: "/a b"},
		{Type: netTypeHTTP, Endpoint: "/a\\b"},
		{Type: netTypeHTTP, Endpoint: "/a#frag"},
		{Type: netTypeHTTP, Endpoint: "/" + strings.Repeat("a", 250)},
		{Type: netTypeHTTP, ExpectStatus: "ok"},
		{Type: netTypeHTTP, ExpectStatus: "999"},
		{Type: netTypeHTTP, ExpectHeader: ": nginx"},
		{Type: netTypeHTTP, ExpectHeader: "bad name: x"},
	}
	for _, c := range bad {
		if _, err := normalizeNetChecks([]NetCheck{c}, nil, bm, s, map[string]bool{}, 0); err == nil {
			t.Errorf("accepted %+v", c)
		}
	}
	out, err := normalizeNetChecks([]NetCheck{{Type: netTypeHTTP, Endpoint: " /health?x=1 ", ExpectStatus: "200, 204", ExpectHeader: " Server: nginx ", MaxMs: 300}}, nil, bm, s, map[string]bool{}, 0)
	if err != nil || len(out) != 1 {
		t.Fatal(err)
	}
	if c := out[0]; c.Endpoint != "/health?x=1" || c.ExpectStatus != "200,204" || c.ExpectHeader != "Server: nginx" || c.MaxMs != 300 {
		t.Fatalf("%+v", c)
	}
	// The fields belong to the http type only.
	out, _ = normalizeNetChecks([]NetCheck{{Type: netTypeTCP, Port: 22, Endpoint: "/x", ExpectStatus: "200"}}, nil, bm, s, map[string]bool{}, 0)
	if out[0].Endpoint != "" || out[0].ExpectStatus != "" {
		t.Fatalf("%+v", out[0])
	}
}

// Many small headers: the count limit, not the byte limit, is what stops them.
func TestNetHTTPHeaderCountLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for i := 0; i < 80; i++ {
			w.Header().Set(fmt.Sprintf("X-Small-%02d", i), "v")
		}
	}))
	defer srv.Close()
	res := runHTTPTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{})
	if res.HTTP == nil || len(res.HTTP.Headers) != netHTTPMaxHeaders || res.HTTP.HeadersTotal < 80 {
		t.Fatalf("%+v", res.HTTP)
	}
}

func TestNetHTTPProtoName(t *testing.T) {
	for in, want := range map[string]string{"HTTP/2.0": "HTTP/2", "HTTP/1.1": "HTTP/1.1", "HTTP/1.0": "HTTP/1.0", "HTTP/3.0": "HTTP/3"} {
		if got := netHTTPProto(in); got != want {
			t.Errorf("%s -> %s, want %s", in, got, want)
		}
	}
}
