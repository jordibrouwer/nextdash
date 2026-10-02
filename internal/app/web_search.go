package app

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

/*
Web search: the search panel asks a search engine, through this server.

The browser never talks to the engine. The engine sees this server's address,
no cookies and no browser fingerprint, and a Brave key never leaves the data
directory. Nothing is searched while someone types: the panel sends a query
only on Shift+Enter or a click, and nothing here writes the query anywhere.
*/

const (
	webSearchEngineOff     = "off"
	webSearchEngineSearxng = "searxng"
	webSearchEngineBrave   = "brave"
)

func normalizeWebSearchSettings(s *Settings) {
	switch s.WebSearchEngine {
	case webSearchEngineSearxng, webSearchEngineBrave:
	default:
		s.WebSearchEngine = webSearchEngineOff
	}
	s.WebSearchSearxngURL = normalizeSearxngURL(s.WebSearchSearxngURL)
}

// normalizeSearxngURL keeps an http(s) base address and drops a query or
// fragment pasted along with it; anything else is no address at all.
func normalizeSearxngURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimRight(u.String(), "/")
}

const (
	webSearchMaxQuery   = 500
	webSearchMaxResults = 20
	webSearchTimeout    = 5 * time.Second
	webSearchCacheTTL   = 60 * time.Second
	// A plain, common-looking agent: an unusual one is itself a fingerprint,
	// and SearXNG's bot detection turns away requests without one.
	webSearchUserAgent = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"
)

type WebSearchProvider interface {
	Name() string
	Categories() []string
	Search(ctx context.Context, query, category string) (WebSearchResponse, error)
}

type WebSearchResponse struct {
	Engine  string            `json:"engine"`
	Results []WebSearchResult `json:"results"`
	Infobox *WebSearchInfobox `json:"infobox,omitempty"`
}

type WebSearchResult struct {
	Title     string `json:"title"`
	URL       string `json:"url"`
	Snippet   string `json:"snippet"`
	Domain    string `json:"domain"`
	Published string `json:"published,omitempty"`
}

type WebSearchInfobox struct {
	Title string `json:"title"`
	Text  string `json:"text"`
	URL   string `json:"url"`
}

// webSearchError is a failure the panel can name; reason is what it shows.
type webSearchError struct{ reason string }

func (e *webSearchError) Error() string { return e.reason }

var (
	errWebSearchUnreachable  = &webSearchError{"engine_unreachable"}
	errWebSearchJSONDisabled = &webSearchError{"searxng_json_disabled"}
	errWebSearchRateLimited  = &webSearchError{"engine_rate_limited"}
	errWebSearchKeyRejected  = &webSearchError{"brave_key_rejected"}
)

func setWebSearchHeaders(req *http.Request) {
	req.Header.Set("User-Agent", webSearchUserAgent)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Language", "en")
	// Nothing else: no cookies (no jar), no Referer.
}

// isWebURL says whether a URL from an engine may reach the panel, which hands
// it to window.open: only http(s) with a host, never javascript: or data:.
func isWebURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	return (scheme == "http" || scheme == "https") && u.Host != ""
}

func resultDomain(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}

var webSearchTagRe = regexp.MustCompile(`<[^>]*>`)

// plainSnippet turns an engine's snippet into text: Brave marks the matched
// words up with <strong>, and the panel escapes whatever it is given.
func plainSnippet(s string) string {
	s = webSearchTagRe.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	return strings.Join(strings.Fields(s), " ")
}

// httpStatusError maps an engine's HTTP status onto a reason.
func httpStatusError(status int) error {
	switch {
	case status == http.StatusTooManyRequests:
		return errWebSearchRateLimited
	case status >= 200 && status < 300:
		return nil
	default:
		return errWebSearchUnreachable
	}
}

type webSearchCacheEntry struct {
	at   time.Time
	resp WebSearchResponse
}

// webSearchCacheStore keeps answers for a minute, so switching between tabs
// and back does not ask the engine twice. It lives in memory only.
type webSearchCacheStore struct {
	mu      sync.Mutex
	entries map[string]webSearchCacheEntry
}

func (c *webSearchCacheStore) get(key string, now time.Time) (WebSearchResponse, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || now.Sub(e.at) > webSearchCacheTTL {
		return WebSearchResponse{}, false
	}
	return e.resp, true
}

func (c *webSearchCacheStore) put(key string, resp WebSearchResponse, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[string]webSearchCacheEntry{}
	}
	for k, e := range c.entries {
		if now.Sub(e.at) > webSearchCacheTTL {
			delete(c.entries, k)
		}
	}
	c.entries[key] = webSearchCacheEntry{at: now, resp: resp}
}

func (c *webSearchCacheStore) reset() {
	c.mu.Lock()
	c.entries = nil
	c.mu.Unlock()
}

var webSearchCache webSearchCacheStore

// webSearchProviderFor builds the provider the settings name, or nil when
// the engine is on but not yet usable (no address, no key).
var webSearchProviderFor = func(s Settings) WebSearchProvider {
	switch s.WebSearchEngine {
	case webSearchEngineSearxng:
		if s.WebSearchSearxngURL != "" {
			return newSearxngProvider(s.WebSearchSearxngURL)
		}
	case webSearchEngineBrave:
		if key := braveSearchKey(); key != "" {
			return newBraveProvider(key)
		}
	}
	return nil
}

func normalizeWebSearchQuery(q string) string {
	q = strings.TrimSpace(q)
	if r := []rune(q); len(r) > webSearchMaxQuery {
		q = strings.TrimSpace(string(r[:webSearchMaxQuery]))
	}
	return q
}

func writeWebSearchReason(w http.ResponseWriter, status int, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"reason": reason})
}

/*
WebSearchHandler answers GET /api/web-search.

Neither the query nor the answer is logged or stored beyond the one-minute
cache: the reader asked the web something, not this dashboard.
*/
func (h *Handlers) WebSearchHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	settings := h.store.GetSettings()
	if settings.WebSearchEngine == webSearchEngineOff {
		writeWebSearchReason(w, http.StatusNotFound, "disabled")
		return
	}
	query := normalizeWebSearchQuery(r.URL.Query().Get("q"))
	if query == "" {
		writeWebSearchReason(w, http.StatusBadRequest, "empty_query")
		return
	}
	provider := webSearchProviderFor(settings)
	if provider == nil {
		writeWebSearchReason(w, http.StatusBadRequest, "not_configured")
		return
	}
	category := r.URL.Query().Get("cat")
	known := false
	for _, c := range provider.Categories() {
		known = known || c == category
	}
	if !known {
		category = "web"
	}
	key := provider.Name() + "\x00" + category + "\x00" + query
	if cached, ok := webSearchCache.get(key, time.Now()); ok {
		writeJSON(w, cached)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), webSearchTimeout)
	defer cancel()
	resp, err := provider.Search(ctx, query, category)
	if err != nil {
		reason := errWebSearchUnreachable.reason
		var named *webSearchError
		if errors.As(err, &named) {
			reason = named.reason
		}
		writeWebSearchReason(w, http.StatusBadGateway, reason)
		return
	}
	webSearchCache.put(key, resp, time.Now())
	writeJSON(w, resp)
}

// WebSearchStatusHandler tells the panel which engine is on and which tabs
// it can offer.
func (h *Handlers) WebSearchStatusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	settings := h.store.GetSettings()
	out := struct {
		Engine     string   `json:"engine"`
		Configured bool     `json:"configured"`
		Categories []string `json:"categories"`
	}{Engine: settings.WebSearchEngine, Categories: []string{}}
	switch settings.WebSearchEngine {
	case webSearchEngineSearxng:
		out.Categories = (&searxngProvider{}).Categories()
		out.Configured = settings.WebSearchSearxngURL != ""
	case webSearchEngineBrave:
		out.Categories = (&braveProvider{}).Categories()
		out.Configured = braveSearchKey() != ""
	}
	writeJSON(w, out)
}
