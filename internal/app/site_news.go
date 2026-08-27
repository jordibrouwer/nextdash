package app

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"html"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

/*
The most recent posts from nextdash.cc, for the config overview's news stream.

Fetched by the server rather than the browser, for three reasons: the page's
content-security policy does not allow a request to another host, the site's
feed is a couple of hundred kilobytes of full post bodies that only a few
titles and summaries are wanted from, and one server fetch every few hours
serves every browser that opens config instead of one per reader.

Nothing about the reader goes out with it — it is the same request for every
install, carrying no query, no identifier and no referrer.
*/

// siteNewsFeedURL is a var rather than a const so a test can point it at a
// closed port and prove what an unreachable site does to the panel.
var siteNewsFeedURL = "https://nextdash.cc/feed/"

const (
	// The feed carries whole post bodies, so it is large for what is taken from
	// it: measured at 172KB for ten posts, with the tenth starting at 97% of
	// the file. A truncated read loses the oldest items first and looks like a
	// short feed rather than a failure, so the ceiling has to clear the whole
	// document with room for it to grow, not just the posts wanted today.
	siteNewsMaxBytes = 2 << 20
	siteNewsTimeout  = 8 * time.Second
	// How long a fetched copy is served without asking again.
	//
	// Six hours was chosen against how often posts appear -- a few times a month
	// -- and it made the overview lag a release announcement by most of a day.
	// What it costs to ask is the thing that actually matters: the request is
	// conditional, so the common answer is a 304 with no body, and it is made
	// once per server rather than once per reader. Ninety minutes reads as
	// "current" to someone opening config after lunch, and still asks fewer
	// than twenty times a day.
	siteNewsTTL = 90 * time.Minute
	// A failed fetch is not retried immediately: a site that is down should not
	// be hit on every config open.
	siteNewsRetryAfter = 15 * time.Minute
	// Ten posts must always survive the parse, so the cap sits above ten rather
	// than on it: a feed carrying exactly ten and a cap of exactly ten agree
	// only until the eleventh post is published, and then the oldest of the ten
	// silently stops arriving. Twenty keeps ten a floor instead of a ceiling
	// while the drill-in gets a longer tail to list.
	siteNewsMaxItems = 20
	// A summary is a hint, not the post. Long enough to say what it is about,
	// short enough that a row stays a row.
	siteNewsSummaryChars = 160
)

// SiteNewsItem is one post, reduced to what the stream draws.
type SiteNewsItem struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Summary string `json:"summary,omitempty"`
	// PublishedAt is Unix milliseconds, so the browser can render it in whatever
	// date format the reader has set rather than being handed a fixed string.
	PublishedAt int64 `json:"publishedAt"`
}

// SiteNewsResponse is what /api/site-news answers.
type SiteNewsResponse struct {
	// Enabled is false when the setting is cleared or DISABLE_NEWS_FEED is set.
	// The stream still draws — releases and features need no network — and says
	// in one line that the site's own posts are not part of it.
	Enabled   bool           `json:"enabled"`
	Items     []SiteNewsItem `json:"items"`
	FetchedAt int64          `json:"fetchedAt"`
}

// siteNewsFile is the on-disk mirror of the cache.
//
// Without it every restart went straight back out to the site, which on a
// machine that reboots nightly is a request a day for a feed that changes
// twice a month. It also carries the validators, so the first fetch after a
// restart can be a conditional one.
type siteNewsFile struct {
	FetchedAt    int64          `json:"fetchedAt"`
	ETag         string         `json:"etag,omitempty"`
	LastModified string         `json:"lastModified,omitempty"`
	Items        []SiteNewsItem `json:"items"`
}

type siteNewsCache struct {
	mu           sync.Mutex
	items        []SiteNewsItem
	fetchedAt    time.Time
	triedAt      time.Time
	etag         string
	lastModified string
	ok           bool
	loaded       bool
}

var siteNews siteNewsCache

type siteNewsFeed struct {
	Items []struct {
		Title       string `xml:"title"`
		Link        string `xml:"link"`
		PubDate     string `xml:"pubDate"`
		Date        string `xml:"date"`
		Description string `xml:"description"`
	} `xml:"channel>item"`
}

// newsFeedDisabledByEnv reports whether DISABLE_NEWS_FEED switches the site's
// posts off for the whole server, whatever any reader has configured.
//
// Same shape as DISABLE_TELEMETRY and DISABLE_UPDATE_CHECK: an operator who
// does not want the machine talking to nextdash.cc says so once, in the
// environment, rather than trusting every user to leave a checkbox alone.
func newsFeedDisabledByEnv() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("DISABLE_NEWS_FEED"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func siteNewsFilePath() string {
	return filepath.Join(ResolveDataDir(), "site-news.json")
}

var siteNewsTagPattern = regexp.MustCompile(`(?s)<[^>]*>`)
var siteNewsSpacePattern = regexp.MustCompile(`\s+`)

// summariseSiteNews turns a WordPress description into one plain line.
//
// The field is HTML — paragraphs, a "Continue reading" link, sometimes an
// image — and the stream sets text rather than markup, so the tags would
// otherwise be printed as written. Cut on a word boundary: a summary that ends
// mid-word reads as broken rather than as shortened.
func summariseSiteNews(raw string) string {
	// Unescaped once, not twice: a post about `&amp;lt;script&amp;gt;` means to
	// show `&lt;script&gt;`, and decoding a second time turns the text it wrote
	// into the thing it was quoting.
	text := html.UnescapeString(siteNewsTagPattern.ReplaceAllString(raw, " "))
	text = strings.TrimSpace(siteNewsSpacePattern.ReplaceAllString(text, " "))
	if text == "" {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= siteNewsSummaryChars {
		return text
	}
	cut := string(runes[:siteNewsSummaryChars])
	if space := strings.LastIndex(cut, " "); space > siteNewsSummaryChars/2 {
		cut = cut[:space]
	}
	return strings.TrimRight(cut, " ,;:.") + "…"
}

// parseSiteNews reads the feed body into at most siteNewsMaxItems posts.
//
// An item with no title or no readable date is skipped rather than shown with a
// blank where its date belongs: the stream is sorted by time, and an item
// without one cannot take its place in it.
func parseSiteNews(body []byte) []SiteNewsItem {
	var doc siteNewsFeed
	if err := xml.Unmarshal(body, &doc); err != nil {
		return nil
	}
	items := make([]SiteNewsItem, 0, siteNewsMaxItems)
	for _, entry := range doc.Items {
		title := strings.TrimSpace(html.UnescapeString(entry.Title))
		link := strings.TrimSpace(entry.Link)
		if title == "" || link == "" {
			continue
		}
		var published int64
		for _, raw := range []string{entry.PubDate, entry.Date} {
			if ts := parseFeedTime(raw); ts > 0 {
				published = ts
				break
			}
		}
		if published == 0 {
			continue
		}
		items = append(items, SiteNewsItem{
			Title:       title,
			URL:         link,
			Summary:     summariseSiteNews(entry.Description),
			PublishedAt: published,
		})
		if len(items) >= siteNewsMaxItems {
			break
		}
	}
	return items
}

// loadSiteNewsFromDisk fills the cache from the mirror, once per process.
func (c *siteNewsCache) loadFromDisk() {
	if c.loaded {
		return
	}
	c.loaded = true
	data, err := os.ReadFile(siteNewsFilePath())
	if err != nil {
		return
	}
	var file siteNewsFile
	if json.Unmarshal(data, &file) != nil || len(file.Items) == 0 {
		return
	}
	c.items = file.Items
	c.etag = file.ETag
	c.lastModified = file.LastModified
	if file.FetchedAt > 0 {
		c.fetchedAt = time.UnixMilli(file.FetchedAt)
		c.ok = true
	}
}

func (c *siteNewsCache) saveToDisk() {
	payload := siteNewsFile{
		FetchedAt:    c.fetchedAt.UnixMilli(),
		ETag:         c.etag,
		LastModified: c.lastModified,
		Items:        c.items,
	}
	if data, err := json.Marshal(payload); err == nil {
		_ = writeFileAtomic(siteNewsFilePath(), data, 0644)
	}
}

// fetchSiteNews gets the feed once, honouring the cache and the retry delay.
func (h *Handlers) fetchSiteNews(ctx context.Context) ([]SiteNewsItem, int64) {
	siteNews.mu.Lock()
	defer siteNews.mu.Unlock()
	siteNews.loadFromDisk()

	now := time.Now()
	if siteNews.ok && now.Sub(siteNews.fetchedAt) < siteNewsTTL {
		return siteNews.items, siteNews.fetchedAt.UnixMilli()
	}
	if !siteNews.triedAt.IsZero() && now.Sub(siteNews.triedAt) < siteNewsRetryAfter {
		// Still inside the back-off. Whatever was last read is better than
		// nothing, and an empty list is an honest "no news right now".
		return siteNews.items, siteNews.fetchedAt.UnixMilli()
	}
	siteNews.triedAt = now

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, siteNewsFeedURL, nil)
	if err != nil {
		return siteNews.items, siteNews.fetchedAt.UnixMilli()
	}
	req.Header.Set("User-Agent", "nextDash/1.0 (+https://nextdash.cc)")
	req.Header.Set("Accept", "application/rss+xml, application/xml;q=0.9, */*;q=0.5")
	// Conditional: a feed that has not changed answers 304 with no body, which
	// is the common case at six-hour intervals.
	if siteNews.etag != "" {
		req.Header.Set("If-None-Match", siteNews.etag)
	}
	if siteNews.lastModified != "" {
		req.Header.Set("If-Modified-Since", siteNews.lastModified)
	}

	resp, err := h.outboundHTTPClient(siteNewsTimeout, 5).Do(req)
	if err != nil || resp == nil {
		return siteNews.items, siteNews.fetchedAt.UnixMilli()
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		// Unchanged, and therefore fresh: without moving the timestamp the TTL
		// would have expired again on the next open and asked once more.
		siteNews.fetchedAt = now
		siteNews.ok = len(siteNews.items) > 0
		siteNews.saveToDisk()
		return siteNews.items, now.UnixMilli()
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return siteNews.items, siteNews.fetchedAt.UnixMilli()
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, siteNewsMaxBytes))
	if err != nil {
		return siteNews.items, siteNews.fetchedAt.UnixMilli()
	}
	items := parseSiteNews(body)
	if len(items) == 0 {
		// Reachable but unreadable. Keep what was there rather than replacing
		// posts with nothing because one fetch came back malformed.
		return siteNews.items, siteNews.fetchedAt.UnixMilli()
	}
	siteNews.items = items
	siteNews.fetchedAt = now
	siteNews.ok = true
	siteNews.etag = strings.TrimSpace(resp.Header.Get("ETag"))
	siteNews.lastModified = strings.TrimSpace(resp.Header.Get("Last-Modified"))
	siteNews.saveToDisk()
	return items, now.UnixMilli()
}

// GetSiteNews serves the posts for the config overview's news stream.
func (h *Handlers) GetSiteNews(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// The panel is opt-out, and off means the request is never made — the same
	// promise the analytics setting makes, for the same reason: a self-hosted
	// dashboard should not reach a website you did not ask it to. The
	// environment overrides the setting, for a server run on someone's behalf.
	if newsFeedDisabledByEnv() || !h.store.GetSettings().ShowSiteNews {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(SiteNewsResponse{Enabled: false, Items: []SiteNewsItem{}})
		return
	}

	items, fetchedAt := h.fetchSiteNews(r.Context())
	if items == nil {
		items = []SiteNewsItem{}
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(SiteNewsResponse{Enabled: true, Items: items, FetchedAt: fetchedAt})
}
