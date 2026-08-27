package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExtractFeedFromHTML(t *testing.T) {
	cases := []struct {
		name string
		html string
		want string
	}{
		{
			name: "rss link",
			html: `<html><head><link rel="alternate" type="application/rss+xml" title="Feed" href="/feed.xml"></head></html>`,
			want: "/feed.xml",
		},
		{
			name: "atom with single quotes and reordered attributes",
			html: `<head><link href='https://example.com/atom' type='application/atom+xml' rel='alternate'></head>`,
			want: "https://example.com/atom",
		},
		{
			name: "the primary feed wins over the comments feed behind it",
			html: `<head><link rel="alternate" type="application/rss+xml" href="/main.xml">` +
				`<link rel="alternate" type="application/rss+xml" href="/comments.xml"></head>`,
			want: "/main.xml",
		},
		{
			name: "a stylesheet link is not a feed",
			html: `<head><link rel="stylesheet" href="/site.css"></head>`,
			want: "",
		},
		{
			name: "rel=alternate without a feed type is a translation, not a feed",
			html: `<head><link rel="alternate" hreflang="nl" href="/nl/"></head>`,
			want: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := extractFeedFromHTML(tc.html); got != tc.want {
				t.Fatalf("extractFeedFromHTML() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestFeedEntryTimestamps(t *testing.T) {
	rss := []byte(`<?xml version="1.0"?><rss version="2.0"><channel>
		<item><pubDate>Mon, 02 Jun 2025 10:00:00 +0000</pubDate></item>
		<item><pubDate>Tue, 03 Jun 2025 10:00:00 GMT</pubDate></item>
		<item><pubDate>not a date</pubDate></item>
	</channel></rss>`)
	times := feedEntryTimestamps(rss)
	if len(times) != 2 {
		t.Fatalf("expected the two readable dates, got %d", len(times))
	}
	// Newest first, so the badge can read the head of the list.
	if times[0] <= times[1] {
		t.Fatalf("expected newest first, got %v", times)
	}

	atom := []byte(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
		<entry><updated>2025-06-02T10:00:00Z</updated></entry>
		<entry><published>2025-06-03T10:00:00Z</published></entry>
	</feed>`)
	if got := len(feedEntryTimestamps(atom)); got != 2 {
		t.Fatalf("atom entries: got %d, want 2", got)
	}

	// An unparseable date must not be counted as now — that would make every
	// poll report something new.
	if got := feedEntryTimestamps([]byte(`<rss><channel><item><pubDate>soon</pubDate></item></channel></rss>`)); len(got) != 0 {
		t.Fatalf("unreadable dates should be skipped, got %v", got)
	}
}

// feedTestHandlers builds handlers over a temp data dir that allows local
// hosts, which is what an httptest server is.
func feedTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"allowLocalBookmarks":true}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	return &Handlers{store: &FileStore{settingsFile: settingsPath, dataDir: dir}}
}

func TestPollFeedUsesValidatorsAndKeepsStateOn304(t *testing.T) {
	var sawIfNoneMatch string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawIfNoneMatch = r.Header.Get("If-None-Match")
		if sawIfNoneMatch == `"v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		w.Header().Set("Content-Type", "application/rss+xml")
		_, _ = w.Write([]byte(`<rss><channel><item><pubDate>Mon, 02 Jun 2025 10:00:00 +0000</pubDate></item></channel></rss>`))
	}))
	defer server.Close()

	h := feedTestHandlers(t)
	first := h.pollFeed(t.Context(), FeedState{FeedURL: server.URL})
	if first.ETag != `"v1"` {
		t.Fatalf("expected the ETag to be kept, got %q", first.ETag)
	}
	if len(first.RecentItems) != 1 || first.LastItemAt != first.RecentItems[0] {
		t.Fatalf("expected one item and a matching lastItemAt, got %+v", first)
	}

	second := h.pollFeed(t.Context(), first)
	if sawIfNoneMatch != `"v1"` {
		t.Fatalf("expected If-None-Match to be sent, got %q", sawIfNoneMatch)
	}
	// A 304 is the good case: nothing comes back, and what is stored stands.
	if len(second.RecentItems) != 1 || second.LastItemAt != first.LastItemAt {
		t.Fatalf("304 must not clear what is known: %+v", second)
	}
	if second.Failures != 0 {
		t.Fatalf("304 is not a failure, got %d", second.Failures)
	}
}

func TestPollFeedCountsUnreadableAsFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A 200 with an HTML error page: reachable, and useless.
		_, _ = w.Write([]byte("<html><body>not a feed</body></html>"))
	}))
	defer server.Close()

	h := feedTestHandlers(t)
	state := h.pollFeed(t.Context(), FeedState{FeedURL: server.URL})
	if state.Failures != 1 {
		t.Fatalf("expected one failure, got %d", state.Failures)
	}
}

func TestFreshnessCountsSinceLastOpened(t *testing.T) {
	now := time.Now().UnixMilli()
	hour := int64(60 * 60 * 1000)
	state := FeedStateFile{Feeds: map[string]FeedState{
		canonicalBookmarkURLKey("https://example.com/blog"): {
			FeedURL:     "https://example.com/feed.xml",
			RecentItems: []int64{now - hour, now - 3*hour, now - 30*hour},
			LastItemAt:  now - hour,
		},
	}}

	// Opened two hours ago: one entry has appeared since.
	fresh := freshnessForBookmarks(state, []Bookmark{
		{URL: "https://example.com/blog", LastOpened: now - 2*hour},
	})
	if got := fresh[canonicalBookmarkURLKey("https://example.com/blog")].NewCount; got != 1 {
		t.Fatalf("newCount = %d, want 1", got)
	}

	// Never opened: everything the feed has is new to you.
	fresh = freshnessForBookmarks(state, []Bookmark{{URL: "https://example.com/blog"}})
	if got := fresh[canonicalBookmarkURLKey("https://example.com/blog")].NewCount; got != 3 {
		t.Fatalf("newCount for a never-opened bookmark = %d, want 3", got)
	}

	// A bookmark with no feed is absent rather than zero, so the dashboard can
	// tell "nothing new" from "no feed here".
	fresh = freshnessForBookmarks(state, []Bookmark{{URL: "https://example.com/other"}})
	if len(fresh) != 0 {
		t.Fatalf("expected no entry for a bookmark without a feed, got %+v", fresh)
	}
}
