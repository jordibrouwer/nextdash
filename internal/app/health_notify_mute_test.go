package app

import (
	"testing"
	"time"
)

// Per-bookmark muting silences a bookmark's alerts without silencing its
// checks. The distinction is the whole point: the sample is still recorded, the
// row still reads as down, and only the outbound message is withheld.
//
// The subtle rule is that a muted outage must not be *marked* as alerted.
// pendingMonitorNotifications stamps the stored sample when it decides to
// alert, and currentOutageAlerted reads that stamp to avoid re-alerting the
// same outage. If muting merely filtered the result after that bookkeeping,
// un-muting mid-outage would find the outage already "handled" and stay silent
// until the next one — which is indistinguishable from the feature being
// broken, and only at the moment someone actually wanted the alert.

const muteTestSettings = `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":3}`

// seedOutage stores enough prior failures that the next failing check crosses
// the alert threshold.
func seedOutage(t *testing.T, h *Handlers, key string, now time.Time) {
	t.Helper()
	if err := h.appendHealthSamples(map[string][]HealthSample{
		key: {
			{T: msAgo(now, 15*time.Minute), Up: false},
			{T: msAgo(now, 10*time.Minute), Up: false},
		},
	}); err != nil {
		t.Fatalf("append history for %s: %v", key, err)
	}
}

func TestMutedBookmarkRaisesNoNotification(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, muteTestSettings)
	now := time.Now()
	seedOutage(t, h, "https://a.example", now)

	got := h.pendingMonitorNotifications([]monitorTransition{{
		key: "https://a.example", url: "https://a.example", name: "A",
		up: false, reason: "HTTP 503", at: now.UnixMilli(), muted: true,
	}})
	if len(got) != 0 {
		t.Fatalf("muted bookmark produced %d notification(s): %#v", len(got), got)
	}
}

// The unmuted control: the same history and the same transition must alert, so
// the test above is proving the mute did it rather than the fixture.
func TestUnmutedBookmarkStillNotifies(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, muteTestSettings)
	now := time.Now()
	seedOutage(t, h, "https://a.example", now)

	got := h.pendingMonitorNotifications([]monitorTransition{{
		key: "https://a.example", url: "https://a.example", name: "A",
		up: false, reason: "HTTP 503", at: now.UnixMilli(),
	}})
	if len(got) != 1 {
		t.Fatalf("unmuted bookmark produced %d notification(s), want 1", len(got))
	}
}

// Muting one bookmark must not silence the others in the same round. A shared
// outage where only one row is muted should still alert for the rest.
func TestMuteIsPerBookmarkNotPerRound(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, muteTestSettings)
	now := time.Now()
	seedOutage(t, h, "https://muted.example", now)
	seedOutage(t, h, "https://loud.example", now)

	got := h.pendingMonitorNotifications([]monitorTransition{
		{key: "https://muted.example", url: "https://muted.example", name: "Muted",
			up: false, reason: "HTTP 503", at: now.UnixMilli(), muted: true},
		{key: "https://loud.example", url: "https://loud.example", name: "Loud",
			up: false, reason: "HTTP 503", at: now.UnixMilli()},
	})
	if len(got) != 1 {
		t.Fatalf("got %d notification(s), want exactly the unmuted one: %#v", len(got), got)
	}
	if got[0].Name != "Loud" {
		t.Errorf("notified about %q, want the unmuted bookmark", got[0].Name)
	}
}

// The rule that makes muting reversible: a muted outage leaves no "already
// alerted" stamp behind, so un-muting during that same outage still alerts.
func TestMutedOutageDoesNotConsumeItsAlert(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, muteTestSettings)
	now := time.Now()
	seedOutage(t, h, "https://a.example", now)

	transition := monitorTransition{
		key: "https://a.example", url: "https://a.example", name: "A",
		up: false, reason: "HTTP 503", at: now.UnixMilli(), muted: true,
	}
	if got := h.pendingMonitorNotifications([]monitorTransition{transition}); len(got) != 0 {
		t.Fatalf("muted round alerted: %#v", got)
	}

	// Same ongoing outage, now unmuted: the alert must still be available.
	transition.muted = false
	got := h.pendingMonitorNotifications([]monitorTransition{transition})
	if len(got) != 1 {
		t.Fatalf("un-muting mid-outage produced %d notification(s), want 1 — "+
			"the muted round consumed the alert", len(got))
	}
}
