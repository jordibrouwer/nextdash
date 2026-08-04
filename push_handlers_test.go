package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func postJSON(t *testing.T, h http.HandlerFunc, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

// subscribeBody builds a well-formed subscribe request with usable keys.
func subscribeBody(t *testing.T, endpoint string) map[string]any {
	t.Helper()
	p256dh, auth, _, _ := newTestSubscriptionKeys(t)
	return map[string]any{
		"endpoint": endpoint,
		"keys":     map[string]string{"p256dh": p256dh, "auth": auth},
		"label":    "Chrome on macOS",
	}
}

func TestSubscribePushStoresSubscription(t *testing.T) {
	h := newPushTestHandlers(t, nil, nil)

	rec := postJSON(t, h.SubscribePush, "/api/push/subscribe", subscribeBody(t, "https://fcm.googleapis.com/fcm/send/abc"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := listPushSubscriptions(); len(got) != 1 {
		t.Fatalf("stored %d subscriptions, want 1", len(got))
	}
}

// The endpoint is attacker-controlled input that the server later makes requests
// to, so anything that is not an https push URL must be refused.
func TestSubscribePushRejectsNonHTTPSEndpoints(t *testing.T) {
	h := newPushTestHandlers(t, nil, nil)

	for _, endpoint := range []string{
		"http://push.example.com/abc",
		"http://127.0.0.1:8099/internal",
		"file:///etc/passwd",
		"ftp://example.com/x",
		"not a url",
		"",
	} {
		rec := postJSON(t, h.SubscribePush, "/api/push/subscribe", subscribeBody(t, endpoint))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("endpoint %q: status = %d, want 400", endpoint, rec.Code)
		}
	}
	if got := listPushSubscriptions(); len(got) != 0 {
		t.Errorf("a rejected endpoint was stored: %+v", got)
	}
}

// Keys that cannot be used for encryption must fail at subscribe time, where the
// user sees it, rather than silently dropping the first real alert.
func TestSubscribePushRejectsUnusableKeys(t *testing.T) {
	h := newPushTestHandlers(t, nil, nil)

	body := map[string]any{
		"endpoint": "https://fcm.googleapis.com/fcm/send/abc",
		"keys":     map[string]string{"p256dh": "not-a-key", "auth": "also-not"},
	}
	rec := postJSON(t, h.SubscribePush, "/api/push/subscribe", body)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// With the master switch off, subscribing must be refused: otherwise a device
// would believe it is registered while nothing will ever be sent.
func TestSubscribePushRequiresEnabled(t *testing.T) {
	h := newPushTestHandlers(t, nil, func(s *Settings) { s.PushNotifyEnabled = false })

	rec := postJSON(t, h.SubscribePush, "/api/push/subscribe", subscribeBody(t, "https://fcm.googleapis.com/fcm/send/abc"))
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
}

func TestUnsubscribePushRemovesDevice(t *testing.T) {
	h := newPushTestHandlers(t, nil, nil)

	endpoint := "https://fcm.googleapis.com/fcm/send/abc"
	if rec := postJSON(t, h.SubscribePush, "/api/push/subscribe", subscribeBody(t, endpoint)); rec.Code != http.StatusOK {
		t.Fatalf("subscribe failed: %s", rec.Body.String())
	}

	rec := postJSON(t, h.UnsubscribePush, "/api/push/unsubscribe", map[string]string{"endpoint": endpoint})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := listPushSubscriptions(); len(got) != 0 {
		t.Errorf("subscription survived unsubscribe: %+v", got)
	}
}

func TestUnsubscribePushRequiresIdentifier(t *testing.T) {
	h := newPushTestHandlers(t, nil, nil)

	rec := postJSON(t, h.UnsubscribePush, "/api/push/unsubscribe", map[string]string{})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestPushPublicKeyReportsDisabled(t *testing.T) {
	h := newPushTestHandlers(t, nil, func(s *Settings) { s.PushNotifyEnabled = false })

	rec := httptest.NewRecorder()
	h.PushPublicKey(rec, httptest.NewRequest(http.MethodGet, "/api/push/public-key", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var resp pushPublicKeyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Enabled {
		t.Error("enabled = true with push turned off")
	}
	// No key is minted while push is off, so enabling it later is what generates
	// the pair — and the client has nothing to subscribe with in the meantime.
	if resp.PublicKey != "" {
		t.Error("a public key was returned while push is disabled")
	}
}

func TestPushPublicKeyReturnsStableKey(t *testing.T) {
	h := newPushTestHandlers(t, nil, nil)

	get := func() pushPublicKeyResponse {
		rec := httptest.NewRecorder()
		h.PushPublicKey(rec, httptest.NewRequest(http.MethodGet, "/api/push/public-key", nil))
		var resp pushPublicKeyResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return resp
	}

	first := get()
	if !first.Enabled || first.PublicKey == "" {
		t.Fatalf("expected an enabled response with a key, got %+v", first)
	}
	if second := get(); second.PublicKey != first.PublicKey {
		t.Error("public key changed between requests; subscriptions would break")
	}
}

// The device list is rendered in config, so it must never leak the endpoint or
// the encryption keys.
func TestListPushDevicesOmitsSecrets(t *testing.T) {
	h := newPushTestHandlers(t, nil, nil)

	endpoint := "https://fcm.googleapis.com/fcm/send/secret-token"
	if rec := postJSON(t, h.SubscribePush, "/api/push/subscribe", subscribeBody(t, endpoint)); rec.Code != http.StatusOK {
		t.Fatalf("subscribe failed: %s", rec.Body.String())
	}

	rec := httptest.NewRecorder()
	h.ListPushDevices(rec, httptest.NewRequest(http.MethodGet, "/api/push/devices", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	body := rec.Body.String()
	for _, secret := range []string{"secret-token", "p256dh", "auth", "endpoint"} {
		if bytes.Contains([]byte(body), []byte(secret)) {
			t.Errorf("device list leaked %q: %s", secret, body)
		}
	}

	var resp struct {
		Devices []pushDeviceView `json:"devices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Devices) != 1 || resp.Devices[0].Label != "Chrome on macOS" {
		t.Errorf("devices = %+v", resp.Devices)
	}
}

func TestTestPushNotificationRequiresSubscribers(t *testing.T) {
	h := newPushTestHandlers(t, nil, nil)

	rec := postJSON(t, h.TestPushNotification, "/api/push/test", map[string]string{})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 when no device is subscribed", rec.Code)
	}
}

func TestPushServiceWorkerIsServedFromRoot(t *testing.T) {
	h := newPushTestHandlers(t, nil, nil)
	h.files = embeddedFiles

	rec := httptest.NewRecorder()
	h.PushServiceWorker(rec, httptest.NewRequest(http.MethodGet, "/push-service-worker.js", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/javascript; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	// A cached worker would keep an old push handler alive across updates.
	if cc := rec.Header().Get("Cache-Control"); cc == "" || !bytes.Contains([]byte(cc), []byte("no-store")) {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("addEventListener('push'")) {
		t.Error("served file does not look like the push service worker")
	}
}
