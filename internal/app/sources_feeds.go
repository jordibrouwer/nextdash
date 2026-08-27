package app

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"regexp"
	"strings"
	"time"
)

/*
The sources that are just a feed: Hacker News favorites and a YouTube channel.

Neither needs a token, a key or an account on nextDash's side -- both are public
XML at a predictable address. That makes them the cheapest saved-items
integrations that exist, and it is why they share one file: the difference
between them is a URL and what a row means, not a protocol.

What a row means is the interesting part. A Hacker News favorite is a thing
somebody deliberately saved, so it is a bookmark. A YouTube channel is a
subscription -- one thing followed, whose feed is a rolling window of the last
fifteen videos. Turned into rows that means new bookmarks appearing for ever,
which is not what following a channel is. So the reader chooses: rows, or a
single bookmark for the channel that Fresh can then count new videos on.
*/

const (
	feedSourceTimeout  = 20 * time.Second
	feedSourceMaxBytes = 4 << 20
	feedSourceAgent    = "nextDash-feed-source/1.0"
	// feedSourceMaxItems bounds one round. Both feeds are short by nature --
	// hnrss pages at 100, a YouTube channel feed holds 15 -- so this is a guard
	// against a surprise rather than a working limit.
	feedSourceMaxItems = 300
)

var errFeedSourceNoHandle = errors.New("no account or channel configured")

// feedSourceDoc is RSS and Atom, as far as building a bookmark needs.
type feedSourceDoc struct {
	XMLName   xml.Name          `xml:"-"`
	Title     string            `xml:"channel>title"`
	AtomTitle string            `xml:"title"`
	Items     []feedSourceEntry `xml:"channel>item"`
	Entries   []feedSourceEntry `xml:"entry"`
}

type feedSourceEntry struct {
	Title string `xml:"title"`
	/*
	 * One field for both shapes.
	 *
	 * RSS writes the address as the element's text; Atom writes it in an href
	 * attribute. encoding/xml refuses two fields claiming the same tag -- go vet
	 * catches it -- so this holds the text and the attributes together and the
	 * reader below picks whichever is filled.
	 */
	Link        feedSourceLink `xml:"link"`
	GUID        string         `xml:"guid"`
	Description string         `xml:"description"`
	PubDate     string         `xml:"pubDate"`
	Published   string         `xml:"published"`
	Updated     string         `xml:"updated"`
}

// feedSourceLink is a <link>, as RSS and Atom each write one.
type feedSourceLink struct {
	Text string `xml:",chardata"`
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr"`
}

// url returns the entry's address from whichever shape carried it.
func (e feedSourceEntry) url() string {
	if link := strings.TrimSpace(e.Link.Text); link != "" {
		return link
	}
	// Atom: rel="alternate" is the page; anything else is an enclosure or a
	// self-reference, neither of which is what a reader wants to open.
	if rel := strings.TrimSpace(e.Link.Rel); rel == "" || strings.EqualFold(rel, "alternate") {
		return strings.TrimSpace(e.Link.Href)
	}
	return ""
}

func (e feedSourceEntry) publishedAt() int64 {
	for _, raw := range []string{e.Published, e.PubDate, e.Updated} {
		if at := parseFeedTime(raw); at > 0 {
			return at
		}
	}
	return 0
}

// FeedSourceResult is one round's worth of a feed.
type FeedSourceResult struct {
	Bookmarks []ImportedRow
	// NewestAt is the cursor: the newest entry's time, as a string so it fits
	// the register's opaque cursor field.
	NewestAt string
	Title    string
}

/*
fetchFeedSource reads one feed and turns it into rows.

Everything below the fetch is shared between the two sources, because a feed is
a feed: what differs is the address it lives at and whether the caller wants the
entries or the channel.
*/
func (h *Handlers) fetchFeedSource(ctx context.Context, feedURL, since, category string) (FeedSourceResult, error) {
	var out FeedSourceResult

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/xml;q=0.9")
	req.Header.Set("User-Agent", feedSourceAgent)

	client := h.outboundHTTPClient(feedSourceTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		// The one failure a reader can act on: they typed a name that does not
		// exist, and "HTTP 404" would send them looking at their network.
		return out, errors.New("that account or channel was not found")
	}
	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("the feed answered %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, feedSourceMaxBytes))
	if err != nil {
		return out, err
	}

	var doc feedSourceDoc
	if err := xml.Unmarshal(body, &doc); err != nil {
		return out, fmt.Errorf("that address did not answer with a feed: %w", err)
	}

	out.Title = strings.TrimSpace(doc.Title)
	if out.Title == "" {
		out.Title = strings.TrimSpace(doc.AtomTitle)
	}

	entries := doc.Items
	if len(entries) == 0 {
		entries = doc.Entries
	}

	sinceAt := int64(0)
	if parsed := parseFeedTime(since); parsed > 0 {
		sinceAt = parsed
	}

	seen := map[string]struct{}{}
	for i, entry := range entries {
		if i >= feedSourceMaxItems {
			break
		}
		link := entry.url()
		if link == "" {
			continue
		}
		parsed, err := neturl.Parse(link)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			continue
		}

		at := entry.publishedAt()
		if at > out.parsedNewest() {
			out.NewestAt = time.UnixMilli(at).UTC().Format(time.RFC3339)
		}
		// Older than the last round: already imported. Not a break, because a
		// feed is not guaranteed to be in date order the way a paged API is.
		if sinceAt > 0 && at > 0 && at <= sinceAt {
			continue
		}

		key := canonicalBookmarkURLKey(link)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}

		name := strings.TrimSpace(entry.Title)
		if name == "" {
			name = link
		}
		out.Bookmarks = append(out.Bookmarks, ImportedRow{
			Name:      name,
			URL:       link,
			Category:  category,
			Note:      feedEntryNote(entry),
			CreatedAt: at,
		})
	}
	return out, nil
}

// parsedNewest reads back the cursor this round has built so far.
func (r FeedSourceResult) parsedNewest() int64 {
	return parseFeedTime(r.NewestAt)
}

// feedEntryNote keeps the entry's own words, with the markup taken out.
//
// hnrss puts the discussion link in the description, which is the one thing
// worth keeping from a Hacker News favorite beside the article itself.
var feedTagPattern = regexp.MustCompile(`<[^>]*>`)

func feedEntryNote(entry feedSourceEntry) string {
	note := feedTagPattern.ReplaceAllString(entry.Description, " ")
	note = strings.Join(strings.Fields(note), " ")
	if len(note) > 500 {
		note = note[:500]
	}
	return note
}

/*
FetchHackerNewsFavorites reads what somebody starred on Hacker News.

hnrss.org turns a user's favorites page into a feed; no token, no key, no rate
limit, and the reader types nothing but their username. Each favorite is a
bookmark because that is what a favorite is -- something deliberately kept.

With AsRows off it becomes a single bookmark to the favorites page itself, for a
reader who wants the list in reach without every item in their grid.
*/
func (h *Handlers) FetchHackerNewsFavorites(ctx context.Context, source SourceState) (FeedSourceResult, error) {
	handle := strings.TrimSpace(source.Handle)
	if handle == "" {
		return FeedSourceResult{}, errFeedSourceNoHandle
	}
	// A username, not a path: anything else is a typo or an attempt to point
	// this at another address entirely.
	if strings.ContainsAny(handle, "/?&#: ") {
		return FeedSourceResult{}, errors.New("that is not a Hacker News username")
	}

	feedURL := "https://hnrss.org/favorites?id=" + neturl.QueryEscape(handle)
	if !source.AsRows {
		return FeedSourceResult{
			Bookmarks: []ImportedRow{{
				Name:     "Hacker News favorites — " + handle,
				URL:      "https://news.ycombinator.com/favorites?id=" + neturl.QueryEscape(handle),
				Category: source.TargetCategory,
			}},
		}, nil
	}
	return h.fetchFeedSource(ctx, feedURL, source.Cursor, source.TargetCategory)
}

// youtubeChannelPattern matches the channel id YouTube's feed needs.
var youtubeChannelPattern = regexp.MustCompile(`^UC[0-9A-Za-z_-]{20,24}$`)

/*
FetchYouTubeChannel reads a channel's public feed.

youtube.com/feeds/videos.xml needs a channel id, and the id is the whole
difficulty: a handle like @maker does not work, and resolving one means fetching
the channel page and reading an id out of the HTML. That is the only part of
this that breaks when YouTube changes its markup, so it says so when it fails
rather than reporting the channel as empty.

A channel is a subscription rather than a list of saved things, so AsRows is off
by default: one bookmark to the channel, which Fresh then counts new videos on.
*/
func (h *Handlers) FetchYouTubeChannel(ctx context.Context, source SourceState) (FeedSourceResult, error) {
	handle := strings.TrimSpace(source.Handle)
	if handle == "" {
		return FeedSourceResult{}, errFeedSourceNoHandle
	}

	channelID, err := h.resolveYouTubeChannelID(ctx, handle)
	if err != nil {
		return FeedSourceResult{}, err
	}

	if !source.AsRows {
		return FeedSourceResult{
			Bookmarks: []ImportedRow{{
				Name:     "YouTube — " + handle,
				URL:      "https://www.youtube.com/channel/" + channelID,
				Category: source.TargetCategory,
			}},
		}, nil
	}
	return h.fetchFeedSource(ctx,
		"https://www.youtube.com/feeds/videos.xml?channel_id="+neturl.QueryEscape(channelID),
		source.Cursor, source.TargetCategory)
}

// youtubeIDInPage finds the channel id in a channel page's HTML.
var youtubeIDInPage = regexp.MustCompile(`"(?:channelId|externalId)":"(UC[0-9A-Za-z_-]{20,24})"`)

/*
resolveYouTubeChannelID turns whatever the reader pasted into a UC id.

A raw id passes straight through. Anything else -- a handle, a channel URL, a
/c/ vanity path -- means fetching the page and reading the id out of it, because
there is no public endpoint that does this without an API key.

This is the one part of the YouTube source that depends on YouTube's markup, so
its failure says exactly that. Reporting "no videos" instead would send a reader
looking at the wrong thing entirely.
*/
func (h *Handlers) resolveYouTubeChannelID(ctx context.Context, handle string) (string, error) {
	if youtubeChannelPattern.MatchString(handle) {
		return handle, nil
	}

	pageURL := ""
	switch {
	case strings.HasPrefix(handle, "http://"), strings.HasPrefix(handle, "https://"):
		parsed, err := neturl.Parse(handle)
		if err != nil || !strings.HasSuffix(strings.ToLower(parsed.Hostname()), "youtube.com") {
			return "", errors.New("that is not a YouTube address")
		}
		// A /channel/UC… address carries the id already.
		if parts := strings.Split(strings.Trim(parsed.Path, "/"), "/"); len(parts) == 2 && parts[0] == "channel" {
			if youtubeChannelPattern.MatchString(parts[1]) {
				return parts[1], nil
			}
		}
		pageURL = handle
	case strings.HasPrefix(handle, "@"):
		pageURL = "https://www.youtube.com/" + handle
	default:
		pageURL = "https://www.youtube.com/@" + neturl.PathEscape(handle)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", feedSourceAgent)
	client := h.outboundHTTPClient(feedSourceTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return "", errors.New("that YouTube channel was not found")
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("YouTube answered %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, feedSourceMaxBytes))
	if err != nil {
		return "", err
	}
	match := youtubeIDInPage.FindSubmatch(body)
	if match == nil {
		return "", errors.New("could not find the channel id on that page — paste the UC… id instead")
	}
	return string(match[1]), nil
}
