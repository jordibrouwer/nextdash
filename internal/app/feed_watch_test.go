package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// watchFeedServer serves an RSS feed whose entries a test can change.
type watchFeedServer struct {
	*httptest.Server
	mu      sync.Mutex
	entries []string
	hits    atomic.Int32
	// delay holds every answer back, so concurrent callers overlap.
	delay time.Duration
}

func newWatchFeedServer(t *testing.T) *watchFeedServer {
	t.Helper()
	s := &watchFeedServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.hits.Add(1)
		if s.delay > 0 {
			time.Sleep(s.delay)
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprintf(w, `<?xml version="1.0"?><rss version="2.0"><channel><title>Stub</title>%s</channel></rss>`, strings.Join(s.entries, ""))
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *watchFeedServer) set(entries ...string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = entries
}

func rssEntry(guid, title string, day int) string {
	return fmt.Sprintf(`<item><title>%s</title><link>https://e.com/%s</link><guid>%s</guid><pubDate>%s</pubDate><description>%s text</description></item>`,
		title, guid, guid, time.Date(2024, 1, day, 10, 0, 0, 0, time.UTC).Format(time.RFC1123), title)
}

func undatedEntry(guid, title string) string {
	return fmt.Sprintf(`<item><title>%s</title><link>https://e.com/%s</link><guid>%s</guid></item>`, title, guid, guid)
}

func newWatch(url string) FeedWatch {
	return FeedWatch{BookmarkKey: "e.com/page", FeedURL: url, IntervalMinutes: 360}
}

func baselined(t *testing.T, h *Handlers, url string) FeedWatch {
	t.Helper()
	w, err := h.baselineWatch(context.Background(), newWatch(url))
	if err != nil {
		t.Fatal(err)
	}
	return w
}

var watchNow = time.Date(2024, 2, 1, 12, 0, 0, 0, time.UTC)

func TestWatchBaselineCountsNothingNew(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	if len(w.Items) != 0 || len(w.SeenIDs) != 2 || w.NewestAt == 0 || w.Title != "Stub" {
		t.Fatalf("baseline: %+v", w)
	}
	_, news := h.pollWatch(context.Background(), w, watchNow)
	if len(news) != 0 {
		t.Fatalf("unchanged feed should give no news, got %d", len(news))
	}
}

func TestWatchBaselineRefusesANonFeed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "<html>no</html>") }))
	defer srv.Close()
	h := newDiscoveryHandlers(t, nil)
	if _, err := h.baselineWatch(context.Background(), newWatch(srv.URL)); err == nil {
		t.Fatal("expected errFeedWatchNotAFeed")
	}
}

func TestWatchPollFindsNewEntries(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2), rssEntry("c", "C", 3))
	w, news := h.pollWatch(context.Background(), w, watchNow)
	if len(news) != 2 || len(w.Items) != 2 {
		t.Fatalf("news=%d items=%d", len(news), len(w.Items))
	}
	if w.Items[0].Title != "C" || w.Items[0].FoundAt != watchNow.UnixMilli() || w.NewAt != watchNow.UnixMilli() {
		t.Fatalf("items[0]=%+v NewAt=%d", w.Items[0], w.NewAt)
	}
}

func TestWatchKeepsFiveItems(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	var all []string
	all = append(all, rssEntry("a", "A", 1))
	for d := 2; d <= 9; d++ {
		all = append(all, rssEntry(fmt.Sprintf("n%d", d), fmt.Sprintf("N%d", d), d))
	}
	srv.set(all...)
	w, _ = h.pollWatch(context.Background(), w, watchNow)
	if len(w.Items) != feedWatchMaxItems || w.Items[0].Title != "N9" {
		t.Fatalf("items=%d first=%q", len(w.Items), w.Items[0].Title)
	}
}

func TestWatchSummaryCappedAt600(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	long := fmt.Sprintf(`<item><title>L</title><link>https://e.com/l</link><guid>l</guid><pubDate>%s</pubDate><description>%s</description></item>`,
		time.Date(2024, 1, 5, 10, 0, 0, 0, time.UTC).Format(time.RFC1123), strings.Repeat("y", 3000))
	srv.set(rssEntry("a", "A", 1), long)
	w, _ = h.pollWatch(context.Background(), w, watchNow)
	if n := len([]rune(w.Items[0].Summary)); n > feedWatchSummaryRunes+1 {
		t.Fatalf("summary has %d runes", n)
	}
}

func TestWatchUndatedEntriesUseIDs(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(undatedEntry("a", "A"))
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	_, news := h.pollWatch(context.Background(), w, watchNow)
	if len(news) != 0 {
		t.Fatalf("same guids should give 0 new, got %d", len(news))
	}
	srv.set(undatedEntry("a", "A"), undatedEntry("b", "B"))
	_, news = h.pollWatch(context.Background(), w, watchNow)
	if len(news) != 1 || news[0].Title != "B" {
		t.Fatalf("new guid should give 1 new, got %+v", news)
	}
}

func TestWatchSameIDNotNewTwice(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	srv.set(rssEntry("a", "A edited", 20))
	_, news := h.pollWatch(context.Background(), w, watchNow)
	if len(news) != 0 {
		t.Fatalf("a republished old guid is not news, got %d", len(news))
	}
}

func TestWatchDueHonoursInterval(t *testing.T) {
	at := func(ago time.Duration) int64 { return watchNow.Add(-ago).UnixMilli() }
	w := FeedWatch{IntervalMinutes: 360, CheckedAt: at(5*time.Hour + 59*time.Minute)}
	if watchDue(w, watchNow) {
		t.Fatal("5h59m on a 6h watch is not due")
	}
	w.CheckedAt = at(6 * time.Hour)
	if !watchDue(w, watchNow) {
		t.Fatal("6h on a 6h watch is due")
	}
	if !watchDue(FeedWatch{IntervalMinutes: 1440}, watchNow) {
		t.Fatal("a never-checked watch is due")
	}
}

func TestWatchPollSkipsRetiredAndOrphaned(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	h := newDiscoveryHandlers(t, []Bookmark{{Name: "live", URL: "https://live.example/page"}})
	retired := FeedWatch{BookmarkKey: canonicalBookmarkURLKey("https://live.example/page"), FeedURL: srv.URL, IntervalMinutes: 60,
		Failures: feedMaxFailures, TriedAt: time.Now().Add(-time.Hour).UnixMilli()}
	orphan := FeedWatch{BookmarkKey: canonicalBookmarkURLKey("https://gone.example/page"), FeedURL: srv.URL, IntervalMinutes: 60}
	if err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{retired, orphan}}); err != nil {
		t.Fatal(err)
	}
	n, _ := h.pollWatches(context.Background(), false)
	if n != 0 || srv.hits.Load() != 0 {
		t.Fatalf("polled=%d hits=%d, want 0 and 0", n, srv.hits.Load())
	}
}

func TestWatchPollWatchesPersistsAndReports(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	h := newDiscoveryHandlers(t, []Bookmark{{Name: "live", URL: "https://live.example/page"}})
	key := canonicalBookmarkURLKey("https://live.example/page")
	w, err := h.baselineWatch(context.Background(), FeedWatch{BookmarkKey: key, FeedURL: srv.URL, IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	w.CheckedAt = time.Now().Add(-2 * time.Hour).UnixMilli()
	w.TriedAt = w.CheckedAt
	if err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{w}}); err != nil {
		t.Fatal(err)
	}
	srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	n, news := h.pollWatches(context.Background(), false)
	if n != 1 || len(news) != 1 || len(news[0].Items) != 1 || news[0].BookmarkKey != key {
		t.Fatalf("n=%d news=%+v", n, news)
	}
	if got := readFeedWatchFile().Watches; len(got) != 1 || len(got[0].Items) != 1 {
		t.Fatalf("not persisted: %+v", got)
	}
}

func TestWatchSameTimestampPostIsNews(t *testing.T) {
	// Date-only front matter stamps every post of a day with the same time.
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 5))
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	srv.set(rssEntry("a", "A", 5), rssEntry("b", "B", 5))
	_, news := h.pollWatch(context.Background(), w, watchNow)
	if len(news) != 1 || news[0].Title != "B" {
		t.Fatalf("a second post with the same timestamp is news, got %+v", news)
	}
}

func TestWatchUndatedFeedBeyondFiftyEntriesIsNotNewAgain(t *testing.T) {
	srv := newWatchFeedServer(t)
	var entries []string
	for i := 0; i < 60; i++ {
		entries = append(entries, undatedEntry(fmt.Sprintf("g%d", i), fmt.Sprintf("T%d", i)))
	}
	srv.set(entries...)
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	for round := 0; round < 2; round++ {
		var news []FeedItem
		w, news = h.pollWatch(context.Background(), w, watchNow)
		if len(news) != 0 {
			t.Fatalf("round %d: %d old undated entries came back as news", round, len(news))
		}
	}
}

func TestWatchIntervalChoices(t *testing.T) {
	for _, minutes := range []int{30, 60, 120, 240, 360, 720, 1440} {
		if !validFeedWatchInterval(minutes) {
			t.Errorf("%d minutes should be allowed", minutes)
		}
	}
	for _, minutes := range []int{0, 15, 45, 90, 2880, -60} {
		if validFeedWatchInterval(minutes) {
			t.Errorf("%d minutes should be refused", minutes)
		}
	}
	// A 30 minute watch is due after 30 minutes, not before.
	w := FeedWatch{IntervalMinutes: 30, CheckedAt: watchNow.Add(-29 * time.Minute).UnixMilli()}
	if watchDue(w, watchNow) {
		t.Fatal("29 minutes on a 30 minute watch is not due")
	}
	w.CheckedAt = watchNow.Add(-30 * time.Minute).UnixMilli()
	if !watchDue(w, watchNow) {
		t.Fatal("30 minutes on a 30 minute watch is due")
	}
}

func manyEntries(n int) []string {
	var out []string
	for i := 1; i <= n; i++ {
		out = append(out, rssEntry(fmt.Sprintf("r%d", i), fmt.Sprintf("Entry %d", i), 1+i%27))
	}
	return out
}

func TestWatchKeepsRecentEntriesOfTheFeed(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(manyEntries(40)...)
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	if len(w.Recent) != feedWatchRecent {
		t.Fatalf("baseline keeps %d recent entries, want %d", len(w.Recent), feedWatchRecent)
	}
	// Newest first, and light: a cut summary and no picture to fetch.
	if w.Recent[0].PublishedAt < w.Recent[len(w.Recent)-1].PublishedAt {
		t.Fatal("recent entries are not newest first")
	}
	if w.Recent[0].Image != "" || w.Recent[0].ImageSource != "" {
		t.Fatalf("recent entries carry no picture: %+v", w.Recent[0])
	}

	// A poll with nothing new keeps them; a 304-free poll refreshes them.
	w2, news := h.pollWatch(context.Background(), w, watchNow)
	if len(news) != 0 || len(w2.Recent) != feedWatchRecent {
		t.Fatalf("news=%d recent=%d", len(news), len(w2.Recent))
	}
}

func TestWatchRecentSummaryIsCut(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(fmt.Sprintf(`<item><title>L</title><link>https://e.com/l</link><guid>l</guid><pubDate>%s</pubDate><description>%s</description></item>`,
		time.Date(2024, 1, 5, 10, 0, 0, 0, time.UTC).Format(time.RFC1123), strings.Repeat("z", 3000)))
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	if n := len([]rune(w.Recent[0].Summary)); n > feedWatchRecentSummaryRunes+1 {
		t.Fatalf("recent summary has %d runes", n)
	}
}

func datedEntry(guid, title string, at time.Time) string {
	return fmt.Sprintf(`<item><title>%s</title><link>https://e.com/%s</link><guid>%s</guid><pubDate>%s</pubDate></item>`,
		title, guid, guid, at.UTC().Format(time.RFC1123))
}

func TestWatchFutureDatedEntryDoesNotHideLaterOnes(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(datedEntry("odd", "Odd", time.Now().Add(30*24*time.Hour)))
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, srv.URL)
	if limit := time.Now().Add(feedWatchFutureSlack).UnixMilli(); w.NewestAt > limit {
		t.Fatalf("NewestAt %d is beyond now plus the slack", w.NewestAt)
	}
	srv.set(datedEntry("odd", "Odd", time.Now().Add(30*24*time.Hour)), datedEntry("real", "Real", time.Now().Add(time.Hour)))
	_, news := h.pollWatch(context.Background(), w, time.Now())
	if len(news) != 1 || news[0].Title != "Real" {
		t.Fatalf("a normal entry after a future-dated one is news, got %+v", news)
	}
}

func TestWatchStoredFutureNewestHeals(t *testing.T) {
	srv := newWatchFeedServer(t)
	old := time.Now().Add(-48 * time.Hour)
	srv.set(datedEntry("a", "A", old), datedEntry("odd", "Odd", time.Now().Add(30*24*time.Hour)))
	h := newDiscoveryHandlers(t, nil)
	w := newWatch(srv.URL)
	w.SeenIDs = []string{"a", "odd"}
	w.NewestAt = time.Now().Add(30 * 24 * time.Hour).UnixMilli()
	srv.set(datedEntry("a", "A", old), datedEntry("odd", "Odd", time.Now().Add(30*24*time.Hour)), datedEntry("b", "B", time.Now().Add(-time.Hour)))
	w, news := h.pollWatch(context.Background(), w, time.Now())
	if len(news) != 1 || news[0].Title != "B" {
		t.Fatalf("news after a stored future NewestAt: %+v", news)
	}
	if w.NewestAt > time.Now().Add(feedWatchFutureSlack).UnixMilli() {
		t.Fatalf("NewestAt did not heal: %d", w.NewestAt)
	}
}

func TestWatchConcurrentRoundsPushOnce(t *testing.T) {
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	h := newDiscoveryHandlers(t, []Bookmark{{Name: "live", URL: "https://live.example/page"}})
	key := canonicalBookmarkURLKey("https://live.example/page")
	w, err := h.baselineWatch(context.Background(), FeedWatch{BookmarkKey: key, FeedURL: srv.URL, IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	if err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{w}}); err != nil {
		t.Fatal(err)
	}
	srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	srv.delay = 80 * time.Millisecond

	var batches atomic.Int32
	onWatchNewsHook = func([]watchNews) { batches.Add(1) }
	t.Cleanup(func() { onWatchNewsHook = nil })

	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.pollWatches(context.Background(), true)
		}()
	}
	wg.Wait()
	if got := batches.Load(); got != 1 {
		t.Fatalf("%d news batches announced, want 1", got)
	}
	if hits := srv.hits.Load(); hits != 3 { // baseline + one per round
		t.Fatalf("%d hits, want 3", hits)
	}
}

// redirectingFeed serves a feed at /feed and redirects /old to it with the
// given status (/mixed goes /old-hop with 301 first, then /old with status).
func redirectingFeed(t *testing.T, status int) (base string, hits func(path string) int) {
	t.Helper()
	var mu sync.Mutex
	count := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		count[r.URL.Path]++
		mu.Unlock()
		switch r.URL.Path {
		case "/old":
			http.Redirect(w, r, "/feed", status)
		case "/mixed":
			http.Redirect(w, r, "/old", http.StatusMovedPermanently)
		case "/feed":
			w.Header().Set("Content-Type", "application/rss+xml")
			fmt.Fprint(w, `<?xml version="1.0"?><rss version="2.0"><channel><title>Moved</title>`+rssEntry("a", "A", 1)+`</channel></rss>`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL, func(path string) int {
		mu.Lock()
		defer mu.Unlock()
		return count[path]
	}
}

func TestWatchFollowsPermanentRedirect(t *testing.T) {
	for _, status := range []int{http.StatusMovedPermanently, http.StatusPermanentRedirect} {
		base, hits := redirectingFeed(t, status)
		h := newDiscoveryHandlers(t, nil)
		w := baselined(t, h, base+"/old")
		w, _ = h.pollWatch(context.Background(), w, watchNow)
		if w.FeedURL != base+"/feed" || w.MovedFrom != base+"/old" || w.MovedAt != watchNow.UnixMilli() || w.Failures != 0 {
			t.Fatalf("%d: after a permanent redirect: %+v", status, w)
		}
		before := hits("/old")
		h.pollWatch(context.Background(), w, watchNow)
		if hits("/old") != before {
			t.Fatalf("%d: the next poll still asked the old address", status)
		}
	}
}

func TestWatchTemporaryRedirectKeepsURL(t *testing.T) {
	for _, status := range []int{http.StatusFound, http.StatusTemporaryRedirect} {
		base, _ := redirectingFeed(t, status)
		h := newDiscoveryHandlers(t, nil)
		w := baselined(t, h, base+"/old")
		w, _ = h.pollWatch(context.Background(), w, watchNow)
		if w.FeedURL != base+"/old" || w.MovedFrom != "" {
			t.Fatalf("%d: a temporary redirect must not rewrite: %+v", status, w)
		}
	}
}

func TestWatchMixedChainIsNotPermanent(t *testing.T) {
	base, _ := redirectingFeed(t, http.StatusFound)
	h := newDiscoveryHandlers(t, nil)
	w := baselined(t, h, base+"/mixed")
	w, _ = h.pollWatch(context.Background(), w, watchNow)
	if w.FeedURL != base+"/mixed" || w.MovedFrom != "" {
		t.Fatalf("a 301 then a 302 is not permanent: %+v", w)
	}
}

func TestWatchMoveOntoExistingWatchMerges(t *testing.T) {
	base, _ := redirectingFeed(t, http.StatusMovedPermanently)
	h := newDiscoveryHandlers(t, []Bookmark{{Name: "live", URL: "https://live.example/page"}})
	key := canonicalBookmarkURLKey("https://live.example/page")
	oldW, err := h.baselineWatch(context.Background(), FeedWatch{BookmarkKey: key, FeedURL: base + "/old", IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	oldW.SeenIDs = []string{"only-on-old"}
	newW, err := h.baselineWatch(context.Background(), FeedWatch{BookmarkKey: key, FeedURL: base + "/feed", IntervalMinutes: 360})
	if err != nil {
		t.Fatal(err)
	}
	if err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{oldW, newW}}); err != nil {
		t.Fatal(err)
	}
	h.pollWatches(context.Background(), true)
	got := readFeedWatchFile().Watches
	if len(got) != 1 || got[0].FeedURL != base+"/feed" || got[0].IntervalMinutes != 360 {
		t.Fatalf("watches: %+v", got)
	}
	if !containsString(got[0].SeenIDs, "only-on-old") {
		t.Fatalf("the merged watch lost what the moved one had seen: %v", got[0].SeenIDs)
	}
}

func TestWatchRecordsFailureReason(t *testing.T) {
	old := feedFetchTimeout
	feedFetchTimeout = 100 * time.Millisecond
	t.Cleanup(func() { feedFetchTimeout = old })
	cases := []struct {
		name   string
		handle http.HandlerFunc
		code   string
		status int
	}{
		{"404", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) }, "http-404", 404},
		{"410", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(410) }, "http-410", 410},
		{"500", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }, "http-5xx", 500},
		{"418", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(418) }, "http-418", 418},
		{"timeout", func(w http.ResponseWriter, r *http.Request) { time.Sleep(600 * time.Millisecond) }, "timeout", 0},
		{"html", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "<html>no</html>") }, "not-a-feed", 200},
	}
	for _, c := range cases {
		srv := httptest.NewServer(c.handle)
		h := newDiscoveryHandlers(t, nil)
		w, _ := h.pollWatch(context.Background(), newWatch(srv.URL), watchNow)
		srv.Close()
		if w.LastError != c.code || w.LastStatus != c.status || w.Failures != 1 {
			t.Errorf("%s: lastError=%q lastStatus=%d failures=%d", c.name, w.LastError, w.LastStatus, w.Failures)
		}
	}
	// Nobody listening is unreachable, and a good answer clears the reason.
	dead := httptest.NewServer(http.NotFoundHandler())
	url := dead.URL
	dead.Close()
	h := newDiscoveryHandlers(t, nil)
	w, _ := h.pollWatch(context.Background(), newWatch(url), watchNow)
	if w.LastError != "unreachable" {
		t.Errorf("closed port: %q", w.LastError)
	}
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	w.FeedURL = srv.URL
	w, _ = h.pollWatch(context.Background(), w, watchNow)
	if w.LastError != "" || w.LastStatus != 0 || w.Failures != 0 {
		t.Errorf("success must clear the reason: %+v", w)
	}
}
