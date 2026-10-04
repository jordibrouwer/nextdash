package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
	h.recordManualHealthSample(key, false, 0, 0, "")

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
			{T: msAgo(now, 5*time.Minute), Up: false, Alerted: true},
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

func postTestNotification(t *testing.T, h *Handlers) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/health/test-notification", nil)
	rec := httptest.NewRecorder()
	h.TestMonitorNotification(rec, req)
	return rec
}

func TestTestMonitorNotificationSendsThroughThePickedPreset(t *testing.T) {
	var (
		mu      sync.Mutex
		bodies  []string
		headers []http.Header
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(body))
		headers = append(headers, r.Header.Clone())
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"`+srv.URL+`","monitorNotifyPreset":"slack","allowLocalBookmarks":true}`)

	rec := postTestNotification(t, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 1 {
		t.Fatalf("expected 1 request to the webhook, got %d", len(bodies))
	}
	var decoded slackWebhookPayload
	if err := json.Unmarshal([]byte(bodies[0]), &decoded); err != nil {
		t.Fatalf("body is not a Slack payload: %v\nbody: %s", err, bodies[0])
	}
	if decoded.Text == "" {
		t.Error("expected a non-empty Slack text field")
	}
	if headers[0].Get("Content-Type") != "application/json" {
		t.Errorf("content-type = %q, want application/json", headers[0].Get("Content-Type"))
	}
}

func TestTestMonitorNotificationWithoutConfigIs400(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)

	rec := postTestNotification(t, h)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 when nothing is configured", rec.Code)
	}
}

// Pushover has no user-chosen URL: it needs both credentials before the
// handler will consider it configured at all, rather than silently falling
// back to some other target. (monitorNotifyTarget's own unit test — see
// health_notify_presets_test.go — separately proves monitorNotifyUrl is
// ignored for this preset once credentials are set; that assertion does not
// need a live network call, so it is not repeated here.)
func TestTestMonitorNotificationPushoverRequiresBothCredentials(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	h, _ := healthRecheckTestHandlers(t, `{
		"monitorNotifyUrl":"`+srv.URL+`",
		"monitorNotifyPreset":"pushover",
		"allowLocalBookmarks":true
	}`)

	rec := postTestNotification(t, h)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 with no Pushover credentials set", rec.Code)
	}
	if called {
		t.Error("nothing should be contacted when Pushover has no credentials configured")
	}
}

// A malformed configuration must not be silently dropped — the whole point of
// the test-send button is to surface a delivery failure at setup time.
func TestTestMonitorNotificationSurfacesUpstreamRejection(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"`+srv.URL+`","allowLocalBookmarks":true}`)

	rec := postTestNotification(t, h)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 when the upstream service rejects the test alert", rec.Code)
	}
}

// Failures recorded inside a maintenance window neither count toward an alert
// nor make the first good check after it a "back online".
func TestPendingNotificationsIgnoreMaintenanceSamples(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":3}`)
	now := time.Now()
	if err := h.appendHealthSamples(map[string][]HealthSample{
		"https://a.example": {
			{T: msAgo(now, 25*time.Minute), Up: true},
			{T: msAgo(now, 20*time.Minute), Up: false, Maint: true},
			{T: msAgo(now, 15*time.Minute), Up: false, Maint: true},
			{T: msAgo(now, 10*time.Minute), Up: false, Maint: true},
		},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	up := monitorTransition{key: "https://a.example", url: "https://a.example", up: true, at: now.UnixMilli()}
	if got := h.pendingMonitorNotifications([]monitorTransition{up}); len(got) != 0 {
		t.Fatalf("a nightly window produced %#v", got)
	}
	down := monitorTransition{key: "https://a.example", url: "https://a.example", up: false, reason: "Timeout", at: now.UnixMilli()}
	if got := h.pendingMonitorNotifications([]monitorTransition{down}); len(got) != 0 {
		t.Fatalf("the first failure after a window alerted at once: %#v", got)
	}
}

// A re-check inside a maintenance window is marked like the monitor's own
// samples: unmarked, it counted as an outage and fed the alerts.
func TestAManualRecheckInAMaintenanceWindowIsMarked(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"maintenanceWindows":[{"start":"00:00","end":"23:59"}]}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[{"name":"A","url":"https://a.example","monitor":true}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	key := canonicalBookmarkURLKey("https://a.example")
	h.recordManualHealthSample(key, false, 0, 503, "HTTP 503")
	samples := readHealthHistoryFile().Samples[key]
	if len(samples) != 1 || !samples[0].Maint {
		t.Fatalf("samples = %#v, want one marked as maintenance", samples)
	}
}

// A threshold crossed during Retest all or a check-url was stamped notified
// with nothing sent, and the monitor then never warned for it.
func TestACertificateThresholdSeenOutsideTheMonitorIsSent(t *testing.T) {
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
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"`+srv.URL+`","allowLocalBookmarks":true}`)

	expiry := time.Now().Add(20 * 24 * time.Hour).UnixMilli()
	h.recordCertificatesAndAlert(context.Background(), []PingResult{{CertHost: "cert.example", CertExpiry: expiry}})

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("notifications = %d, want the 30-day warning", len(received))
	}
}

// An install whose only listener is a Config → Webhooks endpoint still has to
// get health.down: the events come from this list, and the gate returned none.
func TestPendingNotificationsWithOnlyAWebhookEndpoint(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyRetries":1}`)
	if _, err := saveWebhookEndpoint("ha", WebhookEndpoint{URL: "https://ha.example/hook", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	transition := monitorTransition{key: "https://a.example", url: "https://a.example", name: "A", up: false, reason: "HTTP 503", at: now.UnixMilli()}
	if err := h.appendHealthSamples(map[string][]HealthSample{"https://a.example": {{T: now.UnixMilli(), Up: false}}}); err != nil {
		t.Fatal(err)
	}
	if got := h.pendingMonitorNotifications([]monitorTransition{transition}); len(got) != 1 {
		t.Fatalf("notifications = %#v, want the down event for the webhook", got)
	}
}

// A recovery that a Re-check saw first still sends "back online": once its up
// sample was stored, the next monitor round compared up with up and stayed
// silent.
func TestARecoverySeenByARecheckIsAnnounced(t *testing.T) {
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
	h, dir := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"`+srv.URL+`","monitorNotifyRetries":1,"allowLocalBookmarks":true}`)
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[{"name":"A","url":"https://a.example","monitor":true}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	key := canonicalBookmarkURLKey("https://a.example")
	now := time.Now()
	if err := h.appendHealthSamples(map[string][]HealthSample{key: {{T: msAgo(now, 10*time.Minute), Up: false, Alerted: true}}}); err != nil {
		t.Fatalf("append: %v", err)
	}

	h.recordManualHealthSample(key, true, 40, 200, "")

	deadline := time.Now().Add(5 * time.Second)
	for {
		mu.Lock()
		n := len(received)
		mu.Unlock()
		if n > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 || received[0].Event != "up" {
		t.Fatalf("received = %#v, want one back-online", received)
	}
}

// One URL monitored on two pages shares one history: the collection view
// counted it as two monitors with every outage twice.
func TestFleetCountsAURLOnTwoPagesOnce(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	for id, name := range map[int]string{1: "Page 1", 2: "Page 2"} {
		body := fmt.Sprintf(`{"id":%d,"name":%q,"bookmarks":[{"name":"A","url":"https://a.example","monitor":true}]}`, id, name)
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("bookmarks-%d.json", id)), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	_ = os.WriteFile(filepath.Join(dir, "pages.json"), []byte(`[{"id":1,"name":"Page 1"},{"id":2,"name":"Page 2"}]`), 0o644)
	key := canonicalBookmarkURLKey("https://a.example")
	now := time.Now()
	if err := h.appendHealthSamples(map[string][]HealthSample{key: {
		{T: msAgo(now, 20*time.Minute), Up: true}, {T: msAgo(now, 10*time.Minute), Up: false}, {T: msAgo(now, 5*time.Minute), Up: true},
	}}); err != nil {
		t.Fatal(err)
	}
	report := h.buildBookmarkHealthReport()
	if report.Fleet == nil || report.Fleet.Monitors != 1 || report.Fleet.Uptime24h.Samples != 3 {
		t.Fatalf("fleet = %+v", report.Fleet)
	}
}

// An unreachable alert service is logged by host: Go's error quotes the whole
// address, and a Telegram bot token sits in its path.
func TestAnUnreachableAlertLogsNoSecret(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"http://127.0.0.1:1/botSECRET123/sendMessage","allowLocalBookmarks":true}`)
	h.dispatchMonitorNotifications(context.Background(), []monitorNotification{{Event: "down", Name: "A", URL: "https://a.example"}})
	out := buf.String()
	if strings.Contains(out, "SECRET123") || !strings.Contains(out, "127.0.0.1:1") {
		t.Fatalf("log = %s", out)
	}
}

// A manual re-check or retest records failures without alerting. The next
// success then sent "back online" for an outage nobody had been told about.
func TestPendingNotificationsNoRecoveryForAnUnalertedLongOutage(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":1}`)
	now := time.Now()
	if err := h.appendHealthSamples(map[string][]HealthSample{
		"https://quiet.example": {
			{T: msAgo(now, 10*time.Minute), Up: false},
			{T: msAgo(now, 5*time.Minute), Up: false},
		},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}
	got := h.pendingMonitorNotifications([]monitorTransition{
		{key: "https://quiet.example", url: "https://quiet.example", name: "Quiet", up: true, at: now.UnixMilli()},
	})
	if len(got) != 0 {
		t.Fatalf("a recovery was sent for an outage that never alerted: %#v", got)
	}
}
