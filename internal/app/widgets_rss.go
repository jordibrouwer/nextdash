package app

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
The RSS widget: the latest articles from the feeds a tile is given.

Fresh (feeds.go) already reads feeds and deliberately keeps no titles -- it
answers "is there anything new here", which is a checker's question, and it
would be a different program if it kept an article list. This tile asks the
reader's question instead: what is new, in words, with somewhere to click.

The parsing is not written again. sources_feeds.go already reads RSS and Atom
into one shape -- the two ways a link is written, the three ways a date is --
so this reuses those types and adds only what a reading tile needs: no
cursor, no bookmark rows, no dedupe against what was imported last time. Just
the newest entries, merged across the feeds this widget names.

Fetched here rather than in the browser for the reason every outward tile is:
a feed served without CORS headers cannot be read from the page at all, and
that is most of them.
*/

const (
	// rssFetchTimeout bounds one feed read.
	rssFetchTimeout = 10 * time.Second
	// rssMaxBody caps one feed. Feeds run to tens of kilobytes; a couple of
	// megabytes is past every real one and short of anything that would hurt
	// to hold while it is parsed.
	rssMaxBody = 2 << 20
	// rssCacheTTL is how long a fetched feed is trusted. Fifteen minutes is
	// faster than anything publishes and slow enough that a dashboard left
	// open is not a load generator against somebody else's blog.
	rssCacheTTL = 15 * time.Minute
	// rssMaxItemsPerFeed bounds what one feed contributes before the merge,
	// so a feed carrying a year of history cannot crowd out the others.
	rssMaxItemsPerFeed = 30
	// rssMaxItems bounds the merged answer. The tile shows a handful and can
	// be expanded to the rest; past this it is a reader, not a tile.
	rssMaxItems = 50
	// rssMaxSummary is how much of an entry's own description travels to the
	// browser, for the hover preview. A paragraph, not an article.
	rssMaxSummary = 300
)

// RSSItem is one article as the tile should show it.
type RSSItem struct {
	Title string `json:"title"`
	Link  string `json:"link"`
	// PublishedAt is unix milliseconds, or 0 when the feed named no date.
	PublishedAt int64 `json:"publishedAt,omitempty"`
	// Summary is the entry's own description, stripped of markup, for the
	// preview shown on hover or focus.
	Summary string `json:"summary,omitempty"`
	// Source is the feed's own title, so a merged list can say where a line
	// came from.
	Source string `json:"source,omitempty"`
}

// RSSWidgetResult is what the tile draws.
type RSSWidgetResult struct {
	Items []RSSItem `json:"items,omitempty"`
	// FetchedAt says how old this is, because a cached list that looks live
	// is worse than a stale one that says so.
	FetchedAt int64  `json:"fetchedAt"`
	Error     string `json:"error,omitempty"`
}

/*
rssFeedCache holds one parsed feed per address.

Per address rather than per widget: two tiles following the same blog are
asking the same question, and the answer does not differ by who asked.
*/
var rssFeedCache = struct {
	sync.Mutex
	at map[string]rssFeedEntry
}{at: map[string]rssFeedEntry{}}

type rssFeedEntry struct {
	items   []RSSItem
	err     string
	expires time.Time
}

func rssFeedCached(url string, now time.Time) (rssFeedEntry, bool) {
	rssFeedCache.Lock()
	defer rssFeedCache.Unlock()
	entry, ok := rssFeedCache.at[url]
	if !ok || now.After(entry.expires) {
		return rssFeedEntry{}, false
	}
	return entry, true
}

func rssFeedStore(url string, entry rssFeedEntry, now time.Time) {
	rssFeedCache.Lock()
	defer rssFeedCache.Unlock()
	if len(rssFeedCache.at) > 100 {
		for key, existing := range rssFeedCache.at {
			if now.After(existing.expires) {
				delete(rssFeedCache.at, key)
			}
		}
	}
	rssFeedCache.at[url] = entry
}

// rssFeed returns one feed's newest entries, fetching only when nothing
// cached is still fresh.
func (h *Handlers) rssFeed(ctx context.Context, url string, forceRefresh bool) ([]RSSItem, string) {
	now := time.Now()
	if !forceRefresh {
		if cached, ok := rssFeedCached(url, now); ok {
			return cached.items, cached.err
		}
	}

	items, errText := h.fetchRSSFeed(ctx, url)
	entry := rssFeedEntry{items: items, err: errText, expires: now.Add(rssCacheTTL)}
	if errText != "" {
		// A feed that is down is not a reason to ask it again on every
		// repaint, but it should recover sooner than a working one expires.
		entry.expires = now.Add(2 * time.Minute)
	}
	rssFeedStore(url, entry, now)
	return items, errText
}

func (h *Handlers) fetchRSSFeed(ctx context.Context, url string) ([]RSSItem, string) {
	if err := validateHTTPURL(url, h.allowLocalBookmarks()); err != nil {
		return nil, "that address is not allowed"
	}

	ctx, cancel := context.WithTimeout(ctx, rssFetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "that address cannot be requested"
	}
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml;q=0.9")
	req.Header.Set("User-Agent", "nextDash Widget/1.0")

	resp, err := h.outboundHTTPClient(rssFetchTimeout, 3).Do(req)
	if err != nil {
		logWarn(logComponentWidgets, "%s could not be reached; the RSS tile will show what it has: %v",
			hostOf(url), err)
		return nil, "no answer from that address"
	}
	defer drainAndCloseResponse(resp)

	if resp.StatusCode >= 400 {
		logWarn(logComponentWidgets, "%s answered %d; the RSS tile will show what it has",
			hostOf(url), resp.StatusCode)
		return nil, "the feed answered " + strconv.Itoa(resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, rssMaxBody))
	if err != nil {
		return nil, "the feed could not be read"
	}
	return parseRSSItems(raw)
}

/*
parseRSSItems reads entries out of RSS or Atom.

The shapes come from sources_feeds.go, which already handles both -- an RSS
link written as text and an Atom one written as an href, and the three date
fields either may carry.
*/
func parseRSSItems(raw []byte) ([]RSSItem, string) {
	// The root element is checked before the fields are read, because a web
	// page is well-formed XML often enough to unmarshal into an empty feed --
	// and "nothing published yet" is the wrong thing to tell someone who
	// pasted a site's address instead of its feed's.
	if !isFeedDocument(raw) {
		return nil, "that address did not answer with a feed"
	}
	var doc feedSourceDoc
	if err := xml.Unmarshal(raw, &doc); err != nil {
		return nil, "that address did not answer with a feed"
	}

	source := strings.TrimSpace(doc.Title)
	if source == "" {
		source = strings.TrimSpace(doc.AtomTitle)
	}

	entries := doc.Items
	if len(entries) == 0 {
		entries = doc.Entries
	}

	items := make([]RSSItem, 0, len(entries))
	seen := map[string]struct{}{}
	for _, entry := range entries {
		if len(items) >= rssMaxItemsPerFeed {
			break
		}
		link := strings.TrimSpace(entry.url())
		if link == "" || sanitizeWidgetURL(link) == "" {
			continue
		}
		if _, duplicate := seen[link]; duplicate {
			continue
		}
		seen[link] = struct{}{}

		title := strings.TrimSpace(entry.Title)
		if title == "" {
			// A headline is the whole of what this tile shows, so an entry
			// without one falls back to its address rather than to a blank
			// row nobody can read or judge.
			title = link
		}
		summary := feedEntryNote(entry)
		if len(summary) > rssMaxSummary {
			summary = strings.TrimSpace(summary[:rssMaxSummary]) + "…"
		}
		items = append(items, RSSItem{
			Title:       title,
			Link:        link,
			PublishedAt: entry.publishedAt(),
			Summary:     summary,
			Source:      source,
		})
	}
	return items, ""
}

// isFeedDocument reports whether the first element is one a feed starts with:
// <rss>, <feed> for Atom, or RDF for the older RSS 1.0.
func isFeedDocument(raw []byte) bool {
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	decoder.Strict = false
	for {
		token, err := decoder.Token()
		if err != nil {
			return false
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		switch strings.ToLower(start.Name.Local) {
		case "rss", "feed", "rdf":
			return true
		}
		return false
	}
}

/*
RSSWidgetHandler answers what one RSS tile should draw: its own feeds,
merged newest first.

A feed that fails does not empty the tile -- the others are still an answer,
and the error is only reported when nothing came back at all.
*/
func (h *Handlers) RSSWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	pageID, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("pageId")))
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	widgetID := strings.TrimSpace(r.URL.Query().Get("id"))
	if widgetID == "" {
		http.Error(w, "Missing widget id", http.StatusBadRequest)
		return
	}

	widgets, _ := h.store.GetPageBlocks(pageID)
	var found *Widget
	for i := range widgets {
		if widgets[i].ID == widgetID && widgets[i].Type == WidgetTypeRSS {
			found = &widgets[i]
			break
		}
	}
	if found == nil {
		http.Error(w, "No such widget", http.StatusNotFound)
		return
	}

	now := time.Now()
	urls := widgetConfigURLList(found.Config["feedUrls"], widgetMaxFeedsPerWidget)
	if len(urls) == 0 {
		_ = json.NewEncoder(w).Encode(RSSWidgetResult{
			FetchedAt: now.UnixMilli(),
			Error:     "no feeds set",
		})
		return
	}

	forced := r.URL.Query().Get("refresh") == "1"
	if forced && !h.requireWriteAccess(w, r) {
		return
	}

	merged := make([]RSSItem, 0, rssMaxItems)
	lastError := ""
	for _, url := range urls {
		items, errText := h.rssFeed(r.Context(), url, forced)
		if errText != "" {
			lastError = errText
			continue
		}
		merged = append(merged, items...)
	}

	result := RSSWidgetResult{FetchedAt: now.UnixMilli()}
	if len(merged) == 0 {
		// Only now is a failure worth reporting: with anything to show, the
		// one feed that is down is a gap rather than the answer.
		result.Error = lastError
		_ = json.NewEncoder(w).Encode(result)
		return
	}
	result.Items = mergeRSSItems(merged)
	_ = json.NewEncoder(w).Encode(result)
}

/*
mergeRSSItems puts every feed's entries in one order: newest first.

An entry with no date sorts last rather than first. A feed that names no
dates at all is rare and usually broken, and letting it lead would put an
undated line above this morning's news on every draw.
*/
func mergeRSSItems(items []RSSItem) []RSSItem {
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].PublishedAt > items[j].PublishedAt
	})
	if len(items) > rssMaxItems {
		items = items[:rssMaxItems]
	}
	return items
}
