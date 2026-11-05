package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// newSettingsEnv watches the stub feed (baseline: "a") for the per-feed
// settings tests.
func newSettingsEnv(t *testing.T) *watchEnv {
	t.Helper()
	globalOutboundLimiter.reset()
	e := newWatchEnv(t)
	if rec := e.watch(t, 360); rec.Code != 200 {
		t.Fatalf("watch: %d %s", rec.Code, rec.Body.String())
	}
	return e
}

func (e *watchEnv) patch(t *testing.T, fields string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"bookmarkUrl":"` + e.url + `","feedUrl":"` + e.srv.URL + `"` + fields + `}`
	return e.post(e.h.UpdateFeedWatch, "/api/feeds/watch/feed", body)
}

func (e *watchEnv) poll() {
	e.post(e.h.PollFeedWatchesNow, "/api/feeds/watch/poll", "")
}

func (e *watchEnv) feedEntry(t *testing.T) watchFeedEntry {
	t.Helper()
	entry := e.list(t)[e.key]
	if len(entry.Feeds) != 1 {
		t.Fatalf("feeds = %+v", entry.Feeds)
	}
	return entry.Feeds[0]
}

func TestWatchIncludeFilter(t *testing.T) {
	e := newSettingsEnv(t)
	if rec := e.patch(t, `,"include":["release"]`); rec.Code != 200 {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body.String())
	}
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "Weekly chat", 2), rssEntry("c", "RELEASE 2.0", 3))
	e.poll()
	entry := e.list(t)[e.key]
	if entry.NewCount != 1 || entry.Newest == nil || entry.Newest.ID != "c" {
		t.Fatalf("newCount=%d newest=%+v, want only c", entry.NewCount, entry.Newest)
	}
}

func TestWatchExcludeFilter(t *testing.T) {
	e := newSettingsEnv(t)
	if rec := e.patch(t, `,"exclude":["  Sponsored "," "]`); rec.Code != 200 {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body.String())
	}
	if got := e.feedEntry(t).Exclude; len(got) != 1 || got[0] != "Sponsored" {
		t.Fatalf("exclude = %q, want trimmed and without empty words", got)
	}
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "Sponsored post", 2), rssEntry("c", "Real news", 3))
	e.poll()
	if entry := e.list(t)[e.key]; entry.NewCount != 1 || entry.Newest.ID != "c" {
		t.Fatalf("newCount=%d newest=%+v, want only c", entry.NewCount, entry.Newest)
	}
}

func TestWatchFilterMatchesTheText(t *testing.T) {
	e := newSettingsEnv(t)
	e.patch(t, `,"include":["inside"]`)
	e.srv.set(rssEntry("a", "A", 1),
		`<item><title>Plain</title><link>https://e.com/p</link><guid>p</guid><pubDate>Tue, 02 Jan 2024 10:00:00 GMT</pubDate><description>&lt;p&gt;Something &lt;b&gt;inside&lt;/b&gt;&lt;/p&gt;</description></item>`)
	e.poll()
	if n := e.list(t)[e.key].NewCount; n != 1 {
		t.Fatalf("newCount = %d, want the match in the summary", n)
	}
}

func TestWatchFilteredItemNeverNewLater(t *testing.T) {
	e := newSettingsEnv(t)
	e.patch(t, `,"include":["release"]`)
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "Weekly chat", 2))
	e.poll()
	if n := e.list(t)[e.key].NewCount; n != 0 {
		t.Fatalf("newCount = %d, want 0", n)
	}
	e.patch(t, `,"include":[]`)
	e.poll()
	if n := e.list(t)[e.key].NewCount; n != 0 {
		t.Fatalf("after the filter was lifted newCount = %d, want 0: b was seen", n)
	}
}

func TestWatchFilterHidesRecentToo(t *testing.T) {
	e := newSettingsEnv(t)
	e.patch(t, `,"exclude":["chat"]`)
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "Weekly chat", 2), rssEntry("c", "Release", 3))
	e.poll()
	rec := httptest.NewRecorder()
	e.h.GetFeedWatchItems(rec, httptest.NewRequest(http.MethodGet, "/api/feeds/watch/items", nil))
	var out struct {
		Items  []FeedItem `json:"items"`
		Recent []FeedItem `json:"recent"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	for _, it := range append(out.Items, out.Recent...) {
		if it.ID == "b" {
			t.Fatalf("filtered item listed: %+v", out)
		}
	}
	if len(out.Recent) != 1 || out.Recent[0].ID != "a" {
		t.Fatalf("recent = %+v, want only a", out.Recent)
	}
}

func TestWatchPausedNotPolled(t *testing.T) {
	e := newSettingsEnv(t)
	e.patch(t, `,"paused":true`)
	if !e.feedEntry(t).Paused {
		t.Fatal("entry must say paused")
	}
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	before := e.srv.hits.Load()
	e.poll()
	if e.srv.hits.Load() != before || e.list(t)[e.key].NewCount != 0 {
		t.Fatal("a paused watch was polled")
	}
	file := readFeedWatchFile()
	if watchDue(file.Watches[0], time.Now().Add(48*time.Hour)) {
		t.Fatal("a paused watch is never due")
	}

	// Resume forgets failures and is due at once.
	file.Watches[0].Failures, file.Watches[0].TriedAt = feedMaxFailures, time.Now().UnixMilli()
	if err := writeFeedWatchFile(file); err != nil {
		t.Fatal(err)
	}
	e.patch(t, `,"paused":false`)
	w := readFeedWatchFile().Watches[0]
	if w.Paused || w.Failures != 0 || w.TriedAt != 0 || !watchDue(w, time.Now()) {
		t.Fatalf("resume left %+v", w)
	}
	e.poll()
	if e.list(t)[e.key].NewCount != 1 {
		t.Fatal("a resumed watch must be polled")
	}
}

func TestWatchMutedCountsButDoesNotPush(t *testing.T) {
	e := newSettingsEnv(t)
	e.patch(t, `,"muted":true`)
	if entry := e.list(t)[e.key]; !entry.Muted || !entry.Feeds[0].Muted {
		t.Fatalf("entry = %+v, want muted", entry)
	}
	var seen []watchNews
	onWatchNewsHook = func(n []watchNews) { seen = append(seen, n...) }
	t.Cleanup(func() { onWatchNewsHook = nil })
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	e.poll()
	if n := e.list(t)[e.key].NewCount; n != 1 {
		t.Fatalf("newCount = %d, want the muted news counted", n)
	}
	if len(seen) != 1 || !seen[0].Muted {
		t.Fatalf("news = %+v, want one muted batch", seen)
	}

	f := newFakePushService(t)
	h := newPushTestHandlers(t, f, func(s *Settings) { s.PushNotifyEnabled = true; s.PushNotifyNews = true })
	h.pushWatchNews(context.Background(), seen)
	if f.count() != 0 {
		t.Fatalf("muted news pushed %d times", f.count())
	}
	loud := watchNews{BookmarkKey: "https://b.example", FeedURL: "https://f.example/feed", Items: []FeedItem{{ID: "x", Title: "x"}}}
	h.pushWatchNews(context.Background(), append(seen, loud))
	if f.count() != 1 {
		t.Fatalf("with one loud feed: %d pushes, want 1", f.count())
	}
}

func TestWatchMutedBookmarkNeedsEveryFeedMuted(t *testing.T) {
	file := FeedWatchFile{Watches: []FeedWatch{
		{BookmarkKey: "https://a.example", FeedURL: "https://a.example/1", Muted: true},
		{BookmarkKey: "https://a.example", FeedURL: "https://a.example/2"},
		{BookmarkKey: "https://b.example", FeedURL: "https://b.example/1", Muted: true},
		{BookmarkKey: "https://b.example", FeedURL: "https://b.example/2", Muted: true},
	}}
	got := watchListFor(file, []Bookmark{{URL: "https://a.example"}, {URL: "https://b.example"}}, 0)
	if got["https://a.example"].Muted || !got["https://b.example"].Muted {
		t.Fatalf("a=%v b=%v, want false and true", got["https://a.example"].Muted, got["https://b.example"].Muted)
	}
}

func TestWatchFeedPatchKeepsOmittedFields(t *testing.T) {
	e := newSettingsEnv(t)
	rec := e.patch(t, `,"muted":true,"include":["x"],"exclude":["y"],"intervalMinutes":60`)
	if rec.Code != 200 {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.patch(t, `,"paused":true`)
	var out struct {
		Watch watchEntry `json:"watch"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Watch.Feeds) != 1 {
		t.Fatalf("answer %q: %v", rec.Body.String(), err)
	}
	f := out.Watch.Feeds[0]
	if !f.Muted || !f.Paused || f.IntervalMinutes != 60 || len(f.Include) != 1 || len(f.Exclude) != 1 {
		t.Fatalf("feed = %+v, want everything kept and paused added", f)
	}
	e.patch(t, `,"include":[]`)
	if f := e.feedEntry(t); len(f.Include) != 0 || len(f.Exclude) != 1 || !f.Muted {
		t.Fatalf("clearing include changed more: %+v", f)
	}
	if !strings.Contains(e.post(e.h.UpdateFeedWatch, "/api/feeds/watch/feed", `{"bookmarkUrl":"`+e.url+`","feedUrl":"https://nope.example/f"}`).Body.String(), "not-watched") {
		t.Fatal("an unknown feed must answer not-watched")
	}
	if rec := e.post(e.h.UpdateFeedWatch, "/api/feeds/watch/feed", `{"bookmarkUrl":"`+e.url+`","feedUrl":"https://nope.example/f"}`); rec.Code != 404 {
		t.Fatalf("unknown feed = %d, want 404", rec.Code)
	}
}

func TestWatchFeedPatchRejectsBadValues(t *testing.T) {
	e := newSettingsEnv(t)
	long := strings.Repeat("é", 41)
	many := `"a","b","c","d","e","f","g","h","i","j","k"`
	cases := map[string]string{
		`,"intervalMinutes":45`:       "bad-interval",
		`,"intervalMinutes":0`:        "bad-interval",
		`,"include":["` + long + `"]`: "bad-filter",
		`,"exclude":[` + many + `]`:   "bad-filter",
	}
	for fields, code := range cases {
		rec := e.patch(t, fields)
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), code) {
			t.Errorf("%s = %d %s, want 400 %s", fields, rec.Code, rec.Body.String(), code)
		}
	}
	if rec := e.patch(t, `,"include":["`+strings.Repeat("é", 40)+`","","b","c","d","e","f","g","h","i","j"]`); rec.Code != 200 {
		t.Errorf("ten words of 40 runes plus an empty one = %d, want 200", rec.Code)
	}
}

func TestWatchBulkInterval(t *testing.T) {
	e := newSettingsEnv(t)
	other := "https://other.example/x"
	file := readFeedWatchFile()
	file.Watches = append(file.Watches,
		FeedWatch{BookmarkKey: canonicalBookmarkURLKey(other), FeedURL: "https://other.example/feed", IntervalMinutes: 60},
		FeedWatch{BookmarkKey: "third.example", FeedURL: "https://third.example/feed", IntervalMinutes: 60})
	if err := writeFeedWatchFile(file); err != nil {
		t.Fatal(err)
	}
	rec := e.post(e.h.SetFeedWatchInterval, "/api/feeds/watch/interval",
		`{"bookmarkUrls":["`+e.url+`","`+other+`"],"intervalMinutes":1440}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"changed":2`) {
		t.Fatalf("bulk = %d %s", rec.Code, rec.Body.String())
	}
	for _, w := range readFeedWatchFile().Watches {
		want := 1440
		if w.BookmarkKey == "third.example" {
			want = 60
		}
		if w.IntervalMinutes != want {
			t.Errorf("%s interval = %d, want %d", w.BookmarkKey, w.IntervalMinutes, want)
		}
	}
	rec = e.post(e.h.SetFeedWatchInterval, "/api/feeds/watch/interval", `{"bookmarkUrls":["`+e.url+`"],"intervalMinutes":7}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "bad-interval") {
		t.Fatalf("bad interval = %d %s", rec.Code, rec.Body.String())
	}
}

func TestWatchSettingsRoutesNeedTokenAndDemoDenies(t *testing.T) {
	e := newSettingsEnv(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret")
	for path, handler := range map[string]http.HandlerFunc{
		"/api/feeds/watch/feed":     e.h.UpdateFeedWatch,
		"/api/feeds/watch/interval": e.h.SetFeedWatchInterval,
	} {
		if rec := e.post(handler, path, "{}"); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without a token = %d, want 401", path, rec.Code)
		}
	}
	denied := map[string]bool{}
	for _, route := range demoDeniedWrites {
		denied[route] = true
	}
	for _, route := range []string{"/api/feeds/watch/feed", "/api/feeds/watch/interval"} {
		if !denied[route] {
			t.Errorf("%s is not refused in the demo", route)
		}
	}
}
