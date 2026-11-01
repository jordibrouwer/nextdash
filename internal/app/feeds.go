package app

import (
	"context"
	"errors"
	htmlpkg "html"
	"io"
	"net/http"
	"net/mail"
	neturl "net/url"
	"strings"
	"time"
)

/*
Feeds, as far as watching one needs them.

nextDash used to count, quietly, what every feed it could find had published
(Fresh). That is gone; what is left is the part a watch is built on: finding the
feeds a page advertises, fetching one with the validators of the last answer,
and the clock that wakes the watches (see feed_watch*.go).
*/

const (
	// feedPollCheckInterval is how often the scheduler wakes to see whether a
	// watch is due -- short relative to the cadences so "every N hours" survives
	// a restart.
	feedPollCheckInterval = 15 * time.Minute
	// feedMaxBytes caps what is read from a feed: enough for the head of any
	// reasonable feed, and a hard stop on one that streams forever.
	feedMaxBytes = 1 << 20
	// feedMaxFailures is when a watch gives up on a feed until the next daily
	// retry: a feed that has answered badly this many times in a row is gone,
	// not slow.
	feedMaxFailures = 5
	// feedRetiredRetry is how long a retired feed waits for another try.
	feedRetiredRetry = 24 * time.Hour
	// feedDiscoverTimeout bounds one page fetch while looking for a feed link,
	// and feedDiscoverMaxBytes caps how much of the page is read: the <link> is
	// in the head, and a page that has not declared one in this much never will.
	feedDiscoverTimeout  = 8 * time.Second
	feedDiscoverMaxBytes = 512 << 10
)

// feedLink is one feed a page advertises.
type feedLink struct {
	URL   string `json:"url"`
	Title string `json:"title,omitempty"`
	Type  string `json:"type,omitempty"`
}

// discoverFeedsForURL fetches one page and returns every feed it advertises,
// as absolute URLs. A URL that is itself a feed answers with itself, so the
// picker can take a pasted feed address.
func (h *Handlers) discoverFeedsForURL(ctx context.Context, rawURL string) []feedLink {
	if err := validateHTTPURL(rawURL, h.allowLocalBookmarks()); err != nil {
		return nil
	}
	fetchCtx, cancel := context.WithTimeout(ctx, feedDiscoverTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "nextDash FeedFinder/1.0")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml;q=0.9,application/feed+json;q=0.9")

	resp, err := h.outboundHTTPClient(feedDiscoverTimeout, 5).Do(req)
	if err != nil || resp == nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, feedDiscoverMaxBytes))
	if err != nil && len(body) == 0 {
		return nil
	}
	finalURL := resp.Request.URL.String()
	if title, items, perr := parseFeedItems(body, finalURL); perr == nil && len(items) > 0 {
		return []feedLink{{URL: finalURL, Title: title}}
	}
	found := extractFeedsFromHTML(string(body))
	for i := range found {
		found[i].URL = h.resolveRelativeURL(finalURL, found[i].URL)
	}
	return found
}

// commonFeedPaths are where sites that advertise nothing in their page head
// usually keep a feed. Only the picker tries them, on a page the reader chose:
// Fresh's own discovery asks every bookmark in the collection, and eight extra
// requests each would be eight extra requests to every site.
var commonFeedPaths = []string{
	"/feed", "/feed/", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/feeds/mixed.xml",
	"/feed.json", "/feed/json",
}

// probeCommonFeeds looks for a feed at the usual addresses of a site's origin.
// For a page that sends a first visit to a consent wall, so its head says
// nothing although the feed is open.
func (h *Handlers) probeCommonFeeds(ctx context.Context, rawURL string) []feedLink {
	base, err := neturl.Parse(strings.TrimSpace(rawURL))
	if err != nil || base.Host == "" {
		return nil
	}
	origin := base.Scheme + "://" + base.Host
	var out []feedLink
	for _, path := range commonFeedPaths {
		if ctx.Err() != nil {
			break
		}
		candidate := origin + path
		fetchCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		res := h.fetchFeed(fetchCtx, candidate, "", "")
		cancel()
		if res.Err != nil || res.Status < 200 || res.Status >= 300 {
			continue
		}
		title, items, err := parseFeedItems(res.Body, res.Final)
		if err != nil || len(items) == 0 {
			continue
		}
		out = append(out, feedLink{URL: res.Final, Title: title})
		if len(out) == 2 {
			break
		}
	}
	return out
}

// extractFeedsFromHTML lists every feed the page advertises, in document
// order and without duplicates.
func extractFeedsFromHTML(htmlBody string) []feedLink {
	lower := asciiLower(htmlBody)
	var out []feedLink
	seen := map[string]bool{}
	start := 0
	for {
		linkIdx := strings.Index(lower[start:], "<link")
		if linkIdx < 0 {
			return out
		}
		tagStart := start + linkIdx
		tagEnd := strings.Index(lower[tagStart:], ">")
		if tagEnd < 0 {
			return out
		}
		tag := htmlBody[tagStart : tagStart+tagEnd+1]
		lowerTag := lower[tagStart : tagStart+tagEnd+1]
		start = tagStart + tagEnd + 1

		if !strings.Contains(lowerTag, "alternate") {
			continue
		}
		mediaType := ""
		switch {
		case strings.Contains(lowerTag, "application/rss+xml"):
			mediaType = "application/rss+xml"
		case strings.Contains(lowerTag, "application/atom+xml"):
			mediaType = "application/atom+xml"
		case strings.Contains(lowerTag, "application/feed+json"):
			mediaType = "application/feed+json"
		case strings.Contains(lowerTag, "application/json") && jsonFeedLooksLikeAFeed(tag):
			mediaType = "application/json"
		default:
			continue
		}
		href := extractAttributeValue(tag, "href")
		if href == "" || seen[href] {
			continue
		}
		seen[href] = true
		out = append(out, feedLink{
			URL:   href,
			Title: strings.TrimSpace(htmlpkg.UnescapeString(extractAttributeValue(tag, "title"))),
			Type:  mediaType,
		})
	}
}

// jsonFeedLooksLikeAFeed tells a plain application/json alternate that is a
// feed from the oEmbed and API links sites advertise the same way: its title or
// address says feed.
func jsonFeedLooksLikeAFeed(tag string) bool {
	hay := asciiLower(htmlpkg.UnescapeString(extractAttributeValue(tag, "title") + " " + extractAttributeValue(tag, "href")))
	return strings.Contains(hay, "feed")
}

// extractAttributeValue reads one attribute out of a tag, quoted either way.
func extractAttributeValue(tag, attribute string) string {
	lower := asciiLower(tag)
	needle := attribute + "="
	idx := strings.Index(lower, needle)
	if idx < 0 {
		return ""
	}
	rest := tag[idx+len(needle):]
	if rest == "" {
		return ""
	}
	quote := rest[0]
	if quote != '"' && quote != '\'' {
		end := strings.IndexAny(rest, " \t\r\n>")
		if end < 0 {
			end = len(rest)
		}
		return strings.TrimSpace(rest[:end])
	}
	end := strings.IndexByte(rest[1:], quote)
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(rest[1 : 1+end])
}

func parseFeedTime(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	// A US zone name: time.Parse reads "EST" as an unknown zone at offset 0,
	// four to eight hours off. Swapped for its offset first.
	for name, offset := range feedZoneOffsets {
		if strings.HasSuffix(raw, " "+name) {
			raw = strings.TrimSuffix(raw, name) + offset
			break
		}
	}
	layouts := []string{
		time.RFC1123Z,
		time.RFC1123,
		time.RFC3339,
		"2006-01-02T15:04:05Z0700",
		"2006-01-02 15:04:05",
		"2006-01-02",
		"Mon, _2 Jan 2006 15:04:05 -07:00",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed.UnixMilli()
		}
	}
	// RFC 5322 as mail parses it: a one-digit day, no seconds, no weekday, UT
	// and GMT. Feeds write all of these, and an unread date counted as a
	// failed poll until Fresh retired the feed.
	if parsed, err := mail.ParseDate(raw); err == nil {
		return parsed.UnixMilli()
	}
	return 0
}

var feedZoneOffsets = map[string]string{
	"EST": "-0500", "EDT": "-0400",
	"CST": "-0600", "CDT": "-0500",
	"MST": "-0700", "MDT": "-0600",
	"PST": "-0800", "PDT": "-0700",
}

// pollFeed asks one feed whether anything is new, and returns the updated state.
//
// A 304 is the good case and the common one: the validators go back out, nothing
// comes back, and the stored timestamps stand. Anything else that is not a 2xx
// counts as a failure, and enough consecutive failures retire the feed.
var errFeedURLInvalid = errors.New("feed address refused")

// feedFetchTimeout bounds a single feed fetch. One that cannot answer in this
// long is one to stop waiting for. A variable so a test can shorten it.
var feedFetchTimeout = 10 * time.Second

// feedFetch is the answer of one conditional GET of a feed.
type feedFetch struct {
	Status                    int
	Body                      []byte
	ETag, LastModified, Final string
	Err                       error
	// Permanent is true when the feed was reached through redirects and every
	// hop was a 301 or 308: the address has moved for good.
	Permanent bool
}

// fetchFeed asks for a feed once, with the validators of the last answer. It
// is the HTTP half of a poll, shared by Fresh and by watched feeds: an
// unreachable server and an unreadable body come back as Err, anything the
// server did say as Status.
func (h *Handlers) fetchFeed(ctx context.Context, feedURL, etag, lastModified string) feedFetch {
	if err := validateHTTPURL(feedURL, h.allowLocalBookmarks()); err != nil {
		return feedFetch{Err: errFeedURLInvalid}
	}
	client := h.outboundHTTPClient(feedFetchTimeout, 5)
	hops, temporary := 0, false
	checkRedirect := client.CheckRedirect
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		hops++
		if req.Response == nil || (req.Response.StatusCode != http.StatusMovedPermanently && req.Response.StatusCode != http.StatusPermanentRedirect) {
			temporary = true
		}
		return checkRedirect(req, via)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return feedFetch{Err: err}
	}
	req.Header.Set("User-Agent", "nextDash FeedBot/1.0")
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.5")
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	if lastModified != "" {
		req.Header.Set("If-Modified-Since", lastModified)
	}
	resp, err := client.Do(req)
	if err != nil || resp == nil {
		if err == nil {
			err = errors.New("no response")
		}
		return feedFetch{Err: err}
	}
	defer resp.Body.Close()
	out := feedFetch{
		Status:       resp.StatusCode,
		ETag:         strings.TrimSpace(resp.Header.Get("ETag")),
		LastModified: strings.TrimSpace(resp.Header.Get("Last-Modified")),
		Final:        feedURL,
		Permanent:    hops > 0 && !temporary,
	}
	if resp.Request != nil && resp.Request.URL != nil {
		out.Final = resp.Request.URL.String()
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return out
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, feedMaxBytes))
	if err != nil {
		out.Err = err
		return out
	}
	out.Body = body
	return out
}

// StartFeedPollScheduler wakes the watches until stop is closed.
func (h *Handlers) StartFeedPollScheduler(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(feedPollCheckInterval)
		defer ticker.Stop()

		h.maybePollWatches()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				h.maybePollWatches()
			}
		}
	}()
}

// logFeedFailure says a feed round did not work, and says it louder on the
// round that retires the feed — that is the one where it stops being polled at
// all, and until now nothing anywhere said so.
func logFeedFailure(feedURL string, failures int, reason string) {
	host := hostOf(feedURL)
	if failures >= feedMaxFailures {
		logWarn(logComponentFeeds, "%s failed %d times in a row (%s) and is no longer polled", host, failures, reason)
		return
	}
	logDebug(logComponentFeeds, "%s did not answer usefully (%s), attempt %d of %d", host, reason, failures, feedMaxFailures)
}
