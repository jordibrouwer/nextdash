package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// PushServiceWorker serves the push service worker from the site root.
//
// A worker can only control pages at or below its own URL, so serving this from
// /static/js/ would scope it to /static/ and leave the dashboard uncontrolled.
// The file itself still lives with the other JS; only its URL is special.
//
// Prefers the copy on disk for the same reason readWhatsNewIndex does: a
// development container with ./static mounted should serve what it actually has.
func (h *Handlers) PushServiceWorker(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(filepath.Join("static", "js", "push-service-worker.js"))
	if err != nil {
		data, err = h.files.ReadFile("static/js/push-service-worker.js")
	}
	if err != nil {
		http.Error(w, "Service worker unavailable", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	// The worker must never be served stale: a cached copy would keep an old push
	// handler alive across updates. Browsers bypass the HTTP cache for the worker
	// script itself on update checks, but proxies in front of nextDash do not.
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Write(data)
}

// pushPublicKeyResponse tells the browser whether push is usable and which
// application server key to subscribe with.
type pushPublicKeyResponse struct {
	Enabled   bool   `json:"enabled"`
	PublicKey string `json:"publicKey,omitempty"`
	// Subscriptions is how many devices are currently registered, so the config
	// UI can report "3 devices" without a second request.
	Subscriptions int `json:"subscriptions"`
}

// PushPublicKey returns the VAPID public key, generating the pair on first call.
//
// Safe to call unauthenticated-for-write: the public key is public by
// definition, and generating it on demand means the operator never has to run a
// key-generation step by hand.
func (h *Handlers) PushPublicKey(w http.ResponseWriter, r *http.Request) {
	settings := h.store.GetSettings()
	resp := pushPublicKeyResponse{Enabled: settings.PushNotifyEnabled}

	if resp.Enabled {
		keys, err := ensureVAPIDKeys()
		if err != nil {
			logPushError("failed to prepare VAPID keys: %v", err)
			http.Error(w, "Failed to prepare push keys", http.StatusInternalServerError)
			return
		}
		resp.PublicKey = keys.PublicKey
		resp.Subscriptions = len(listPushSubscriptions())
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(resp)
}

// pushSubscribeRequest is the browser's PushSubscription, flattened.
type pushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	Label string `json:"label"`
}

// SubscribePush registers or refreshes this browser's push subscription.
func (h *Handlers) SubscribePush(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.store.GetSettings().PushNotifyEnabled {
		http.Error(w, "Push notifications are disabled", http.StatusForbidden)
		return
	}

	var req pushSubscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	endpoint := strings.TrimSpace(req.Endpoint)
	if endpoint == "" {
		http.Error(w, "endpoint is required", http.StatusBadRequest)
		return
	}
	// Push endpoints are always HTTPS URLs owned by the browser vendor. Rejecting
	// anything else keeps a hostile client from turning the dispatcher into a
	// request forwarder aimed at the operator's own network.
	if _, err := vapidAudience(endpoint); err != nil || !strings.HasPrefix(strings.ToLower(endpoint), "https://") {
		http.Error(w, "endpoint must be an https URL", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Keys.P256dh) == "" || strings.TrimSpace(req.Keys.Auth) == "" {
		http.Error(w, "subscription keys are required", http.StatusBadRequest)
		return
	}

	sub := PushSubscription{
		Endpoint: endpoint,
		P256dh:   strings.TrimSpace(req.Keys.P256dh),
		Auth:     strings.TrimSpace(req.Keys.Auth),
		Label:    sanitizeDeviceLabel(req.Label),
	}
	// Encrypting a probe payload now surfaces malformed keys at subscribe time,
	// where the user sees the error, instead of silently dropping the first real
	// alert days later.
	if _, err := encryptPushPayload(sub.P256dh, sub.Auth, []byte(`{"probe":true}`)); err != nil {
		http.Error(w, "subscription keys are not usable", http.StatusBadRequest)
		return
	}

	if err := savePushSubscription(sub); err != nil {
		logPushError("failed to store subscription: %v", err)
		http.Error(w, "Failed to store subscription", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":       true,
		"id":            pushSubscriptionID(endpoint),
		"subscriptions": len(listPushSubscriptions()),
	})
}

// sanitizeDeviceLabel keeps the operator-facing device list readable and free of
// anything a client could smuggle in: labels come from the browser's user-agent
// hints and are rendered in config.
func sanitizeDeviceLabel(label string) string {
	label = strings.TrimSpace(label)
	if label == "" {
		return ""
	}
	label = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, label)
	if runes := []rune(label); len(runes) > 60 {
		label = string(runes[:60])
	}
	return label
}

// UnsubscribePush removes a device, by endpoint (the browser unsubscribing
// itself) or by id (the operator removing a device from config).
func (h *Handlers) UnsubscribePush(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		Endpoint string `json:"endpoint"`
		ID       string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	var (
		removed bool
		err     error
	)
	switch {
	case strings.TrimSpace(req.ID) != "":
		removed, err = deletePushSubscriptionByID(req.ID)
	case strings.TrimSpace(req.Endpoint) != "":
		removed, err = deletePushSubscriptionByEndpoint(req.Endpoint)
	default:
		http.Error(w, "endpoint or id is required", http.StatusBadRequest)
		return
	}
	if err != nil {
		logPushError("failed to remove subscription: %v", err)
		http.Error(w, "Failed to remove subscription", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":       true,
		"removed":       removed,
		"subscriptions": len(listPushSubscriptions()),
	})
}

// pushDeviceView is one registered device as shown in config, without the
// endpoint or keys — those are secrets that never need to reach the page.
type pushDeviceView struct {
	ID        string `json:"id"`
	Label     string `json:"label,omitempty"`
	CreatedAt int64  `json:"createdAt"`
	LastSeen  int64  `json:"lastSeen"`
}

// ListPushDevices returns the registered devices for the config UI.
func (h *Handlers) ListPushDevices(w http.ResponseWriter, r *http.Request) {
	subs := listPushSubscriptions()
	devices := make([]pushDeviceView, 0, len(subs))
	for _, s := range subs {
		devices = append(devices, pushDeviceView{
			ID:        s.ID,
			Label:     s.Label,
			CreatedAt: s.CreatedAt,
			LastSeen:  s.LastSeen,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{
		"enabled": h.store.GetSettings().PushNotifyEnabled,
		"devices": devices,
	})
}

// TestPushNotification sends a sample notification to every registered device so
// the operator can confirm the whole chain works before relying on it.
func (h *Handlers) TestPushNotification(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.store.GetSettings().PushNotifyEnabled {
		http.Error(w, "Push notifications are disabled", http.StatusForbidden)
		return
	}

	subs := listPushSubscriptions()
	if len(subs) == 0 {
		http.Error(w, "No devices are subscribed", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), pushSendTimeout+2*time.Second)
	defer cancel()
	h.sendWebPushNotification(ctx, webPushMessage{
		Title: "nextDash",
		Body:  "Test notification — push is working.",
		Tag:   "nextdash-test",
		Kind:  "test",
		URL:   "/",
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"sent":    len(subs),
	})
}
