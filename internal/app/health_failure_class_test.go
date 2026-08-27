package app

import (
	"testing"
	"time"
)

// A failed check works out why it failed on every run — classifyPingError has
// always done that — and then threw the answer away. A DNS outage and a refused
// connection were both stored as "Up:false, Code:0" and reached the incident
// list, the fleet timeline and the CSV export with no cause at all.
func TestFailureClassMapsEveryBranch(t *testing.T) {
	for detail, want := range map[string]string{
		"":                     "",
		"Timeout":              "timeout",
		"DNS lookup failed":    "dns",
		"Connection refused":   "refused",
		"TLS error":            "tls",
		"Too many redirects":   "redirect",
		`Page is missing "ok"`: "content",
		"HTTP 503":             "http",
		// A sentence this does not know lands in "other" rather than being
		// mapped to something plausible and wrong.
		"Unreachable": "other",
	} {
		if got := failureClass(detail); got != want {
			t.Fatalf("failureClass(%q) = %q, want %q", detail, got, want)
		}
	}
}

// The class is what the file keeps; the sentence is presentation. A class this
// does not know still shows up as itself rather than disappearing.
func TestFailureClassReasonRoundTrip(t *testing.T) {
	if got := failureClassReason(failureClass("DNS lookup failed")); got != "DNS lookup failed" {
		t.Fatalf("round trip = %q, want the original sentence", got)
	}
	if got := failureClassReason("something-new"); got != "something-new" {
		t.Fatalf("unknown class = %q, want it back unchanged", got)
	}
	if got := failureClassReason(""); got != "" {
		t.Fatalf("empty class = %q, want empty", got)
	}
}

// A network-level failure stores no HTTP code, so before samples carried a
// class every such incident reached the list with a blank reason.
func TestIncidentReasonUsesFailureClass(t *testing.T) {
	now := time.Now()
	at := func(min int) int64 { return now.Add(time.Duration(-min) * time.Minute).UnixMilli() }

	incidents := deriveIncidents([]HealthSample{
		{T: at(30), Up: true},
		{T: at(20), Up: false, Fail: "dns"},
		{T: at(10), Up: false, Fail: "dns"},
		{T: at(5), Up: true},
	}, now)

	if len(incidents) != 1 {
		t.Fatalf("incidents = %d, want 1", len(incidents))
	}
	if incidents[0].Reason != "DNS lookup failed" {
		t.Fatalf("reason = %q, want the DNS sentence", incidents[0].Reason)
	}
}

// An HTTP status is more specific than the class, so it still wins.
func TestIncidentReasonPrefersHTTPStatus(t *testing.T) {
	now := time.Now()
	incidents := deriveIncidents([]HealthSample{
		{T: now.Add(-20 * time.Minute).UnixMilli(), Up: true},
		{T: now.Add(-10 * time.Minute).UnixMilli(), Up: false, Code: 503, Fail: "http"},
	}, now)

	if len(incidents) != 1 || incidents[0].Reason != "HTTP 503" {
		t.Fatalf("reason = %+v, want HTTP 503", incidents)
	}
}

// The 30-day window is computed over whatever samples survived the per-URL cap
// — about a week on a five-minute monitor — and was labelled "30 days" all the
// same. CoveredMs is how the view can tell the difference.
func TestMonitorStatsReportsCoveredSpan(t *testing.T) {
	now := time.Now()
	samples := []HealthSample{
		{T: now.Add(-7 * 24 * time.Hour).UnixMilli(), Up: true},
		{T: now.Add(-3 * 24 * time.Hour).UnixMilli(), Up: true},
		{T: now.Add(-1 * time.Hour).UnixMilli(), Up: true},
	}
	stats := buildMonitorStats(samples, 5, now)
	if stats == nil {
		t.Fatal("stats = nil")
	}
	want := samples[len(samples)-1].T - samples[0].T
	if stats.CoveredMs != want {
		t.Fatalf("coveredMs = %d, want %d", stats.CoveredMs, want)
	}
	// Seven days of history behind a thirty-day figure: the ratio is still
	// reported, and the span is what says how much of the window it covers.
	if stats.CoveredMs >= int64(30*24*time.Hour/time.Millisecond) {
		t.Fatalf("coveredMs = %d, expected less than the full window", stats.CoveredMs)
	}
}
