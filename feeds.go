package main

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

/*
Fresh: bookmarks that can say when there is something new.

The preview fetch already reads the page's <head>, and `<link rel="alternate"
type="application/rss+xml">` is sitting right there, ignored. Keeping it costs a
line; polling it costs a conditional GET on the health cadence. What it buys is
the one question none of the smart collections can answer — Today, Recently
opened, Most used and Stale all key on what *you* did, and this keys on what
*changed*.

This is deliberately not a feed reader. No article list, no titles, no read
state, no OPML. What is stored per feed is the validators needed to ask "anything
new?" cheaply, and the timestamps of recent entries so the badge can say three
rather than just "new". Nothing that would let you read the feed here, because
then it would be a second product rather than a five-hundred-line feature.

The count is measured against when the bookmark was last opened: opening the
bookmark is what clears it, so there is no read state to keep in sync.
*/

const (
	// feedMaxRecentItems bounds what is kept per feed. Twenty is enough for the
	// badge to be right about a busy blog between two polls, and small enough
	// that the file stays a state file rather than a copy of the feed.
	feedMaxRecentItems = 20
	// feedPollCheckInterval is how often the scheduler wakes to see whether a
	// poll is due — short relative to the cadence so "every N hours" survives a
	// restart, the same approach the recheck scheduler takes.
	feedPollCheckInterval = 15 * time.Minute
	// feedFetchTimeout bounds a single feed fetch. Feeds are XML documents on
	// ordinary web servers; one that cannot answer in this long is one this
	// should stop waiting for.
	feedFetchTimeout = 10 * time.Second
	// feedMaxBytes caps what is read from a feed. Enough for the head of any
	// reasonable feed, and a hard stop on one that streams forever.
	feedMaxBytes = 1 << 20
	// feedMaxFailures is when polling gives up on a feed until it is rediscovered.
	// A feed that has answered badly this many times in a row is gone, not slow.
	feedMaxFailures = 5
)

// FeedState is everything remembered about one bookmark's feed.
//
// Keyed by the bookmark's canonical URL, so it survives a rename and does not
// need a bookmark id — the same key the health cache uses.
type FeedState struct {
	FeedURL string `json:"feedUrl"`
	// ETag and LastModified are the server's own validators, sent back on the
	// next poll. A feed that supports either answers 304 with no body, which is
	// what makes polling on a six-hour cadence unremarkable.
	ETag         string `json:"etag,omitempty"`
	LastModified string `json:"lastModified,omitempty"`
	CheckedAt    int64  `json:"checkedAt,omitempty"`
	// LastItemAt is the newest entry's timestamp, and RecentItems are the
	// timestamps behind it, newest first. Timestamps only: the badge needs to
	// count entries newer than your last visit, and nothing here needs to know
	// what they said.
	RecentItems []int64 `json:"recentItems,omitempty"`
	LastItemAt  int64   `json:"lastItemAt,omitempty"`
	// Failures counts consecutive failed polls, so a dead feed stops being
	// polled without being forgotten.
	Failures int `json:"failures,omitempty"`
}

// FeedStateFile is the whole of what feeds remember, on disk.
type FeedStateFile struct {
	Feeds    map[string]FeedState `json:"feeds"`
	LastPoll int64                `json:"lastPoll,omitempty"`
}

var feedStateMu sync.Mutex

func feedStateFilePath() string {
	return filepath.Join(ResolveDataDir(), "feeds.json")
}

func readFeedStateFile() FeedStateFile {
	data, err := os.ReadFile(feedStateFilePath())
	if err != nil {
		return FeedStateFile{Feeds: map[string]FeedState{}}
	}
	var state FeedStateFile
	if err := json.Unmarshal(data, &state); err != nil || state.Feeds == nil {
		return FeedStateFile{Feeds: map[string]FeedState{}}
	}
	return state
}

func writeFeedStateFile(state FeedStateFile) error {
	if state.Feeds == nil {
		state.Feeds = map[string]FeedState{}
	}
	return writeIndentJSONFile(feedStateFilePath(), state)
}

// recordDiscoveredFeed remembers where a bookmark's feed lives.
//
// Called from the preview fetch, which runs whether or not polling is switched
// on: discovery is free, and a reader who turns Fresh on later should not have
// to re-fetch every page before anything can happen. An unchanged URL is left
// exactly as it is, validators and all, so this never costs a re-poll.
func recordDiscoveredFeed(bookmarkURL, feedURL string) {
	key := canonicalBookmarkURLKey(bookmarkURL)
	feedURL = strings.TrimSpace(feedURL)
	if key == "" || feedURL == "" {
		return
	}

	feedStateMu.Lock()
	defer feedStateMu.Unlock()
	state := readFeedStateFile()
	existing, ok := state.Feeds[key]
	if ok && existing.FeedURL == feedURL {
		return
	}
	if ok {
		// A different feed at the same bookmark: the validators and the item
		// timestamps belong to the old one and would make the new feed look
		// read.
		existing = FeedState{}
	}
	existing.FeedURL = feedURL
	state.Feeds[key] = existing
	_ = writeFeedStateFile(state)
}

// extractFeedFromHTML finds the page's own feed link.
//
// Both media types are accepted, and the first match wins: a page that
// advertises several (comments feeds, per-category feeds) puts the one it
// considers primary first, which is the convention this relies on rather than
// trying to be clever about titles.
func extractFeedFromHTML(htmlBody string) string {
	lower := strings.ToLower(htmlBody)
	start := 0
	for {
		linkIdx := strings.Index(lower[start:], "<link")
		if linkIdx < 0 {
			return ""
		}
		tagStart := start + linkIdx
		tagEnd := strings.Index(lower[tagStart:], ">")
		if tagEnd < 0 {
			return ""
		}
		tag := htmlBody[tagStart : tagStart+tagEnd+1]
		lowerTag := lower[tagStart : tagStart+tagEnd+1]
		start = tagStart + tagEnd + 1

		if !strings.Contains(lowerTag, "alternate") {
			continue
		}
		if !strings.Contains(lowerTag, "application/rss+xml") &&
			!strings.Contains(lowerTag, "application/atom+xml") {
			continue
		}
		if href := extractAttributeValue(tag, "href"); href != "" {
			return href
		}
	}
}

// extractAttributeValue reads one attribute out of a tag, quoted either way.
func extractAttributeValue(tag, attribute string) string {
	lower := strings.ToLower(tag)
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

// feedDocument is as much of RSS and Atom as counting entries needs.
type feedDocument struct {
	XMLName xml.Name    `xml:"-"`
	Items   []feedEntry `xml:"channel>item"`
	Entries []feedEntry `xml:"entry"`
}

type feedEntry struct {
	PubDate   string `xml:"pubDate"`
	Date      string `xml:"date"`
	Published string `xml:"published"`
	Updated   string `xml:"updated"`
}

// feedEntryTimestamps returns the entry times, newest first.
//
// The three date formats are the ones actually in the wild: RFC 1123 with and
// without a zone name (RSS), and RFC 3339 (Atom, and RSS feeds that use Dublin
// Core). An entry whose date cannot be read is skipped rather than counted as
// now, because counting it as now would make every poll report something new.
func feedEntryTimestamps(body []byte) []int64 {
	var doc feedDocument
	if err := xml.Unmarshal(body, &doc); err != nil {
		return nil
	}
	entries := append(append([]feedEntry{}, doc.Items...), doc.Entries...)
	times := make([]int64, 0, len(entries))
	for _, entry := range entries {
		for _, raw := range []string{entry.PubDate, entry.Published, entry.Updated, entry.Date} {
			if ts := parseFeedTime(raw); ts > 0 {
				times = append(times, ts)
				break
			}
		}
	}
	// Newest first, and capped: this is a state file, not the feed.
	for i := 0; i < len(times); i++ {
		for j := i + 1; j < len(times); j++ {
			if times[j] > times[i] {
				times[i], times[j] = times[j], times[i]
			}
		}
	}
	if len(times) > feedMaxRecentItems {
		times = times[:feedMaxRecentItems]
	}
	return times
}

func parseFeedTime(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	layouts := []string{
		time.RFC1123Z,
		time.RFC1123,
		time.RFC3339,
		"2006-01-02T15:04:05Z0700",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed.UnixMilli()
		}
	}
	return 0
}

// pollFeed asks one feed whether anything is new, and returns the updated state.
//
// A 304 is the good case and the common one: the validators go back out, nothing
// comes back, and the stored timestamps stand. Anything else that is not a 2xx
// counts as a failure, and enough consecutive failures retire the feed.
func (h *Handlers) pollFeed(ctx context.Context, state FeedState) FeedState {
	feedURL := strings.TrimSpace(state.FeedURL)
	if feedURL == "" {
		return state
	}
	if err := validateHTTPURL(feedURL, h.allowLocalBookmarks()); err != nil {
		state.Failures = feedMaxFailures
		return state
	}

	client := h.outboundHTTPClient(feedFetchTimeout, 5)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		state.Failures++
		return state
	}
	req.Header.Set("User-Agent", "nextDash FeedBot/1.0")
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5")
	if state.ETag != "" {
		req.Header.Set("If-None-Match", state.ETag)
	}
	if state.LastModified != "" {
		req.Header.Set("If-Modified-Since", state.LastModified)
	}

	resp, err := client.Do(req)
	if err != nil || resp == nil {
		state.Failures++
		return state
	}
	defer resp.Body.Close()

	state.CheckedAt = time.Now().UnixMilli()
	if resp.StatusCode == http.StatusNotModified {
		state.Failures = 0
		return state
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		state.Failures++
		return state
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, feedMaxBytes))
	if err != nil {
		state.Failures++
		return state
	}
	times := feedEntryTimestamps(body)
	if len(times) == 0 {
		// Reachable but unreadable — an HTML error page served with a 200, or a
		// feed whose dates cannot be parsed. Counted as a failure so it retires
		// rather than being polled forever for nothing.
		state.Failures++
		return state
	}

	state.Failures = 0
	state.ETag = strings.TrimSpace(resp.Header.Get("ETag"))
	state.LastModified = strings.TrimSpace(resp.Header.Get("Last-Modified"))
	state.RecentItems = times
	state.LastItemAt = times[0]
	return state
}

// feedPollDue reports whether a round of polling is due, on the health cadence.
//
// Deliberately the same interval as the background re-check rather than a
// setting of its own: both are "how often may this install talk to the outside
// world on its own", and answering that twice invites the two to disagree.
func (h *Handlers) feedPollDue() bool {
	last := readFeedStateFile().LastPoll
	if last <= 0 {
		return true
	}
	return time.Since(time.UnixMilli(last)) >= h.healthAutoRecheckInterval()
}

// StartFeedPollScheduler polls known feeds until stop is closed.
func (h *Handlers) StartFeedPollScheduler(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(feedPollCheckInterval)
		defer ticker.Stop()

		h.maybePollFeeds()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				h.maybePollFeeds()
			}
		}
	}()
}

func (h *Handlers) maybePollFeeds() {
	if !h.store.GetSettings().FeedsEnabled {
		return
	}
	if !h.feedPollDue() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	h.PollAllFeeds(ctx)
}

// PollAllFeeds polls every feed still worth polling and records the round.
//
// Only feeds belonging to a bookmark that still exists: a deleted bookmark
// leaves its state behind, and polling it would be talking to the internet on
// behalf of something nobody has.
func (h *Handlers) PollAllFeeds(ctx context.Context) int {
	feedStateMu.Lock()
	state := readFeedStateFile()
	targets := make(map[string]FeedState, len(state.Feeds))
	live := map[string]struct{}{}
	for _, bookmark := range h.store.GetAllBookmarks() {
		if key := canonicalBookmarkURLKey(bookmark.URL); key != "" {
			live[key] = struct{}{}
		}
	}
	for key, feed := range state.Feeds {
		if _, ok := live[key]; !ok {
			continue
		}
		if feed.FeedURL == "" || feed.Failures >= feedMaxFailures {
			continue
		}
		targets[key] = feed
	}
	feedStateMu.Unlock()

	polled := make(map[string]FeedState, len(targets))
	for key, feed := range targets {
		select {
		case <-ctx.Done():
			// Whatever was polled before the deadline is still worth keeping.
			goto persist
		default:
		}
		polled[key] = h.pollFeed(ctx, feed)
	}

persist:
	feedStateMu.Lock()
	defer feedStateMu.Unlock()
	current := readFeedStateFile()
	if current.Feeds == nil {
		current.Feeds = map[string]FeedState{}
	}
	for key, feed := range polled {
		// Merged onto whatever is on disk now rather than onto the snapshot: a
		// bookmark saved mid-round may have rediscovered a different feed, and
		// that is newer information than this round's.
		if existing, ok := current.Feeds[key]; ok && existing.FeedURL != feed.FeedURL {
			continue
		}
		current.Feeds[key] = feed
	}
	current.LastPoll = time.Now().UnixMilli()
	_ = writeFeedStateFile(current)
	return len(polled)
}

// FeedFresh is what one bookmark's feed says, as the dashboard needs it.
type FeedFresh struct {
	FeedURL    string `json:"feedUrl"`
	NewCount   int    `json:"newCount"`
	LastItemAt int64  `json:"lastItemAt,omitempty"`
	CheckedAt  int64  `json:"checkedAt,omitempty"`
}

// freshnessForBookmarks counts, per bookmark, the entries published since that
// bookmark was last opened.
//
// Opening the bookmark is what clears the count, which is why there is no read
// state here: the thing that would maintain it is already maintained. A bookmark
// never opened counts everything the feed has, capped by what is stored — you
// have seen none of it.
func freshnessForBookmarks(state FeedStateFile, bookmarks []Bookmark) map[string]FeedFresh {
	out := make(map[string]FeedFresh)
	for _, bookmark := range bookmarks {
		key := canonicalBookmarkURLKey(bookmark.URL)
		if key == "" {
			continue
		}
		feed, ok := state.Feeds[key]
		if !ok || feed.FeedURL == "" {
			continue
		}
		lastOpened := bookmark.LastOpened
		count := 0
		for _, at := range feed.RecentItems {
			if at > lastOpened {
				count++
			}
		}
		out[key] = FeedFresh{
			FeedURL:    feed.FeedURL,
			NewCount:   count,
			LastItemAt: feed.LastItemAt,
			CheckedAt:  feed.CheckedAt,
		}
	}
	return out
}

// GetFeeds reports what every known feed has published since you last looked.
func (h *Handlers) GetFeeds(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.store.GetSettings().FeedsEnabled {
		// Answered rather than refused: the dashboard asks on every load, and an
		// error for a switched-off feature would be noise in the console.
		json.NewEncoder(w).Encode(map[string]any{"enabled": false, "feeds": map[string]FeedFresh{}})
		return
	}
	state := readFeedStateFile()
	json.NewEncoder(w).Encode(map[string]any{
		"enabled":  true,
		"lastPoll": state.LastPoll,
		"feeds":    freshnessForBookmarks(state, h.store.GetAllBookmarks()),
	})
}

// PollFeedsNow runs a round on demand — the config panel's "check now".
func (h *Handlers) PollFeedsNow(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	polled := h.PollAllFeeds(ctx)

	w.Header().Set("Content-Type", "application/json")
	state := readFeedStateFile()
	json.NewEncoder(w).Encode(map[string]any{
		"polled":   polled,
		"lastPoll": state.LastPoll,
		"feeds":    freshnessForBookmarks(state, h.store.GetAllBookmarks()),
	})
}
