package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func rssAt(guid, title string, at time.Time) string {
	return fmt.Sprintf(`<item><title>%s</title><link>https://e.com/%s</link><guid>%s</guid><pubDate>%s</pubDate></item>`,
		title, guid, guid, at.UTC().Format(time.RFC1123))
}

// newStatsEnv is a watched bookmark with a stub feed, statistics on.
func newStatsEnv(t *testing.T, settings string) *watchEnv {
	t.Helper()
	globalOutboundLimiter.reset()
	h, _ := healthRecheckTestHandlers(t, settings)
	bookmarks := []Bookmark{{Name: "Blog", URL: "https://blog.example/news"}}
	if err := h.store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatal(err)
	}
	srv := newWatchFeedServer(t)
	srv.set(rssEntry("a", "A", 1))
	e := &watchEnv{h: h, srv: srv, url: bookmarks[0].URL, key: canonicalBookmarkURLKey(bookmarks[0].URL)}
	if rec := e.watch(t, 60); rec.Code != 200 {
		t.Fatalf("watch: %d %s", rec.Code, rec.Body.String())
	}
	return e
}

func (e *watchEnv) statsID() string { return feedStatsID(e.key, e.srv.URL) }

func (e *watchEnv) pollOK(t *testing.T) {
	t.Helper()
	if rec := e.post(e.h.PollFeedWatchesNow, "/api/feeds/watch/poll", ""); rec.Code != 200 {
		t.Fatalf("poll: %d", rec.Code)
	}
}

func (e *watchEnv) markRead(t *testing.T, read bool, ids ...string) {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"bookmarkUrl": e.url, "feedUrl": e.srv.URL, "ids": ids, "read": read})
	if rec := e.post(e.h.MarkFeedWatchRead, "/api/feeds/watch/read", string(b)); rec.Code != 200 {
		t.Fatalf("read: %d", rec.Code)
	}
}

func statsToday() string { return time.Now().Format(feedStatsDayLayout) }

func (e *watchEnv) readsToday(t *testing.T) int {
	t.Helper()
	feed := readFeedStatsFile().Feeds[e.statsID()]
	if feed == nil || feed.Days[statsToday()] == nil {
		return 0
	}
	return feed.Days[statsToday()].Read
}

func TestFeedStatsCountsPublishedByDayButNotTheBaseline(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true}`)
	if _, err := os.Stat(feedStatsFilePath()); err == nil {
		if feed := readFeedStatsFile().Feeds[e.statsID()]; feed != nil && len(feed.Days) > 0 {
			t.Fatalf("the baseline was counted: %+v", feed.Days)
		}
	}
	now := time.Now()
	d1, d2 := now.Add(-48*time.Hour), now.Add(-24*time.Hour)
	e.srv.set(rssEntry("a", "A", 1), rssAt("b", "B", d1), rssAt("c", "C", d2), rssAt("d", "D", d2))
	e.pollOK(t)

	feed := readFeedStatsFile().Feeds[e.statsID()]
	if feed == nil {
		t.Fatal("nothing recorded")
	}
	day := func(at time.Time) int {
		if d := feed.Days[at.Format(feedStatsDayLayout)]; d != nil {
			return d.Published
		}
		return 0
	}
	if day(d1) != 1 || day(d2) != 2 {
		t.Fatalf("published by day: %d on d1, %d on d2; days %+v", day(d1), day(d2), feed.Days)
	}
	if d := feed.Days["2024-01-01"]; d != nil && d.Published > 0 {
		t.Fatal("the baseline item was counted as published")
	}
	total := 0
	for _, row := range feed.Hours {
		for _, n := range row {
			total += n
		}
	}
	if total != 3 {
		t.Fatalf("hour matrix holds %d, want 3", total)
	}
	local := d2.In(time.Local)
	if feed.Hours[(int(local.Weekday())+6)%7][local.Hour()] != 2 {
		t.Fatal("the hour matrix is not keyed by local weekday and hour")
	}
	today := feed.Days[statsToday()]
	if today == nil || today.OK != 1 || today.MsCount != 1 || today.Failed != 0 {
		t.Fatalf("poll outcome: %+v", today)
	}
	if today.Unread == nil || *today.Unread != 3 {
		t.Fatalf("unread snapshot: %+v", today.Unread)
	}
}

func TestFeedStatsCountsAReadOnceAndOnlyFromUnread(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true}`)
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2), rssEntry("c", "C", 3))
	e.pollOK(t)

	e.markRead(t, true, "b")
	if n := e.readsToday(t); n != 1 {
		t.Fatalf("after reading b: %d, want 1", n)
	}
	// Unread again and read again: still the one read.
	e.markRead(t, false, "b")
	e.markRead(t, true, "b")
	if n := e.readsToday(t); n != 1 {
		t.Fatalf("b counted twice: %d", n)
	}
	// Marking unread never counts.
	e.markRead(t, false, "c")
	if n := e.readsToday(t); n != 1 {
		t.Fatalf("an unread mark counted: %d", n)
	}
	e.markRead(t, true, "c")
	if n := e.readsToday(t); n != 2 {
		t.Fatalf("after reading c: %d, want 2", n)
	}
	// A later poll does not count them again.
	e.pollOK(t)
	if n := e.readsToday(t); n != 2 {
		t.Fatalf("a poll counted again: %d", n)
	}
}

func TestFeedStatsSeenCountsWhatItClears(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true}`)
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2), rssEntry("c", "C", 3))
	e.pollOK(t)
	e.markRead(t, true, "b")

	if rec := e.post(e.h.MarkFeedWatchSeen, "/api/feeds/watch/seen", fmt.Sprintf(`{"bookmarkUrl":%q}`, e.url)); rec.Code != 200 {
		t.Fatalf("seen: %d", rec.Code)
	}
	if n := e.readsToday(t); n != 2 {
		t.Fatalf("seen: %d reads, want 2 (b was already read, c cleared)", n)
	}

	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2), rssEntry("c", "C", 3), rssEntry("d", "D", 4))
	time.Sleep(5 * time.Millisecond)
	e.pollOK(t)
	if rec := e.post(e.h.MarkFeedWatchSeen, "/api/feeds/watch/seen", `{"all":true}`); rec.Code != 200 {
		t.Fatalf("seen all: %d", rec.Code)
	}
	if rec := e.post(e.h.MarkFeedWatchSeen, "/api/feeds/watch/seen", `{"all":true}`); rec.Code != 200 {
		t.Fatalf("seen all: %d", rec.Code)
	}
	if n := e.readsToday(t); n != 3 {
		t.Fatalf("seen all: %d reads, want 3", n)
	}
}

func TestFeedStatsOpeningTheBookmarkCountsItsNews(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true}`)
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	e.pollOK(t)
	time.Sleep(5 * time.Millisecond)
	body := fmt.Sprintf(`{"pageId":1,"index":0,"url":%q}`, e.url)
	if rec := e.post(e.h.TrackBookmarkOpen, "/api/bookmarks/track", body); rec.Code != 200 {
		t.Fatalf("open: %d %s", rec.Code, rec.Body.String())
	}
	if n := e.readsToday(t); n != 1 {
		t.Fatalf("open: %d reads, want 1", n)
	}
}

func TestFeedStatsOffRecordsNothing(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true,"feedStatsEnabled":false}`)
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	e.pollOK(t)
	e.markRead(t, true, "b")
	e.h.recordFeedNotify(1, 1, 1)
	if _, err := os.Stat(feedStatsFilePath()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("statistics off, yet feed-stats.json exists: %v", err)
	}
}

func TestFeedStatsCountsFailuresByCodeAndAnswerTime(t *testing.T) {
	globalOutboundLimiter.reset()
	h, _ := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	if err := h.store.SaveBookmarksByPage(1, []Bookmark{{Name: "Blog", URL: "https://blog.example/"}}); err != nil {
		t.Fatal(err)
	}
	var status atomic.Int32
	status.Store(200)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if code := int(status.Load()); code != 200 {
			w.WriteHeader(code)
			return
		}
		time.Sleep(20 * time.Millisecond)
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprintf(w, `<?xml version="1.0"?><rss version="2.0"><channel><title>S</title>%s</channel></rss>`, rssEntry("a", "A", 1))
	}))
	defer srv.Close()
	e := &watchEnv{h: h, url: "https://blog.example/", key: canonicalBookmarkURLKey("https://blog.example/")}
	body := fmt.Sprintf(`{"bookmarkUrl":%q,"feeds":[{"feedUrl":%q,"intervalMinutes":60}]}`, e.url, srv.URL)
	if rec := e.post(h.WatchFeeds, "/api/feeds/watch", body); rec.Code != 200 {
		t.Fatalf("watch: %d %s", rec.Code, rec.Body.String())
	}
	poll := func() { e.post(h.PollFeedWatchesNow, "/api/feeds/watch/poll", "") }
	poll()
	poll()
	status.Store(404)
	poll()
	poll()
	status.Store(503)
	poll()

	d := readFeedStatsFile().Feeds[feedStatsID(e.key, srv.URL)].Days[statsToday()]
	if d.OK != 2 || d.Failed != 3 || d.Codes["http-404"] != 2 || d.Codes["http-5xx"] != 1 {
		t.Fatalf("outcomes: %+v", d)
	}
	if d.MsCount != 2 || d.MsSum/int64(d.MsCount) < 20 {
		t.Fatalf("answer time: %d over %d", d.MsSum, d.MsCount)
	}
	if g := readFeedStatsFile().Days[statsToday()]; g == nil || g.Rounds != 5 {
		t.Fatalf("rounds: %+v", g)
	}

	rec := httptest.NewRecorder()
	h.GetFeedStats(rec, httptest.NewRequest(http.MethodGet, "/api/feeds/stats?days=7", nil))
	var out struct {
		Health struct {
			ByFeed []feedStatsHealthRow `json:"byFeed"`
		} `json:"health"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out.Health.ByFeed) != 1 {
		t.Fatalf("health: %v %s", err, rec.Body.String())
	}
	if row := out.Health.ByFeed[0]; row.AvgMs < 20 || row.Codes["http-404"] != 2 || row.Failed != 3 || row.State != "warn" {
		t.Fatalf("health row: %+v", row)
	}
}

func TestFeedStatsCountsWhatTheNewsSent(t *testing.T) {
	sink := newNewsSink(t)
	h := newsChannelHandlers(t, sink, `,"notifyNewsTarget":true`)
	defer webhookAllowLocalForTest(true)()
	hooks := newNewsSink(t)
	for _, id := range []string{"one", "two"} {
		if _, err := saveWebhookEndpoint(id, WebhookEndpoint{URL: hooks.srv.URL, Enabled: true, Events: []string{webhookEventFeedNews}}); err != nil {
			t.Fatal(err)
		}
	}
	round := []watchNews{watchNewsFor("a.example", "x"), watchNewsFor("b.example", "y")}
	h.pushWatchNews(context.Background(), round)
	g := readFeedStatsFile().Days[statsToday()]
	// Two feeds to two endpoints, one message to the target, no browser.
	if g == nil || g.Webhooks != 4 || g.Targets != 1 || g.Push != 0 {
		t.Fatalf("sent: %+v", g)
	}
	h.recordFeedNotify(3, 0, 0)
	if g := readFeedStatsFile().Days[statsToday()]; g.Push != 3 {
		t.Fatalf("push: %+v", g)
	}
}

func TestFeedStatsPruneRollsDaysIntoWeeksAndForgetsTheGone(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"feedStatsKeepDays":30}`)
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.Local)
	defer func(prev func() time.Time) { feedStatsNow = prev }(feedStatsNow)
	feedStatsNow = func() time.Time { return now }
	day := func(back int) string { return now.AddDate(0, 0, -back).Format(feedStatsDayLayout) }

	file := FeedStatsFile{Since: 1, PrunedOn: "", Feeds: map[string]*FeedStatsFeed{
		"live|f": {Days: map[string]*FeedStatsDay{
			day(1):  {Published: 1},
			day(29): {Published: 2},
			day(40): {Published: 4, Read: 1, Failed: 1},
			day(41): {Published: 8},
		}, Weeks: map[string]*FeedStatsWeek{
			"2024-01-01": {Published: 9},
			"2025-06-02": {Published: 3},
		}},
		"gone-long|f":  {Days: map[string]*FeedStatsDay{day(1): {Published: 1}}, GoneAt: now.AddDate(0, 0, -91).UnixMilli()},
		"gone-short|f": {Days: map[string]*FeedStatsDay{day(1): {Published: 1}}, GoneAt: now.AddDate(0, 0, -89).UnixMilli()},
	}, Days: map[string]*FeedStatsGlobal{day(1): {Push: 1}, day(60): {Push: 2}}}
	if err := writeFeedStatsFile(file); err != nil {
		t.Fatal(err)
	}
	h.recordFeedNotify(1, 0, 0)

	got := readFeedStatsFile()
	live := got.Feeds["live|f"]
	if live == nil || len(live.Days) != 2 || live.Days[day(1)] == nil || live.Days[day(29)] == nil {
		t.Fatalf("daily rows kept: %+v", live)
	}
	w40, w41 := feedStatsWeekOf(day(40)), feedStatsWeekOf(day(41))
	sum := 0
	for _, wk := range []string{w40, w41} {
		if live.Weeks[wk] == nil {
			t.Fatalf("no weekly row for %s: %+v", wk, live.Weeks)
		}
	}
	for _, w := range live.Weeks {
		sum += w.Published
	}
	if sum != 4+8+3 {
		t.Fatalf("weekly published = %d, want 15 (the 2024 week dropped)", sum)
	}
	if live.Weeks["2024-01-01"] != nil {
		t.Fatal("a weekly row older than two years was kept")
	}
	if got.Feeds["gone-long|f"] != nil || got.Feeds["gone-short|f"] == nil {
		t.Fatal("gone watches: the 91-day one should go, the 89-day one stay")
	}
	if got.Days[day(60)] != nil || got.Days[day(1)] == nil {
		t.Fatalf("global days: %+v", got.Days)
	}
	if got.PrunedOn != now.Format(feedStatsDayLayout) {
		t.Fatalf("prunedOn %q", got.PrunedOn)
	}
	// Once a day: a row that turns old later the same day waits for tomorrow.
	got.Feeds["live|f"].Days[day(50)] = &FeedStatsDay{Published: 1}
	_ = writeFeedStatsFile(got)
	h.recordFeedNotify(1, 0, 0)
	if readFeedStatsFile().Feeds["live|f"].Days[day(50)] == nil {
		t.Fatal("pruned twice on one day")
	}
}

func TestFeedStatsMarksAWatchGoneWhenItIsStopped(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true}`)
	e.pollOK(t)
	if feed := readFeedStatsFile().Feeds[e.statsID()]; feed == nil || feed.GoneAt != 0 {
		t.Fatalf("live watch: %+v", feed)
	}
	if rec := e.post(e.h.UnwatchFeeds, "/api/feeds/unwatch", fmt.Sprintf(`{"bookmarkUrl":%q}`, e.url)); rec.Code != 200 {
		t.Fatal("unwatch")
	}
	e.pollOK(t)
	if feed := readFeedStatsFile().Feeds[e.statsID()]; feed == nil || feed.GoneAt == 0 {
		t.Fatalf("stopped watch not marked gone: %+v", feed)
	}
}

func TestFeedStatsAFailedWriteNeverBreaksAPoll(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true}`)
	defer func(prev func(FeedStatsFile) error) { writeFeedStatsFile = prev }(writeFeedStatsFile)
	writeFeedStatsFile = func(FeedStatsFile) error { return errors.New("disk full") }
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	e.pollOK(t)
	if got := e.list(t)[e.key]; got.NewCount != 1 {
		t.Fatalf("the poll round lost its news: %+v", got)
	}
}

func TestFeedStatsRouteShape(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true}`)
	now := time.Now()
	e.srv.set(rssEntry("a", "A", 1), rssAt("b", "B", now.Add(-time.Hour)), rssAt("c", "C", now.Add(-2*time.Hour)))
	e.pollOK(t)
	e.markRead(t, true, "b")

	get := func(q string) map[string]any {
		rec := httptest.NewRecorder()
		e.h.GetFeedStats(rec, httptest.NewRequest(http.MethodGet, "/api/feeds/stats"+q, nil))
		if rec.Code != 200 {
			t.Fatalf("stats%s: %d", q, rec.Code)
		}
		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	for q, n := range map[string]int{"?days=7": 7, "?days=14": 14, "?days=30": 30, "?days=90": 90, "": 30, "?days=8": 30} {
		if got := len(get(q)["daily"].([]any)); got != n {
			t.Fatalf("days%s: %d rows, want %d", q, got, n)
		}
	}
	out := get("?days=7")
	daily := out["daily"].([]any)
	last := daily[len(daily)-1].(map[string]any)
	if last["date"] != statsToday() {
		t.Fatalf("the last row is %v, want today", last["date"])
	}
	totals := out["totals"].(map[string]any)
	if totals["feeds"].(float64) != 1 || totals["published"].(float64) != 2 || totals["read"].(float64) != 1 ||
		totals["readPct"].(float64) != 50 || totals["unreadNow"].(float64) != 1 {
		t.Fatalf("totals: %v", totals)
	}
	if busiest := totals["busiest"].(map[string]any); busiest["name"] != "Blog" {
		t.Fatalf("busiest: %v", busiest)
	}
	feeds := out["feeds"].([]any)
	row := feeds[0].(map[string]any)
	if row["name"] != "Blog" || row["feedUrl"] != e.srv.URL || row["readPct"].(float64) != 50 || row["state"] != "ok" || row["unread"].(float64) != 1 {
		t.Fatalf("feed row: %v", row)
	}
	hours := out["hours"].(map[string]any)
	if hours["feed"] != e.statsID() || hours["total"].(float64) != 2 || len(hours["matrix"].([]any)) != 7 {
		t.Fatalf("hours: %v", hours)
	}
	if out["enabled"] != true || out["keepDays"].(float64) != 90 {
		t.Fatalf("enabled/keepDays: %v %v", out["enabled"], out["keepDays"])
	}
	if strings.Contains(fmt.Sprint(out), "readCounted") {
		t.Fatal("internal flags leaked")
	}
}

func TestFeedStatsResetNeedsTokenAndDemoDeniesIt(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true}`)
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	e.pollOK(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret")
	if rec := e.post(e.h.ResetFeedStats, "/api/feeds/stats/reset", "{}"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("reset without a token = %d, want 401", rec.Code)
	}
	if len(readFeedStatsFile().Feeds) == 0 {
		t.Fatal("refused reset still cleared")
	}
	req := httptest.NewRequest(http.MethodPost, "/api/feeds/stats/reset", strings.NewReader("{}"))
	req.Header.Set("X-NextDash-Token", "secret")
	rec := httptest.NewRecorder()
	e.h.ResetFeedStats(rec, req)
	if rec.Code != 200 {
		t.Fatalf("reset: %d %s", rec.Code, rec.Body.String())
	}
	if got := readFeedStatsFile(); len(got.Feeds) != 0 || got.Since == 0 {
		t.Fatalf("after reset: %+v", got)
	}
	denied := false
	for _, route := range demoDeniedWrites {
		denied = denied || route == "/api/feeds/stats/reset"
	}
	if !denied {
		t.Fatal("/api/feeds/stats/reset is not refused in the demo")
	}
}

func TestFeedStatsSettingsDefaults(t *testing.T) {
	cases := []struct {
		stored string
		on     bool
		keep   int
	}{
		{`{}`, true, 90},
		{`{"feedStatsEnabled":false}`, false, 90},
		{`{"feedStatsEnabled":true,"feedStatsKeepDays":365}`, true, 365},
		{`{"feedStatsKeepDays":30}`, true, 30},
		{`{"feedStatsKeepDays":45}`, true, 90},
	}
	for _, c := range cases {
		h, _ := healthRecheckTestHandlers(t, c.stored)
		s := h.store.GetSettings()
		if s.FeedStatsEnabled != c.on || s.FeedStatsKeepDays != c.keep {
			t.Errorf("%s: enabled %v keep %d, want %v %d", c.stored, s.FeedStatsEnabled, s.FeedStatsKeepDays, c.on, c.keep)
		}
	}
	// A fresh install: the default settings written on first start.
	if d := newTestHandlers(t).store.GetSettings(); !d.FeedStatsEnabled || d.FeedStatsKeepDays != 90 {
		t.Fatalf("defaults: %v %d", d.FeedStatsEnabled, d.FeedStatsKeepDays)
	}
}

func TestFeedStatsAReadDuringAPollIsNotCountedTwice(t *testing.T) {
	e := newStatsEnv(t, `{"allowLocalBookmarks":true}`)
	e.srv.set(rssEntry("a", "A", 1), rssEntry("b", "B", 2))
	e.pollOK(t)

	// A slow round is out while b is read; it writes back its own older copy.
	e.srv.delay = 300 * time.Millisecond
	done := make(chan struct{})
	go func() { e.pollOK(t); close(done) }()
	time.Sleep(100 * time.Millisecond)
	e.markRead(t, true, "b")
	<-done
	e.srv.delay = 0
	e.markRead(t, true, "b")
	if n := e.readsToday(t); n != 1 {
		t.Fatalf("b counted %d times, want once", n)
	}
}
