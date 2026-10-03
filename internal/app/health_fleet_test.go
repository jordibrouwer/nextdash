package app

import (
	"testing"
	"time"
)

// The collection-wide view answers questions the per-row strips cannot: how the
// whole set is doing, which monitors are worst, what broke this month, and what
// got slower. These pin the choices that make those answers honest.

// fleetSamples builds n samples ending now, spaced `every` apart.
func fleetSamples(n int, every time.Duration, now time.Time, up func(int) bool, ping func(int) int) []HealthSample {
	out := make([]HealthSample, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, HealthSample{
			T:      now.Add(-time.Duration(n-i) * every).UnixMilli(),
			Up:     up(i),
			PingMs: ping(i),
		})
	}
	return out
}

func alwaysUp(int) bool         { return true }
func ping100(int) int           { return 100 }
func noSamples() []HealthSample { return nil }

// Nothing monitored, or monitored but never sampled, produces no panel at all
// rather than a wall of zeroes.
func TestBuildFleetStatsNilWithoutSamples(t *testing.T) {
	now := time.Now()
	if buildFleetStats(nil, now) != nil {
		t.Error("no inputs produced stats")
	}
	inputs := []fleetMonitorInput{{name: "A", url: "https://a.example", samples: noSamples()}}
	if buildFleetStats(inputs, now) != nil {
		t.Error("a monitor with no samples produced stats")
	}
}

// Uptime pools samples rather than averaging per-monitor ratios: otherwise a
// monitor with 3 samples would weigh as much as one with 3000.
func TestPooledUptimeWeighsBySample(t *testing.T) {
	now := time.Now()
	// 300 perfect samples, and 3 that all failed. Averaging the two ratios gives
	// 50%; pooling gives 300/303 ≈ 99%.
	inputs := []fleetMonitorInput{
		{name: "Busy", url: "https://a.example", samples: fleetSamples(300, time.Minute, now, alwaysUp, ping100)},
		{name: "Quiet", url: "https://b.example", samples: fleetSamples(3, time.Minute, now, func(int) bool { return false }, func(int) int { return 0 })},
	}
	got := pooledUptime(inputs, 24*time.Hour, now)
	if got.Samples != 303 {
		t.Fatalf("Samples = %d, want 303", got.Samples)
	}
	if got.Ratio < 0.98 {
		t.Errorf("Ratio = %.4f, want ~0.99 — ratios were averaged rather than pooled", got.Ratio)
	}
}

// The shortlist names monitors with something wrong. Padding it with perfect
// scores would make five things look broken when none are.
func TestWorstExcludesPerfectMonitors(t *testing.T) {
	now := time.Now()
	inputs := []fleetMonitorInput{
		{name: "Perfect", url: "https://a.example", samples: fleetSamples(100, time.Minute, now, alwaysUp, ping100)},
		{name: "Flaky", url: "https://b.example", samples: fleetSamples(100, time.Minute, now, func(i int) bool { return i%5 != 0 }, ping100)},
	}
	stats := buildFleetStats(inputs, now)
	if stats == nil {
		t.Fatal("nil stats")
	}
	if len(stats.Worst) != 1 {
		t.Fatalf("Worst has %d entries, want 1 (the perfect monitor excluded)", len(stats.Worst))
	}
	if stats.Worst[0].Name != "Flaky" {
		t.Errorf("Worst[0] = %q, want \"Flaky\"", stats.Worst[0].Name)
	}
}

// A monitor failing right now sorts above one with a merely poor average: the
// live outage is what needs attention first.
func TestWorstPutsDownMonitorsFirst(t *testing.T) {
	now := time.Now()
	inputs := []fleetMonitorInput{
		// Poor average — half its checks failed — but recovered, so the final
		// sample is up. i=99 is the last one, hence the odd-index test.
		{name: "Poor", url: "https://a.example", samples: fleetSamples(100, time.Minute, now, func(i int) bool { return i%2 == 1 }, ping100)},
		// Better average (only the last five failed), but still failing now.
		{name: "DownNow", url: "https://b.example", samples: fleetSamples(100, time.Minute, now, func(i int) bool { return i < 95 }, ping100)},
	}
	stats := buildFleetStats(inputs, now)
	if stats == nil || len(stats.Worst) == 0 {
		t.Fatal("no worst list")
	}
	if stats.Worst[0].Name != "DownNow" {
		t.Errorf("Worst[0] = %q, want \"DownNow\" — a live outage outranks a poor average", stats.Worst[0].Name)
	}
	if stats.DownNow != 1 {
		t.Errorf("DownNow = %d, want 1", stats.DownNow)
	}
}

// Incidents carry the bookmark they belong to and arrive newest first, so the
// list reads as a timeline across the collection.
func TestFleetIncidentsAreAttributedAndOrdered(t *testing.T) {
	now := time.Now()
	inputs := []fleetMonitorInput{
		{name: "A", url: "https://a.example", samples: fleetSamples(100, time.Minute, now, func(i int) bool { return i != 10 }, ping100)},
		{name: "B", url: "https://b.example", samples: fleetSamples(100, time.Minute, now, func(i int) bool { return i != 80 }, ping100)},
	}
	stats := buildFleetStats(inputs, now)
	if stats == nil || len(stats.Incidents) != 2 {
		t.Fatalf("want 2 incidents, got %v", stats)
	}
	if stats.Incidents[0].Start < stats.Incidents[1].Start {
		t.Error("incidents are not newest first")
	}
	// B's outage is later, so it leads.
	if stats.Incidents[0].Name != "B" {
		t.Errorf("Incidents[0].Name = %q, want \"B\"", stats.Incidents[0].Name)
	}
}

// The list is capped, and the total says so — otherwise 25 outages reads as the
// month's complete tally.
func TestFleetIncidentsReportTotalWhenCapped(t *testing.T) {
	now := time.Now()
	// Every third check fails, well past the cap.
	inputs := []fleetMonitorInput{
		{name: "Flapper", url: "https://a.example", samples: fleetSamples(300, time.Minute, now, func(i int) bool { return i%3 != 0 }, ping100)},
	}
	stats := buildFleetStats(inputs, now)
	if stats == nil {
		t.Fatal("nil stats")
	}
	if len(stats.Incidents) != maxFleetIncidents {
		t.Errorf("Incidents = %d, want the cap %d", len(stats.Incidents), maxFleetIncidents)
	}
	if stats.TotalIncidents <= maxFleetIncidents {
		t.Errorf("TotalIncidents = %d, want more than the cap so the UI can say it is truncated", stats.TotalIncidents)
	}
}

// A monitor that got measurably slower is named; the baseline must not overlap
// the recent window, or it would be dragged toward the value it is compared to.
func TestResponseShiftDetectsSlowdown(t *testing.T) {
	now := time.Now()
	// 10-minute spacing: the last 144 samples are the most recent 24h.
	samples := fleetSamples(900, 10*time.Minute, now, alwaysUp, func(i int) int {
		if i > 900-144 {
			return 400
		}
		return 100
	})
	shifts := deriveResponseShifts([]fleetMonitorInput{{name: "Slowing", url: "https://a.example", samples: samples}}, now)
	if len(shifts) != 1 {
		t.Fatalf("got %d shifts, want 1", len(shifts))
	}
	if shifts[0].BaselineMs != 100 {
		t.Errorf("BaselineMs = %d, want 100 — the recent window leaked into the baseline", shifts[0].BaselineMs)
	}
	if shifts[0].ChangePct < 200 {
		t.Errorf("ChangePct = %d, want a large increase", shifts[0].ChangePct)
	}
}

// Steady response times report nothing: the list exists to surface change, and
// noise below the threshold would make it a different five every refresh.
func TestResponseShiftIgnoresSteadyAndFaster(t *testing.T) {
	now := time.Now()
	steady := fleetSamples(900, 10*time.Minute, now, alwaysUp, ping100)
	if got := deriveResponseShifts([]fleetMonitorInput{{name: "Steady", samples: steady}}, now); len(got) != 0 {
		t.Errorf("steady monitor reported a shift: %+v", got)
	}

	faster := fleetSamples(900, 10*time.Minute, now, alwaysUp, func(i int) int {
		if i > 900-144 {
			return 50
		}
		return 200
	})
	if got := deriveResponseShifts([]fleetMonitorInput{{name: "Faster", samples: faster}}, now); len(got) != 0 {
		t.Errorf("a monitor that got faster was listed as slower: %+v", got)
	}
}

// Too few readings on either side is not evidence — two averages of one check
// each would report noise as a trend.
func TestResponseShiftNeedsEnoughSamples(t *testing.T) {
	now := time.Now()
	// Only 4 recent samples, below minSamplesForShift.
	samples := fleetSamples(4, time.Hour, now, alwaysUp, func(int) int { return 900 })
	if got := deriveResponseShifts([]fleetMonitorInput{{name: "Sparse", samples: samples}}, now); len(got) != 0 {
		t.Errorf("a sparse monitor reported a shift: %+v", got)
	}
}

// The per-day course pools every monitor by sample, per UTC day, oldest first:
// maintenance is left out, a failed check counts but has no time, and a day
// past the retention is not there.
func TestFleetDaysPoolPerUTCDay(t *testing.T) {
	now := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	day := func(d int, h int) int64 { return time.Date(2026, 10, d, h, 0, 0, 0, time.UTC).UnixMilli() }
	inputs := []fleetMonitorInput{
		{name: "A", url: "https://a.example", samples: []HealthSample{
			{T: day(1, 1), Up: true, PingMs: 100},
			{T: day(1, 23), Up: false},
			{T: day(2, 1), Up: true, PingMs: 300},
			{T: day(2, 2), Up: false, Maint: true},
			{T: now.Add(-31 * 24 * time.Hour).UnixMilli(), Up: true, PingMs: 999},
		}},
		{name: "B", url: "https://b.example", samples: []HealthSample{
			{T: day(1, 5), Up: true, PingMs: 200},
			{T: day(2, 3), Up: true},
		}},
	}
	got := fleetDays(inputs, now)
	want := []FleetDay{
		{Day: day(1, 0), Checks: 3, Up: 2, AvgMs: 150},
		{Day: day(2, 0), Checks: 2, Up: 2, AvgMs: 300},
	}
	if len(got) != len(want) {
		t.Fatalf("days = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("day %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if stats := buildFleetStats(inputs, now); stats == nil || len(stats.Days) != 2 {
		t.Errorf("buildFleetStats did not carry the days: %+v", stats)
	}
}

// The 30-day figures read the day summaries too: the samples kept reach back
// about a week at a 5-minute interval, and the weeks before it counted as
// "no checks".
func TestFleetCountsTheDaySummaries(t *testing.T) {
	now := time.Now()
	old := dayStart(now.Add(-20 * 24 * time.Hour))
	in := fleetMonitorInput{name: "A", url: "https://a.example",
		samples: fleetSamples(10, time.Minute, now, alwaysUp, ping100),
		days:    []HealthDay{{D: old, N: 90, U: 0}}}
	got := pooledUptime([]fleetMonitorInput{in}, 30*24*time.Hour, now)
	if got.Samples != 100 || got.Ratio > 0.2 {
		t.Fatalf("uptime = %+v, want 100 checks at 10%%", got)
	}
	found := false
	for _, d := range fleetDays([]fleetMonitorInput{in}, now) {
		found = found || (d.Day == old && d.Checks == 90)
	}
	if !found {
		t.Fatal("the summarised day is missing from the per-day chart")
	}
}

// Every incident's span comes along, not only the five listed: the large view
// counted and summed downtime over those five.
func TestMonitorStatsCarryEveryIncidentSpan(t *testing.T) {
	now := time.Now()
	var samples []HealthSample
	for i := 0; i < 12; i++ {
		at := now.Add(time.Duration(-120+i*10) * time.Minute)
		samples = append(samples, HealthSample{T: at.UnixMilli(), Up: false}, HealthSample{T: at.Add(5 * time.Minute).UnixMilli(), Up: true})
	}
	stats := buildMonitorStats(samples, 5, now)
	if len(stats.Incidents) != 5 || len(stats.IncidentSpans) != 12 {
		t.Fatalf("incidents %d, spans %d; want 5 and 12", len(stats.Incidents), len(stats.IncidentSpans))
	}
	if stats.IncidentSpans[0][0] < stats.IncidentSpans[11][0] {
		t.Fatal("spans are not newest first")
	}
}

// Each monitor's count and downtime cover every outage, not the 25 listed:
// the outage card's "n×" for a flapping monitor stopped at the cap.
func TestFleetTotalsCountPastTheCap(t *testing.T) {
	now := time.Now()
	inputs := []fleetMonitorInput{
		{name: "Flapper", url: "https://a.example", samples: fleetSamples(300, time.Minute, now, func(i int) bool { return i%3 != 0 }, ping100)},
	}
	stats := buildFleetStats(inputs, now)
	if len(stats.IncidentTotals) != 1 || stats.IncidentTotals[0].Count != stats.TotalIncidents || stats.IncidentTotals[0].Count <= maxFleetIncidents {
		t.Fatalf("totals = %+v, total incidents %d", stats.IncidentTotals, stats.TotalIncidents)
	}
}
