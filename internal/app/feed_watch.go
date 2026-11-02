package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode/utf8"

	xhtml "golang.org/x/net/html"
)

/*
Watched feeds.

Fresh counts, quietly, what every feed it can find has published. A watch is
the other thing: a feed somebody chose to follow, whose newest entries are kept
with their words so they can be read on the dashboard. The two live in separate
files because a watch belongs to a (bookmark, feed) pair with its own
validators and items, while Fresh holds one feed per bookmark and only
timestamps. Stopping a watch is then a plain delete.
*/
const (
	feedWatchMaxItems     = 10
	feedWatchSummaryRunes = 600
	feedWatchLimit        = 100
	feedWatchSeenIDs      = 75
	// feedWatchRecent is how many of a feed's current entries are kept for the
	// news modal's lists, beyond the new ones; feedWatchRecentSummaryRunes cuts
	// their text so a hundred watches stay a small file.
	feedWatchRecent             = 50
	feedWatchRecentSummaryRunes = 300
)

// The choices, in minutes: 30, 1 h, 2 h, 4 h, 6 h, 12 h and 24 h.
var feedWatchIntervals = []int{30, 60, 120, 240, 360, 720, 1440}

// FeedWatch is everything remembered about one watched feed.
type FeedWatch struct {
	// BookmarkKey is canonicalBookmarkURLKey of the bookmark the feed was
	// watched from; two bookmarks of the same page share a watch.
	BookmarkKey     string `json:"bookmarkKey"`
	FeedURL         string `json:"feedUrl"`
	Title           string `json:"title,omitempty"`
	IntervalMinutes int    `json:"intervalMinutes"`

	// Muted feeds still count as news but never call: no push, no toast.
	// Paused feeds are not polled. Include and Exclude are words matched
	// against an entry's title and text: with Include, an entry needs one of
	// them; an Exclude word drops it.
	Muted   bool     `json:"muted,omitempty"`
	Paused  bool     `json:"paused,omitempty"`
	Include []string `json:"include,omitempty"`
	Exclude []string `json:"exclude,omitempty"`

	ETag         string `json:"etag,omitempty"`
	LastModified string `json:"lastModified,omitempty"`

	WatchedAt int64 `json:"watchedAt,omitempty"`
	CheckedAt int64 `json:"checkedAt,omitempty"`
	TriedAt   int64 `json:"triedAt,omitempty"`
	// NewestAt is the newest publish time seen; NewAt is when the last new
	// entry was found. Failures counts consecutive failed polls.
	NewestAt int64 `json:"newestAt,omitempty"`
	NewAt    int64 `json:"newAt,omitempty"`
	Failures int   `json:"failures,omitempty"`
	// LastError is a stable code for why the last poll failed (http-404,
	// http-5xx, timeout, unreachable, not-a-feed, refused) with LastStatus the
	// HTTP status when there was one; both are cleared by a poll that works.
	LastError  string `json:"lastError,omitempty"`
	LastStatus int    `json:"lastStatus,omitempty"`
	// MovedFrom is the address this feed was followed from after it moved for
	// good (a 301 or 308), MovedAt when that was.
	MovedFrom string `json:"movedFrom,omitempty"`
	MovedAt   int64  `json:"movedAt,omitempty"`

	SeenIDs []string   `json:"seenIds,omitempty"`
	Items   []FeedItem `json:"items,omitempty"`
	// Recent are the feed's newest entries as of the last answer, light copies
	// (no picture) for the list beside an article.
	Recent []FeedItem `json:"recent,omitempty"`
}

// FeedWatchFile is the whole of what watches remember, on disk.
type FeedWatchFile struct {
	Watches []FeedWatch `json:"watches"`
	// SeenAt is, per bookmark key, when its news was last marked read.
	SeenAt map[string]int64 `json:"seenAt,omitempty"`
}

var feedWatchMu sync.Mutex

func feedWatchFilePath() string {
	return filepath.Join(ResolveDataDir(), "feed-watches.json")
}

func readFeedWatchFile() FeedWatchFile {
	data, err := os.ReadFile(feedWatchFilePath())
	if err != nil {
		return FeedWatchFile{Watches: []FeedWatch{}}
	}
	var file FeedWatchFile
	if err := json.Unmarshal(data, &file); err != nil || file.Watches == nil {
		return FeedWatchFile{Watches: []FeedWatch{}}
	}
	file.Watches = dropDuplicateWatches(file.Watches)
	return file
}

// dropDuplicateWatches keeps the first of every (bookmark, feed) pair. Two
// tabs saving one feed at once used to store it twice.
func dropDuplicateWatches(in []FeedWatch) []FeedWatch {
	seen := make(map[string]bool, len(in))
	out := make([]FeedWatch, 0, len(in))
	for _, w := range in {
		id := w.BookmarkKey + "\x00" + w.FeedURL
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, w)
	}
	return out
}

func writeFeedWatchFile(file FeedWatchFile) error {
	if file.Watches == nil {
		file.Watches = []FeedWatch{}
	}
	return writeIndentJSONFile(feedWatchFilePath(), file)
}

func validFeedWatchInterval(minutes int) bool {
	for _, v := range feedWatchIntervals {
		if v == minutes {
			return true
		}
	}
	return false
}

const (
	feedWatchFilterWords     = 10
	feedWatchFilterWordRunes = 40
)

// cleanFilterWords trims the words and drops empty ones. It is false when
// there are too many or one is too long.
func cleanFilterWords(in []string) ([]string, bool) {
	out := make([]string, 0, len(in))
	for _, word := range in {
		word = strings.TrimSpace(word)
		if word == "" {
			continue
		}
		if utf8.RuneCountInString(word) > feedWatchFilterWordRunes {
			return nil, false
		}
		out = append(out, word)
	}
	if len(out) > feedWatchFilterWords {
		return nil, false
	}
	return out, true
}

// feedItemPlainText is an entry's title and text without markup.
func feedItemPlainText(it FeedItem) string {
	var b strings.Builder
	b.WriteString(it.Title)
	b.WriteByte(' ')
	z := xhtml.NewTokenizer(strings.NewReader(it.Summary))
	for {
		tt := z.Next()
		if tt == xhtml.ErrorToken {
			break
		}
		if tt == xhtml.TextToken {
			b.Write(z.Text())
			b.WriteByte(' ')
		}
	}
	return strings.ToLower(b.String())
}

// watchKeeps applies a watch's word filter to one entry.
func watchKeeps(w FeedWatch, it FeedItem) bool {
	if len(w.Include) == 0 && len(w.Exclude) == 0 {
		return true
	}
	text := feedItemPlainText(it)
	for _, word := range w.Exclude {
		if strings.Contains(text, strings.ToLower(word)) {
			return false
		}
	}
	if len(w.Include) == 0 {
		return true
	}
	for _, word := range w.Include {
		if strings.Contains(text, strings.ToLower(word)) {
			return true
		}
	}
	return false
}

// filterWatchItems keeps the entries a watch's word filter lets through.
func filterWatchItems(w FeedWatch, items []FeedItem) []FeedItem {
	if len(w.Include) == 0 && len(w.Exclude) == 0 {
		return items
	}
	out := make([]FeedItem, 0, len(items))
	for _, it := range items {
		if watchKeeps(w, it) {
			out = append(out, it)
		}
	}
	return out
}
