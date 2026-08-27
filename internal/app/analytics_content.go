package app

import (
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// analyticsContentCounts is the size of an install, as raw numbers.
//
// The client buckets every one of these before anything leaves the browser
// (see CONTENT_FIELDS in umami-analytics.js) — an exact 1274 is distinctive
// enough to follow one install across releases, `500+` is not. They are counted
// here rather than in the page because the browser only ever has the page you
// opened: counting client-side would answer "bookmarks on this page" while
// calling itself "bookmarks".
type analyticsContentCounts struct {
	Bookmarks  int `json:"bookmarks"`
	Pages      int `json:"pages"`
	Categories int `json:"categories"`
	Tags       int `json:"tags"`
	Finders    int `json:"finders"`
	// Collections are the user's own smart collections, which live in settings.
	Collections int `json:"collections"`
	// Monitored and Periodic split the availability checking: a bookmark on the
	// fast monitor tier, against one that is merely checked. Together with the
	// bookmark total they answer whether people monitor a handful deliberately
	// or switch it on for everything.
	Monitored int `json:"monitored"`
	Periodic  int `json:"periodic"`
	// InboxOpen is what is waiting now; the other three are lifetime totals from
	// inbox-stats.json, which survives the items being triaged away. Together
	// they separate an inbox that flows from one that fills up.
	InboxOpen     int `json:"inboxOpen"`
	InboxAdded    int `json:"inboxAdded"`
	InboxPromoted int `json:"inboxPromoted"`
	InboxDeleted  int `json:"inboxDeleted"`
}

// analyticsContentTTL is how long a count is reused.
//
// Counting reads every page file, which the dashboard render otherwise does not
// do — it needs one page. Paying that on every load, for a number whose buckets
// move perhaps once a week, is not a trade worth making. A stale count inside
// this window is harmless: it lands in the same bucket.
const analyticsContentTTL = 10 * time.Minute

var analyticsContentCache = struct {
	sync.Mutex
	json string
	at   time.Time
}{}

// analyticsContentJSON returns the counts as JSON for the page template, or ""
// when analytics is off.
//
// The gate is the whole point of the signature: someone who opted out must not
// pay for a scan of their library on every page load. Off means not counted,
// not counted-and-discarded.
func (h *Handlers) analyticsContentJSON(enabled bool) string {
	if !enabled {
		return ""
	}

	analyticsContentCache.Lock()
	defer analyticsContentCache.Unlock()
	if analyticsContentCache.json != "" && time.Since(analyticsContentCache.at) < analyticsContentTTL {
		return analyticsContentCache.json
	}

	counts := h.countAnalyticsContent()
	encoded, err := json.Marshal(counts)
	if err != nil {
		return ""
	}
	analyticsContentCache.json = string(encoded)
	analyticsContentCache.at = time.Now()
	return analyticsContentCache.json
}

// invalidateAnalyticsContentCache drops the cached counts. Called where a write
// changes one of them enough to matter — adding a page, importing a backup —
// rather than on every bookmark edit, which cannot move a bucket on its own.
func invalidateAnalyticsContentCache() {
	analyticsContentCache.Lock()
	defer analyticsContentCache.Unlock()
	analyticsContentCache.json = ""
}

func (h *Handlers) countAnalyticsContent() analyticsContentCounts {
	settings := h.store.GetSettings()
	pages := h.store.GetPages()
	bookmarks := h.store.GetAllBookmarks()

	counts := analyticsContentCounts{
		Bookmarks:   len(bookmarks),
		Pages:       len(pages),
		Finders:     len(h.store.GetFinders()),
		Collections: len(settings.Collections),
	}

	tags := make(map[string]struct{})
	for _, bookmark := range bookmarks {
		if bookmark.Monitor {
			counts.Monitored++
		} else if bookmark.CheckStatus {
			counts.Periodic++
		}
		for _, tag := range bookmark.Tags {
			trimmed := strings.ToLower(strings.TrimSpace(tag))
			if trimmed != "" {
				tags[trimmed] = struct{}{}
			}
		}
	}
	counts.Tags = len(tags)

	for _, page := range pages {
		counts.Categories += len(h.store.GetCategoriesByPage(page.ID))
	}

	counts.InboxOpen = len(h.store.GetInboxItems())
	stats := h.store.GetInboxStats()
	counts.InboxAdded = stats.TotalAdded
	counts.InboxPromoted = stats.TotalPromoted
	counts.InboxDeleted = stats.TotalDeleted

	return counts
}
