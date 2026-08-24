package main

import (
	"strings"
	"testing"
)

// Collapsing a burst into one digest.
//
// The shape this guards against: one upstream failing takes every bookmark
// behind it down in the same sweep, and alerting per bookmark then posts a
// dozen near-identical messages within a second — the exact pattern Slack and
// Telegram rate-limit, so the alerts get dropped rather than delivered.
//
// The rules that matter are about when *not* to collapse. Under the threshold
// the individual messages are strictly better, since they name the bookmark and
// its error, and a mixed round must stay expanded because a digest reading "3
// events" over one recovery and one certificate warning says less than the
// messages it replaced.

func downNotifications(n int) []monitorNotification {
	out := make([]monitorNotification, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, monitorNotification{
			Event: "down", Name: string(rune('A' + i)), URL: "https://x.example",
			Status: "offline", Error: "HTTP 503", At: 1, Failures: 3,
		})
	}
	return out
}

func TestCollapseLeavesSmallRoundsAlone(t *testing.T) {
	for n := 0; n < monitorDigestThreshold; n++ {
		in := downNotifications(n)
		got := collapseMonitorNotifications(in)
		if len(got) != n {
			t.Errorf("round of %d collapsed to %d, want it left alone", n, len(got))
		}
	}
}

func TestCollapseFlattensABurst(t *testing.T) {
	got := collapseMonitorNotifications(downNotifications(12))
	if len(got) != 1 {
		t.Fatalf("burst of 12 produced %d message(s), want 1 digest", len(got))
	}
	if got[0].Event != "down" {
		t.Errorf("digest event = %q, want down", got[0].Event)
	}
	// The count belongs in the digest, since that is the fact the individual
	// messages no longer carry.
	if !strings.Contains(got[0].Name, "12") {
		t.Errorf("digest name %q does not state how many bookmarks", got[0].Name)
	}
	// Enough names to recognise which corner of the collection went down.
	if !strings.Contains(got[0].Error, "A") || !strings.Contains(got[0].Error, "more") {
		t.Errorf("digest summary %q should name the first few and count the rest", got[0].Error)
	}
}

// A round mixing kinds stays expanded: a digest over a recovery and an outage
// would describe neither.
func TestCollapseKeepsMixedRoundsExpanded(t *testing.T) {
	mixed := downNotifications(5)
	mixed[2].Event = "up"
	mixed[2].Status = "online"

	got := collapseMonitorNotifications(mixed)
	if len(got) != len(mixed) {
		t.Fatalf("mixed round of %d collapsed to %d, want it left alone", len(mixed), len(got))
	}
}

// Recoveries burst the same way outages do — one upstream coming back brings
// everything with it — so they collapse under the same rule.
func TestCollapseFlattensARecoveryBurst(t *testing.T) {
	ups := downNotifications(8)
	for i := range ups {
		ups[i].Event = "up"
		ups[i].Status = "online"
	}
	got := collapseMonitorNotifications(ups)
	if len(got) != 1 {
		t.Fatalf("recovery burst produced %d message(s), want 1 digest", len(got))
	}
	if got[0].Event != "up" {
		t.Errorf("digest event = %q, want up", got[0].Event)
	}
}

// Certificate warnings are already deduplicated per host and arrive on a
// threshold crossing rather than a sweep, so a run of them is not the burst
// this exists to flatten — and each names a different host, which a digest
// would throw away.
func TestCollapseLeavesCertificateWarningsAlone(t *testing.T) {
	certs := downNotifications(6)
	for i := range certs {
		certs[i].Event = "cert-expiring"
		certs[i].Status = "warning"
	}
	got := collapseMonitorNotifications(certs)
	if len(got) != len(certs) {
		t.Fatalf("certificate round of %d collapsed to %d, want it left alone", len(certs), len(got))
	}
}
