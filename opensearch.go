package main

import (
	"encoding/xml"
	"net/http"
	"strings"
)

/*
OpenSearch: the browser's address bar as a nextDash search box.

Forty lines of XML that turn the most used text field there is into a way into
your own bookmarks -- type the keyword, Tab, a term, Enter. No extension, no
dashboard to open first, no mouse. For a tool that is keyboard-first everywhere
else, this is the one place it was not.

The description is served rather than shipped as a static file because two of
its fields depend on where this install actually lives: the search template has
to be an absolute URL, and the name is the one the reader chose. A file on disk
would be right on exactly one install.
*/

// openSearchDescription is the document a browser reads to learn how to search
// a site. The namespace is required; browsers refuse the document without it.
type openSearchDescription struct {
	XMLName     xml.Name         `xml:"OpenSearchDescription"`
	Namespace   string           `xml:"xmlns,attr"`
	ShortName   string           `xml:"ShortName"`
	Description string           `xml:"Description"`
	InputEncode string           `xml:"InputEncoding"`
	Image       *openSearchImage `xml:"Image,omitempty"`
	URLs        []openSearchURL  `xml:"Url"`
}

type openSearchURL struct {
	Type     string `xml:"type,attr"`
	Method   string `xml:"method,attr,omitempty"`
	Template string `xml:"template,attr"`
}

type openSearchImage struct {
	Width  int    `xml:"width,attr"`
	Height int    `xml:"height,attr"`
	Type   string `xml:"type,attr"`
	URL    string `xml:",chardata"`
}

/*
openSearchShortName is what appears in the address bar beside the keyword.

Sixteen characters is the practical ceiling: Firefox and Chrome both truncate
past roughly that, and a name cut mid-word reads as a bug in the dashboard
rather than in the browser.
*/
func openSearchShortName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "nextDash"
	}
	return trimToLength(trimmed, 16)
}

/*
requestBaseURL is the absolute address this install answers on.

OpenSearch templates cannot be relative, so this has to be built rather than
assumed. The proxy headers are honoured because a self-hosted nextDash is
usually behind one, and a template naming the internal address would send the
browser somewhere only the server can reach.
*/
func requestBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); forwarded != "" {
		// The first value: a chain of proxies appends, and the one nearest the
		// browser is what the browser actually spoke.
		if first, _, found := strings.Cut(forwarded, ","); found {
			forwarded = strings.TrimSpace(first)
		}
		if forwarded == "http" || forwarded == "https" {
			scheme = forwarded
		}
	}
	host := strings.TrimSpace(r.Host)
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwarded != "" {
		if first, _, found := strings.Cut(forwarded, ","); found {
			forwarded = strings.TrimSpace(first)
		}
		host = forwarded
	}
	if host == "" {
		return ""
	}
	return scheme + "://" + host
}

/*
OpenSearchDescription answers GET /opensearch.xml.

The template points at the search route rather than at an API: what someone
wants from their address bar is the dashboard, with the query already run and
the keyboard already where they left it.
*/
func (h *Handlers) OpenSearchDescription(w http.ResponseWriter, r *http.Request) {
	settings := h.store.GetSettings()
	name := manifestAppName(settings)
	base := requestBaseURL(r)

	description := openSearchDescription{
		Namespace:   "http://a9.com/-/spec/opensearch/1.1/",
		ShortName:   openSearchShortName(name),
		Description: "Search your bookmarks in " + name,
		InputEncode: "UTF-8",
		URLs: []openSearchURL{{
			Type: "text/html",
			// {searchTerms} is the one placeholder every browser substitutes.
			Template: base + "/#search?q={searchTerms}",
		}},
	}
	/*
	 * This install's own icon, whichever one that is.
	 *
	 * The address named here was /data/icons/favicon.png, which is not a path
	 * nextDash ever writes: an uploaded favicon lands at /data/favicon<ext> and
	 * the default is /static/favicon.ico. So the browser was pointed at a file
	 * that is not there and drew the search entry without an icon.
	 *
	 * manifestIcons already answers "what is this install's icon", for the app
	 * manifest; asking it here means the two cannot drift apart.
	 */
	if icons := manifestIcons(settings); base != "" && len(icons) > 0 {
		description.Image = &openSearchImage{
			Width: 48, Height: 48, Type: icons[0].Type,
			URL: base + icons[0].Src,
		}
	}

	w.Header().Set("Content-Type", "application/opensearchdescription+xml; charset=utf-8")
	// A browser reads this once when the site is first seen, and again only
	// when it is refetched; an hour keeps a renamed install from being stuck.
	w.Header().Set("Cache-Control", "public, max-age=3600")
	/*
	 * Both the template and the icon are built from the address this request
	 * arrived on, proxy headers included -- so the document is not the same for
	 * every caller, and a shared cache that treated it as one would hand a
	 * neighbour's browser a template pointing at whatever host the previous
	 * request claimed to be.
	 *
	 * Add, not Set: the gzip middleware has already put Accept-Encoding in Vary
	 * on this header map, and replacing it would undo that.
	 */
	w.Header().Add("Vary", "X-Forwarded-Host, X-Forwarded-Proto")

	_, _ = w.Write([]byte(xml.Header))
	encoder := xml.NewEncoder(w)
	encoder.Indent("", "  ")
	_ = encoder.Encode(description)
}
