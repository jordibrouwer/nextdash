package app

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// writeRoutesInSource lists every route main.go and handlers_unraid.go
// register for a method that writes, as they are written there.
func writeRoutesInSource(t *testing.T) []string {
	t.Helper()
	routeRE := regexp.MustCompile(`(?:HandleFunc|PathPrefix)\("([^"]+)"[^\n]*\.Methods\(([^)]*)\)`)
	seen := map[string]bool{}
	for _, file := range []string{"main.go", "handlers_unraid.go"} {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range routeRE.FindAllStringSubmatch(string(src), -1) {
			if regexp.MustCompile(`"(POST|PUT|PATCH|DELETE)"`).MatchString(match[2]) {
				seen[match[1]] = true
			}
		}
	}
	out := make([]string, 0, len(seen))
	for route := range seen {
		out = append(out, route)
	}
	sort.Strings(out)
	return out
}

// Every route that writes has been decided for the demo: a new one fails here
// until it is put on one of the two lists in demo_guard.go.
func TestDemoClassifiesEveryWriteRoute(t *testing.T) {
	routes := writeRoutesInSource(t)
	if len(routes) < 50 {
		t.Fatalf("found only %d write routes; the scan is broken", len(routes))
	}
	denied, allowed := map[string]bool{}, map[string]bool{}
	for _, route := range demoDeniedWrites {
		denied[route] = true
	}
	for _, route := range demoAllowedWrites {
		if denied[route] {
			t.Errorf("%s is both allowed and refused", route)
		}
		allowed[route] = true
	}
	inSource := map[string]bool{}
	for _, route := range routes {
		inSource[route] = true
		if !denied[route] && !allowed[route] {
			t.Errorf("write route %s is neither allowed nor refused in the demo (demo_guard.go)", route)
		}
	}
	for route := range allowed {
		if !inSource[route] {
			t.Errorf("allowed route %s is not registered any more", route)
		}
	}
	for route := range denied {
		if !inSource[route] && route != "/mcp" {
			t.Errorf("refused route %s is not registered any more", route)
		}
	}
}

// The files that build an HTTP client or dial themselves. Each one either goes
// through ssrfSafeDialContext, which refuses in the demo, or refuses at its own
// source. A new one fails here until it is looked at.
func TestDemoKnowsEveryOutboundClient(t *testing.T) {
	known := map[string]string{
		"url_safety.go":    "ssrfSafeDialContext itself",
		"ping.go":          "newSSRFSafeTransport",
		"handlers.go":      "newSSRFSafeTransport",
		"unraid_client.go": "newSSRFSafeTransportWithHeaderTimeout",
		"install_ping.go":  "refuses at its source",
		"push_send.go":     "refuses at its source",
		"system_docker.go": "the local Docker socket, not another host",
	}
	clientRE := regexp.MustCompile(`http\.Client\{|http\.Transport\{|http\.DefaultClient|http\.DefaultTransport|net\.Dial\(|net\.Dialer\{|http\.Get\(|http\.Post\(`)
	files, _ := filepath.Glob("*.go")
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		src, _ := os.ReadFile(file)
		if clientRE.Match(src) {
			if _, ok := known[file]; !ok {
				t.Errorf("%s builds its own HTTP client or dialer; make it refuse in the demo and add it here", file)
			}
		}
	}
}

func TestDemoDialsNoHost(t *testing.T) {
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer site.Close()
	address := strings.TrimPrefix(site.URL, "http://")
	dial := ssrfSafeDialContext(true, 0)

	t.Setenv("NEXTDASH_DEMO", "1")
	if _, err := dial(context.Background(), "tcp", address); err != errDemoOutbound {
		t.Fatalf("dial in the demo: %v", err)
	}
	demoOutboundOpen.Store(true)
	conn, err := dial(context.Background(), "tcp", address)
	demoOutboundOpen.Store(false)
	if err != nil {
		t.Fatalf("dial in the start-up window: %v", err)
	}
	conn.(net.Conn).Close()
	if err := sendInstallPing(context.Background(), "id", "v1", ""); err != errDemoOutbound {
		t.Errorf("install ping in the demo: %v", err)
	}
}

func TestDemoGuard(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "1")
	demoWriteLimiter.reset()
	demo.lastWrite.Store(0)
	reached := 0
	guard := demoGuard(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached++ }))
	serve := func(method, path, ip string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, nil)
		req.RemoteAddr = ip + ":1234"
		guard.ServeHTTP(rec, req)
		return rec
	}

	for _, path := range []string{"/api/reset", "/api/import", "/api/sources/github/run", "/api/archives/x.html", "/api/webhooks/test"} {
		if rec := serve(http.MethodPost, path, "10.0.0.1"); rec.Code != http.StatusForbidden {
			t.Errorf("POST %s: %d, want refused", path, rec.Code)
		}
	}
	if rec := serve(http.MethodGet, "/mcp", "10.0.0.1"); rec.Code != http.StatusForbidden {
		t.Errorf("GET /mcp: %d", rec.Code)
	}
	if rec := serve(http.MethodGet, "/api/webhooks", "10.0.0.1"); rec.Code != http.StatusOK || rec.Header().Get("X-Robots-Tag") == "" {
		t.Errorf("GET /api/webhooks: %d, robots %q", rec.Code, rec.Header().Get("X-Robots-Tag"))
	}
	if rec := serve(http.MethodPost, "/api/bookmarks/add", "10.0.0.2"); rec.Code != http.StatusOK || demo.lastWrite.Load() == 0 {
		t.Errorf("an allowed write: %d, idle clock %d", rec.Code, demo.lastWrite.Load())
	}
	limited := 0
	for i := 0; i < demoWritesPerMinute+5; i++ {
		if serve(http.MethodPost, "/api/bookmarks/add", "10.0.0.3").Code == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited != 5 {
		t.Errorf("%d writes refused past the limit, want 5", limited)
	}
	if serve(http.MethodPost, "/api/bookmarks/add", "10.0.0.4").Code != http.StatusOK {
		t.Error("another address was held to the first one's limit")
	}

	t.Setenv("NEXTDASH_DEMO", "")
	plain := demoGuard(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	rec := httptest.NewRecorder()
	plain.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/reset", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("outside the demo /api/reset was refused: %d", rec.Code)
	}
	demoWriteLimiter.reset()
}

func TestDemoHoldsPagesToItsLimits(t *testing.T) {
	h := newDemoHandlers(t)
	many := make([]Bookmark, demoMaxBookmarksPerPage+1)
	for i := range many {
		many[i] = Bookmark{Name: "x", URL: "https://example.com/" + string(rune('a'+i%26)) + strings.Repeat("x", i)}
	}
	if err := h.store.SaveBookmarksByPage(1, many); err == nil {
		t.Error("a page past the bookmark limit was saved")
	}
	created := 0
	for id := 10; id < 10+demoMaxPages; id++ {
		if err := h.store.SaveBookmarksByPage(id, []Bookmark{{Name: "x", URL: "https://example.com/"}}); err == nil {
			created++
		}
	}
	pages, _ := filepath.Glob(filepath.Join(ResolveDataDir(), "bookmarks-*.json"))
	if len(pages) > demoMaxPages {
		t.Errorf("%d page files, limit %d", len(pages), demoMaxPages)
	}
	if created == 0 {
		t.Error("no new page could be made at all")
	}
}
