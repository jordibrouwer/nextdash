package app

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNormalizeWebSearchSettings(t *testing.T) {
	cases := []struct {
		engine, url         string
		wantEngine, wantURL string
	}{
		{"", "", "off", ""},
		{"google", "", "off", ""},
		{"searxng", " http://192.168.1.10:8888/ ", "searxng", "http://192.168.1.10:8888"},
		{"searxng", "https://search.example.com/sub/?q=x#y", "searxng", "https://search.example.com/sub"},
		{"brave", "ftp://nope", "brave", ""},
		{"searxng", "not a url", "searxng", ""},
	}
	for _, c := range cases {
		s := Settings{WebSearchEngine: c.engine, WebSearchSearxngURL: c.url}
		normalizeWebSearchSettings(&s)
		if s.WebSearchEngine != c.wantEngine || s.WebSearchSearxngURL != c.wantURL {
			t.Errorf("(%q, %q) -> (%q, %q), want (%q, %q)", c.engine, c.url,
				s.WebSearchEngine, s.WebSearchSearxngURL, c.wantEngine, c.wantURL)
		}
	}
}

// Stored settings go through the same normalisation, so a hand-edited
// settings.json cannot switch on an engine nextDash does not know.
func TestWebSearchSettingsSurviveSave(t *testing.T) {
	h := newTestHandlers(t)
	s := h.store.GetSettings()
	if s.WebSearchEngine != "off" {
		t.Fatalf("fresh install engine = %q, want off", s.WebSearchEngine)
	}
	s.WebSearchEngine = "searxng"
	s.WebSearchSearxngURL = "http://tower:8888/"
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	got := h.store.GetSettings()
	if got.WebSearchEngine != "searxng" || got.WebSearchSearxngURL != "http://tower:8888" {
		t.Fatalf("got (%q, %q)", got.WebSearchEngine, got.WebSearchSearxngURL)
	}
}

const searxngFixture = `{
  "query": "go generics",
  "results": [
    {"url": "https://www.go.dev/doc/tutorial/generics", "title": "Tutorial: Getting started with generics",
     "content": "This tutorial introduces the <b>basics</b> of generics &amp; more.", "publishedDate": null},
    {"url": "https://example.org/post", "title": "A post", "content": "Snippet", "publishedDate": "2026-09-01T10:00:00"}
  ],
  "infoboxes": [
    {"infobox": "Go (programming language)", "content": "Go is a statically typed language.",
     "id": "https://en.wikipedia.org/wiki/Go_(programming_language)", "urls": [{"title": "Site", "url": "https://go.dev"}]}
  ]
}`

// fakeSearxng answers /search the way SearXNG does with format=json enabled,
// and remembers the last query string it saw.
func fakeSearxng(t *testing.T, status int, body string) (*httptest.Server, *string, *int) {
	t.Helper()
	var lastQuery string
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		lastQuery = r.URL.RawQuery
		if r.URL.Path != "/search" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &lastQuery, &hits
}

func TestSearxngProviderNormalises(t *testing.T) {
	srv, lastQuery, _ := fakeSearxng(t, http.StatusOK, searxngFixture)
	p := newSearxngProvider(srv.URL)
	resp, err := p.Search(context.Background(), "go generics", "news")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(*lastQuery, "format=json") || !strings.Contains(*lastQuery, "categories=news") {
		t.Fatalf("query string = %q, want format=json and categories=news", *lastQuery)
	}
	if resp.Engine != "searxng" || len(resp.Results) != 2 {
		t.Fatalf("engine=%q results=%d", resp.Engine, len(resp.Results))
	}
	first := resp.Results[0]
	if first.Domain != "go.dev" {
		t.Errorf("domain = %q, want go.dev (www. dropped)", first.Domain)
	}
	if first.Snippet != "This tutorial introduces the basics of generics & more." {
		t.Errorf("snippet = %q, want tags stripped and entities decoded", first.Snippet)
	}
	if resp.Results[1].Published != "2026-09-01T10:00:00" {
		t.Errorf("published = %q", resp.Results[1].Published)
	}
	if resp.Infobox == nil || resp.Infobox.Title != "Go (programming language)" ||
		resp.Infobox.URL != "https://en.wikipedia.org/wiki/Go_(programming_language)" {
		t.Fatalf("infobox = %+v", resp.Infobox)
	}
}

func TestSearxngProviderCategoryMapping(t *testing.T) {
	srv, lastQuery, _ := fakeSearxng(t, http.StatusOK, `{"results":[]}`)
	p := newSearxngProvider(srv.URL)
	for cat, want := range map[string]string{"web": "general", "news": "news", "video": "videos", "it": "it"} {
		if _, err := p.Search(context.Background(), "q", cat); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(*lastQuery, "categories="+want) {
			t.Errorf("cat %s sent %q, want categories=%s", cat, *lastQuery, want)
		}
	}
}

func TestSearxngProviderErrors(t *testing.T) {
	for status, want := range map[int]*webSearchError{
		http.StatusForbidden:           errWebSearchJSONDisabled,
		http.StatusTooManyRequests:     errWebSearchRateLimited,
		http.StatusInternalServerError: errWebSearchUnreachable,
	} {
		srv, _, _ := fakeSearxng(t, status, `{}`)
		_, err := newSearxngProvider(srv.URL).Search(context.Background(), "q", "web")
		if err != want {
			t.Errorf("status %d -> %v, want %v", status, err, want)
		}
	}
	// Nothing listening at all.
	_, err := newSearxngProvider("http://127.0.0.1:1").Search(context.Background(), "q", "web")
	if err != errWebSearchUnreachable {
		t.Errorf("closed port -> %v, want engine_unreachable", err)
	}
}

// The panel hands a result's URL to window.open, so only http(s) gets that far.
func TestSearxngProviderDropsNonWebURLs(t *testing.T) {
	srv, _, _ := fakeSearxng(t, http.StatusOK, `{
  "results": [
    {"url": "javascript:alert(1)", "title": "Bad", "content": "x"},
    {"url": "https://good.example/page", "title": "Good", "content": "y"}
  ],
  "infoboxes": [{"infobox": "Box", "content": "text", "id": "not a url"}]
}`)
	resp, err := newSearxngProvider(srv.URL).Search(context.Background(), "q", "web")
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Results) != 1 || resp.Results[0].URL != "https://good.example/page" {
		t.Fatalf("results = %+v, want only the https one", resp.Results)
	}
	if resp.Infobox == nil || resp.Infobox.URL != "" {
		t.Fatalf("infobox = %+v, want URL \"\"", resp.Infobox)
	}
}

func TestBraveProviderDropsNonWebURLs(t *testing.T) {
	srv, _ := fakeBrave(t, http.StatusOK, `{"web":{"results":[
    {"title":"Bad","url":"data:text/html,hi","description":"x"},
    {"title":"Good","url":"https://good.example/","description":"y"}]},
  "infobox":{"results":[{"title":"Box","description":"d","url":"javascript:void(0)"}]}}`)
	resp, err := testBraveProvider(srv).Search(context.Background(), "q", "web")
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Results) != 1 || resp.Results[0].URL != "https://good.example/" {
		t.Fatalf("results = %+v, want only the https one", resp.Results)
	}
	if resp.Infobox == nil || resp.Infobox.URL != "" {
		t.Fatalf("infobox = %+v, want URL \"\"", resp.Infobox)
	}
}

func TestIsWebURL(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://a.example/x": true, "http://a.example": true, "HTTPS://A.example": true,
		"javascript:alert(1)": false, "data:text/html,x": false, "ftp://a.example": false,
		"https://": false, "not a url": false, "": false, "//a.example/x": false,
	} {
		if got := isWebURL(raw); got != want {
			t.Errorf("isWebURL(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestWebSearchCacheExpires(t *testing.T) {
	var c webSearchCacheStore
	now := time.Unix(1_000, 0)
	c.put("k", WebSearchResponse{Engine: "x"}, now)
	if _, ok := c.get("k", now.Add(59*time.Second)); !ok {
		t.Fatal("entry gone before 60 s")
	}
	if _, ok := c.get("k", now.Add(61*time.Second)); ok {
		t.Fatal("entry still there after 60 s")
	}
}

const braveWebFixture = `{
  "web": {"results": [
    {"title": "Go <strong>generics</strong>", "url": "https://go.dev/doc/tutorial/generics",
     "description": "Learn <strong>generics</strong> in Go.", "page_age": "2026-08-01T00:00:00"}
  ]},
  "infobox": {"results": [{"title": "Go", "long_desc": "Go is a language.", "url": "https://en.wikipedia.org/wiki/Go"}]}
}`

func fakeBrave(t *testing.T, status int, body string) (*httptest.Server, *http.Request) {
	t.Helper()
	seen := &http.Request{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = *r.Clone(context.Background())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, seen
}

func testBraveProvider(srv *httptest.Server) *braveProvider {
	return &braveProvider{base: srv.URL, key: "BSA-test", client: srv.Client()}
}

func TestBraveProviderNormalises(t *testing.T) {
	srv, seen := fakeBrave(t, http.StatusOK, braveWebFixture)
	resp, err := testBraveProvider(srv).Search(context.Background(), "go generics", "web")
	if err != nil {
		t.Fatal(err)
	}
	if seen.URL.Path != "/res/v1/web/search" || seen.Header.Get("X-Subscription-Token") != "BSA-test" {
		t.Fatalf("path=%q token=%q", seen.URL.Path, seen.Header.Get("X-Subscription-Token"))
	}
	if len(resp.Results) != 1 || resp.Results[0].Title != "Go generics" ||
		resp.Results[0].Snippet != "Learn generics in Go." || resp.Results[0].Domain != "go.dev" {
		t.Fatalf("results = %+v", resp.Results)
	}
	if resp.Infobox == nil || resp.Infobox.Text != "Go is a language." {
		t.Fatalf("infobox = %+v", resp.Infobox)
	}
}

func TestBraveProviderNewsAndVideoUseTheirEndpoints(t *testing.T) {
	for cat, path := range map[string]string{"news": "/res/v1/news/search", "video": "/res/v1/videos/search"} {
		srv, seen := fakeBrave(t, http.StatusOK, `{"results":[{"title":"t","url":"https://a.example/x","description":"d"}]}`)
		resp, err := testBraveProvider(srv).Search(context.Background(), "q", cat)
		if err != nil || seen.URL.Path != path || len(resp.Results) != 1 {
			t.Errorf("%s: path=%q results=%d err=%v", cat, seen.URL.Path, len(resp.Results), err)
		}
	}
	if cats := (&braveProvider{}).Categories(); strings.Contains(strings.Join(cats, ","), "it") {
		t.Errorf("Brave has no IT category, got %v", cats)
	}
}

func TestBraveProviderRejectedKey(t *testing.T) {
	srv, _ := fakeBrave(t, http.StatusUnauthorized, `{}`)
	if _, err := testBraveProvider(srv).Search(context.Background(), "q", "web"); err != errWebSearchKeyRejected {
		t.Fatalf("401 -> %v, want brave_key_rejected", err)
	}
}

func TestBraveProviderDoesNotForwardTheKeyOnRedirect(t *testing.T) {
	var leaked atomic.Bool
	elsewhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Subscription-Token") != "" {
			leaked.Store(true)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"web":{"results":[]}}`)
	}))
	t.Cleanup(elsewhere.Close)
	brave := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.URL+"/res/v1/web/search", http.StatusFound)
	}))
	t.Cleanup(brave.Close)

	// The real redirect policy, with loopback allowed so the fakes can be reached.
	p := &braveProvider{base: brave.URL, key: "BSA-test", client: newOutboundHTTPClient(true, webSearchTimeout, braveMaxRedirects)}
	if _, err := p.Search(context.Background(), "q", "web"); err == nil {
		t.Fatal("a redirected answer should be an error")
	}
	if leaked.Load() {
		t.Fatal("X-Subscription-Token followed the redirect")
	}
}

func TestBraveKeyIsStoredAndNeverReturned(t *testing.T) {
	h := newTestHandlers(t)
	call := func(method, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.WebSearchBraveKeyHandler(rec, httptest.NewRequest(method, "/api/web-search/brave-key", strings.NewReader(body)))
		return rec
	}
	if rec := call("PUT", `{"key":"BSA-secret"}`); rec.Code != http.StatusOK {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	if rec := call("GET", ""); strings.Contains(rec.Body.String(), "BSA-secret") || !strings.Contains(rec.Body.String(), `"set":true`) {
		t.Fatalf("get = %s", rec.Body)
	}
	if braveSearchKey() != "BSA-secret" {
		t.Fatal("key not readable by the server")
	}
	info, err := os.Stat(webSearchSecretsFilePath())
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v err = %v", info.Mode().Perm(), err)
	}
	if rec := call("DELETE", ""); rec.Code != http.StatusOK || braveSearchKey() != "" {
		t.Fatalf("delete: %d, key now %q", rec.Code, braveSearchKey())
	}
}

func webSearchTestHandlers(t *testing.T, engine, searxngURL string) *Handlers {
	t.Helper()
	h := newTestHandlers(t)
	webSearchCache.reset()
	t.Cleanup(webSearchCache.reset)
	s := h.store.GetSettings()
	s.WebSearchEngine = engine
	s.WebSearchSearxngURL = searxngURL
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	return h
}

func getWebSearch(h *Handlers, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.WebSearchHandler(rec, httptest.NewRequest("GET", target, nil))
	return rec
}

func TestWebSearchHandlerOffIs404(t *testing.T) {
	h := webSearchTestHandlers(t, "off", "")
	rec := getWebSearch(h, "/api/web-search?q=x")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"reason":"disabled"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestWebSearchHandlerNeedsQueryAndConfig(t *testing.T) {
	h := webSearchTestHandlers(t, "searxng", "")
	if rec := getWebSearch(h, "/api/web-search?q=%20%20"); rec.Code != http.StatusBadRequest ||
		!strings.Contains(rec.Body.String(), "empty_query") {
		t.Fatalf("blank query: %d %s", rec.Code, rec.Body)
	}
	if rec := getWebSearch(h, "/api/web-search?q=x"); rec.Code != http.StatusBadRequest ||
		!strings.Contains(rec.Body.String(), "not_configured") {
		t.Fatalf("no url: %d %s", rec.Code, rec.Body)
	}
}

func TestWebSearchHandlerSearchesAndCaches(t *testing.T) {
	srv, _, hits := fakeSearxng(t, http.StatusOK, searxngFixture)
	h := webSearchTestHandlers(t, "searxng", srv.URL)
	for i := 0; i < 2; i++ {
		rec := getWebSearch(h, "/api/web-search?q=go+generics&cat=web")
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"domain":"go.dev"`) {
			t.Fatalf("call %d: %d %s", i, rec.Code, rec.Body)
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("answer must not be cached by the browser")
		}
	}
	if *hits != 1 {
		t.Fatalf("engine asked %d times, want 1 (second from cache)", *hits)
	}
	getWebSearch(h, "/api/web-search?q=go+generics&cat=news")
	if *hits != 2 {
		t.Fatalf("another category must not come from the cache (hits=%d)", *hits)
	}
}

func TestWebSearchHandlerEngineFailureIs502WithReason(t *testing.T) {
	srv, _, _ := fakeSearxng(t, http.StatusForbidden, `{}`)
	h := webSearchTestHandlers(t, "searxng", srv.URL)
	rec := getWebSearch(h, "/api/web-search?q=x")
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "searxng_json_disabled") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestWebSearchHandlerCutsLongQueries(t *testing.T) {
	srv, lastQuery, _ := fakeSearxng(t, http.StatusOK, `{"results":[]}`)
	h := webSearchTestHandlers(t, "searxng", srv.URL)
	getWebSearch(h, "/api/web-search?q="+strings.Repeat("a", 900))
	vals, _ := url.ParseQuery(*lastQuery)
	if n := len(vals.Get("q")); n != 500 {
		t.Fatalf("engine got %d characters, want 500", n)
	}
}

func TestWebSearchStatus(t *testing.T) {
	h := webSearchTestHandlers(t, "brave", "")
	rec := httptest.NewRecorder()
	h.WebSearchStatusHandler(rec, httptest.NewRequest("GET", "/api/web-search/status", nil))
	body := rec.Body.String()
	if !strings.Contains(body, `"engine":"brave"`) || !strings.Contains(body, `"configured":false`) ||
		strings.Contains(body, `"it"`) {
		t.Fatalf("status = %s", body)
	}
}

// A new SearXNG address is asked, not answered from the old one's cache:
// Test said "Working" for a broken new address.
func TestWebSearchCacheFollowsTheAddress(t *testing.T) {
	oldSrv, _, _ := fakeSearxng(t, http.StatusOK, searxngFixture)
	newSrv, _, newHits := fakeSearxng(t, http.StatusForbidden, `{}`)
	h := webSearchTestHandlers(t, "searxng", oldSrv.URL)
	if rec := getWebSearch(h, "/api/web-search?q=go"); rec.Code != http.StatusOK {
		t.Fatalf("old address: %d", rec.Code)
	}
	s := h.store.GetSettings()
	s.WebSearchSearxngURL = newSrv.URL
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if rec := getWebSearch(h, "/api/web-search?q=go"); rec.Code != http.StatusBadGateway || *newHits != 1 {
		t.Fatalf("new address: %d, asked %d times", rec.Code, *newHits)
	}
}

// SearXNG answers 200 with nothing when its engines are blocked; that is a
// failure, not "Nothing found" cached for a minute.
func TestWebSearchUnresponsiveEnginesAreAFailure(t *testing.T) {
	srv, _, _ := fakeSearxng(t, http.StatusOK, `{"results":[],"unresponsive_engines":[["google","CAPTCHA"]]}`)
	h := webSearchTestHandlers(t, "searxng", srv.URL)
	if rec := getWebSearch(h, "/api/web-search?q=x"); rec.Code != http.StatusBadGateway {
		t.Fatalf("code = %d, want 502", rec.Code)
	}
}

// With a long title both engines were cut to the same 16 characters, and the
// browser refused the second one.
func TestOpenSearchNamesStayApartOnALongTitle(t *testing.T) {
	a := openSearchShortName("Jordi's Homelab Dashboard")
	b := openSearchShortName("Jordi's Homelab Dashboard", " Web")
	if a == b || len([]rune(b)) > 16 || !strings.HasSuffix(b, " Web") {
		t.Fatalf("names %q and %q", a, b)
	}
}
