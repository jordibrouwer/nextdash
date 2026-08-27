package app

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

// pruneHostCertificates must drop only hosts nothing live points at, keeping
// a certificate for a host still in use even if another one was removed.
func TestPruneHostCertificatesDropsDeadHostsOnly(t *testing.T) {
	stored := map[string]HostCertificate{
		"kept.example":    {Host: "kept.example"},
		"removed.example": {Host: "removed.example"},
	}
	pruneHostCertificates(stored, map[string]struct{}{"kept.example": {}})

	if _, ok := stored["removed.example"]; ok {
		t.Error("removed.example should have been pruned — nothing live points at it")
	}
	if _, ok := stored["kept.example"]; !ok {
		t.Error("kept.example should survive — a live host still points at it")
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

// A certificate that expired minutes ago must read as "expired" immediately,
// not "urgent" for the next 24 hours. int()-truncating a negative
// Hours()/24 rounds toward zero rather than toward negative infinity, so a
// naive implementation reports "0 days left" for the better part of a day
// after expiry.
func TestCertDaysLeftFloorsTowardNegativeInfinity(t *testing.T) {
	now := time.Now()

	expiredMinutesAgo := now.Add(-10 * time.Minute).UnixMilli()
	if days := certDaysLeft(expiredMinutesAgo, now); days >= 0 {
		t.Errorf("certDaysLeft 10 minutes after expiry = %d, want negative", days)
	}
	if got := certSeverity(expiredMinutesAgo, now); got != "expired" {
		t.Errorf("severity 10 minutes after expiry = %q, want %q", got, "expired")
	}

	expiredHoursAgo := now.Add(-12 * time.Hour).UnixMilli()
	if days := certDaysLeft(expiredHoursAgo, now); days >= 0 {
		t.Errorf("certDaysLeft 12 hours after expiry = %d, want negative", days)
	}
	if got := certSeverity(expiredHoursAgo, now); got != "expired" {
		t.Errorf("severity 12 hours after expiry = %q, want %q", got, "expired")
	}

	// Symmetry check: the final 24 hours before expiry still reads as "0
	// days left", which is the honest reading of "expires this afternoon".
	expiresInHours := now.Add(12 * time.Hour).UnixMilli()
	if days := certDaysLeft(expiresInHours, now); days != 0 {
		t.Errorf("certDaysLeft 12 hours before expiry = %d, want 0", days)
	}
}
