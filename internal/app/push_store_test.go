package app

import (
	"os"
	"strings"
	"testing"
	"time"
)

// withTempPushData points the data dir at a temp directory so the tests never
// touch the real push-subscriptions.json.
func withTempPushData(t *testing.T) {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
}

func testSubscription(t *testing.T, endpoint string) PushSubscription {
	t.Helper()
	p256dh, auth, _, _ := newTestSubscriptionKeys(t)
	return PushSubscription{Endpoint: endpoint, P256dh: p256dh, Auth: auth}
}

func TestSavePushSubscriptionRoundTrip(t *testing.T) {
	withTempPushData(t)

	sub := testSubscription(t, "https://push.example.com/abc")
	sub.Label = "Firefox on Linux"
	if err := savePushSubscription(sub); err != nil {
		t.Fatalf("savePushSubscription: %v", err)
	}

	stored := listPushSubscriptions()
	if len(stored) != 1 {
		t.Fatalf("stored %d subscriptions, want 1", len(stored))
	}
	if stored[0].Endpoint != sub.Endpoint || stored[0].Label != "Firefox on Linux" {
		t.Errorf("stored subscription = %+v", stored[0])
	}
	if stored[0].CreatedAt == 0 || stored[0].LastSeen == 0 {
		t.Error("timestamps should be set on save")
	}
}

// Re-subscribing the same browser must update its entry, not add a second one:
// browsers re-register on every load, so duplicates would grow without bound.
func TestSavePushSubscriptionDeduplicatesByEndpoint(t *testing.T) {
	withTempPushData(t)

	sub := testSubscription(t, "https://push.example.com/abc")
	sub.Label = "First"
	if err := savePushSubscription(sub); err != nil {
		t.Fatalf("first save: %v", err)
	}
	created := listPushSubscriptions()[0].CreatedAt

	again := testSubscription(t, "https://push.example.com/abc")
	again.Label = "Second"
	if err := savePushSubscription(again); err != nil {
		t.Fatalf("second save: %v", err)
	}

	stored := listPushSubscriptions()
	if len(stored) != 1 {
		t.Fatalf("stored %d subscriptions, want 1 after re-subscribing", len(stored))
	}
	if stored[0].Label != "Second" {
		t.Errorf("label = %q, want the refreshed value", stored[0].Label)
	}
	// The original opt-in time is what the config list shows; refreshing must not
	// reset it.
	if stored[0].CreatedAt != created {
		t.Errorf("CreatedAt changed on refresh: %d -> %d", created, stored[0].CreatedAt)
	}
}

func TestSavePushSubscriptionRejectsIncomplete(t *testing.T) {
	withTempPushData(t)

	valid := testSubscription(t, "https://push.example.com/abc")
	tests := []struct {
		name string
		sub  PushSubscription
	}{
		{"no endpoint", PushSubscription{P256dh: valid.P256dh, Auth: valid.Auth}},
		{"no keys", PushSubscription{Endpoint: "https://push.example.com/x"}},
		{"no auth", PushSubscription{Endpoint: "https://push.example.com/x", P256dh: valid.P256dh}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := savePushSubscription(tc.sub); err == nil {
				t.Error("expected an error, got nil")
			}
		})
	}
}

func TestDeletePushSubscription(t *testing.T) {
	withTempPushData(t)

	endpoint := "https://push.example.com/abc"
	if err := savePushSubscription(testSubscription(t, endpoint)); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := savePushSubscription(testSubscription(t, "https://push.example.com/other")); err != nil {
		t.Fatalf("save other: %v", err)
	}

	removed, err := deletePushSubscriptionByEndpoint(endpoint)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if !removed {
		t.Error("removed = false, want true")
	}
	stored := listPushSubscriptions()
	if len(stored) != 1 || stored[0].Endpoint == endpoint {
		t.Errorf("wrong subscription removed: %+v", stored)
	}

	// Deleting something absent is not an error; it just reports no change.
	removed, err = deletePushSubscriptionByEndpoint(endpoint)
	if err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if removed {
		t.Error("removed = true for an already-deleted subscription")
	}
}

// A push service reporting 404/410 means the subscription is dead; keeping it
// would retry forever against an endpoint that can never accept again.
func TestRecordPushDeliveryResultsDropsGone(t *testing.T) {
	withTempPushData(t)

	gone := testSubscription(t, "https://push.example.com/gone")
	kept := testSubscription(t, "https://push.example.com/kept")
	for _, s := range []PushSubscription{gone, kept} {
		if err := savePushSubscription(s); err != nil {
			t.Fatalf("save: %v", err)
		}
	}

	recordPushDeliveryResults(map[string]pushDeliveryOutcome{
		pushSubscriptionID(gone.Endpoint): pushDeliveryGone,
		pushSubscriptionID(kept.Endpoint): pushDeliveryOK,
	})

	stored := listPushSubscriptions()
	if len(stored) != 1 {
		t.Fatalf("stored %d subscriptions, want 1", len(stored))
	}
	if stored[0].Endpoint != kept.Endpoint {
		t.Errorf("kept the wrong subscription: %s", stored[0].Endpoint)
	}
}

// A transient failure must not drop a device on the first error — a phone that
// is briefly unreachable should still be there when it comes back.
func TestRecordPushDeliveryResultsTolerateTransientFailures(t *testing.T) {
	withTempPushData(t)

	sub := testSubscription(t, "https://push.example.com/flaky")
	if err := savePushSubscription(sub); err != nil {
		t.Fatalf("save: %v", err)
	}
	id := pushSubscriptionID(sub.Endpoint)

	for i := 1; i < maxPushDeliveryFailures; i++ {
		recordPushDeliveryResults(map[string]pushDeliveryOutcome{id: pushDeliveryFailed})
		stored := listPushSubscriptions()
		if len(stored) != 1 {
			t.Fatalf("dropped after %d transient failures, want it kept until %d", i, maxPushDeliveryFailures)
		}
		if stored[0].FailureCount != i {
			t.Errorf("FailureCount = %d, want %d", stored[0].FailureCount, i)
		}
	}

	// One more failure crosses the threshold and retires the subscription.
	recordPushDeliveryResults(map[string]pushDeliveryOutcome{id: pushDeliveryFailed})
	if stored := listPushSubscriptions(); len(stored) != 0 {
		t.Errorf("subscription survived %d failures: %+v", maxPushDeliveryFailures, stored)
	}
}

// A success in between must clear the count, so an occasional blip never adds up
// to an eviction over weeks.
func TestRecordPushDeliveryResultsResetsOnSuccess(t *testing.T) {
	withTempPushData(t)

	sub := testSubscription(t, "https://push.example.com/flaky")
	if err := savePushSubscription(sub); err != nil {
		t.Fatalf("save: %v", err)
	}
	id := pushSubscriptionID(sub.Endpoint)

	recordPushDeliveryResults(map[string]pushDeliveryOutcome{id: pushDeliveryFailed})
	recordPushDeliveryResults(map[string]pushDeliveryOutcome{id: pushDeliveryFailed})
	recordPushDeliveryResults(map[string]pushDeliveryOutcome{id: pushDeliveryOK})

	stored := listPushSubscriptions()
	if len(stored) != 1 {
		t.Fatalf("stored %d subscriptions, want 1", len(stored))
	}
	if stored[0].FailureCount != 0 {
		t.Errorf("FailureCount = %d after a success, want 0", stored[0].FailureCount)
	}
}

func TestPruneSubscriptionsDropsStaleAndEnforcesCap(t *testing.T) {
	now := time.Now()
	stale := PushSubscription{ID: "stale", LastSeen: now.Add(-pushSubscriptionMaxAge - time.Hour).UnixMilli()}
	fresh := PushSubscription{ID: "fresh", LastSeen: now.UnixMilli()}

	got := pruneSubscriptions([]PushSubscription{stale, fresh})
	if len(got) != 1 || got[0].ID != "fresh" {
		t.Errorf("stale subscription not pruned: %+v", got)
	}

	// Over the cap, the least recently seen is evicted first.
	many := make([]PushSubscription, 0, maxPushSubscriptions+5)
	for i := 0; i < maxPushSubscriptions+5; i++ {
		many = append(many, PushSubscription{
			ID:       string(rune('a' + i%26)),
			LastSeen: now.Add(-time.Duration(i) * time.Minute).UnixMilli(),
		})
	}
	got = pruneSubscriptions(many)
	if len(got) != maxPushSubscriptions {
		t.Errorf("pruned to %d, want the cap of %d", len(got), maxPushSubscriptions)
	}
}

// The VAPID pair must be generated once and then reused: regenerating it would
// invalidate every subscription stored beside it.
func TestEnsureVAPIDKeysIsStable(t *testing.T) {
	withTempPushData(t)

	first, err := ensureVAPIDKeys()
	if err != nil {
		t.Fatalf("ensureVAPIDKeys: %v", err)
	}
	if first.PublicKey == "" || first.PrivateKey == "" {
		t.Fatal("generated keys are empty")
	}

	second, err := ensureVAPIDKeys()
	if err != nil {
		t.Fatalf("second ensureVAPIDKeys: %v", err)
	}
	if first.PublicKey != second.PublicKey || first.PrivateKey != second.PrivateKey {
		t.Error("VAPID keys were regenerated; existing subscriptions would break")
	}
}

// Subscriptions must survive a key generation and vice versa — they share a file,
// so a careless write of one could clear the other.
func TestVAPIDKeysAndSubscriptionsCoexist(t *testing.T) {
	withTempPushData(t)

	keys, err := ensureVAPIDKeys()
	if err != nil {
		t.Fatalf("ensureVAPIDKeys: %v", err)
	}
	if err := savePushSubscription(testSubscription(t, "https://push.example.com/abc")); err != nil {
		t.Fatalf("save: %v", err)
	}

	after, err := ensureVAPIDKeys()
	if err != nil {
		t.Fatalf("ensureVAPIDKeys after save: %v", err)
	}
	if after.PublicKey != keys.PublicKey {
		t.Error("saving a subscription clobbered the VAPID keys")
	}
	if len(listPushSubscriptions()) != 1 {
		t.Error("subscription lost")
	}
}

// A corrupt file must not take down a monitor run: the store degrades to empty
// rather than returning an error to callers that cannot handle one.
func TestReadPushSubscriptionsToleratesCorruptFile(t *testing.T) {
	withTempPushData(t)

	if err := os.WriteFile(pushSubscriptionsFilePath(), []byte("{not json"), 0644); err != nil {
		t.Fatalf("write corrupt file: %v", err)
	}
	if got := listPushSubscriptions(); len(got) != 0 {
		t.Errorf("expected an empty list from a corrupt file, got %+v", got)
	}
}

func TestPushSubscriptionIDIsStableAndDistinct(t *testing.T) {
	a := pushSubscriptionID("https://push.example.com/abc")
	if a != pushSubscriptionID("https://push.example.com/abc") {
		t.Error("id is not stable for the same endpoint")
	}
	if a == pushSubscriptionID("https://push.example.com/def") {
		t.Error("different endpoints produced the same id")
	}
	// The id is surfaced in the config UI and used in notification tags, so it
	// must stay free of characters that would need escaping.
	if strings.ContainsAny(a, "+/=") {
		t.Errorf("id %q contains characters outside the URL-safe alphabet", a)
	}
}

func TestSanitizeDeviceLabel(t *testing.T) {
	if got := sanitizeDeviceLabel("  Chrome on macOS  "); got != "Chrome on macOS" {
		t.Errorf("label = %q", got)
	}
	if got := sanitizeDeviceLabel("bad\x00label\n"); got != "badlabel" {
		t.Errorf("control characters not stripped: %q", got)
	}
	long := strings.Repeat("x", 200)
	if got := sanitizeDeviceLabel(long); len([]rune(got)) != 60 {
		t.Errorf("label length = %d, want it capped at 60", len([]rune(got)))
	}
}
