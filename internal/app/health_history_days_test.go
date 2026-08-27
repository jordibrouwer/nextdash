package app

import (
	"testing"
	"time"
)

// The per-URL cap keeps roughly a week of five-minute checks, and the 30-day
// window was computed over whatever survived it. Folding each day into a summary
// before its samples are dropped is what makes the long windows mean what they
// say.
func TestPruneFoldsDroppedSamplesIntoDays(t *testing.T) {
	now := time.Now().UTC()
	samples := make([]HealthSample, 0, maxHealthSamplesPerURL+300)
	// Oldest first: 300 checks that will not survive the cap, half of them down.
	for i := 0; i < 300; i++ {
		at := now.Add(-20 * 24 * time.Hour).Add(time.Duration(i) * time.Minute)
		samples = append(samples, HealthSample{T: at.UnixMilli(), Up: i%2 == 0, PingMs: 100})
	}
	for i := 0; i < maxHealthSamplesPerURL; i++ {
		at := now.Add(-time.Duration(maxHealthSamplesPerURL-i) * time.Minute)
		samples = append(samples, HealthSample{T: at.UnixMilli(), Up: true, PingMs: 50})
	}

	history := pruneHealthHistory(HealthHistoryFile{
		Samples: map[string][]HealthSample{"u": samples},
	}, nil, now)

	if got := len(history.Samples["u"]); got != maxHealthSamplesPerURL {
		t.Fatalf("kept samples = %d, want the cap %d", got, maxHealthSamplesPerURL)
	}
	days := history.Days["u"]
	if len(days) == 0 {
		t.Fatal("no daily summaries were written for the dropped samples")
	}
	total, up := 0, 0
	for _, d := range days {
		total += d.N
		up += d.U
	}
	if total != 300 {
		t.Fatalf("summarised checks = %d, want the 300 that were dropped", total)
	}
	if up != 150 {
		t.Fatalf("summarised successes = %d, want 150", up)
	}
}

// A day already summarised keeps its weight when more of its checks are folded
// in later: the mean response time is stored, not the samples behind it.
func TestFoldSamplesIntoDaysWeightsExistingMean(t *testing.T) {
	day := dayStart(time.Now().UTC().Add(-48 * time.Hour))
	existing := []HealthDay{{D: day, N: 2, U: 2, P: 100}}
	more := []HealthSample{
		{T: day + 3600_000, Up: true, PingMs: 400},
		{T: day + 7200_000, Up: true, PingMs: 400},
	}
	out := foldSamplesIntoDays(existing, more)
	if len(out) != 1 {
		t.Fatalf("days = %d, want 1", len(out))
	}
	if out[0].N != 4 || out[0].U != 4 {
		t.Fatalf("counts = %d/%d, want 4/4", out[0].U, out[0].N)
	}
	// (100+100+400+400)/4
	if out[0].P != 250 {
		t.Fatalf("mean ping = %d, want 250", out[0].P)
	}
}

// Maintenance samples are excluded, matching uptimeRatio — otherwise a nightly
// window would drag the long figures down while the short ones stayed clean.
func TestFoldSamplesIntoDaysSkipsMaintenance(t *testing.T) {
	day := dayStart(time.Now().UTC().Add(-72 * time.Hour))
	out := foldSamplesIntoDays(nil, []HealthSample{
		{T: day + 1000, Up: false, Maint: true},
		{T: day + 2000, Up: true},
	})
	if len(out) != 1 || out[0].N != 1 || out[0].U != 1 {
		t.Fatalf("day = %+v, want one counted check that succeeded", out)
	}
}

// The window must not count a day twice: the raw samples for it are already
// being counted check by check.
func TestUptimeWithDaysDoesNotDoubleCount(t *testing.T) {
	now := time.Now().UTC()
	rawDay := dayStart(now.Add(-24 * time.Hour))
	samples := []HealthSample{
		{T: rawDay + 1000, Up: true},
		{T: rawDay + 2000, Up: true},
	}
	days := []HealthDay{
		// Same day as the raw samples: skipped.
		{D: rawDay, N: 100, U: 0},
		// Older, so it is the only thing standing in for that stretch.
		{D: dayStart(now.Add(-10 * 24 * time.Hour)), N: 100, U: 50},
	}
	got := uptimeWithDays(samples, days, 30*24*time.Hour, now)
	if got.Samples != 102 {
		t.Fatalf("samples = %d, want 2 raw + 100 summarised", got.Samples)
	}
	// 2 up raw + 50 up summarised, over 102.
	if want := 52.0 / 102.0; got.Ratio < want-0.001 || got.Ratio > want+0.001 {
		t.Fatalf("ratio = %f, want %f", got.Ratio, want)
	}
}
