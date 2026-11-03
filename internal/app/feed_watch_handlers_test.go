package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type watchEnv struct {
	h   *Handlers
	srv *watchFeedServer
	url string // bookmark URL
	key string
}

func newWatchEnv(t *testing.T, bookmarks ...Bookmark) *watchEnv {
	t.Helper()
	h, _ := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	if len(bookmarks) == 0 {
		bookmarks = []Bookmark{{Name: "Blog", URL: "https://blog.example/news"}}
	}
	if err := h.store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatal(err)
	}
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	return &watchEnv{h: h, srv: srv, url: bookmarks[0].URL, key: canonicalBookmarkURLKey(bookmarks[0].URL)}
}

func (e *watchEnv) post(handler http.HandlerFunc, path, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	handler(rec, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
	return rec
}

func (e *watchEnv) watch(t *testing.T, minutes int) *httptest.ResponseRecorder {
	t.Helper()
	body := fmt.Sprintf(`{"bookmarkUrl":%q,"feeds":[{"feedUrl":%q,"intervalMinutes":%d}]}`, e.url, e.srv.URL, minutes)
	return e.post(e.h.WatchFeeds, "/api/feeds/watch", body)
}

func (e *watchEnv) list(t *testing.T) map[string]watchEntry {
	t.Helper()
	rec := httptest.NewRecorder()
	e.h.GetFeedWatches(rec, httptest.NewRequest(http.MethodGet, "/api/feeds/watch", nil))
	var out struct {
		Limit   int                   `json:"limit"`
		Total   int                   `json:"total"`
		Watches map[string]watchEntry `json:"watches"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("bad list JSON %q: %v", rec.Body.String(), err)
	}
	if out.Limit != 100 {
		t.Fatalf("limit = %d", out.Limit)
	}
	return out.Watches
}

func TestWatchRoutesWatchListSeenUnwatch(t *testing.T) {
	e := newWatchEnv(t)
	if rec := e.watch(t, 360); rec.Code != 200 {
		t.Fatalf("watch: %d %s", rec.Code, rec.Body.String())
	}
	got := e.list(t)[e.key]
	if len(got.Feeds) != 1 || got.NewCount != 0 || got.Feeds[0].IntervalMinutes != 360 {
		t.Fatalf("after watch: %+v", got)
	}

	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2), rssEntry("c", "C", 3))
	// Check now is not bound by the interval.
	rec := e.post(e.h.PollFeedWatchesNow, "/api/feeds/watch/poll", "")
	if rec.Code != 200 {
		t.Fatalf("poll: %d", rec.Code)
	}
	got = e.list(t)[e.key]
	if got.NewCount != 2 || got.Newest == nil || got.Newest.Title != "C" {
		t.Fatalf("after poll: %+v", got)
	}

	if rec := e.post(e.h.MarkFeedWatchSeen, "/api/feeds/watch/seen", fmt.Sprintf(`{"bookmarkUrl":%q}`, e.url)); rec.Code != 200 {
		t.Fatalf("seen: %d", rec.Code)
	}
	if n := e.list(t)[e.key].NewCount; n != 0 {
		t.Fatalf("seen should clear the count, got %d", n)
	}

	if rec := e.post(e.h.UnwatchFeeds, "/api/feeds/unwatch", fmt.Sprintf(`{"bookmarkUrl":%q}`, e.url)); rec.Code != 200 {
		t.Fatalf("unwatch: %d", rec.Code)
	}
	if _, ok := e.list(t)[e.key]; ok {
		t.Fatal("watch still listed after unwatch")
	}
	if len(readFeedWatchFile().Watches) != 0 {
		t.Fatal("items remain on disk after unwatch")
	}
}

func TestWatchRejectsBadIntervalAndNonFeed(t *testing.T) {
	e := newWatchEnv(t)
	if rec := e.watch(t, 45); rec.Code != 400 || !strings.Contains(rec.Body.String(), "bad-interval") {
		t.Fatalf("2h: %d %s", rec.Code, rec.Body.String())
	}
	html := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "<html>no</html>") }))
	defer html.Close()
	body := fmt.Sprintf(`{"bookmarkUrl":%q,"feeds":[{"feedUrl":%q,"intervalMinutes":360}]}`, e.url, html.URL)
	if rec := e.post(e.h.WatchFeeds, "/api/feeds/watch", body); rec.Code != 422 || !strings.Contains(rec.Body.String(), "not-a-feed") {
		t.Fatalf("html: %d %s", rec.Code, rec.Body.String())
	}
	body = fmt.Sprintf(`{"bookmarkUrl":"https://nobody.example/","feeds":[{"feedUrl":%q,"intervalMinutes":360}]}`, e.srv.URL)
	if rec := e.post(e.h.WatchFeeds, "/api/feeds/watch", body); rec.Code != 400 || !strings.Contains(rec.Body.String(), "no-bookmark") {
		t.Fatalf("unknown bookmark: %d %s", rec.Code, rec.Body.String())
	}
	if len(readFeedWatchFile().Watches) != 0 {
		t.Fatal("a refused request must not write")
	}
}

func TestWatchLimit100(t *testing.T) {
	e := newWatchEnv(t)
	bms := []Bookmark{{Name: "Blog", URL: e.url}}
	for i := 0; i < feedWatchLimit; i++ {
		bms = append(bms, Bookmark{Name: fmt.Sprintf("o%d", i), URL: fmt.Sprintf("https://other%d.example/", i)})
	}
	if err := e.h.store.SaveBookmarksByPage(1, bms); err != nil {
		t.Fatal(err)
	}
	var ws []FeedWatch
	for i := 0; i < feedWatchLimit; i++ {
		ws = append(ws, FeedWatch{BookmarkKey: canonicalBookmarkURLKey(fmt.Sprintf("https://other%d.example/", i)), FeedURL: fmt.Sprintf("https://other%d.example/f", i), IntervalMinutes: 360})
	}
	if err := writeFeedWatchFile(FeedWatchFile{Watches: ws}); err != nil {
		t.Fatal(err)
	}
	rec := e.watch(t, 360)
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), `"limit"`) {
		t.Fatalf("101st: %d %s", rec.Code, rec.Body.String())
	}
	if len(readFeedWatchFile().Watches) != feedWatchLimit {
		t.Fatal("file changed on a refused request")
	}
}

func TestWatchListUsesNewestOpenOfEveryCopy(t *testing.T) {
	e := newWatchEnv(t,
		Bookmark{Name: "Blog", URL: "https://blog.example/news"},
		Bookmark{Name: "Blog slash", URL: "https://blog.example/news/"})
	if rec := e.watch(t, 360); rec.Code != 200 {
		t.Fatalf("watch: %d %s", rec.Code, rec.Body.String())
	}
	if len(readFeedWatchFile().Watches) != 1 {
		t.Fatal("two copies of one page must share one watch")
	}
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	e.post(e.h.PollFeedWatchesNow, "/api/feeds/watch/poll", "")
	if n := e.list(t)[e.key].NewCount; n != 1 {
		t.Fatalf("newCount = %d, want 1", n)
	}
	file := readFeedWatchFile()
	bms := e.h.store.GetAllBookmarks()
	bms[1].LastOpened = time.Now().Add(time.Hour).UnixMilli()
	if got := watchListFor(file, bms)[e.key].NewCount; got != 0 {
		t.Fatalf("opening either copy should clear both, got %d", got)
	}
}

func TestWatchWritesNeedToken(t *testing.T) {
	e := newWatchEnv(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret")
	routes := map[string]http.HandlerFunc{
		"/api/feeds/watch":       e.h.WatchFeeds,
		"/api/feeds/unwatch":     e.h.UnwatchFeeds,
		"/api/feeds/watch/seen":  e.h.MarkFeedWatchSeen,
		"/api/feeds/watch/read":  e.h.MarkFeedWatchRead,
		"/api/feeds/watch/poll":  e.h.PollFeedWatchesNow,
		"/api/feeds/watch/retry": e.h.RetryFeedWatch,
	}
	for path, handler := range routes {
		if rec := e.post(handler, path, "{}"); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without a token = %d, want 401", path, rec.Code)
		}
	}
}

func TestWatchCandidatesMergeDiscoveredAndWatched(t *testing.T) {
	page := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><head><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed/"></head></html>`)
	}))
	defer page.Close()
	e := newWatchEnv(t, Bookmark{Name: "P", URL: page.URL + "/"})
	if err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{{BookmarkKey: e.key, FeedURL: "https://elsewhere.example/f", Title: "Mine", IntervalMinutes: 1440}}}); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	e.h.GetFeedWatchCandidates(rec, httptest.NewRequest(http.MethodGet, "/api/feeds/watch/candidates?url="+page.URL+"/", nil))
	var out struct {
		Feeds []struct {
			URL             string `json:"url"`
			Title           string `json:"title"`
			Watched         bool   `json:"watched"`
			IntervalMinutes int    `json:"intervalMinutes"`
		} `json:"feeds"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Feeds) != 2 {
		t.Fatalf("%v %s", err, rec.Body.String())
	}
	byURL := map[string]bool{}
	for _, f := range out.Feeds {
		byURL[f.URL] = f.Watched
	}
	if byURL[page.URL+"/feed/"] || !byURL["https://elsewhere.example/f"] {
		t.Fatalf("watched flags wrong: %v", byURL)
	}
}

func TestWatchItemsOnlyNewOnes(t *testing.T) {
	e := newWatchEnv(t)
	e.watch(t, 360)
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	e.post(e.h.PollFeedWatchesNow, "/api/feeds/watch/poll", "")
	rec := httptest.NewRecorder()
	e.h.GetFeedWatchItems(rec, httptest.NewRequest(http.MethodGet, "/api/feeds/watch/items", nil))
	var out struct {
		Items []struct {
			BookmarkKey  string `json:"bookmarkKey"`
			BookmarkName string `json:"bookmarkName"`
			BookmarkURL  string `json:"bookmarkUrl"`
			FeedTitle    string `json:"feedTitle"`
			Title        string `json:"title"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Items) != 1 {
		t.Fatalf("%v %s", err, rec.Body.String())
	}
	it := out.Items[0]
	if it.Title != "B" || it.BookmarkName != "Blog" || it.BookmarkURL != e.url || it.FeedTitle != "Stub" {
		t.Fatalf("item: %+v", it)
	}
	_ = context.Background
}

func TestWatchItemsListsEarlierEntriesToo(t *testing.T) {
	e := newWatchEnv(t)
	e.srv.set(manyEntries(12)...)
	if rec := e.watch(t, 60); rec.Code != 200 {
		t.Fatalf("watch: %d %s", rec.Code, rec.Body.String())
	}
	e.srv.set(append([]string{rssEntry("fresh", "Fresh entry", 28)}, manyEntries(12)...)...)
	e.post(e.h.PollFeedWatchesNow, "/api/feeds/watch/poll", "")

	rec := httptest.NewRecorder()
	e.h.GetFeedWatchItems(rec, httptest.NewRequest(http.MethodGet, "/api/feeds/watch/items", nil))
	var out struct {
		Items  []struct{ ID, Title string } `json:"items"`
		Recent []struct {
			ID           string `json:"id"`
			Title        string `json:"title"`
			BookmarkName string `json:"bookmarkName"`
			BookmarkKey  string `json:"bookmarkKey"`
			FeedTitle    string `json:"feedTitle"`
		} `json:"recent"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 1 || out.Items[0].Title != "Fresh entry" {
		t.Fatalf("new items: %+v", out.Items)
	}
	// The earlier entries are the feed's others: never the new one again.
	if len(out.Recent) != 12 {
		t.Fatalf("recent = %d, want 12", len(out.Recent))
	}
	for _, r := range out.Recent {
		if r.ID == "fresh" || r.BookmarkName != "Blog" || r.BookmarkKey == "" {
			t.Fatalf("bad recent entry: %+v", r)
		}
	}
}

func TestWatchConcurrentSavesStoreOnce(t *testing.T) {
	e := newWatchEnv(t)
	e.srv.delay = 80 * time.Millisecond
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if rec := e.watch(t, 360); rec.Code != 200 {
				t.Errorf("watch: %d %s", rec.Code, rec.Body.String())
			}
		}()
	}
	wg.Wait()
	if n := len(readFeedWatchFile().Watches); n != 1 {
		t.Fatalf("%d watches stored, want 1", n)
	}
}

func TestReadFeedWatchFileDropsDuplicates(t *testing.T) {
	newWatchEnv(t)
	a := FeedWatch{BookmarkKey: "e.com/page", FeedURL: "https://e.com/f", IntervalMinutes: 60, Title: "first"}
	b := a
	b.Title = "second"
	c := FeedWatch{BookmarkKey: "e.com/page", FeedURL: "https://e.com/g", IntervalMinutes: 60}
	if err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{a, b, c}}); err != nil {
		t.Fatal(err)
	}
	got := readFeedWatchFile().Watches
	if len(got) != 2 || got[0].Title != "first" || got[1].FeedURL != "https://e.com/g" {
		t.Fatalf("watches: %+v", got)
	}
}

func TestWatchRetryNeedsToken(t *testing.T) {
	e := newWatchEnv(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret")
	if rec := e.post(e.h.RetryFeedWatch, "/api/feeds/watch/retry", "{}"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("retry without a token = %d, want 401", rec.Code)
	}
}

func TestDemoDeniesWatchWrites(t *testing.T) {
	denied := map[string]bool{}
	for _, route := range demoDeniedWrites {
		denied[route] = true
	}
	for _, route := range []string{"/api/feeds/watch", "/api/feeds/unwatch", "/api/feeds/watch/seen", "/api/feeds/watch/read", "/api/feeds/watch/poll", "/api/feeds/watch/retry"} {
		if !denied[route] {
			t.Errorf("%s is not refused in the demo", route)
		}
	}
}

func TestWatchRetryRevivesRetired(t *testing.T) {
	e := newWatchEnv(t)
	if rec := e.watch(t, 360); rec.Code != 200 {
		t.Fatalf("watch: %d %s", rec.Code, rec.Body.String())
	}
	file := readFeedWatchFile()
	file.Watches[0].Failures = feedMaxFailures
	file.Watches[0].LastError, file.Watches[0].LastStatus = "http-404", 404
	file.Watches[0].TriedAt = time.Now().UnixMilli()
	if err := writeFeedWatchFile(file); err != nil {
		t.Fatal(err)
	}
	if got := e.list(t)[e.key].Feeds[0]; !got.Retired || got.LastError != "http-404" || got.LastStatus != 404 {
		t.Fatalf("before retry: %+v", got)
	}
	// A retired feed is not polled by Check now; Retry is what asks it.
	e.post(e.h.PollFeedWatchesNow, "/api/feeds/watch/poll", "")
	if !e.list(t)[e.key].Feeds[0].Retired {
		t.Fatal("Check now must leave a retired feed alone")
	}

	body := fmt.Sprintf(`{"bookmarkUrl":%q,"feedUrl":%q}`, e.url, e.srv.URL)
	rec := e.post(e.h.RetryFeedWatch, "/api/feeds/watch/retry", body)
	if rec.Code != 200 {
		t.Fatalf("retry: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Watch watchEntry `json:"watch"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Watch.Feeds) != 1 {
		t.Fatalf("%v %s", err, rec.Body.String())
	}
	if f := out.Watch.Feeds[0]; f.Retired || f.Failures != 0 || f.LastError != "" {
		t.Fatalf("after retry: %+v", f)
	}

	// Still down: the count starts over at one instead of staying retired.
	gone := httptest.NewServer(http.NotFoundHandler())
	defer gone.Close()
	file = readFeedWatchFile()
	file.Watches[0].FeedURL, file.Watches[0].Failures = gone.URL, feedMaxFailures
	if err := writeFeedWatchFile(file); err != nil {
		t.Fatal(err)
	}
	rec = e.post(e.h.RetryFeedWatch, "/api/feeds/watch/retry", fmt.Sprintf(`{"bookmarkUrl":%q,"feedUrl":%q}`, e.url, gone.URL))
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Watch.Feeds) != 1 {
		t.Fatalf("%v %s", err, rec.Body.String())
	}
	if f := out.Watch.Feeds[0]; f.Retired || f.Failures != 1 || f.LastError != "http-404" {
		t.Fatalf("retry of a feed still down: %+v", f)
	}

	missing := fmt.Sprintf(`{"bookmarkUrl":%q,"feedUrl":"https://nowhere.example/f"}`, e.url)
	if rec := e.post(e.h.RetryFeedWatch, "/api/feeds/watch/retry", missing); rec.Code != 404 {
		t.Fatalf("unknown feed: %d %s", rec.Code, rec.Body.String())
	}
}

// newReadEnv watches a feed whose baseline is "a", then finds "b" and "c".
func newReadEnv(t *testing.T) *watchEnv {
	t.Helper()
	globalOutboundLimiter.reset()
	e := newWatchEnv(t)
	if rec := e.watch(t, 360); rec.Code != 200 {
		t.Fatalf("watch: %d %s", rec.Code, rec.Body.String())
	}
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2), rssEntry("c", "C", 3))
	e.post(e.h.PollFeedWatchesNow, "/api/feeds/watch/poll", "")
	if n := e.list(t)[e.key].NewCount; n != 2 {
		t.Fatalf("setup newCount = %d, want 2", n)
	}
	time.Sleep(5 * time.Millisecond)
	return e
}

func (e *watchEnv) markItem(t *testing.T, id string, read bool) {
	t.Helper()
	body := fmt.Sprintf(`{"bookmarkUrl":%q,"feedUrl":%q,"ids":[%q],"read":%t}`, e.url, e.srv.URL, id, read)
	if rec := e.post(e.h.MarkFeedWatchRead, "/api/feeds/watch/read", body); rec.Code != 200 {
		t.Fatalf("read: %d %s", rec.Code, rec.Body.String())
	}
	time.Sleep(5 * time.Millisecond)
}

func (e *watchEnv) newCountOpenedAt(openedAt int64) int {
	bms := e.h.store.GetAllBookmarks()
	bms[0].LastOpened = openedAt
	return watchListFor(readFeedWatchFile(), bms)[e.key].NewCount
}

func TestWatchItemReadWins(t *testing.T) {
	e := newReadEnv(t)
	e.markItem(t, "b", true)
	got := e.list(t)[e.key]
	if got.NewCount != 1 || got.Newest == nil || got.Newest.ID != "c" {
		t.Fatalf("after marking b read: count %d newest %+v", got.NewCount, got.Newest)
	}
}

func TestWatchItemUnreadAfterOpenWins(t *testing.T) {
	e := newReadEnv(t)
	opened := time.Now().UnixMilli()
	time.Sleep(5 * time.Millisecond)
	if n := e.newCountOpenedAt(opened); n != 0 {
		t.Fatalf("after open: %d", n)
	}
	e.markItem(t, "b", false)
	if n := e.newCountOpenedAt(opened); n != 1 {
		t.Fatalf("marked unread after open: %d, want 1", n)
	}
}

func TestWatchOpenAfterItemMarkWins(t *testing.T) {
	e := newReadEnv(t)
	e.markItem(t, "b", false)
	if n := e.newCountOpenedAt(time.Now().Add(time.Hour).UnixMilli()); n != 0 {
		t.Fatalf("open after the mark: %d, want 0", n)
	}
}

func TestWatchSeenAll(t *testing.T) {
	e := newReadEnv(t)
	if rec := e.post(e.h.MarkFeedWatchSeen, "/api/feeds/watch/seen", `{"all":true}`); rec.Code != 200 {
		t.Fatalf("seen all: %d %s", rec.Code, rec.Body.String())
	}
	if n := e.list(t)[e.key].NewCount; n != 0 {
		t.Fatalf("newCount = %d, want 0", n)
	}
	if rec := e.post(e.h.MarkFeedWatchSeen, "/api/feeds/watch/seen", `{}`); rec.Code != 400 {
		t.Fatalf("empty seen = %d, want 400", rec.Code)
	}
}

func TestWatchReadNeedsToken(t *testing.T) {
	e := newReadEnv(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret")
	if rec := e.post(e.h.MarkFeedWatchRead, "/api/feeds/watch/read", `{}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("read without token = %d", rec.Code)
	}
}

func TestWatchItemsAllKeys(t *testing.T) {
	e := newReadEnv(t)
	e.markItem(t, "b", true)
	for _, url := range []string{"/api/feeds/watch/items", "/api/feeds/watch/items?key=" + e.key} {
		rec := httptest.NewRecorder()
		e.h.GetFeedWatchItems(rec, httptest.NewRequest(http.MethodGet, url, nil))
		var out struct {
			Items []struct {
				ID          string `json:"id"`
				Unread      bool   `json:"unread"`
				FeedURL     string `json:"feedUrl"`
				BookmarkKey string `json:"bookmarkKey"`
				BookmarkURL string `json:"bookmarkUrl"`
				MarkedRead  bool   `json:"markedRead"`
			} `json:"items"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if len(out.Items) != 2 {
			t.Fatalf("%s: items = %d, want both stored items: %s", url, len(out.Items), rec.Body.String())
		}
		for _, it := range out.Items {
			if it.FeedURL != e.srv.URL || it.BookmarkKey != e.key || it.BookmarkURL != e.url {
				t.Fatalf("%s: item origin: %+v", url, it)
			}
			if it.Unread != (it.ID == "c") || it.MarkedRead != (it.ID == "b") {
				t.Fatalf("%s: item state: %+v", url, it)
			}
		}
	}
}

// The list carries up to three unread items per bookmark across its feeds,
// newest first, the first being Newest; read items stay out.
func TestWatchListCarriesNewItems(t *testing.T) {
	bms := []Bookmark{{Name: "Blog", URL: "https://blog.example/news", LastOpened: 1500}}
	key := canonicalBookmarkURLKey(bms[0].URL)
	file := FeedWatchFile{Watches: []FeedWatch{
		{BookmarkKey: key, FeedURL: "https://blog.example/a.xml", Items: []FeedItem{
			{ID: "old", FoundAt: 1000}, {ID: "a2", FoundAt: 2000}, {ID: "a5", FoundAt: 5000, ImageSource: "x"}}},
		{BookmarkKey: key, FeedURL: "https://blog.example/b.xml", Items: []FeedItem{
			{ID: "b3", FoundAt: 3000}, {ID: "b4", FoundAt: 4000}}},
	}}
	e := watchListFor(file, bms)[key]
	var ids []string
	for _, it := range e.NewItems {
		ids = append(ids, it.ID)
		if it.ImageSource != "" {
			t.Fatalf("imageSource leaked: %+v", it)
		}
	}
	if fmt.Sprint(ids) != "[a5 b4 b3]" || e.NewCount != 4 || e.Newest == nil || e.Newest.ID != "a5" {
		t.Fatalf("newItems = %v, count %d, newest %+v", ids, e.NewCount, e.Newest)
	}
}

// The newest item across a bookmark's feeds, by publish time (found time when
// a feed gives none), from stored items and the recent list alike.
func TestWatchListCarriesLatest(t *testing.T) {
	bms := []Bookmark{{Name: "Blog", URL: "https://blog.example/news"}, {Name: "Quiet", URL: "https://quiet.example/"}}
	key := canonicalBookmarkURLKey(bms[0].URL)
	file := FeedWatchFile{Watches: []FeedWatch{
		{BookmarkKey: key, FeedURL: "https://blog.example/a.xml",
			Items:  []FeedItem{{ID: "1", Title: "Old stored", PublishedAt: 1000, FoundAt: 5000}},
			Recent: []FeedItem{{ID: "2", Title: "Newest recent", PublishedAt: 3000, FoundAt: 100}}},
		{BookmarkKey: key, FeedURL: "https://blog.example/b.xml",
			Items: []FeedItem{{ID: "3", Title: "Undated", FoundAt: 2000}}},
		{BookmarkKey: canonicalBookmarkURLKey(bms[1].URL), FeedURL: "https://quiet.example/f.xml"},
	}}
	got := watchListFor(file, bms)
	if e := got[key]; e.LatestAt != 3000 || e.LatestTitle != "Newest recent" {
		t.Fatalf("latest = %d %q, want 3000 \"Newest recent\"", e.LatestAt, e.LatestTitle)
	}
	if e := got[canonicalBookmarkURLKey(bms[1].URL)]; e.LatestAt != 0 || e.LatestTitle != "" {
		t.Fatalf("a feed with no items has no latest, got %d %q", e.LatestAt, e.LatestTitle)
	}
	// An undated item counts at the time it was found.
	file.Watches[0].Recent = nil
	file.Watches[0].Items = nil
	if e := watchListFor(file, bms)[key]; e.LatestAt != 2000 || e.LatestTitle != "Undated" {
		t.Fatalf("fallback to FoundAt: %d %q", e.LatestAt, e.LatestTitle)
	}
}

func TestWatchCandidatesLightSkipsTheUsualAddresses(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><head><title>Please accept</title></head><body>consent</body></html>`)
	})
	mux.HandleFunc("/rss", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprint(w, rssItemsFixture)
	})
	page := httptest.NewServer(mux)
	defer page.Close()
	e := newWatchEnv(t, Bookmark{Name: "P", URL: page.URL + "/"})
	count := func(query string) int {
		rec := httptest.NewRecorder()
		e.h.GetFeedWatchCandidates(rec, httptest.NewRequest(http.MethodGet, "/api/feeds/watch/candidates?url="+page.URL+"/"+query, nil))
		var out struct {
			Feeds []struct{ URL string } `json:"feeds"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return len(out.Feeds)
	}
	if n := count(""); n != 1 {
		t.Fatalf("the full lookup should find the open feed, got %d", n)
	}
	if n := count("&light=1"); n != 0 {
		t.Fatalf("the light lookup reads the page only, got %d", n)
	}
}
