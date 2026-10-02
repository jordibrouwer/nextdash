package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// searxngCategory maps the panel's tabs onto SearXNG's category names.
var searxngCategory = map[string]string{
	"web": "general", "news": "news", "video": "videos", "it": "it",
}

type searxngProvider struct {
	base   string
	client *http.Client
}

// newSearxngProvider allows local addresses: a reader's own instance is
// usually on the LAN, and the address is one they typed themselves.
func newSearxngProvider(base string) *searxngProvider {
	return &searxngProvider{base: base, client: newOutboundHTTPClient(true, webSearchTimeout, 3)}
}

func (p *searxngProvider) Name() string         { return webSearchEngineSearxng }
func (p *searxngProvider) Categories() []string { return []string{"web", "news", "video", "it"} }

type searxngBody struct {
	Results []struct {
		URL           string `json:"url"`
		Title         string `json:"title"`
		Content       string `json:"content"`
		PublishedDate string `json:"publishedDate"`
	} `json:"results"`
	Infoboxes []struct {
		Infobox string `json:"infobox"`
		Content string `json:"content"`
		ID      string `json:"id"`
		URLs    []struct {
			URL string `json:"url"`
		} `json:"urls"`
	} `json:"infoboxes"`
}

func (p *searxngProvider) Search(ctx context.Context, query, category string) (WebSearchResponse, error) {
	params := url.Values{}
	params.Set("q", query)
	params.Set("format", "json")
	params.Set("categories", searxngCategory[category])
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.base+"/search?"+params.Encode(), nil)
	if err != nil {
		return WebSearchResponse{}, errWebSearchUnreachable
	}
	setWebSearchHeaders(req)
	resp, err := p.client.Do(req)
	if err != nil {
		return WebSearchResponse{}, errWebSearchUnreachable
	}
	defer drainAndCloseResponse(resp)
	// SearXNG answers 403 when format=json is not in its search.formats.
	if resp.StatusCode == http.StatusForbidden {
		return WebSearchResponse{}, errWebSearchJSONDisabled
	}
	if err := httpStatusError(resp.StatusCode); err != nil {
		return WebSearchResponse{}, err
	}
	var body searxngBody
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&body); err != nil {
		return WebSearchResponse{}, errWebSearchUnreachable
	}
	out := WebSearchResponse{Engine: webSearchEngineSearxng, Results: []WebSearchResult{}}
	for _, r := range body.Results {
		if len(out.Results) == webSearchMaxResults {
			break
		}
		if !isWebURL(r.URL) {
			continue
		}
		out.Results = append(out.Results, WebSearchResult{
			Title: plainSnippet(r.Title), URL: r.URL, Snippet: plainSnippet(r.Content),
			Domain: resultDomain(r.URL), Published: r.PublishedDate,
		})
	}
	if len(body.Infoboxes) > 0 {
		ib := body.Infoboxes[0]
		link := ""
		if isWebURL(ib.ID) {
			link = ib.ID
		} else if len(ib.URLs) > 0 && isWebURL(ib.URLs[0].URL) {
			link = ib.URLs[0].URL
		}
		out.Infobox = &WebSearchInfobox{Title: plainSnippet(ib.Infobox), Text: plainSnippet(ib.Content), URL: link}
	}
	return out, nil
}
