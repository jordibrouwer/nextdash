package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func msAgo(now time.Time, d time.Duration) int64 {
	return now.Add(-d).UnixMilli()
}

func TestReadHealthHistoryFileMissingAndCorrupt(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	// Missing file: history is derived data, so this must be an empty record
	// rather than an error that could block a monitor run.
	got := readHealthHistoryFile()
	if got.Samples == nil || len(got.Samples) != 0 {
		t.Fatalf("expected empty samples for missing file, got %#v", got.Samples)
	}

	if err := os.WriteFile(healthHistoryFilePath(), []byte("{not json"), 0o644); err != nil {
		t.Fatalf("write corrupt file: %v", err)
	}
	got = readHealthHistoryFile()
	if got.Samples == nil || len(got.Samples) != 0 {
		t.Fatalf("expected empty samples for corrupt file, got %#v", got.Samples)
	}
}

func TestTrimSamplesDropsOldAndCaps(t *testing.T) {
	now := time.Now()
	cutoff := now.Add(-healthHistoryRetention).UnixMilli()

	samples := []HealthSample{
		{T: msAgo(now, 40*24*time.Hour), Up: true}, // older than retention
		{T: msAgo(now, 31*24*time.Hour), Up: true}, // older than retention
		{T: msAgo(now, 2*time.Hour), Up: true},
		{T: msAgo(now, 1*time.Hour), Up: false},
	}
	got := trimSamples(samples, cutoff)
	if len(got) != 2 {
		t.Fatalf("expected 2 samples inside retention, got %d", len(got))
	}
	if got[0].T != samples[2].T || got[1].T != samples[3].T {
		t.Errorf("kept the wrong samples: %#v", got)
	}

	// Cap: build more than the per-URL maximum, all recent.
	many := make([]HealthSample, maxHealthSamplesPerURL+50)
	for i := range many {
		many[i] = HealthSample{T: msAgo(now, time.Duration(len(many)-i)*time.Second), Up: true}
	}
	capped := trimSamples(many, cutoff)
	if len(capped) != maxHealthSamplesPerURL {
		t.Fatalf("expected cap at %d, got %d", maxHealthSamplesPerURL, len(capped))
	}
	// The newest sample must survive the cap — that is the one the UI shows.
	if capped[len(capped)-1].T != many[len(many)-1].T {
		t.Errorf("cap dropped the newest sample")
	}
}

func TestTrimSamplesSortsOutOfOrderInput(t *testing.T) {
	now := time.Now()
	cutoff := now.Add(-healthHistoryRetention).UnixMilli()

	// A clock jump can append an older timestamp after a newer one. Sorting first
	// keeps the binary search over the cutoff honest.
	samples := []HealthSample{
		{T: msAgo(now, 1*time.Hour), Up: true},
		{T: msAgo(now, 3*time.Hour), Up: false},
		{T: msAgo(now, 2*time.Hour), Up: true},
	}
	got := trimSamples(samples, cutoff)
	if len(got) != 3 {
		t.Fatalf("expected all 3 kept, got %d", len(got))
	}
	for i := 1; i < len(got); i++ {
		if got[i].T < got[i-1].T {
			t.Fatalf("result is not ascending: %#v", got)
		}
	}
}

func TestPruneHealthHistoryDropsOrphans(t *testing.T) {
	now := time.Now()
	history := HealthHistoryFile{Samples: map[string][]HealthSample{
		"https://kept.example":    {{T: msAgo(now, time.Hour), Up: true}},
		"https://orphan.example":  {{T: msAgo(now, time.Hour), Up: true}},
		"https://expired.example": {{T: msAgo(now, 60*24*time.Hour), Up: true}},
	}}

	known := map[string]bool{"https://kept.example": true, "https://expired.example": true}
	got := pruneHealthHistory(history, known, now)

	if _, ok := got.Samples["https://orphan.example"]; ok {
		t.Errorf("orphan URL should have been dropped")
	}
	if _, ok := got.Samples["https://expired.example"]; ok {
		t.Errorf("URL with only expired samples should have been dropped")
	}
	if len(got.Samples["https://kept.example"]) != 1 {
		t.Errorf("expected kept URL to survive, got %#v", got.Samples)
	}

	// A nil known map means "retention only" — orphans must survive.
	got = pruneHealthHistory(HealthHistoryFile{Samples: map[string][]HealthSample{
		"https://orphan.example": {{T: msAgo(now, time.Hour), Up: true}},
	}}, nil, now)
	if len(got.Samples["https://orphan.example"]) != 1 {
		t.Errorf("nil known map must not drop orphans, got %#v", got.Samples)
	}
}

func TestAppendHealthSamplesPersistsCompactly(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	now := time.Now()

	err := h.appendHealthSamples(map[string][]HealthSample{
		"https://a.example": {{T: msAgo(now, 2*time.Minute), Up: true, PingMs: 120, Code: 200}},
	})
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	// Append again: samples accumulate rather than replace, which is the whole
	// difference from mergeHealthCacheUpdates.
	err = h.appendHealthSamples(map[string][]HealthSample{
		"https://a.example": {{T: msAgo(now, 1*time.Minute), Up: false, Code: 503}},
	})
	if err != nil {
		t.Fatalf("append 2: %v", err)
	}

	got := h.healthHistoryFor("https://a.example")
	if len(got) != 2 {
		t.Fatalf("expected 2 accumulated samples, got %d", len(got))
	}
	if !got[0].Up || got[1].Up {
		t.Errorf("samples out of order or wrong: %#v", got)
	}

	raw, err := os.ReadFile(healthHistoryFilePath())
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	// Compact encoding is a deliberate choice for the one file that grows per
	// check; indentation would roughly double it.
	if strings.Contains(string(raw), "\n  ") {
		t.Errorf("history file should be compact JSON, got:\n%s", raw)
	}
	var parsed HealthHistoryFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("stored history is not valid JSON: %v", err)
	}
}

func TestSweepHealthHistoryRemovesUnmonitored(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	now := time.Now()

	if err := h.appendHealthSamples(map[string][]HealthSample{
		"https://keep.example": {{T: msAgo(now, time.Minute), Up: true}},
		"https://gone.example": {{T: msAgo(now, time.Minute), Up: true}},
	}); err != nil {
		t.Fatalf("append: %v", err)
	}

	if err := h.sweepHealthHistory(map[string]bool{"https://keep.example": true}); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	if len(h.healthHistoryFor("https://gone.example")) != 0 {
		t.Errorf("un-monitored URL should have been swept")
	}
	if len(h.healthHistoryFor("https://keep.example")) != 1 {
		t.Errorf("monitored URL should have survived the sweep")
	}
}
