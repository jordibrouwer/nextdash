package main

import (
	"testing"
	"time"
)

// Thresholds must fire once each, on the tightest mark the certificate has
// passed. Walking from the loose end instead turned one renewal into a message
// per round: 30 days now, 7 days on the next check, 3 on the one after.
func TestCertThresholdsAlertOncePerMark(t *testing.T) {
	now := time.Now()
	at := func(days int) int64 { return now.Add(time.Duration(days) * 24 * time.Hour).UnixMilli() }

	stored := map[string]HostCertificate{}
	seen := []PingResult{{CertHost: "a.example", CertExpiry: at(5)}}

	if got := recordHostCertificates(stored, seen, now); len(got) != 1 {
		t.Fatalf("first check: %d alerts, want 1", len(got))
	}
	// Five days left is past both 30 and 7, so both are marked and neither can
	// alert again.
	for round := 2; round <= 4; round++ {
		if got := recordHostCertificates(stored, seen, now); len(got) != 0 {
			t.Fatalf("check %d: %d alerts, want 0", round, len(got))
		}
	}

	// Decaying past the next mark is news again.
	later := now.Add(3 * 24 * time.Hour) // two days left
	if got := recordHostCertificates(stored, seen, later); len(got) != 1 {
		t.Fatalf("after crossing 3 days: %d alerts, want 1", len(got))
	}
}

// A renewal is a different certificate and has its own thresholds to cross;
// keeping the old marks would silence the next expiry entirely.
func TestCertRenewalRearmsAlerts(t *testing.T) {
	now := time.Now()
	at := func(days int) int64 { return now.Add(time.Duration(days) * 24 * time.Hour).UnixMilli() }

	stored := map[string]HostCertificate{}
	recordHostCertificates(stored, []PingResult{{CertHost: "a.example", CertExpiry: at(2)}}, now)
	if len(stored["a.example"].NotifiedDays) == 0 {
		t.Fatal("expected the first expiry to be marked as notified")
	}

	recordHostCertificates(stored, []PingResult{{CertHost: "a.example", CertExpiry: at(90)}}, now)
	if marks := stored["a.example"].NotifiedDays; len(marks) != 0 {
		t.Fatalf("after renewal: notified = %v, want empty", marks)
	}
	if got := recordHostCertificates(stored, []PingResult{{CertHost: "a.example", CertExpiry: at(5)}}, now); len(got) != 1 {
		t.Fatalf("renewed certificate nearing expiry: %d alerts, want 1", len(got))
	}
}

func TestCertSeverityAndReporting(t *testing.T) {
	now := time.Now()
	at := func(days int) int64 { return now.Add(time.Duration(days) * 24 * time.Hour).UnixMilli() }

	for _, tc := range []struct {
		days int
		want string
	}{{200, "ok"}, {40, "ok"}, {20, "warn"}, {2, "urgent"}, {-1, "expired"}} {
		if got := certSeverity(at(tc.days), now); got != tc.want {
			t.Errorf("severity at %d days = %q, want %q", tc.days, got, tc.want)
		}
	}
	// Plain HTTP has nothing to say, which must not read as "expired".
	if got := certSeverity(0, now); got != "" {
		t.Errorf("severity with no certificate = %q, want empty", got)
	}

	// Only the ones worth showing reach the report.
	stored := map[string]HostCertificate{
		"far.example":  {Host: "far.example", ExpiresAt: at(200)},
		"soon.example": {Host: "soon.example", ExpiresAt: at(10)},
	}
	got := expiringCertificates(stored, now)
	if _, ok := got["far.example"]; ok {
		t.Error("a certificate with 200 days left should not be reported")
	}
	if _, ok := got["soon.example"]; !ok {
		t.Error("a certificate with 10 days left should be reported")
	}
}
