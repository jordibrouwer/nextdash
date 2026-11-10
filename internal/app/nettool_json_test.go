package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// runJSONTest runs a JSON check against a bookmark at rawURL.
func runJSONTest(t *testing.T, g netGuard, bm Bookmark, c NetCheck) NetResult {
	t.Helper()
	h := &Handlers{}
	c.Type = netTypeJSON
	target, err := netCheckTarget(bm, c, Settings{})
	if err != nil {
		t.Fatal(err)
	}
	return h.runJSON(context.Background(), g, target, bm, c)
}

func jsonServer(body string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(body))
	}))
}

func TestNetJSONOps(t *testing.T) {
	srv := jsonServer(`{"status":"degraded","count":42,"ok":true,"tags":["a","Beta"],"n":null,"db":{"state":"ok"},"text":"Hello World","numtext":"7"}`)
	defer srv.Close()
	cases := []struct {
		name         string
		path, op, ex string
		ok           bool
		class        string
	}{
		{"eq match", "db.state", "eq", "ok", true, ""},
		{"eq mismatch", "status", "eq", "ok", false, "content"},
		{"eq number", "count", "eq", "42", true, ""},
		{"eq number written differently", "count", "eq", "42.0", true, ""},
		{"eq bool", "ok", "eq", "true", true, ""},
		{"eq null", "n", "eq", "null", true, ""},
		{"ne holds", "status", "ne", "ok", true, ""},
		{"ne fails", "status", "ne", "degraded", false, "content"},
		{"gt holds", "count", "gt", "41", true, ""},
		{"gt equal is not more", "count", "gt", "42", false, "content"},
		{"lt holds", "count", "lt", "43", true, ""},
		{"lt fails", "count", "lt", "42", false, "content"},
		{"gt on numeric text", "numtext", "gt", "6", true, ""},
		{"gt on a word is not a number", "status", "gt", "1", false, "content"},
		{"contains in a string, any case", "text", "contains", "WORLD", true, ""},
		{"contains misses", "text", "contains", "moon", false, "content"},
		{"contains in a list", "tags", "contains", "beta", true, ""},
		{"contains not in a list", "tags", "contains", "gamma", false, "content"},
		{"contains on a number is false", "count", "contains", "4", false, "content"},
		{"exists", "db", "exists", "", true, ""},
		{"exists of null", "n", "exists", "", true, ""},
		{"exists ignores expect", "db.state", "exists", "whatever", true, ""},
		{"missing path", "db.nope", "exists", "", false, "content"},
		{"missing path is not zero", "nope", "eq", "0", false, "content"},
		{"missing path with ne", "nope", "ne", "x", false, "content"},
		{"array index", "tags[1]", "eq", "Beta", true, ""},
		{"negative array index", "tags[-1]", "eq", "Beta", true, ""},
		{"array index out of range", "tags[5]", "exists", "", false, "content"},
		{"count with #", "tags#", "eq", "2", true, ""},
	}
	for _, c := range cases {
		res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: c.path, Op: c.op, Expect: c.ex})
		if res.OK != c.ok || res.Class != c.class {
			t.Errorf("%s: ok=%v class=%q error=%q", c.name, res.OK, res.Class, res.Error)
			continue
		}
		if c.ok && (res.JSON == nil || !res.JSON.OK || !res.JSON.Found || res.JSON.Status != 200) {
			t.Errorf("%s: %+v", c.name, res.JSON)
		}
	}
	// A failure says what it found and what it wanted.
	res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "status", Op: "eq", Expect: "ok"})
	if res.JSON.Value != "degraded" || res.JSON.Type != "string" || res.Detail != "degraded" ||
		!strings.Contains(res.Error, "status is degraded, but the check expects ok") {
		t.Fatalf("%+v %q %q", res.JSON, res.Detail, res.Error)
	}
	// An object is described, not printed.
	res = runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "db", Op: "exists"})
	if res.JSON.Value != "object (1 key)" || res.JSON.Type != "object" {
		t.Fatalf("%+v", res.JSON)
	}
	// Numbers read the way they were written, not as 4.2e+01.
	res = runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "count", Op: "exists"})
	if res.JSON.Value != "42" || res.JSON.Type != "number" {
		t.Fatalf("%+v", res.JSON)
	}
}

func TestNetJSONPathLimits(t *testing.T) {
	for name, c := range map[string]struct {
		path, op, expect string
		ok               bool
	}{
		"plain":               {"status", "eq", "ok", true},
		"200 characters":      {strings.Repeat("a", 200), "exists", "", true},
		"201 characters":      {strings.Repeat("a", 201), "exists", "", false},
		"empty":               {"", "exists", "", false},
		"blank":               {"   ", "exists", "", false},
		"control character":   {"a\nb", "exists", "", false},
		"no operator":         {"a", "", "x", false},
		"unknown operator":    {"a", "regex", "x", false},
		"eq needs a value":    {"a", "eq", "", false},
		"exists needs none":   {"a", "exists", "", true},
		"long expected value": {"a", "eq", strings.Repeat("x", 201), false},
		"gt needs a number":   {"a", "gt", "many", false},
		"gt with a number":    {"a", "gt", "3.5", true},
		"lt needs a number":   {"a", "lt", "", false},
		"operator any case":   {"a", "EQ", "x", true},
		"expected value cut":  {"a", "contains", strings.Repeat("é", 200), true},
		"expected control":    {"a", "eq", "x\x00", false},
	} {
		_, _, _, err := normalizeNetJSON(c.path, c.op, c.expect)
		if (err == nil) != c.ok {
			t.Errorf("%s: %v", name, err)
		}
	}
	// Through the list validation, with the endpoint rules of the HTTP check.
	bm := Bookmark{URL: "https://a.example/"}
	built := func(c NetCheck) error {
		c.Type = netTypeJSON
		_, err := normalizeNetChecks([]NetCheck{c}, nil, bm, netTestSettings(), nil, 0)
		return err
	}
	if err := built(NetCheck{Path: "status", Op: "eq", Expect: "ok", Endpoint: "/health"}); err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string]NetCheck{
		"no path":            {Op: "exists"},
		"a full url":         {Path: "a", Op: "exists", Endpoint: "https://evil.example/x"},
		"scheme-relative":    {Path: "a", Op: "exists", Endpoint: "//evil.example"},
		"unknown credential": {Path: "a", Op: "exists", CredentialID: "nope-missing"},
	} {
		t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
		if built(c) == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// A stored check keeps what the form owns and drops what exists does not use.
	out, err := normalizeNetChecks([]NetCheck{{Type: netTypeJSON, Path: " db.state ", Op: "EXISTS", Expect: "left over"}}, nil, bm, netTestSettings(), nil, 0)
	if err != nil || out[0].Path != "db.state" || out[0].Op != "exists" || out[0].Expect != "" {
		t.Fatalf("%+v %v", out, err)
	}
}

func TestNetJSONRedactsSecretPaths(t *testing.T) {
	const secret = "s3cr3t-value-123"
	srv := jsonServer(`{"api_token":"` + secret + `","auth":{"Password":"` + secret + `"},"keys":["` + secret + `"],"client_secret":"` + secret + `","settings":{"token":"` + secret + `","name":"x"},"public":"fine"}`)
	defer srv.Close()
	for _, path := range []string{"api_token", "auth.Password", "keys[0]", "client_secret"} {
		for _, op := range []string{"eq", "ne", "contains", "exists"} {
			expect := secret
			if op == "ne" {
				expect = "other-value"
			}
			res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: path, Op: op, Expect: expect})
			raw, _ := json.Marshal(res)
			if strings.Contains(string(raw), secret) {
				t.Errorf("%s %s: the value is in the result: %s", path, op, raw)
			}
			if res.JSON == nil || res.JSON.Value != "[hidden]" || res.Detail != "[hidden]" {
				t.Errorf("%s %s: %+v detail %q", path, op, res.JSON, res.Detail)
			}
			if op != "exists" && res.JSON.Expect != "[hidden]" {
				t.Errorf("%s %s: expected value shown: %q", path, op, res.JSON.Expect)
			}
			// What the history would keep.
			if d := res.sample(false).D; strings.Contains(d, secret) {
				t.Errorf("%s: the sample carries the value: %q", path, d)
			}
		}
	}
	// A failing comparison on a secret path does not quote the value.
	res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "api_token", Op: "eq", Expect: "wrong"})
	if res.OK || strings.Contains(res.Error, secret) || strings.Contains(res.Error, "wrong") {
		t.Fatalf("%q", res.Error)
	}
	// An object holding a secret is described by its size, never printed.
	res = runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "settings", Op: "exists"})
	raw, _ := json.Marshal(res)
	if strings.Contains(string(raw), secret) || res.JSON.Value != "object (2 keys)" {
		t.Fatalf("%s", raw)
	}
	// A public path is shown.
	res = runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "public", Op: "eq", Expect: "fine"})
	if !res.OK || res.JSON.Value != "fine" || res.Detail != "fine" {
		t.Fatalf("%+v", res)
	}
}

func TestNetJSONCredentialNeverInResult(t *testing.T) {
	const secret = "json-credential-secret-key"
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	// The server echoes the credential back in the answer and in its error.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("X-Api-Key") != secret && r.URL.Query().Get("apikey") != secret {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"no key"}`))
			return
		}
		fmt.Fprintf(w, `{"echo":%q,"status":"ok"}`, secret)
	}))
	defer srv.Close()
	if err := saveHealthCredential("svc", HealthCredential{Label: "svc", Headers: map[string]string{"X-Api-Key": secret}}); err != nil {
		t.Fatal(err)
	}
	if err := saveHealthCredential("qry", HealthCredential{Label: "qry", Query: map[string]string{"apikey": secret}}); err != nil {
		t.Fatal(err)
	}
	bm := Bookmark{URL: srv.URL, CredentialID: "svc"}
	check := func(c NetCheck) {
		t.Helper()
		res := runJSONTest(t, localGuard, bm, c)
		raw, _ := json.Marshal(res)
		if strings.Contains(string(raw), secret) {
			t.Fatalf("the credential is in the result: %s", raw)
		}
		if d := res.sample(false).D; strings.Contains(d, secret) {
			t.Fatalf("the credential is in the sample: %q", d)
		}
	}
	// The bookmark's own credential, a value that echoes it, and a mismatch that would quote it.
	res := runJSONTest(t, localGuard, bm, NetCheck{Path: "status", Op: "eq", Expect: "ok"})
	if !res.OK {
		t.Fatalf("the bookmark's credential was not sent: %+v", res)
	}
	check(NetCheck{Path: "echo", Op: "exists"})
	check(NetCheck{Path: "echo", Op: "eq", Expect: "something else"})
	check(NetCheck{Path: "echo", Op: "contains", Expect: "nope"})
	res = runJSONTest(t, localGuard, bm, NetCheck{Path: "echo", Op: "exists"})
	if res.JSON.Value != "[hidden]" || res.Detail != "[hidden]" {
		t.Fatalf("an echoed credential was shown: %q %q", res.JSON.Value, res.Detail)
	}
	// A credential of its own, living in the query: the address never shows it.
	res = runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "status", Op: "eq", Expect: "ok", CredentialID: "qry"})
	if !res.OK {
		t.Fatalf("the check's credential was not sent: %+v", res)
	}
	check(NetCheck{Path: "status", Op: "eq", Expect: "ok", CredentialID: "qry"})
	// A refused answer says so without any credential in it.
	res = runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "status", Op: "exists"})
	if res.OK || res.Class != "http" || !strings.Contains(res.Error, "401") || !strings.Contains(res.Error, "credential") {
		t.Fatalf("%+v", res)
	}
	// A transport error that would print the address with its query.
	dead, _ := net.Listen("tcp", "127.0.0.1:0")
	port := dead.Addr().(*net.TCPAddr).Port
	dead.Close()
	bad := runJSONTest(t, localGuard, Bookmark{URL: fmt.Sprintf("http://127.0.0.1:%d", port)}, NetCheck{Path: "a", Op: "exists", Endpoint: "/x?apikey=" + secret, CredentialID: "qry"})
	raw, _ := json.Marshal(bad)
	if bad.OK || strings.Contains(string(raw), secret) {
		t.Fatalf("%s", raw)
	}
	// A server that drops the connection makes the transport error name the
	// address it asked for; a key typed into the path must not come back.
	const typed = "typed-in-the-path-1234"
	dropper := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			conn.Close()
		}
	}))
	defer dropper.Close()
	dropped := runJSONTest(t, localGuard, Bookmark{URL: dropper.URL}, NetCheck{Path: "a", Op: "exists", Endpoint: "/x?token=" + typed})
	raw, _ = json.Marshal(dropped)
	if dropped.OK || dropped.Class == "" || strings.Contains(string(raw), typed) || !strings.Contains(dropped.Error, "/x?…") {
		t.Fatalf("%s", raw)
	}
}

// The credential goes to the host the run started at and nowhere else.
func TestNetJSONCredentialOnlyToTheSameHost(t *testing.T) {
	const secret = "same-host-only-secret"
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	var otherSaw, otherQuery atomic.Value
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		otherSaw.Store(r.Header.Get("X-Api-Key"))
		otherQuery.Store(r.URL.RawQuery)
		w.Write([]byte(`{"landed":true}`))
	}))
	defer other.Close()
	var firstSaw atomic.Value
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hop":
			http.Redirect(w, r, other.URL+"/landing", http.StatusFound)
		case "/inside":
			http.Redirect(w, r, "/final", http.StatusFound)
		default:
			firstSaw.Store(r.Header.Get("X-Api-Key"))
			w.Write([]byte(`{"landed":true}`))
		}
	}))
	defer first.Close()
	if err := saveHealthCredential("svc", HealthCredential{Label: "svc", Headers: map[string]string{"X-Api-Key": secret}, Query: map[string]string{"apikey": secret}}); err != nil {
		t.Fatal(err)
	}
	run := func(endpoint string) NetResult {
		return runJSONTest(t, localGuard, Bookmark{URL: first.URL}, NetCheck{Path: "landed", Op: "eq", Expect: "true", Endpoint: endpoint, CredentialID: "svc"})
	}
	if res := run("/"); !res.OK || firstSaw.Load() != secret {
		t.Fatalf("same host: %+v saw %v", res, firstSaw.Load())
	}
	firstSaw.Store("")
	if res := run("/inside"); !res.OK || firstSaw.Load() != secret {
		t.Fatalf("same-host redirect: %+v saw %v", res, firstSaw.Load())
	}
	res := run("/hop")
	if !res.OK {
		t.Fatalf("redirect: %+v", res)
	}
	if got, _ := otherSaw.Load().(string); got != "" {
		t.Fatalf("the credential header followed a redirect to another host: %q", got)
	}
	if got, _ := otherQuery.Load().(string); strings.Contains(got, secret) {
		t.Fatalf("the credential query followed a redirect to another host: %q", got)
	}
}

func TestNetJSONNonJSONAnswer(t *testing.T) {
	cases := []struct {
		name, ctype, body, want string
	}{
		{"a web page", "text/html", "<!doctype html><html></html>", "web page, not JSON"},
		{"plain text", "text/plain", "OK", "not JSON"},
		{"empty", "application/json", "", "answered with nothing"},
		{"broken JSON", "application/json", `{"a":`, "not JSON"},
	}
	for _, c := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", c.ctype)
			w.Write([]byte(c.body))
		}))
		res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "a", Op: "exists"})
		srv.Close()
		if res.OK || res.Class != "content" || !strings.Contains(res.Error, c.want) || res.Detail != "not JSON" {
			t.Errorf("%s: %+v", c.name, res)
		}
		if res.JSON == nil || res.JSON.Found || res.JSON.Status != 200 {
			t.Errorf("%s: %+v", c.name, res.JSON)
		}
	}
	// A status that is not 2xx is an http failure, before the body is looked at.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()
	res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "status", Op: "eq", Expect: "ok"})
	if res.OK || res.Class != "http" || res.JSON.Status != 500 || !strings.Contains(res.Error, "500") {
		t.Fatalf("%+v", res)
	}
}

func TestNetJSONBodyLimit(t *testing.T) {
	var sent atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","pad":"`))
		chunk := []byte(strings.Repeat("x", 64<<10))
		for i := 0; i < 32; i++ { // 2 MB
			n, err := w.Write(chunk)
			sent.Add(int64(n))
			if err != nil {
				return
			}
		}
		w.Write([]byte(`"}`))
	}))
	defer srv.Close()
	res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "status", Op: "eq", Expect: "ok"})
	if res.OK || res.Class != "content" || !strings.Contains(res.Error, "larger than 1 MB") {
		t.Fatalf("%+v", res)
	}
	if res.JSON.Size != netHTTPMaxBody {
		t.Fatalf("size %d, want the limit %d", res.JSON.Size, netHTTPMaxBody)
	}
	// A body that never ends is cut at the limit, not waited for.
	endless := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","pad":"`))
		chunk := []byte(strings.Repeat("x", 32<<10))
		for {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}))
	defer endless.Close()
	start := time.Now()
	res = runJSONTest(t, localGuard, Bookmark{URL: endless.URL}, NetCheck{Path: "status", Op: "eq", Expect: "ok", TimeoutSec: 3})
	if res.OK || res.Class != "content" || time.Since(start) > 2*time.Second {
		t.Fatalf("an endless body: %+v after %v", res, time.Since(start))
	}
	// Just under the limit still works.
	small := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"status":"ok","pad":%q}`, strings.Repeat("x", 900<<10))
	}))
	defer small.Close()
	if res := runJSONTest(t, localGuard, Bookmark{URL: small.URL}, NetCheck{Path: "status", Op: "eq", Expect: "ok"}); !res.OK {
		t.Fatalf("%+v", res)
	}
}

func TestNetJSONUsesEndpointAndAccept(t *testing.T) {
	var gotPath, gotAccept, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotAccept, gotMethod = r.URL.RequestURI(), r.Header.Get("Accept"), r.Method
		w.Write([]byte(`{"status":"up"}`))
	}))
	defer srv.Close()
	res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL + "/ignored/page"}, NetCheck{Path: "status", Op: "eq", Expect: "up", Endpoint: "/api/health?full=1"})
	if !res.OK || gotPath != "/api/health?full=1" || gotAccept != "application/json" || gotMethod != "GET" {
		t.Fatalf("%+v %q %q %q", res, gotPath, gotAccept, gotMethod)
	}
	// Without an endpoint the bookmark's own address is requested.
	runJSONTest(t, localGuard, Bookmark{URL: srv.URL + "/own"}, NetCheck{Path: "status", Op: "exists"})
	if gotPath != "/own" {
		t.Fatalf("%q", gotPath)
	}
	// The address in the result has no query.
	if res.Port != 0 && res.JSON == nil {
		t.Fatalf("%+v", res)
	}
}

// A hop to a private address is refused and never requested, like the HTTP check.
func TestNetJSONRedirectToPrivateBlocked(t *testing.T) {
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
		res := runJSONTest(t, g, Bookmark{URL: "http://93.184.216.34/"}, NetCheck{Path: "a", Op: "exists"})
		srv.Close()
		if res.OK || res.Class != "guard" || !strings.Contains(res.Error, "address guard") {
			t.Fatalf("%s: %+v", target, res)
		}
		if secretHits.Load() != 0 {
			t.Fatalf("%s: the blocked hop was requested", target)
		}
		if strings.Contains(res.Error, "token") {
			t.Fatalf("%s: a query value in the error: %q", target, res.Error)
		}
	}
}

// The first request is guarded too, and the demo reaches out to nothing.
func TestNetJSONStartBlockedAndDemo(t *testing.T) {
	srv := jsonServer(`{"a":1}`)
	defer srv.Close()
	res := runJSONTest(t, netGuard{allowLocal: false}, Bookmark{URL: srv.URL}, NetCheck{Path: "a", Op: "exists"})
	if res.OK || res.Class != "guard" {
		t.Fatalf("%+v", res)
	}
	t.Setenv("NEXTDASH_DEMO", "1")
	res = runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "a", Op: "exists"})
	if res.OK || res.Class != "demo" {
		t.Fatalf("%+v", res)
	}
}

func TestNetJSONRedirectLimit(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Redirect(w, r, "/again", http.StatusFound)
	}))
	defer srv.Close()
	res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "a", Op: "exists"})
	if res.OK || res.Class != "http" || !strings.Contains(res.Error, "More than 10 redirects") || hits.Load() != netHTTPMaxRedirects+1 {
		t.Fatalf("%+v hits %d", res, hits.Load())
	}
}

// What the planner and the history see: a JSON value never becomes a state.
func TestNetJSONSampleAndState(t *testing.T) {
	srv := jsonServer(`{"mode":"slow","via":"via TCP"}`)
	defer srv.Close()
	res := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "mode", Op: "eq", Expect: "slow"})
	if !res.OK || res.Slow || res.Ms < 1 {
		t.Fatalf("%+v", res)
	}
	s := res.sample(false)
	if !s.Up || s.D != "slow" || s.PingMs != res.Ms || s.Fail != "" {
		t.Fatalf("%+v", s)
	}
	c := NetCheck{Type: netTypeJSON}
	st := netCheckStateFor(c, []HealthSample{s})
	if st.Slow || st.ViaTCP || !st.OK {
		t.Fatalf("a value read as a state: %+v", st)
	}
	via := netCheckStateFor(c, []HealthSample{{Up: true, D: "via TCP"}})
	if via.ViaTCP {
		t.Fatalf("%+v", via)
	}
	// A failed run is down with the class the alert reads.
	bad := runJSONTest(t, localGuard, Bookmark{URL: srv.URL}, NetCheck{Path: "mode", Op: "eq", Expect: "fast"})
	if bad.OK || bad.Class != "content" || bad.sample(false).Up || bad.sample(false).Fail != "content" {
		t.Fatalf("%+v", bad)
	}
	// A long value is cut in the sample and in the result.
	long := jsonServer(`{"v":"` + strings.Repeat("y", 500) + `"}`)
	defer long.Close()
	res = runJSONTest(t, localGuard, Bookmark{URL: long.URL}, NetCheck{Path: "v", Op: "exists"})
	if r := []rune(res.JSON.Value); len(r) > netJSONMaxValue+1 {
		t.Fatalf("value of %d characters", len(r))
	}
	if r := []rune(res.sample(false).D); len(r) > netDetailMax {
		t.Fatalf("sample detail of %d characters", len(r))
	}
}

func TestNetJSONIsBuiltAndLabelled(t *testing.T) {
	if !netTypesBuilt[netTypeJSON] {
		t.Fatal("json is not built")
	}
	if got := netCheckLabel(NetCheck{Type: netTypeJSON, Path: "db.state"}, Bookmark{}); got != "JSON · db.state" {
		t.Fatalf("%q", got)
	}
	if got := netCheckLabel(NetCheck{Type: netTypeJSON}, Bookmark{}); got != "JSON" {
		t.Fatalf("%q", got)
	}
}
