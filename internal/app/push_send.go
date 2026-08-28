package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// pushSendTimeout bounds one delivery. Push services are expected to answer
	// quickly; a slow one must not hold up a monitor run.
	pushSendTimeout = 10 * time.Second
	// pushTTLSeconds asks the push service to hold an undelivered message for a
	// day, so a phone that is off overnight still gets the outage alert.
	pushTTLSeconds = 86400
	// maxPushDeliveryFailures is how many consecutive transient failures a
	// subscription survives before it is dropped as dead.
	maxPushDeliveryFailures = 5
	// maxConcurrentPushSends bounds parallel deliveries, mirroring the ceiling
	// the monitor puts on outbound pings.
	maxConcurrentPushSends = 4
)

// pushDeliveryOutcome is the per-subscription result of one send.
type pushDeliveryOutcome int

const (
	pushDeliveryOK pushDeliveryOutcome = iota
	// pushDeliveryFailed is a transient problem: network error, 5xx, throttling.
	pushDeliveryFailed
	// pushDeliveryGone means the push service says this subscription is dead and
	// it should be removed.
	pushDeliveryGone
)

func logPushError(format string, args ...any) {
	logWarn(logComponentNotify, format, args...)
}

// webPushMessage is the JSON the service worker receives and renders.
type webPushMessage struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
	// Tag collapses related notifications: a second alert for the same monitor
	// replaces the first rather than stacking.
	Tag string `json:"tag,omitempty"`
	// URL is where a click takes the user.
	URL string `json:"url,omitempty"`
	// Kind lets the service worker and the UI distinguish categories
	// ("monitor", "backup", "release").
	Kind string `json:"kind,omitempty"`
	// Renotify asks the OS to alert again for a replaced tag, used for outages.
	Renotify bool  `json:"renotify,omitempty"`
	At       int64 `json:"at,omitempty"`
}

// sendWebPushNotification encrypts and delivers one message to every stored
// subscription.
//
// Best-effort by design, exactly like the existing webhook dispatch: a broken
// push service must never fail a monitor run, so every error is logged and the
// remaining devices are still tried.
func (h *Handlers) sendWebPushNotification(ctx context.Context, msg webPushMessage) {
	subs := listPushSubscriptions()
	if len(subs) == 0 {
		return
	}

	keys, err := ensureVAPIDKeys()
	if err != nil {
		logPushError("no VAPID keys available: %v", err)
		return
	}

	if msg.At == 0 {
		msg.At = time.Now().UnixMilli()
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		logPushError("failed to encode message: %v", err)
		return
	}

	subject := h.vapidSubject()
	// Push endpoints are third-party HTTPS URLs, not user-supplied bookmark
	// targets, so they use a plain client rather than the SSRF-guarded one: the
	// guard would reject nothing here and its local-address rules do not apply.
	client := &http.Client{Timeout: pushSendTimeout}

	results := make(map[string]pushDeliveryOutcome, len(subs))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxConcurrentPushSends)

	for _, sub := range subs {
		wg.Add(1)
		go func(sub PushSubscription) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			outcome := deliverWebPush(ctx, client, keys, subject, sub, payload)
			mu.Lock()
			results[sub.ID] = outcome
			mu.Unlock()
		}(sub)
	}
	wg.Wait()

	recordPushDeliveryResults(results)
}

// vapidSubject is the contact address sent in the VAPID claim. Push services
// want a way to reach the operator; the configured webhook-style contact is
// reused when set, otherwise a generic mailto keeps the claim well-formed.
func (h *Handlers) vapidSubject() string {
	settings := h.store.GetSettings()
	if s := strings.TrimSpace(settings.PushNotifySubject); s != "" {
		return s
	}
	return "mailto:admin@localhost"
}

// deliverWebPush encrypts the payload for one subscription and posts it.
func deliverWebPush(ctx context.Context, client *http.Client, keys vapidKeys, subject string, sub PushSubscription, payload []byte) pushDeliveryOutcome {
	body, err := encryptPushPayload(sub.P256dh, sub.Auth, payload)
	if err != nil {
		// A subscription whose keys will not parse can never work again, so treat
		// it as gone rather than retrying it forever.
		logPushError("encryption failed for %s: %v", sub.ID, err)
		return pushDeliveryGone
	}

	token, publicKey, err := signVAPIDToken(keys, sub.Endpoint, subject)
	if err != nil {
		logPushError("VAPID signing failed for %s: %v", sub.ID, err)
		return pushDeliveryFailed
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		logPushError("failed to build request for %s: %v", sub.ID, err)
		return pushDeliveryFailed
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("TTL", strconv.Itoa(pushTTLSeconds))
	// "Urgency: high" keeps outage alerts from being deferred while a phone is
	// dozing; push services otherwise batch normal-urgency messages.
	req.Header.Set("Urgency", "high")
	req.Header.Set("Authorization", "vapid t="+token+", k="+publicKey)

	resp, err := client.Do(req)
	if err != nil {
		logPushError("delivery failed for %s: %v", sub.ID, err)
		return pushDeliveryFailed
	}
	defer drainAndCloseResponse(resp)

	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		// The browser dropped this subscription; stop sending to it.
		return pushDeliveryGone
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return pushDeliveryOK
	default:
		logPushError("push service returned HTTP %d for %s", resp.StatusCode, sub.ID)
		return pushDeliveryFailed
	}
}
