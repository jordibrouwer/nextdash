package main

import (
	"context"
	"encoding/json"
	"html"
	"io"
	"net/http"
	neturl "net/url"
	"regexp"
	"strings"
	"time"
)

/*
oEmbed, discovered from the page rather than from a bundled list.

The atlas suggests embedding providers.json -- 373 providers -- and matching a
URL against its patterns. Measured against the real thing, that is not
necessary: a page that offers oEmbed says so in its own head, with

  <link type="application/json+oembed" href="https://…/oembed?url=…">

which YouTube, Vimeo, Flickr, SoundCloud, Spotify and the rest all do. The
document is already in hand, so discovery costs nothing and one fetch follows.

That is worth the trade in both directions. A bundled list is 373 patterns that
go stale, need updating, and answer for providers whose endpoint has moved; the
page's own link is current by definition. What discovery cannot do is answer for
a URL nobody fetched -- but nextDash has always fetched the page to build a
preview, so that case does not arise.
*/

const (
	oembedTimeout  = 10 * time.Second
	oembedMaxBytes = 256 << 10
	// oembedMaxHTML caps the player markup kept. A legitimate embed is an
	// iframe and a few attributes; anything larger is a page, not a player.
	oembedMaxHTML = 4 << 10
)

// oembedLinkPattern finds the discovery link in a document's head.
//
// Attribute order varies, so the type and the href are matched independently
// rather than as one fixed sequence.
var oembedLinkPattern = regexp.MustCompile(
	`(?is)<link[^>]+(?:type\s*=\s*["']application/(?:json|xml)\+oembed["'][^>]*href\s*=\s*["']([^"']+)["']` +
		`|href\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']application/(?:json|xml)\+oembed["'])`)

// oembedResponse is the part of the answer worth keeping.
type oembedResponse struct {
	Type         string `json:"type"`
	Title        string `json:"title"`
	AuthorName   string `json:"author_name"`
	ProviderName string `json:"provider_name"`
	ThumbnailURL string `json:"thumbnail_url"`
	HTML         string `json:"html"`
}

/*
discoverOEmbedURL reads the endpoint a page advertises.

JSON is preferred over XML by taking the first link of either kind and letting
the fetch below reject what it cannot parse -- a page that offers only XML is
rare enough that a second parser is not worth carrying.
*/
func discoverOEmbedURL(doc, pageURL string) string {
	match := oembedLinkPattern.FindStringSubmatch(doc)
	if match == nil {
		return ""
	}
	raw := ""
	for _, group := range match[1:] {
		if group != "" {
			raw = group
			break
		}
	}
	raw = strings.TrimSpace(html.UnescapeString(raw))
	if raw == "" {
		return ""
	}

	parsed, err := neturl.Parse(raw)
	if err != nil {
		return ""
	}
	if !parsed.IsAbs() {
		base, err := neturl.Parse(pageURL)
		if err != nil {
			return ""
		}
		parsed = base.ResolveReference(parsed)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}
	return parsed.String()
}

/*
fetchOEmbed asks the endpoint the page named.

Through outboundHTTPClient like every other outbound request, so the SSRF
checks apply: the endpoint comes out of a document nextDash did not write, and a
page is free to name an address on a private network.
*/
func (h *Handlers) fetchOEmbed(ctx context.Context, endpoint string) (oembedResponse, bool) {
	var out oembedResponse
	if strings.TrimSpace(endpoint) == "" {
		return out, false
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return out, false
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", updateCheckUserAgent)

	client := h.outboundHTTPClient(oembedTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return out, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return out, false
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, oembedMaxBytes))
	if err != nil {
		return out, false
	}
	if err := json.Unmarshal(body, &out); err != nil {
		// An XML endpoint, or a provider answering with something else. Not an
		// error worth reporting: oEmbed is an enrichment, and the preview is
		// already built without it.
		return oembedResponse{}, false
	}

	if len(out.HTML) > oembedMaxHTML {
		// Kept as metadata without the player: a provider returning kilobytes
		// of markup is not returning an embed.
		out.HTML = ""
	}
	return out, true
}

/*
applyOEmbed fills in what the page itself did not say.

Never overwrites: a page's own og:title is what its publisher chose to put on
it, and a provider's title for the same thing is a second opinion. The one field
that is genuinely new is the player.
*/
func applyOEmbed(preview *BookmarkPreview, data oembedResponse) {
	if preview == nil {
		return
	}
	if preview.Title == "" {
		preview.Title = trimToLength(data.Title, 300)
	}
	if preview.Author == "" {
		preview.Author = trimToLength(data.AuthorName, 120)
	}
	if preview.SiteName == "" {
		preview.SiteName = trimToLength(data.ProviderName, 80)
	}
	if preview.Image == "" {
		preview.Image = strings.TrimSpace(data.ThumbnailURL)
	}
	// Only for the types that are actually a player: a "link" response has no
	// embed, and a "photo" is already covered by the thumbnail.
	if data.Type == "video" || data.Type == "rich" {
		preview.EmbedHTML = strings.TrimSpace(data.HTML)
	}
}
