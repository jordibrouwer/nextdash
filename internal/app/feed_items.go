package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"sort"
	"strings"

	xhtml "golang.org/x/net/html"
	neturl "net/url"
)

/*
FeedItem is one entry of a watched feed, kept so it can be read on the
dashboard. Fresh keeps timestamps only; a watch keeps the words.
*/
type FeedItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Link        string `json:"link,omitempty"`
	Summary     string `json:"summary,omitempty"`
	Image       string `json:"image,omitempty"`
	ImageSource string `json:"imageSource,omitempty"`
	PublishedAt int64  `json:"publishedAt,omitempty"`
	FoundAt     int64  `json:"foundAt,omitempty"`
	// MarkedRead and MarkedAt are the reader's own mark on this item; it wins
	// over the bookmark's read time only when it is the more recent of the two.
	MarkedRead bool  `json:"markedRead,omitempty"`
	MarkedAt   int64 `json:"markedAt,omitempty"`
}

var errFeedNoEntries = errors.New("that address did not answer with a feed")

// parseFeedItems reads every entry of an RSS, Atom or RSS 1.0 body, newest
// first. Entries without a date keep document order after the dated ones.
// Summary is sanitised but not cut: callers that store it cut it.
func parseFeedItems(body []byte, baseURL string) (string, []FeedItem, error) {
	var doc feedSourceDoc
	if err := decodeFeedXML(body, &doc); err != nil {
		return "", nil, err
	}
	entries := doc.entries()
	title := strings.TrimSpace(doc.Title)
	if title == "" {
		title = strings.TrimSpace(doc.AtomTitle)
	}
	if len(entries) == 0 {
		return title, nil, errFeedNoEntries
	}

	items := make([]FeedItem, 0, len(entries))
	for _, e := range entries {
		link := resolveFeedURL(baseURL, e.url())
		content := feedEntryContent(e)
		imageBase := link
		if imageBase == "" {
			imageBase = baseURL
		}
		item := FeedItem{
			ID:          feedItemID(e),
			Title:       e.title(),
			Link:        link,
			Summary:     sanitizeFeedHTML(content, 0),
			ImageSource: resolveFeedURL(imageBase, feedEntryImage(e, content)),
			PublishedAt: e.publishedAt(),
		}
		if item.Title == "" && item.Link == "" && item.Summary == "" {
			continue
		}
		if item.Title == "" {
			item.Title = item.Link
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		return title, nil, errFeedNoEntries
	}
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i].PublishedAt, items[j].PublishedAt
		if a == 0 || b == 0 {
			return a != 0 && b == 0
		}
		return a > b
	})
	return title, items, nil
}

// feedEntryContent prefers the fullest text the entry carries.
func feedEntryContent(e feedSourceEntry) string {
	for _, s := range []string{e.Encoded, e.Content, e.Description, e.Summary} {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

// feedItemID identifies an entry across polls: its guid, else Atom id, else
// link, else a hash of title and date.
func feedItemID(e feedSourceEntry) string {
	if v := strings.TrimSpace(e.GUID); v != "" {
		return v
	}
	if v := strings.TrimSpace(e.ID); v != "" {
		return v
	}
	if v := e.url(); v != "" {
		return v
	}
	sum := sha256.Sum256([]byte(e.title() + "|" + e.Published + e.PubDate + e.Updated + e.Date))
	return hex.EncodeToString(sum[:])[:16]
}

var feedImgSrcPattern = regexp.MustCompile(`(?is)<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']`)

// feedEntryImage returns the entry's picture, from the most deliberate source
// to the least: an image enclosure, media:content, media:thumbnail, and last
// the first <img> in the entry's own markup.
func feedEntryImage(e feedSourceEntry, contentHTML string) string {
	for _, enc := range e.Enclosures {
		if strings.HasPrefix(strings.ToLower(enc.Type), "image/") && strings.TrimSpace(enc.URL) != "" {
			return strings.TrimSpace(enc.URL)
		}
	}
	isImage := func(m feedMedia) bool {
		return strings.EqualFold(m.Medium, "image") || strings.HasPrefix(strings.ToLower(m.Type), "image/")
	}
	for _, m := range e.MediaContent {
		if isImage(m) && strings.TrimSpace(m.URL) != "" {
			return strings.TrimSpace(m.URL)
		}
	}
	for _, m := range e.MediaThumbs {
		if strings.TrimSpace(m.URL) != "" {
			return strings.TrimSpace(m.URL)
		}
	}
	for _, g := range e.MediaGroups {
		for _, m := range g.Content {
			if isImage(m) && strings.TrimSpace(m.URL) != "" {
				return strings.TrimSpace(m.URL)
			}
		}
	}
	if m := feedImgSrcPattern.FindStringSubmatch(contentHTML); m != nil {
		return strings.TrimSpace(xhtml.UnescapeString(m[1]))
	}
	return ""
}

// resolveFeedURL makes raw absolute against base. It returns "" for anything
// that is not http(s) once resolved.
func resolveFeedURL(base, raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := neturl.Parse(raw)
	if err != nil {
		return ""
	}
	if !u.IsAbs() {
		b, err := neturl.Parse(base)
		if err != nil || !b.IsAbs() {
			return ""
		}
		u = b.ResolveReference(u)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	return u.String()
}
