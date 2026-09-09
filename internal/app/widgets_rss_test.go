package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const rssFixture = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Example Blog</title>
<item>
  <title>Second post</title>
  <link>https://example.com/second</link>
  <description>&lt;p&gt;Some &lt;b&gt;marked up&lt;/b&gt; words.&lt;/p&gt;</description>
  <pubDate>Tue, 08 Sep 2026 10:00:00 +0000</pubDate>
</item>
<item>
  <title>First post</title>
  <link>https://example.com/first</link>
  <pubDate>Mon, 07 Sep 2026 10:00:00 +0000</pubDate>
</item>
<item>
  <title>Duplicate link</title>
  <link>https://example.com/second</link>
  <pubDate>Wed, 09 Sep 2026 10:00:00 +0000</pubDate>
</item>
<item>
  <title>No link at all</title>
  <pubDate>Wed, 09 Sep 2026 11:00:00 +0000</pubDate>
</item>
</channel></rss>`

const atomFixture = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom Source</title>
<entry>
  <title>An atom entry</title>
  <link rel="alternate" href="https://atom.example/one"/>
  <updated>2026-09-08T09:00:00Z</updated>
</entry>
</feed>`

func TestParseRSSItemsReadsRSS(t *testing.T) {
	items, errText := parseRSSItems([]byte(rssFixture))
	if errText != "" {
		t.Fatalf("parse failed: %s", errText)
	}
	// The duplicate link and the entry with no link are both dropped.
	if len(items) != 2 {
		t.Fatalf("got %d items: %+v", len(items), items)
	}
	if items[0].Title != "Second post" || items[0].Link != "https://example.com/second" {
		t.Errorf("first item = %+v", items[0])
	}
	if items[0].Source != "Example Blog" {
		t.Errorf("source = %q", items[0].Source)
	}
	// Markup is stripped, so a preview is words rather than tags.
	if items[0].Summary != "Some marked up words." {
		t.Errorf("summary = %q", items[0].Summary)
	}
	if items[0].PublishedAt == 0 {
		t.Error("pubDate was not read")
	}
}

func TestParseRSSItemsReadsAtom(t *testing.T) {
	items, errText := parseRSSItems([]byte(atomFixture))
	if errText != "" {
		t.Fatalf("parse failed: %s", errText)
	}
	if len(items) != 1 {
		t.Fatalf("got %d items", len(items))
	}
	// Atom writes the address in an href attribute rather than as text.
	if items[0].Link != "https://atom.example/one" {
		t.Errorf("link = %q", items[0].Link)
	}
	if items[0].Source != "Atom Source" {
		t.Errorf("source = %q", items[0].Source)
	}
}

func TestParseRSSItemsRefusesNonFeed(t *testing.T) {
	if _, errText := parseRSSItems([]byte("<html><body>not a feed</body></html>")); errText == "" {
		t.Error("expected a plain HTML page to be refused")
	}
}

func TestMergeRSSItemsSortsNewestFirstAndUndatedLast(t *testing.T) {
	now := time.Now().UnixMilli()
	merged := mergeRSSItems([]RSSItem{
		{Title: "undated"},
		{Title: "older", PublishedAt: now - 10_000},
		{Title: "newest", PublishedAt: now},
	})
	got := []string{merged[0].Title, merged[1].Title, merged[2].Title}
	want := []string{"newest", "older", "undated"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

func TestFetchRSSFeedReadsAWorkingAddress(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		_, _ = w.Write([]byte(rssFixture))
	}))
	defer service.Close()

	items, errText := h.fetchRSSFeed(context.Background(), service.URL)
	if errText != "" {
		t.Fatalf("fetch failed: %s", errText)
	}
	if len(items) != 2 {
		t.Fatalf("got %d items", len(items))
	}
}

func TestFetchRSSFeedRefusesADisallowedAddress(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, false)

	if _, errText := h.fetchRSSFeed(context.Background(), "http://127.0.0.1:1/feed.xml"); errText == "" {
		t.Error("expected the local address to be refused")
	}
}

func TestRSSWidgetConfigKeepsWholeAddresses(t *testing.T) {
	long := "https://example.com/very/long/path/that/is/well/past/sixty-four/characters/feed.xml?token=abcdefghijklmnop"
	clean := sanitizeWidgetConfig(WidgetTypeRSS, map[string]any{
		"feedUrls": []any{long, "not a url", "ftp://example.com/feed", long, "https://other.example/rss"},
		"rows":     4,
		"smuggled": "value",
	})
	if _, present := clean["smuggled"]; present {
		t.Error("an undeclared key reached the stored widget")
	}
	urls, ok := clean["feedUrls"].([]string)
	if !ok {
		t.Fatalf("feedUrls = %#v", clean["feedUrls"])
	}
	// The long address survives whole, the junk and the duplicate do not.
	if len(urls) != 2 || urls[0] != long || urls[1] != "https://other.example/rss" {
		t.Fatalf("urls = %#v", urls)
	}
	if clean["rows"] != 4 {
		t.Errorf("rows = %v", clean["rows"])
	}
}

func TestRSSWidgetConfigBoundsHowManyFeeds(t *testing.T) {
	many := make([]any, 0, 20)
	for i := 0; i < 20; i++ {
		many = append(many, "https://example.com/feed"+string(rune('a'+i))+".xml")
	}
	clean := sanitizeWidgetConfig(WidgetTypeRSS, map[string]any{"feedUrls": many})
	urls, _ := clean["feedUrls"].([]string)
	if len(urls) != widgetMaxFeedsPerWidget {
		t.Errorf("kept %d feeds, want %d", len(urls), widgetMaxFeedsPerWidget)
	}
}

// The stored copy of a widget's config carries []string, not the []any a
// JSON body arrives as -- and the handler reads that copy, so a reader that
// only knew one shape reported "no feeds set" on a widget that had two.
func TestRSSFeedListReadsBothShapes(t *testing.T) {
	urls := []string{"https://example.com/a.xml", "https://example.com/b.xml"}
	fromJSON := widgetConfigURLList([]any{urls[0], urls[1]}, widgetMaxFeedsPerWidget)
	fromStore := widgetConfigURLList(urls, widgetMaxFeedsPerWidget)
	if len(fromJSON) != 2 || len(fromStore) != 2 {
		t.Fatalf("json=%v store=%v", fromJSON, fromStore)
	}
	for i := range urls {
		if fromJSON[i] != urls[i] || fromStore[i] != urls[i] {
			t.Errorf("entry %d: json=%q store=%q", i, fromJSON[i], fromStore[i])
		}
	}
}
