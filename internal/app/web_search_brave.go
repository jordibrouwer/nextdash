package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// braveAPIBase is a var so tests can point the provider at a fake.
var braveAPIBase = "https://api.search.brave.com"

var bravePath = map[string]string{
	"web": "/res/v1/web/search", "news": "/res/v1/news/search", "video": "/res/v1/videos/search",
}

type braveProvider struct {
	base   string
	key    string
	client *http.Client
}

// braveMaxRedirects is none: Go forwards custom headers on a redirect, and
// X-Subscription-Token would go with it to wherever the answer points. Brave's
// API answers directly.
const braveMaxRedirects = 0

func newBraveProvider(key string) *braveProvider {
	return &braveProvider{base: braveAPIBase, key: key, client: newOutboundHTTPClient(false, webSearchTimeout, braveMaxRedirects)}
}

func (p *braveProvider) Name() string         { return webSearchEngineBrave }
func (p *braveProvider) Categories() []string { return []string{"web", "news", "video"} }

type braveItem struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Description string `json:"description"`
	PageAge     string `json:"page_age"`
}

type braveBody struct {
	Web struct {
		Results []braveItem `json:"results"`
	} `json:"web"`
	Results []braveItem `json:"results"` // news and videos answer at the top level
	Infobox struct {
		Results []struct {
			Title       string `json:"title"`
			LongDesc    string `json:"long_desc"`
			Description string `json:"description"`
			URL         string `json:"url"`
		} `json:"results"`
	} `json:"infobox"`
}

func (p *braveProvider) Search(ctx context.Context, query, category string) (WebSearchResponse, error) {
	path, ok := bravePath[category]
	if !ok {
		path = bravePath["web"]
	}
	params := url.Values{}
	params.Set("q", query)
	params.Set("count", "20")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.base+path+"?"+params.Encode(), nil)
	if err != nil {
		return WebSearchResponse{}, errWebSearchUnreachable
	}
	setWebSearchHeaders(req)
	req.Header.Set("X-Subscription-Token", p.key)
	resp, err := p.client.Do(req)
	if err != nil {
		return WebSearchResponse{}, errWebSearchUnreachable
	}
	defer drainAndCloseResponse(resp)
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return WebSearchResponse{}, errWebSearchKeyRejected
	}
	if err := httpStatusError(resp.StatusCode); err != nil {
		return WebSearchResponse{}, err
	}
	var body braveBody
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&body); err != nil {
		return WebSearchResponse{}, errWebSearchUnreachable
	}
	items := body.Web.Results
	if len(items) == 0 {
		items = body.Results
	}
	out := WebSearchResponse{Engine: webSearchEngineBrave, Results: []WebSearchResult{}}
	for _, it := range items {
		if len(out.Results) == webSearchMaxResults {
			break
		}
		if !isWebURL(it.URL) {
			continue
		}
		out.Results = append(out.Results, WebSearchResult{
			Title: plainSnippet(it.Title), URL: it.URL, Snippet: plainSnippet(it.Description),
			Domain: resultDomain(it.URL), Published: it.PageAge,
		})
	}
	if len(body.Infobox.Results) > 0 {
		ib := body.Infobox.Results[0]
		text := ib.LongDesc
		if text == "" {
			text = ib.Description
		}
		link := ""
		if isWebURL(ib.URL) {
			link = ib.URL
		}
		out.Infobox = &WebSearchInfobox{Title: plainSnippet(ib.Title), Text: plainSnippet(text), URL: link}
	}
	return out, nil
}

func webSearchSecretsFilePath() string {
	return filepath.Join(ResolveDataDir(), "web-search-secrets.json")
}

var webSearchSecretsMu sync.Mutex

type webSearchSecrets struct {
	BraveKey string `json:"braveKey,omitempty"`
}

func readWebSearchSecrets() webSearchSecrets {
	var out webSearchSecrets
	if data, err := os.ReadFile(webSearchSecretsFilePath()); err == nil {
		_ = json.Unmarshal(data, &out)
	}
	return out
}

func braveSearchKey() string {
	webSearchSecretsMu.Lock()
	defer webSearchSecretsMu.Unlock()
	return strings.TrimSpace(readWebSearchSecrets().BraveKey)
}

func saveBraveSearchKey(key string) error {
	webSearchSecretsMu.Lock()
	defer webSearchSecretsMu.Unlock()
	secrets := readWebSearchSecrets()
	secrets.BraveKey = strings.TrimSpace(key)
	if secrets.BraveKey == "" {
		err := os.Remove(webSearchSecretsFilePath())
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	data, err := json.Marshal(secrets)
	if err != nil {
		return err
	}
	return writeFileAtomic(webSearchSecretsFilePath(), data, 0600)
}

// WebSearchBraveKeyHandler says whether a key is set and takes a new one; it
// never hands the key back.
func (h *Handlers) WebSearchBraveKeyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		writeJSON(w, map[string]bool{"set": braveSearchKey() != ""})
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	key := ""
	if r.Method == http.MethodPut {
		var body struct {
			Key string `json:"key"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		key = body.Key
		if strings.ContainsAny(strings.TrimSpace(key), " \t\r\n") {
			http.Error(w, "A key has no spaces", http.StatusBadRequest)
			return
		}
	}
	if err := saveBraveSearchKey(key); err != nil {
		http.Error(w, "Could not store the key", http.StatusInternalServerError)
		return
	}
	// Answers fetched with the old key are not answers for the new one.
	webSearchCache.reset()
	writeJSON(w, map[string]bool{"set": braveSearchKey() != ""})
}
