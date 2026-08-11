package main

import (
	"testing"
	"time"
)

// A window that wraps past midnight belongs to the day it opens on. Checking
// today's weekday for the tail would close a "Sunday 23:00–01:00" window an hour
// early, on the Monday.
func TestMaintenanceWindowWrapsPastMidnight(t *testing.T) {
	sunday := func(h, m int) time.Time { return time.Date(2026, 8, 9, h, m, 0, 0, time.Local) }
	monday := func(h, m int) time.Time { return time.Date(2026, 8, 10, h, m, 0, 0, time.Local) }

	w := MaintenanceWindow{Start: "23:00", End: "01:00", Days: []int{int(time.Sunday)}}
	if !w.covers(sunday(23, 30)) {
		t.Error("Sunday 23:30 should be inside a Sunday 23:00–01:00 window")
	}
	if !w.covers(monday(0, 30)) {
		t.Error("Monday 00:30 is still the Sunday window running past midnight")
	}
	if w.covers(monday(2, 0)) {
		t.Error("Monday 02:00 is past the window")
	}
	if w.covers(monday(23, 30)) {
		t.Error("Monday 23:30 must not open a Sunday-only window")
	}
}

func TestMaintenanceWindowBoundariesAndValidity(t *testing.T) {
	at := func(h, m int) time.Time { return time.Date(2026, 8, 10, h, m, 0, 0, time.Local) }
	w := MaintenanceWindow{Start: "02:00", End: "03:00"}

	// Half-open: the start is inside, the end is not, so back-to-back windows
	// cannot both claim the same minute.
	if w.covers(at(1, 59)) || !w.covers(at(2, 0)) || !w.covers(at(2, 59)) || w.covers(at(3, 0)) {
		t.Error("window should cover [02:00, 03:00)")
	}

	// An unusable window must be inert. Treating it as always-open would silence
	// every alert on the install.
	for _, bad := range []MaintenanceWindow{
		{Start: "", End: ""},
		{Start: "9", End: "10"},
		{Start: "02:00", End: "02:00"},
		{Start: "25:00", End: "26:00"},
	} {
		if bad.isValid() || bad.covers(at(2, 30)) {
			t.Errorf("%q–%q should be invalid and cover nothing", bad.Start, bad.End)
		}
	}

	kept := normalizeMaintenanceWindows([]MaintenanceWindow{
		{Start: "x", End: "y"},
		{Start: "02:00", End: "03:00", Days: []int{1, 1, 9, -2, 3}},
	})
	if len(kept) != 1 {
		t.Fatalf("normalize kept %d windows, want 1", len(kept))
	}
	if got := kept[0].Days; len(got) != 2 || got[0] != 1 || got[1] != 3 {
		t.Errorf("days = %v, want deduped and sorted [1 3]", got)
	}
	// All seven days is the same as unrestricted, and "none" is the cheaper test.
	all := normalizeMaintenanceWindows([]MaintenanceWindow{{Start: "01:00", End: "02:00", Days: []int{0, 1, 2, 3, 4, 5, 6}}})
	if len(all) != 1 || all[0].Days != nil {
		t.Errorf("seven days should normalise to none, got %v", all[0].Days)
	}
}

// Expected downtime is not an availability failure: a nightly backup window
// would otherwise cap a healthy host's monthly uptime at around 99.3%.
func TestUptimeSkipsMaintenanceSamples(t *testing.T) {
	now := time.Now()
	ago := func(min int) int64 { return now.Add(-time.Duration(min) * time.Minute).UnixMilli() }

	samples := []HealthSample{
		{T: ago(50), Up: true},
		{T: ago(40), Up: false, Maint: true},
		{T: ago(30), Up: false, Maint: true},
		{T: ago(10), Up: true},
	}
	got := uptimeRatio(samples, time.Hour, now)
	if got.Ratio != 1 || got.Samples != 2 {
		t.Errorf("uptime = %.2f over %d samples, want 1.00 over 2 — maintenance failures must not count",
			got.Ratio, got.Samples)
	}

	// Without the flag the same failures do count, so the exclusion is doing the
	// work rather than the samples being dropped elsewhere.
	plain := []HealthSample{
		{T: ago(50), Up: true}, {T: ago(40), Up: false}, {T: ago(30), Up: false}, {T: ago(10), Up: true},
	}
	if got := uptimeRatio(plain, time.Hour, now); got.Samples != 4 || got.Ratio != 0.5 {
		t.Errorf("unflagged: %.2f over %d, want 0.50 over 4", got.Ratio, got.Samples)
	}
}

// The fleet-wide pool must exclude maintenance samples the same way the
// per-row ratio does — otherwise a nightly window drags down the collection
// uptime even though every row individually ignores it.
func TestPooledUptimeSkipsMaintenanceSamples(t *testing.T) {
	now := time.Now()
	ago := func(min int) int64 { return now.Add(-time.Duration(min) * time.Minute).UnixMilli() }

	inputs := []fleetMonitorInput{{
		name: "a", url: "https://a.example",
		samples: []HealthSample{
			{T: ago(50), Up: true},
			{T: ago(40), Up: false, Maint: true},
			{T: ago(30), Up: false, Maint: true},
			{T: ago(10), Up: true},
		},
	}}
	got := pooledUptime(inputs, time.Hour, now)
	if got.Ratio != 1 || got.Samples != 2 {
		t.Errorf("pooled uptime = %.2f over %d samples, want 1.00 over 2 — maintenance failures must not count",
			got.Ratio, got.Samples)
	}
}

// A maintenance-window failure must not open, extend, or close an incident:
// otherwise a nightly backup shows up as a recurring outage in the per-row and
// fleet incident lists even though it is excluded from the uptime percentage.
func TestDeriveIncidentsSkipsMaintenanceSamples(t *testing.T) {
	now := time.Now()
	ago := func(min int) int64 { return now.Add(-time.Duration(min) * time.Minute).UnixMilli() }

	samples := []HealthSample{
		{T: ago(50), Up: true},
		{T: ago(40), Up: false, Maint: true},
		{T: ago(30), Up: false, Maint: true},
		{T: ago(10), Up: true},
	}
	incidents := deriveIncidents(samples, now)
	if len(incidents) != 0 {
		t.Errorf("incidents = %d, want 0 — a maintenance window must not appear as an outage", len(incidents))
	}

	// A real outage overlapping a maintenance flag on other samples must still
	// be reported: the exclusion is per-sample, not "any Maint sample present".
	mixed := []HealthSample{
		{T: ago(50), Up: true},
		{T: ago(40), Up: false, Maint: true},
		{T: ago(30), Up: false},
		{T: ago(10), Up: true},
	}
	incidents = deriveIncidents(mixed, now)
	if len(incidents) != 1 {
		t.Fatalf("incidents = %d, want 1 real outage alongside the ignored maintenance sample", len(incidents))
	}
}

// The heartbeat bar must not paint a bucket down/degraded from an expected
// maintenance-window failure — it should read as "no data" for that slice
// instead of a red segment on an otherwise healthy night.
func TestHeartbeatBucketsSkipMaintenanceSamples(t *testing.T) {
	now := time.Now()
	ago := func(min int) int64 { return now.Add(-time.Duration(min) * time.Minute).UnixMilli() }

	samples := []HealthSample{
		{T: ago(30), Up: false, Maint: true},
	}
	buckets := heartbeatBuckets(samples, time.Hour, 2, now)
	for i, b := range buckets {
		if b.State != heartbeatUnknown {
			t.Errorf("bucket %d state = %q, want %q — a maintenance sample must not mark it down", i, b.State, heartbeatUnknown)
		}
	}
}
