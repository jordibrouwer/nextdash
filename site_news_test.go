package main

import (
	"context"
	"strings"
	"testing"
	"time"
)

const sampleSiteFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>nextDash</title>
  <item>
    <title>Hover cards in nextDash v1.3.2</title>
    <link>https://nextdash.cc/2026/08/21/hover-cards/</link>
    <pubDate>Fri, 21 Aug 2026 14:07:57 +0000</pubDate>
  </item>
  <item>
    <title>It&#8217;s about the life of a link</title>
    <link>https://nextdash.cc/2026/08/19/133/</link>
    <pubDate>Wed, 19 Aug 2026 11:17:31 +0000</pubDate>
  </item>
  <item>
    <title>No date on this one</title>
    <link>https://nextdash.cc/2026/08/18/undated/</link>
  </item>
  <item>
    <title></title>
    <link>https://nextdash.cc/2026/08/17/untitled/</link>
    <pubDate>Mon, 17 Aug 2026 11:45:35 +0000</pubDate>
  </item>
</channel></rss>`

// The panel is title-left, date-right, one line each. A row missing half of
// that is worse than one row fewer, so an item without a title or without a
// readable date is skipped rather than drawn with a gap.
func TestSiteNewsSkipsWhatItCannotDraw(t *testing.T) {
	items := parseSiteNews([]byte(sampleSiteFeed))

	if len(items) != 2 {
		t.Fatalf("expected the two complete items, got %d: %+v", len(items), items)
	}
	// Entities come out as characters: the panel sets text, not markup, so
	// &#8217; would otherwise be printed as written.
	if items[1].Title != "It’s about the life of a link" {
		t.Fatalf("entity was not decoded: %q", items[1].Title)
	}
	if items[0].PublishedAt <= 0 || items[1].PublishedAt <= 0 {
		t.Fatalf("dates were not parsed: %+v", items)
	}
	if items[0].PublishedAt <= items[1].PublishedAt {
		t.Fatalf("feed order should be newest first: %+v", items)
	}
}

// Five is what the panel draws; a feed with ten posts must not hand over ten.
func TestSiteNewsStopsAtFive(t *testing.T) {
	feed := `<rss><channel>`
	for i := 0; i < 12; i++ {
		feed += `<item><title>Post</title><link>https://nextdash.cc/p/</link>` +
			`<pubDate>Fri, 21 Aug 2026 14:07:57 +0000</pubDate></item>`
	}
	feed += `</channel></rss>`

	if got := len(parseSiteNews([]byte(feed))); got != siteNewsMaxItems {
		t.Fatalf("expected %d items, got %d", siteNewsMaxItems, got)
	}
}

// Anything that is not a feed — an error page served with a 200, a truncated
// body — yields nothing, and the caller keeps whatever it had.
func TestSiteNewsIgnoresRubbish(t *testing.T) {
	for _, body := range []string{"", "<html><body>404</body></html>", "<rss><channel>"} {
		if got := parseSiteNews([]byte(body)); len(got) != 0 {
			t.Fatalf("expected nothing from %q, got %+v", body, got)
		}
	}
}

// What an unreachable site does to the panel.
//
// Three things, in order of how much they matter: nothing throws, whatever was
// last read stays on the page rather than being replaced by nothing, and the
// next config open does not try again straight away — a site that is down
// should not cost every reader an eight-second wait.
func TestSiteNewsSurvivesAnUnreachableSite(t *testing.T) {
	previousURL := siteNewsFeedURL
	// Its own data dir: the cache mirrors to disk, and a mirror written by
	// another run would be loaded over the state this test sets up.
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Cleanup(func() {
		siteNewsFeedURL = previousURL
		siteNews = siteNewsCache{}
	})

	// A URL the request cannot even be built from, which fails on the same path
	// a dead host does — before any response exists. A real socket is the wrong
	// tool here: localhost is refused by the outbound guard by design, and a
	// public address would make this test depend on the network.
	siteNewsFeedURL = "http://\x7f-invalid/feed/"
	siteNews = siteNewsCache{
		items:     []SiteNewsItem{{Title: "Yesterday's post", URL: "https://nextdash.cc/p/", PublishedAt: 1}},
		fetchedAt: time.Now().Add(-24 * time.Hour),
		ok:        true,
		loaded:    true,
	}

	h := &Handlers{}
	items, _ := h.fetchSiteNews(context.Background())

	if len(items) != 1 || items[0].Title != "Yesterday's post" {
		t.Fatalf("a failed fetch should keep what was there, got %+v", items)
	}
	if siteNews.triedAt.IsZero() {
		t.Fatalf("the attempt was not recorded, so the next open would try again immediately")
	}

	// Inside the back-off, and with nothing cached, the answer is an empty list
	// — which the panel says in one line rather than an empty frame.
	siteNews.items = nil
	siteNews.ok = false
	again, _ := h.fetchSiteNews(context.Background())
	if len(again) != 0 {
		t.Fatalf("expected nothing, got %+v", again)
	}
}

// The description a WordPress feed carries is HTML — paragraphs, a "Continue
// reading" link, sometimes an image — and the stream sets text, not markup.
func TestSiteNewsSummaryIsOnePlainLine(t *testing.T) {
	raw := `<p>The card answers <strong>three things</strong> in the same order every time: ` +
		`what the page is, what it says, and what you already know about it.</p>` +
		`<a href="https://nextdash.cc/x/">Continue reading</a>`

	got := summariseSiteNews(raw)

	if strings.Contains(got, "<") || strings.Contains(got, ">") {
		t.Fatalf("markup survived: %q", got)
	}
	if !strings.HasPrefix(got, "The card answers three things") {
		t.Fatalf("text was mangled: %q", got)
	}
	if len([]rune(got)) > siteNewsSummaryChars+1 {
		t.Fatalf("summary is %d runes, cap is %d: %q", len([]rune(got)), siteNewsSummaryChars, got)
	}
	// Cut on a word boundary: a summary ending mid-word reads as broken.
	if strings.HasSuffix(got, "…") && strings.HasSuffix(strings.TrimSuffix(got, "…"), " ") {
		t.Fatalf("ellipsis follows a space: %q", got)
	}
}

func TestSiteNewsSummaryDecodesEntitiesAndKeepsShortOnesWhole(t *testing.T) {
	if got := summariseSiteNews("<p>It&#8217;s about the life of a link</p>"); got != "It’s about the life of a link" {
		t.Fatalf("short summary was altered: %q", got)
	}
	if got := summariseSiteNews("   <p></p>  "); got != "" {
		t.Fatalf("an empty description should stay empty, got %q", got)
	}
}

// The environment overrides the setting, for a server run on someone's behalf.
func TestNewsFeedDisabledByEnv(t *testing.T) {
	for _, on := range []string{"1", "true", "YES", " on "} {
		t.Setenv("DISABLE_NEWS_FEED", on)
		if !newsFeedDisabledByEnv() {
			t.Fatalf("%q should switch the feed off", on)
		}
	}
	for _, off := range []string{"", "false", "0", "maybe"} {
		t.Setenv("DISABLE_NEWS_FEED", off)
		if newsFeedDisabledByEnv() {
			t.Fatalf("%q should leave the feed under user control", off)
		}
	}
}

// A restart used to go straight back out to the site. The mirror carries the
// posts and the validators, so the first fetch after one can be conditional —
// and on a machine that reboots nightly there is no fetch at all.
func TestSiteNewsMirrorsToDisk(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	t.Cleanup(func() { siteNews = siteNewsCache{} })

	siteNews = siteNewsCache{
		items:        []SiteNewsItem{{Title: "Hover cards", URL: "https://nextdash.cc/p/", PublishedAt: 7}},
		fetchedAt:    time.Now(),
		etag:         `W/"abc"`,
		lastModified: "Fri, 21 Aug 2026 14:07:57 GMT",
		ok:           true,
		loaded:       true,
	}
	siteNews.saveToDisk()

	// A fresh process: nothing in memory, everything on disk.
	siteNews = siteNewsCache{}
	siteNews.loadFromDisk()

	if len(siteNews.items) != 1 || siteNews.items[0].Title != "Hover cards" {
		t.Fatalf("posts did not survive the restart: %+v", siteNews.items)
	}
	if siteNews.etag != `W/"abc"` || siteNews.lastModified == "" {
		t.Fatalf("validators were lost: %q / %q", siteNews.etag, siteNews.lastModified)
	}
	if !siteNews.ok {
		t.Fatalf("a mirrored fetch should count as a fetch")
	}
}
