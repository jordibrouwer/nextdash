package main

import (
	"math"
	"testing"
	"time"
)

func TestUptimeRatioWindows(t *testing.T) {
	now := time.Now()
	samples := []HealthSample{
		{T: msAgo(now, 10*24*time.Hour), Up: false}, // outside 24h and 7d
		{T: msAgo(now, 3*24*time.Hour), Up: true},   // outside 24h, inside 7d
		{T: msAgo(now, 2*time.Hour), Up: true},
		{T: msAgo(now, 1*time.Hour), Up: false},
	}

	day := uptimeRatio(samples, 24*time.Hour, now)
	if day.Samples != 2 {
		t.Fatalf("24h window: expected 2 samples, got %d", day.Samples)
	}
	if math.Abs(day.Ratio-0.5) > 1e-9 {
		t.Errorf("24h window: expected 0.5, got %v", day.Ratio)
	}

	week := uptimeRatio(samples, 7*24*time.Hour, now)
	if week.Samples != 3 {
		t.Fatalf("7d window: expected 3 samples, got %d", week.Samples)
	}
	if math.Abs(week.Ratio-2.0/3.0) > 1e-9 {
		t.Errorf("7d window: expected 2/3, got %v", week.Ratio)
	}
}

// An empty window must be distinguishable from 0% uptime: a monitor that was just
// enabled has no data, which is not the same as being down.
func TestUptimeRatioEmptyWindowIsNotZeroPercent(t *testing.T) {
	now := time.Now()
	samples := []HealthSample{{T: msAgo(now, 40*24*time.Hour), Up: false}}

	got := uptimeRatio(samples, 24*time.Hour, now)
	if got.Samples != 0 {
		t.Fatalf("expected no samples in window, got %d", got.Samples)
	}
	if got.Ratio != 0 {
		t.Errorf("expected zero-value ratio, got %v", got.Ratio)
	}
}

func TestDeriveIncidentsClosedAndOngoing(t *testing.T) {
	now := time.Now()
	samples := []HealthSample{
		{T: msAgo(now, 10*time.Minute), Up: true},
		{T: msAgo(now, 9*time.Minute), Up: false}, // incident 1 starts
		{T: msAgo(now, 8*time.Minute), Up: false},
		{T: msAgo(now, 7*time.Minute), Up: true}, // incident 1 ends here
		{T: msAgo(now, 6*time.Minute), Up: true},
		{T: msAgo(now, 2*time.Minute), Up: false}, // incident 2 starts, still down
		{T: msAgo(now, 1*time.Minute), Up: false},
	}

	incidents := deriveIncidents(samples, now)
	if len(incidents) != 2 {
		t.Fatalf("expected 2 incidents, got %d: %#v", len(incidents), incidents)
	}

	first := incidents[0]
	if first.Ongoing {
		t.Errorf("first incident should be closed")
	}
	if first.Checks != 2 {
		t.Errorf("first incident: expected 2 failed checks, got %d", first.Checks)
	}
	if first.Start != samples[1].T || first.End != samples[3].T {
		t.Errorf("first incident bounds wrong: %#v", first)
	}
	if first.Duration != first.End-first.Start {
		t.Errorf("first incident duration should span start..end, got %d", first.Duration)
	}

	second := incidents[1]
	if !second.Ongoing {
		t.Errorf("second incident should be ongoing")
	}
	if second.End != 0 {
		t.Errorf("ongoing incident must not have an end, got %d", second.End)
	}
	// Ongoing duration is measured to now, so "down since" keeps counting between
	// checks rather than freezing at the last sample.
	if second.Duration < int64(2*time.Minute/time.Millisecond)-1000 {
		t.Errorf("ongoing duration should be measured to now, got %d", second.Duration)
	}
}

func TestDeriveIncidentsReason(t *testing.T) {
	now := time.Now()
	samples := []HealthSample{
		{T: msAgo(now, 9*time.Minute), Up: true},
		// An outage whose status code changes: the latest one describes it best.
		{T: msAgo(now, 8*time.Minute), Up: false, Code: 503},
		{T: msAgo(now, 7*time.Minute), Up: false, Code: 500},
		{T: msAgo(now, 6*time.Minute), Up: true},
		// A network-level failure records no code, so there is nothing to report.
		{T: msAgo(now, 3*time.Minute), Up: false},
	}

	incidents := deriveIncidents(samples, now)
	if len(incidents) != 2 {
		t.Fatalf("expected 2 incidents, got %#v", incidents)
	}
	if incidents[0].Reason != "HTTP 500" {
		t.Errorf("expected the outage's latest code, got %q", incidents[0].Reason)
	}
	if incidents[1].Reason != "" {
		t.Errorf("a codeless failure must not invent a reason, got %q", incidents[1].Reason)
	}
}

func TestDeriveIncidentsAllHealthy(t *testing.T) {
	now := time.Now()
	samples := []HealthSample{
		{T: msAgo(now, 3*time.Minute), Up: true},
		{T: msAgo(now, 2*time.Minute), Up: true},
	}
	if got := deriveIncidents(samples, now); len(got) != 0 {
		t.Fatalf("expected no incidents, got %#v", got)
	}
}

func TestHeartbeatBucketsStatesAndTimeAxis(t *testing.T) {
	now := time.Now()
	window := 40 * time.Minute
	// One sample per minute, so each of the 40 buckets covers exactly one sample.
	samples := []HealthSample{
		{T: msAgo(now, 39*time.Minute), Up: true, PingMs: 100},
		{T: msAgo(now, 20*time.Minute), Up: false},
		{T: msAgo(now, 1*time.Minute), Up: true, PingMs: 300},
	}

	buckets := heartbeatBuckets(samples, window, defaultHeartbeatBuckets, now)
	if len(buckets) != defaultHeartbeatBuckets {
		t.Fatalf("expected %d buckets, got %d", defaultHeartbeatBuckets, len(buckets))
	}

	// Buckets must tile the window contiguously — the bar is a time axis, so gaps
	// or overlaps would misrepresent when an outage happened.
	for i := 1; i < len(buckets); i++ {
		if buckets[i].From != buckets[i-1].To {
			t.Fatalf("bucket %d does not start where %d ends", i, i-1)
		}
	}
	if buckets[len(buckets)-1].To != now.UnixMilli() {
		t.Errorf("last bucket should end at now")
	}

	var up, down, unknown int
	for _, b := range buckets {
		switch b.State {
		case heartbeatUp:
			up++
		case heartbeatDown:
			down++
		case heartbeatUnknown:
			unknown++
		}
	}
	if up != 2 || down != 1 {
		t.Errorf("expected 2 up and 1 down bucket, got up=%d down=%d", up, down)
	}
	if unknown != defaultHeartbeatBuckets-3 {
		t.Errorf("expected the rest to be unknown, got %d", unknown)
	}
}

// A bucket containing both a success and a failure is a flap, not a clean up or
// down — the UI needs that distinction to avoid hiding instability.
func TestHeartbeatBucketsDegraded(t *testing.T) {
	now := time.Now()
	window := 40 * time.Minute
	samples := []HealthSample{
		{T: msAgo(now, 30*time.Second), Up: true, PingMs: 50},
		{T: msAgo(now, 20*time.Second), Up: false},
	}

	buckets := heartbeatBuckets(samples, window, defaultHeartbeatBuckets, now)
	last := buckets[len(buckets)-1]
	if last.State != heartbeatDegraded {
		t.Fatalf("expected degraded bucket, got %q (up=%d down=%d)", last.State, last.Up, last.Down)
	}
}

func TestBuildMonitorStatsNilWithoutHistory(t *testing.T) {
	if got := buildMonitorStats(nil, 5, time.Now()); got != nil {
		t.Fatalf("expected nil stats without history, got %#v", got)
	}
}

func TestBuildMonitorStatsDownSinceAndOrdering(t *testing.T) {
	now := time.Now()
	samples := []HealthSample{
		{T: msAgo(now, 50*time.Minute), Up: true, PingMs: 90},
		{T: msAgo(now, 40*time.Minute), Up: false},
		{T: msAgo(now, 30*time.Minute), Up: true, PingMs: 95},
		{T: msAgo(now, 10*time.Minute), Up: false},
		{T: msAgo(now, 5*time.Minute), Up: false},
	}

	stats := buildMonitorStats(samples, 5, now)
	if stats == nil {
		t.Fatal("expected stats")
	}
	if stats.IntervalMinutes != 5 {
		t.Errorf("expected interval 5, got %d", stats.IntervalMinutes)
	}
	if stats.TotalChecks != len(samples) {
		t.Errorf("expected %d total checks, got %d", len(samples), stats.TotalChecks)
	}
	if stats.DownSince != samples[3].T {
		t.Errorf("DownSince should mark the start of the ongoing outage, got %d", stats.DownSince)
	}
	// Newest first, so the row can show the current outage without scanning.
	if len(stats.Incidents) != 2 {
		t.Fatalf("expected 2 incidents, got %d", len(stats.Incidents))
	}
	if !stats.Incidents[0].Ongoing {
		t.Errorf("newest incident should be first and ongoing: %#v", stats.Incidents)
	}
	if stats.LastPingMs != 0 || stats.LastSample != samples[4].T {
		t.Errorf("last sample fields wrong: %#v", stats)
	}
}

func TestClampMonitorIntervalMinutes(t *testing.T) {
	cases := []struct{ in, want int }{
		{0, defaultMonitorIntervalMinutes},
		{-10, defaultMonitorIntervalMinutes},
		{1, minMonitorIntervalMinutes},
		{5, 5},
		{60, 60},
		{maxMonitorIntervalMinutes, maxMonitorIntervalMinutes},
		{maxMonitorIntervalMinutes + 1, maxMonitorIntervalMinutes},
	}
	for _, c := range cases {
		if got := clampMonitorIntervalMinutes(c.in); got != c.want {
			t.Errorf("clampMonitorIntervalMinutes(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}
