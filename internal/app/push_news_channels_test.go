package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type newsSink struct {
	mu     sync.Mutex
	bodies []string
	srv    *httptest.Server
}

func newNewsSink(t *testing.T) *newsSink {
	t.Helper()
	s := &newsSink{}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.bodies = append(s.bodies, string(b))
		s.mu.Unlock()
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *newsSink) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.bodies)
}

func (s *newsSink) wait(n int) bool {
	for i := 0; i < 100; i++ {
		if s.count() >= n {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

func newsChannelHandlers(t *testing.T, sink *newsSink, extra string) *Handlers {
	t.Helper()
	globalOutboundLimiter.reset()
	return func() *Handlers {
		h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"`+sink.srv.URL+`","monitorNotifyPreset":"ntfy","allowLocalBookmarks":true`+extra+`}`)
		return h
	}()
}

func TestFeedNewsWebhookEvent(t *testing.T) {
	sink := newNewsSink(t)
	h, _ := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	globalOutboundLimiter.reset()
	defer webhookAllowLocalForTest(true)()
	if _, err := saveWebhookEndpoint("news", WebhookEndpoint{URL: sink.srv.URL, Enabled: true, Events: []string{webhookEventFeedNews}}); err != nil {
		t.Fatal(err)
	}
	if webhookEventFeedNews != "feed.news" {
		t.Fatalf("event name %q", webhookEventFeedNews)
	}
	found := false
	for _, n := range webhookEventNames {
		found = found || n == webhookEventFeedNews
	}
	if !found {
		t.Fatal("feed.news is not subscribable")
	}

	loud := watchNews{BookmarkKey: "a.example", FeedURL: "https://a.example/feed", Items: []FeedItem{{ID: "1", Title: "Release 9", Link: "https://a.example/9", Summary: "SECRET SUMMARY", PublishedAt: 42}}}
	muted := watchNews{BookmarkKey: "m.example", FeedURL: "https://m.example/feed", Items: []FeedItem{{ID: "2", Title: "Muted"}}, Muted: true}
	h.pushWatchNews(context.Background(), []watchNews{loud, muted})
	if !sink.wait(1) {
		t.Fatal("no feed.news delivery")
	}
	time.Sleep(200 * time.Millisecond)
	if sink.count() != 1 {
		t.Fatalf("deliveries: %d, want 1 (muted feeds never)", sink.count())
	}
	body := sink.bodies[0]
	if strings.Contains(body, "SECRET SUMMARY") || strings.Contains(body, "Muted") {
		t.Fatalf("summary or muted feed leaked: %s", body)
	}
	var env struct {
		Type string         `json:"type"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &env); err != nil {
		t.Fatalf("body: %v %s", err, body)
	}
	data := env.Data
	if data == nil {
		var flat map[string]any
		_ = json.Unmarshal([]byte(body), &flat)
		data, _ = flat["data"].(map[string]any)
	}
	items, _ := data["items"].([]any)
	if data["feedUrl"] != "https://a.example/feed" || data["site"] != "a.example" || len(items) != 1 {
		t.Fatalf("payload: %s", body)
	}
	if it := items[0].(map[string]any); it["title"] != "Release 9" || it["link"] != "https://a.example/9" {
		t.Fatalf("item: %v", it)
	}
}

func TestFeedNewsWebhookRespectsEventFilter(t *testing.T) {
	sink := newNewsSink(t)
	h, _ := healthRecheckTestHandlers(t, `{}`)
	globalOutboundLimiter.reset()
	defer webhookAllowLocalForTest(true)()
	if _, err := saveWebhookEndpoint("other", WebhookEndpoint{URL: sink.srv.URL, Enabled: true, Events: []string{webhookEventHealthDown}}); err != nil {
		t.Fatal(err)
	}
	h.pushWatchNews(context.Background(), []watchNews{watchNewsFor("a.example", "x")})
	time.Sleep(300 * time.Millisecond)
	if sink.count() != 0 {
		t.Fatal("an endpoint that did not choose feed.news received it")
	}
}

func TestNewsToNtfyTarget(t *testing.T) {
	sink := newNewsSink(t)
	h := newsChannelHandlers(t, sink, `,"notifyNewsTarget":true`)
	one := []watchNews{watchNewsFor("a.example", "Release 9")}
	h.pushWatchNews(context.Background(), one)
	if !sink.wait(1) {
		t.Fatal("nothing reached the target")
	}
	if !strings.Contains(sink.bodies[0], "a.example: Release 9") {
		t.Fatalf("single sentence: %q", sink.bodies[0])
	}

	// Several sites in one round: one message, and the muted one is not in it.
	round := []watchNews{watchNewsFor("a.example", "x"), watchNewsFor("b.example", "y"), watchNewsFor("c.example", "z")}
	round[2].Muted = true
	h.pushWatchNews(context.Background(), round)
	if !sink.wait(2) {
		t.Fatal("round not delivered")
	}
	time.Sleep(200 * time.Millisecond)
	if sink.count() != 2 {
		t.Fatalf("messages: %d, want 2 (one per round)", sink.count())
	}
	last := sink.bodies[1]
	if !strings.Contains(last, "2 sites have news: a.example, b.example") || strings.Contains(last, "c.example") {
		t.Fatalf("merged sentence: %q", last)
	}

	// A fully muted round says nothing.
	h.pushWatchNews(context.Background(), []watchNews{{BookmarkKey: "m.example", Items: []FeedItem{{Title: "q"}}, Muted: true}})
	time.Sleep(200 * time.Millisecond)
	if sink.count() != 2 {
		t.Fatal("muted feed reached the target")
	}
}

func TestNewsTargetOffByDefault(t *testing.T) {
	sink := newNewsSink(t)
	h := newsChannelHandlers(t, sink, ``)
	if h.store.GetSettings().NotifyNewsTarget {
		t.Fatal("must default to off")
	}
	h.pushWatchNews(context.Background(), []watchNews{watchNewsFor("a.example", "x")})
	time.Sleep(300 * time.Millisecond)
	if sink.count() != 0 {
		t.Fatalf("target received news while off: %d", sink.count())
	}
}

func TestNewsTargetFollowsQuietHours(t *testing.T) {
	sink := newNewsSink(t)
	h := newsChannelHandlers(t, sink, `,"notifyNewsTarget":true,"quietHoursEnabled":true,"quietHours":[{"start":"22:00","end":"07:00"}]`)
	old := quietClock
	quietClock = func() time.Time { return time.Date(2026, 11, 1, 3, 0, 0, 0, time.Local) }
	t.Cleanup(func() { quietClock = old })
	h.pushWatchNews(context.Background(), []watchNews{watchNewsFor("a.example", "x")})
	time.Sleep(300 * time.Millisecond)
	if sink.count() != 0 {
		t.Fatal("news reached the target inside the quiet hours")
	}
}
