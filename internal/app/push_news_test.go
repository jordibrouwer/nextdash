package app

import (
	"context"
	"testing"
	"time"
)

func watchNewsFor(key, title string) watchNews {
	return watchNews{BookmarkKey: key, FeedURL: "https://f.example/feed", Items: []FeedItem{{ID: title, Title: title}}}
}

func TestNewsPushMessageOneSite(t *testing.T) {
	msg, ok := newsPushMessage([]watchNews{watchNewsFor("a.example", "Release 9.2")}, map[string]string{"a.example": "Example"})
	if !ok {
		t.Fatal("expected a message")
	}
	if msg.Title != "Example has news" || msg.Body != "Release 9.2" || msg.Kind != "news" ||
		msg.URL != "/?news=1" || msg.Tag != "nextdash-news" || msg.Renotify {
		t.Fatalf("message: %+v", msg)
	}
}

func TestNewsPushMessageMerges(t *testing.T) {
	news := []watchNews{watchNewsFor("a.example", "x"), watchNewsFor("b.example", "y"), watchNewsFor("c.example", "z")}
	msg, ok := newsPushMessage(news, map[string]string{"a.example": "A", "b.example": "B"})
	if !ok || msg.Title != "3 sites have news" || msg.Body != "A, B and 1 more" {
		t.Fatalf("message: %+v ok=%v", msg, ok)
	}
	// A key without a bookmark name falls back to its host.
	one, _ := newsPushMessage([]watchNews{watchNewsFor("https://nameless.example/path", "t")}, nil)
	if one.Title != "nameless.example has news" {
		t.Fatalf("host fallback: %q", one.Title)
	}
	if _, ok := newsPushMessage(nil, nil); ok {
		t.Fatal("no news must give no message")
	}
}

func TestPushNotifyNewsDefaultsOn(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	if !h.store.GetSettings().PushNotifyNews {
		t.Fatal("a settings file without the key must read as on")
	}
	h, _ = healthRecheckTestHandlers(t, `{"pushNotifyNews":false}`)
	if h.store.GetSettings().PushNotifyNews {
		t.Fatal("an explicit false must stay off")
	}
}

func TestPushWatchNewsGated(t *testing.T) {
	news := []watchNews{watchNewsFor("a.example", "x")}

	f := newFakePushService(t)
	h := newPushTestHandlers(t, f, func(s *Settings) { s.PushNotifyEnabled = false; s.PushNotifyNews = true })
	h.pushWatchNews(context.Background(), news)
	if f.count() != 0 {
		t.Fatalf("master switch off: %d deliveries", f.count())
	}

	f = newFakePushService(t)
	h = newPushTestHandlers(t, f, func(s *Settings) { s.PushNotifyNews = false })
	h.pushWatchNews(context.Background(), news)
	if f.count() != 0 {
		t.Fatalf("news switch off: %d deliveries", f.count())
	}

	f = newFakePushService(t)
	h = newPushTestHandlers(t, f, func(s *Settings) { s.PushNotifyNews = true })
	h.pushWatchNews(context.Background(), news)
	if f.count() != 1 {
		t.Fatalf("both on: %d deliveries, want 1", f.count())
	}
}

func TestPushWatchNewsQuietHours(t *testing.T) {
	news := []watchNews{watchNewsFor("a.example", "x")}
	quiet := func(allow []string) func(*Settings) {
		return func(s *Settings) {
			s.PushNotifyNews = true
			s.QuietHoursEnabled = true
			s.QuietHours = []MaintenanceWindow{{Start: "22:00", End: "07:00"}}
			s.QuietHoursAllow = allow
		}
	}
	at := func(hour int) {
		old := quietClock
		quietClock = func() time.Time { return time.Date(2026, 11, 1, hour, 0, 0, 0, time.Local) }
		t.Cleanup(func() { quietClock = old })
	}

	at(3)
	f := newFakePushService(t)
	h := newPushTestHandlers(t, f, quiet(nil))
	h.pushWatchNews(context.Background(), news)
	if f.count() != 0 {
		t.Fatalf("inside the quiet hours: %d deliveries, want 0", f.count())
	}

	f = newFakePushService(t)
	h = newPushTestHandlers(t, f, quiet([]string{quietKindNews}))
	if !quietAllowSet(h.store.GetSettings())[quietKindNews] {
		t.Fatal("news must survive settings normalisation")
	}
	h.pushWatchNews(context.Background(), news)
	if f.count() != 1 {
		t.Fatalf("news allowed through the quiet hours: %d deliveries, want 1", f.count())
	}

	at(12)
	f = newFakePushService(t)
	h = newPushTestHandlers(t, f, quiet(nil))
	h.pushWatchNews(context.Background(), news)
	if f.count() != 1 {
		t.Fatalf("outside the quiet hours: %d deliveries, want 1", f.count())
	}
}
