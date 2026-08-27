package app

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	// maxPushSubscriptions bounds the file. Each browser profile that grants
	// permission adds one entry, so this is generous for a self-hosted dashboard
	// while stopping a misbehaving client from growing the file without bound.
	maxPushSubscriptions = 50
	// pushSubscriptionMaxAge prunes subscriptions that have not been refreshed.
	// Browsers re-subscribe on every load of a page that has permission, so an
	// entry this old belongs to a profile that is gone.
	pushSubscriptionMaxAge = 180 * 24 * time.Hour
)

// pushMu serializes read-modify-write cycles on the subscriptions file. Both the
// HTTP handlers and the notification dispatcher touch it, and a lost update here
// means a device silently stops receiving alerts.
var pushMu sync.Mutex

// PushSubscription is one browser's push endpoint, as reported by the
// PushSubscription object in the service worker.
type PushSubscription struct {
	// ID is derived from the endpoint so re-subscribing the same browser updates
	// its entry instead of adding a duplicate.
	ID       string `json:"id"`
	Endpoint string `json:"endpoint"`
	// P256dh and Auth are the subscription's encryption keys.
	P256dh string `json:"p256dh"`
	Auth   string `json:"auth"`
	// Label is a human-readable hint (browser/OS) so the operator can tell
	// devices apart in the config UI.
	Label     string `json:"label,omitempty"`
	CreatedAt int64  `json:"createdAt"`
	// LastSeen is refreshed whenever the browser re-registers.
	LastSeen int64 `json:"lastSeen"`
	// FailureCount tracks consecutive delivery failures that were not outright
	// rejections, so a temporarily unreachable device is retried rather than
	// dropped on the first error.
	FailureCount int `json:"failureCount,omitempty"`
}

// PushSubscriptionsFile is the on-disk shape of push-subscriptions.json.
type PushSubscriptionsFile struct {
	GeneratedAt   int64              `json:"generatedAt"`
	Keys          *vapidKeys         `json:"vapidKeys,omitempty"`
	Subscriptions []PushSubscription `json:"subscriptions"`
}

func emptyPushSubscriptions() PushSubscriptionsFile {
	return PushSubscriptionsFile{
		GeneratedAt:   time.Now().UnixMilli(),
		Subscriptions: []PushSubscription{},
	}
}

// pushSubscriptionID fingerprints an endpoint. Endpoints are long and contain a
// per-browser token, so hashing keeps the file readable and avoids repeating the
// token in an id field.
func pushSubscriptionID(endpoint string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(endpoint)))
	return base64.RawURLEncoding.EncodeToString(sum[:12])
}

// readPushSubscriptionsFile loads the store. A missing or corrupt file yields an
// empty set rather than an error: losing subscriptions costs the operator a
// re-grant, but failing here would take down the monitor run that called it.
func readPushSubscriptionsFile() PushSubscriptionsFile {
	data, err := os.ReadFile(pushSubscriptionsFilePath())
	if err != nil {
		return emptyPushSubscriptions()
	}
	var file PushSubscriptionsFile
	if err := json.Unmarshal(data, &file); err != nil {
		return emptyPushSubscriptions()
	}
	if file.Subscriptions == nil {
		file.Subscriptions = []PushSubscription{}
	}
	return file
}

func writePushSubscriptionsFile(file PushSubscriptionsFile) error {
	file.GeneratedAt = time.Now().UnixMilli()
	if file.Subscriptions == nil {
		file.Subscriptions = []PushSubscription{}
	}
	return writeIndentJSONFile(pushSubscriptionsFilePath(), file)
}

// ensureVAPIDKeys returns the server's key pair, generating and persisting one on
// first use. Callers hold pushMu.
//
// The pair lives in the subscriptions file rather than in settings because the
// two are inseparable: rotating the key invalidates every subscription stored
// beside it, and keeping them together makes that impossible to get wrong.
func ensureVAPIDKeysLocked() (vapidKeys, error) {
	file := readPushSubscriptionsFile()
	if file.Keys != nil && strings.TrimSpace(file.Keys.PublicKey) != "" && strings.TrimSpace(file.Keys.PrivateKey) != "" {
		return *file.Keys, nil
	}
	keys, err := generateVAPIDKeys()
	if err != nil {
		return vapidKeys{}, err
	}
	file.Keys = &keys
	if err := writePushSubscriptionsFile(file); err != nil {
		return vapidKeys{}, err
	}
	return keys, nil
}

// ensureVAPIDKeys is the locking wrapper around ensureVAPIDKeysLocked.
func ensureVAPIDKeys() (vapidKeys, error) {
	pushMu.Lock()
	defer pushMu.Unlock()
	return ensureVAPIDKeysLocked()
}

// listPushSubscriptions returns the stored subscriptions.
func listPushSubscriptions() []PushSubscription {
	pushMu.Lock()
	defer pushMu.Unlock()
	return readPushSubscriptionsFile().Subscriptions
}

// savePushSubscription inserts or refreshes one subscription, keyed by endpoint.
func savePushSubscription(sub PushSubscription) error {
	sub.Endpoint = strings.TrimSpace(sub.Endpoint)
	if sub.Endpoint == "" {
		return errors.New("subscription endpoint is required")
	}
	if strings.TrimSpace(sub.P256dh) == "" || strings.TrimSpace(sub.Auth) == "" {
		return errors.New("subscription keys are required")
	}

	pushMu.Lock()
	defer pushMu.Unlock()

	file := readPushSubscriptionsFile()
	now := time.Now().UnixMilli()
	sub.ID = pushSubscriptionID(sub.Endpoint)
	sub.LastSeen = now
	sub.FailureCount = 0

	for i, existing := range file.Subscriptions {
		if existing.ID == sub.ID {
			// Preserve the original creation time so the config list keeps showing
			// when the device first opted in.
			sub.CreatedAt = existing.CreatedAt
			if sub.Label == "" {
				sub.Label = existing.Label
			}
			file.Subscriptions[i] = sub
			return writePushSubscriptionsFile(file)
		}
	}

	sub.CreatedAt = now
	file.Subscriptions = append(file.Subscriptions, sub)
	file.Subscriptions = pruneSubscriptions(file.Subscriptions)
	return writePushSubscriptionsFile(file)
}

// pruneSubscriptions drops stale entries and enforces the cap, oldest-seen first.
func pruneSubscriptions(subs []PushSubscription) []PushSubscription {
	cutoff := time.Now().Add(-pushSubscriptionMaxAge).UnixMilli()
	kept := make([]PushSubscription, 0, len(subs))
	for _, s := range subs {
		if s.LastSeen > 0 && s.LastSeen < cutoff {
			continue
		}
		kept = append(kept, s)
	}
	// Over the cap, evict the least recently seen.
	for len(kept) > maxPushSubscriptions {
		oldest := 0
		for i, s := range kept {
			if s.LastSeen < kept[oldest].LastSeen {
				oldest = i
			}
		}
		kept = append(kept[:oldest], kept[oldest+1:]...)
	}
	return kept
}

// deletePushSubscriptionByEndpoint removes one device's subscription. Reports
// whether anything was removed so the handler can answer honestly.
func deletePushSubscriptionByEndpoint(endpoint string) (bool, error) {
	return deletePushSubscriptionByID(pushSubscriptionID(endpoint))
}

// deletePushSubscriptionByID removes a subscription by its derived id.
func deletePushSubscriptionByID(id string) (bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return false, errors.New("subscription id is required")
	}

	pushMu.Lock()
	defer pushMu.Unlock()

	file := readPushSubscriptionsFile()
	for i, s := range file.Subscriptions {
		if s.ID == id {
			file.Subscriptions = append(file.Subscriptions[:i], file.Subscriptions[i+1:]...)
			return true, writePushSubscriptionsFile(file)
		}
	}
	return false, nil
}

// recordPushDeliveryResults applies the outcome of a dispatch round: endpoints
// the push service rejected as gone are dropped, transient failures are counted,
// and successes reset the counter.
func recordPushDeliveryResults(results map[string]pushDeliveryOutcome) {
	if len(results) == 0 {
		return
	}

	pushMu.Lock()
	defer pushMu.Unlock()

	file := readPushSubscriptionsFile()
	kept := make([]PushSubscription, 0, len(file.Subscriptions))
	changed := false

	for _, s := range file.Subscriptions {
		outcome, ok := results[s.ID]
		if !ok {
			kept = append(kept, s)
			continue
		}
		switch outcome {
		case pushDeliveryGone:
			// 404/410 means the browser discarded the subscription for good.
			changed = true
			continue
		case pushDeliveryFailed:
			s.FailureCount++
			changed = true
			if s.FailureCount >= maxPushDeliveryFailures {
				continue
			}
		case pushDeliveryOK:
			if s.FailureCount != 0 {
				s.FailureCount = 0
				changed = true
			}
		}
		kept = append(kept, s)
	}

	if !changed {
		return
	}
	file.Subscriptions = kept
	if err := writePushSubscriptionsFile(file); err != nil {
		logPushError("failed to persist delivery results: %v", err)
	}
}
