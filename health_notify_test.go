package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestClampMonitorNotifyRetries(t *testing.T) {
	cases := []struct{ in, want int }{
		{0, defaultMonitorNotifyRetries},
		{-3, defaultMonitorNotifyRetries},
		{1, 1},
		{3, 3},
		{maxMonitorNotifyRetries, maxMonitorNotifyRetries},
		{maxMonitorNotifyRetries + 5, maxMonitorNotifyRetries},
	}
	for _, c := range cases {
		if got := clampMonitorNotifyRetries(c.in); got != c.want {
			t.Errorf("clampMonitorNotifyRetries(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestTrailingFailures(t *testing.T) {
	now := time.Now()
	samples := []HealthSample{
		{T: msAgo(now, 5*time.Minute), Up: false},
		{T: msAgo(now, 4*time.Minute), Up: true},
		{T: msAgo(now, 3*time.Minute), Up: false},
		{T: msAgo(now, 2*time.Minute), Up: false},
	}
	if got := trailingFailures(samples); got != 2 {
		t.Errorf("expected 2 trailing failures, got %d", got)
	}
	if got := trailingFailures(nil); got != 0 {
		t.Errorf("expected 0 for empty history, got %d", got)
	}
}

// A single blip must stay silent: that is the entire point of the retry threshold.
func TestPendingNotificationsSilentBelowThreshold(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":3}`)
	now := time.Now()

	if err := h.appendHealthSamples(map[string][]HealthSample{
		"https://a.example": {{T: msAgo(now, 5*time.Minute), Up: true}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}

	got := h.pendingMonitorNotifications([]monitorTransition{
		{key: "https://a.example", url: "https://a.example", up: false, reason: "Timeout", at: now.UnixMilli()},
	})
	if len(got) != 0 {
		t.Fatalf("expected silence on first failure, got %#v", got)
	}
}

// Fires exactly once, on the check that reaches the threshold — not again while
// the outage continues.
func TestPendingNotificationsFireOnceAtThreshold(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":3}`)
	now := time.Now()

	// Two prior failures stored; this run's failure is the third.
	if err := h.appendHealthSamples(map[string][]HealthSample{
		"https://a.example": {
			{T: msAgo(now, 15*time.Minute), Up: false},
			{T: msAgo(now, 10*time.Minute), Up: false},
		},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}

	transition := monitorTransition{key: "https://a.example", url: "https://a.example", name: "A", up: false, reason: "HTTP 503", at: now.UnixMilli()}
	got := h.pendingMonitorNotifications([]monitorTransition{transition})
	if len(got) != 1 {
		t.Fatalf("expected 1 notification at threshold, got %#v", got)
	}
	if got[0].Event != "down" || got[0].Failures != 3 || got[0].Error != "HTTP 503" {
		t.Errorf("unexpected notification: %#v", got[0])
	}

	// One more stored failure pushes the count past the threshold: stay quiet.
	if err := h.appendHealthSamples(map[string][]HealthSample{
		"https://a.example": {{T: msAgo(now, 5*time.Minute), Up: false}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if got := h.pendingMonitorNotifications([]monitorTransition{transition}); len(got) != 0 {
		t.Fatalf("expected silence past the threshold, got %#v", got)
	}
}

func TestPendingNotificationsSurviveAManualRecheck(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":3}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"A","url":"https://a.example","monitor":true}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	key := canonicalBookmarkURLKey("https://a.example")
	now := time.Now()

	// Two scheduled failures stored: the next scheduled run is the third and would
	// alert.
	if err := h.appendHealthSamples(map[string][]HealthSample{
		key: {
			{T: msAgo(now, 15*time.Minute), Up: false},
			{T: msAgo(now, 10*time.Minute), Up: false},
		},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}

	// The user presses Re-check while it is down. That writes a sample straight to
	// the history, outside the notification path, pushing the count to three.
	h.recordManualHealthSample(key, false, 0, 0)

	// The next scheduled run now counts four consecutive failures. It must still
	// alert: the outage crossed the threshold here for the first time, and testing
	// for equality alone would silence it for good.
	transition := monitorTransition{key: key, url: "https://a.example", name: "A", up: false, reason: "HTTP 503", at: now.UnixMilli()}
	got := h.pendingMonitorNotifications([]monitorTransition{transition})
	if len(got) != 1 {
		t.Fatalf("expected the outage to alert despite a manual re-check, got %#v", got)
	}
	if got[0].Event != "down" || got[0].Failures != 4 {
		t.Errorf("unexpected notification: %#v", got[0])
	}

	// Still exactly once: with the alert now in the past, later runs stay quiet.
	if err := h.appendHealthSamples(map[string][]HealthSample{
		key: {{T: now.UnixMilli(), Up: false}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	if got := h.pendingMonitorNotifications([]monitorTransition{transition}); len(got) != 0 {
		t.Fatalf("expected silence once the outage has alerted, got %#v", got)
	}
}

func TestPendingNotificationsRecoveryOnlyAfterAlert(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":3}`)
	now := time.Now()

	// Outage that never reached the threshold → recovery must be silent, otherwise
	// a blip produces a lone "back online" with no matching "down".
	if err := h.appendHealthSamples(map[string][]HealthSample{
		"https://blip.example": {{T: msAgo(now, 5*time.Minute), Up: false}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	got := h.pendingMonitorNotifications([]monitorTransition{
		{key: "https://blip.example", url: "https://blip.example", up: true, at: now.UnixMilli()},
	})
	if len(got) != 0 {
		t.Fatalf("expected no recovery for an unalerted blip, got %#v", got)
	}

	// A real outage that did alert → recovery fires.
	if err := h.appendHealthSamples(map[string][]HealthSample{
		"https://real.example": {
			{T: msAgo(now, 15*time.Minute), Up: false},
			{T: msAgo(now, 10*time.Minute), Up: false},
			{T: msAgo(now, 5*time.Minute), Up: false},
		},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	got = h.pendingMonitorNotifications([]monitorTransition{
		{key: "https://real.example", url: "https://real.example", name: "Real", up: true, at: now.UnixMilli()},
	})
	if len(got) != 1 || got[0].Event != "up" {
		t.Fatalf("expected one recovery notification, got %#v", got)
	}
}

func TestPendingNotificationsDisabledWithoutURL(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyRetries":1}`)
	now := time.Now()

	got := h.pendingMonitorNotifications([]monitorTransition{
		{key: "https://a.example", url: "https://a.example", up: false, at: now.UnixMilli()},
	})
	if len(got) != 0 {
		t.Fatalf("expected no notifications without a webhook URL, got %#v", got)
	}
}

func TestDispatchMonitorNotificationsPostsPayload(t *testing.T) {
	var (
		mu       sync.Mutex
		received []monitorNotification
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var n monitorNotification
		_ = json.NewDecoder(r.Body).Decode(&n)
		mu.Lock()
		received = append(received, n)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// The test server listens on loopback, so local targets must be allowed for
	// this to be reachable at all — same rule as a bookmark ping.
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"`+srv.URL+`","allowLocalBookmarks":true}`)

	h.dispatchMonitorNotifications(context.Background(), []monitorNotification{
		{Event: "down", Name: "A", URL: "https://a.example", Status: "offline", Error: "Timeout", At: time.Now().UnixMilli(), Failures: 3},
	})

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 webhook call, got %d", len(received))
	}
	if received[0].Event != "down" || received[0].Name != "A" || received[0].Error != "Timeout" {
		t.Errorf("unexpected payload: %#v", received[0])
	}
}

// The webhook URL is user input and must obey the same SSRF rules as a ping:
// with local bookmarks disallowed, a loopback target is refused outright.
func TestDispatchMonitorNotificationsRejectsInternalURL(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"`+srv.URL+`","allowLocalBookmarks":false}`)

	h.dispatchMonitorNotifications(context.Background(), []monitorNotification{
		{Event: "down", Name: "A", URL: "https://a.example", Status: "offline", At: time.Now().UnixMilli()},
	})

	if called {
		t.Fatal("webhook to a loopback address must be blocked when local bookmarks are disallowed")
	}
}

func TestMonitorNotificationTitle(t *testing.T) {
	cases := []struct {
		in   monitorNotification
		want string
	}{
		{monitorNotification{Event: "down", Name: "Grafana", Error: "HTTP 502"}, "Grafana is offline (HTTP 502)"},
		{monitorNotification{Event: "down", Name: "Grafana"}, "Grafana is offline"},
		{monitorNotification{Event: "up", Name: "Grafana"}, "Grafana is back online"},
		// Nameless bookmarks fall back to the URL so the alert is still actionable.
		{monitorNotification{Event: "down", URL: "https://a.example"}, "https://a.example is offline"},
		// A certificate warning is not an outage: the host is answering fine, so
		// "is offline" would be actively wrong here.
		{monitorNotification{Event: "cert-expiring", Name: "example.com", Error: "TLS certificate expires in 7 days"}, "example.com: TLS certificate expires in 7 days"},
		{monitorNotification{Event: "cert-expiring", Name: "example.com"}, "example.com: TLS certificate expiring soon"},
	}
	for _, c := range cases {
		if got := monitorNotificationTitle(c.in); got != c.want {
			t.Errorf("monitorNotificationTitle(%#v) = %q, want %q", c.in, got, c.want)
		}
		if c.in.Event == "cert-expiring" && strings.Contains(monitorNotificationTitle(c.in), "offline") {
			t.Errorf("cert-expiring title must never say offline: %q", monitorNotificationTitle(c.in))
		}
	}
}
