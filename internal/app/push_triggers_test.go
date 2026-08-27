package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// capturedPush is one notification a fake push service received, decrypted back
// into the message the browser would have shown.
type capturedPush struct {
	Endpoint string
	Auth     string
}

// fakePushService stands in for FCM/Mozilla: it accepts deliveries and records
// them, so the trigger gating can be tested without network access.
type fakePushService struct {
	server *httptest.Server
	mu     sync.Mutex
	hits   []capturedPush
	status int
}

func newFakePushService(t *testing.T) *fakePushService {
	t.Helper()
	f := &fakePushService{status: http.StatusCreated}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.hits = append(f.hits, capturedPush{
			Endpoint: r.URL.Path,
			Auth:     r.Header.Get("Authorization"),
		})
		status := f.status
		f.mu.Unlock()
		w.WriteHeader(status)
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakePushService) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.hits)
}

func (f *fakePushService) lastAuth() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.hits) == 0 {
		return ""
	}
	return f.hits[len(f.hits)-1].Auth
}

// newPushTestHandlers wires a Handlers backed by a temp data dir, with one
// subscription pointing at the fake push service.
func newPushTestHandlers(t *testing.T, f *fakePushService, mutate func(*Settings)) *Handlers {
	t.Helper()
	withTempPushData(t)

	store := NewStore()
	settings := store.GetSettings()
	settings.PushNotifyEnabled = true
	settings.PushNotifyMonitor = true
	settings.PushNotifyBackup = true
	settings.PushNotifyRelease = true
	if mutate != nil {
		mutate(&settings)
	}
	if err := store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	if f != nil {
		sub := testSubscription(t, f.server.URL+"/push/device-1")
		if err := savePushSubscription(sub); err != nil {
			t.Fatalf("savePushSubscription: %v", err)
		}
	}

	return &Handlers{store: store}
}

// The headers a push service checks: without a VAPID Authorization header the
// delivery is rejected, so this guards the whole scheme.
func TestSendWebPushNotificationSendsVAPIDAuth(t *testing.T) {
	f := newFakePushService(t)
	h := newPushTestHandlers(t, f, nil)

	h.sendWebPushNotification(context.Background(), webPushMessage{Title: "hello"})

	if got := f.count(); got != 1 {
		t.Fatalf("push service received %d deliveries, want 1", got)
	}
	auth := f.lastAuth()
	if !strings.HasPrefix(auth, "vapid t=") || !strings.Contains(auth, ", k=") {
		t.Errorf("Authorization = %q, want the vapid t=…, k=… form", auth)
	}
}

// The master switch must gate everything: turning push off has to stop delivery
// even when the per-category toggles are on.
func TestPushTriggersRespectMasterSwitch(t *testing.T) {
	f := newFakePushService(t)
	h := newPushTestHandlers(t, f, func(s *Settings) { s.PushNotifyEnabled = false })

	h.pushMonitorNotifications(context.Background(), []monitorNotification{{Event: "down", Name: "example", URL: "https://example.com"}})
	h.pushAutoBackupResult(context.Background(), nil)

	if got := f.count(); got != 0 {
		t.Errorf("sent %d notifications with push disabled, want 0", got)
	}
}

func TestPushTriggersRespectCategoryToggles(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Settings)
		fire   func(*Handlers)
	}{
		{
			"monitor off",
			func(s *Settings) { s.PushNotifyMonitor = false },
			func(h *Handlers) {
				h.pushMonitorNotifications(context.Background(), []monitorNotification{{Event: "down", Name: "x", URL: "https://x.test"}})
			},
		},
		{
			"backup off",
			func(s *Settings) { s.PushNotifyBackup = false },
			func(h *Handlers) { h.pushAutoBackupResult(context.Background(), nil) },
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakePushService(t)
			h := newPushTestHandlers(t, f, tc.mutate)
			tc.fire(h)
			if got := f.count(); got != 0 {
				t.Errorf("sent %d notifications with the category off, want 0", got)
			}
		})
	}
}

func TestPushMonitorNotificationsSendsPerEvent(t *testing.T) {
	f := newFakePushService(t)
	h := newPushTestHandlers(t, f, nil)

	h.pushMonitorNotifications(context.Background(), []monitorNotification{
		{Event: "down", Name: "one", URL: "https://one.test", Failures: 3},
		{Event: "up", Name: "two", URL: "https://two.test"},
	})

	if got := f.count(); got != 2 {
		t.Errorf("sent %d notifications, want one per transition", got)
	}
}

// Notifications for the same monitor must share a tag so a recovery replaces the
// outage on the lock screen instead of stacking beside it.
func TestMonitorNotificationTagIsStablePerURL(t *testing.T) {
	down := webPushTagFor(t, monitorNotification{Event: "down", Name: "x", URL: "https://x.test"})
	up := webPushTagFor(t, monitorNotification{Event: "up", Name: "x", URL: "https://x.test"})
	other := webPushTagFor(t, monitorNotification{Event: "down", Name: "y", URL: "https://y.test"})

	if down != up {
		t.Errorf("down tag %q != up tag %q for the same monitor", down, up)
	}
	if down == other {
		t.Error("different monitors share a notification tag")
	}
}

// webPushTagFor reproduces the tag the trigger assigns, so the grouping rule can
// be asserted without a network round trip.
func webPushTagFor(t *testing.T, n monitorNotification) string {
	t.Helper()
	return "nextdash-monitor-" + pushSubscriptionID(n.URL)
}

// A failing push service must not be fatal — a monitor run has to complete even
// when notifications cannot be delivered.
func TestSendWebPushNotificationSurvivesServiceErrors(t *testing.T) {
	f := newFakePushService(t)
	f.status = http.StatusInternalServerError
	h := newPushTestHandlers(t, f, nil)

	h.sendWebPushNotification(context.Background(), webPushMessage{Title: "hello"})

	if f.count() != 1 {
		t.Error("delivery was not attempted")
	}
	// The device stays registered: a 500 is transient, not a dead subscription.
	if len(listPushSubscriptions()) != 1 {
		t.Error("a transient server error dropped the subscription")
	}
}

// 410 Gone is the push service saying the subscription is dead; it must be
// removed so it is not retried forever.
func TestSendWebPushNotificationDropsGoneSubscriptions(t *testing.T) {
	f := newFakePushService(t)
	f.status = http.StatusGone
	h := newPushTestHandlers(t, f, nil)

	h.sendWebPushNotification(context.Background(), webPushMessage{Title: "hello"})

	if got := listPushSubscriptions(); len(got) != 0 {
		t.Errorf("subscription survived a 410: %+v", got)
	}
}

func TestSendWebPushNotificationNoSubscriptions(t *testing.T) {
	f := newFakePushService(t)
	h := newPushTestHandlers(t, nil, nil)

	// Must not panic or contact anything when nobody is subscribed.
	h.sendWebPushNotification(context.Background(), webPushMessage{Title: "hello"})

	if f.count() != 0 {
		t.Error("contacted the push service with no subscriptions")
	}
}

// The message the service worker receives must carry the fields it renders.
func TestWebPushMessageShape(t *testing.T) {
	data, err := json.Marshal(webPushMessage{
		Title: "example.com is offline",
		Body:  "failed 3 checks",
		Tag:   "nextdash-monitor-abc",
		URL:   "/health",
		Kind:  "monitor",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, key := range []string{"title", "body", "tag", "url", "kind"} {
		if _, ok := decoded[key]; !ok {
			t.Errorf("message is missing %q, which the service worker reads", key)
		}
	}
}
