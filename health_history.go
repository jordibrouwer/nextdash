package main

import (
	"encoding/json"
	"os"
	"sort"
	"time"
)

const (
	// healthHistoryRetention is how far back samples are kept. It sets the ceiling
	// on the uptime windows the UI can offer (24h / 7d / 30d).
	healthHistoryRetention = 30 * 24 * time.Hour
	// maxHealthSamplesPerURL caps a single URL's history so one long-lived monitor
	// on a short interval cannot grow the file without bound. At the 5-minute floor
	// this is roughly a week; slower intervals reach the 30-day cutoff first.
	maxHealthSamplesPerURL = 2000
)

// writeCompactJSONFile mirrors writeIndentJSONFile but without indentation.
// The history file is rewritten on every monitor run and is the only file that
// grows per check rather than per bookmark, so pretty-printing it would roughly
// double both its size and the bytes written each cycle.
func writeCompactJSONFile(path string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return writeFileAtomic(path, data, 0644)
}

func emptyHealthHistory() HealthHistoryFile {
	return HealthHistoryFile{
		GeneratedAt: time.Now().UnixMilli(),
		Samples:     map[string][]HealthSample{},
	}
}

// readHealthHistoryFile loads the sample history. A missing or corrupt file is not
// an error: history is derived, disposable data, and losing it must never block a
// monitor run — it just restarts the record from now.
func readHealthHistoryFile() HealthHistoryFile {
	data, err := os.ReadFile(healthHistoryFilePath())
	if err != nil {
		return emptyHealthHistory()
	}
	var history HealthHistoryFile
	if err := json.Unmarshal(data, &history); err != nil || history.Samples == nil {
		return emptyHealthHistory()
	}
	return history
}

func writeHealthHistoryFile(history HealthHistoryFile) error {
	if history.Samples == nil {
		history.Samples = map[string][]HealthSample{}
	}
	return writeCompactJSONFile(healthHistoryFilePath(), history)
}

// trimSamples enforces both retention rules on one URL's samples: drop anything
// older than the cutoff, then keep only the newest maxHealthSamplesPerURL.
// Samples are assumed ascending by time; out-of-order input is sorted first so a
// clock jump cannot silently truncate good data.
func trimSamples(samples []HealthSample, cutoff int64) []HealthSample {
	if len(samples) == 0 {
		return nil
	}
	if !sort.SliceIsSorted(samples, func(i, j int) bool { return samples[i].T < samples[j].T }) {
		sort.SliceStable(samples, func(i, j int) bool { return samples[i].T < samples[j].T })
	}

	// Samples are ascending, so the first index at or after the cutoff starts the
	// kept range.
	start := sort.Search(len(samples), func(i int) bool { return samples[i].T >= cutoff })
	kept := samples[start:]
	if len(kept) > maxHealthSamplesPerURL {
		kept = kept[len(kept)-maxHealthSamplesPerURL:]
	}
	if len(kept) == 0 {
		return nil
	}
	// Copy so the trimmed slice does not retain the original backing array.
	out := make([]HealthSample, len(kept))
	copy(out, kept)
	return out
}

// pruneHealthHistory applies retention to every URL and drops entries that are no
// longer monitored. Passing a nil known map skips the orphan sweep, which is what
// callers that only want the age/size limits applied should do.
func pruneHealthHistory(history HealthHistoryFile, known map[string]bool, now time.Time) HealthHistoryFile {
	if len(history.Samples) == 0 {
		history.Samples = map[string][]HealthSample{}
		return history
	}
	cutoff := now.Add(-healthHistoryRetention).UnixMilli()
	pruned := make(map[string][]HealthSample, len(history.Samples))
	for url, samples := range history.Samples {
		if known != nil && !known[url] {
			continue
		}
		if trimmed := trimSamples(samples, cutoff); len(trimmed) > 0 {
			pruned[url] = trimmed
		}
	}
	history.Samples = pruned
	return history
}

// appendHealthSamples adds samples to the history and applies retention in one
// locked read-modify-write.
//
// This deliberately does not hook into mergeHealthCacheUpdates: that function
// *replaces* a URL's entry, which is right for "latest status" but would discard
// history. The two stores are updated side by side by the monitor run instead.
func (h *Handlers) appendHealthSamples(updates map[string][]HealthSample) error {
	if len(updates) == 0 {
		return nil
	}

	h.healthHistoryMu.Lock()
	defer h.healthHistoryMu.Unlock()

	history := readHealthHistoryFile()
	if history.Samples == nil {
		history.Samples = make(map[string][]HealthSample, len(updates))
	}
	for url, samples := range updates {
		if url == "" || len(samples) == 0 {
			continue
		}
		history.Samples[url] = append(history.Samples[url], samples...)
	}
	history = pruneHealthHistory(history, nil, time.Now())
	history.GeneratedAt = time.Now().UnixMilli()
	return writeHealthHistoryFile(history)
}

// sweepHealthHistory drops history for URLs that are no longer monitored and
// re-applies retention. Called from the monitor scheduler so deleting or
// un-monitoring a bookmark eventually reclaims its space without a manual step.
func (h *Handlers) sweepHealthHistory(known map[string]bool) error {
	h.healthHistoryMu.Lock()
	defer h.healthHistoryMu.Unlock()

	history := readHealthHistoryFile()
	before := len(history.Samples)
	history = pruneHealthHistory(history, known, time.Now())
	if before == 0 && len(history.Samples) == 0 {
		return nil
	}
	history.GeneratedAt = time.Now().UnixMilli()
	return writeHealthHistoryFile(history)
}

// healthHistoryFor returns a copy of one URL's samples, or nil when there is none.
func (h *Handlers) healthHistoryFor(url string) []HealthSample {
	h.healthHistoryMu.Lock()
	defer h.healthHistoryMu.Unlock()

	samples := readHealthHistoryFile().Samples[url]
	if len(samples) == 0 {
		return nil
	}
	out := make([]HealthSample, len(samples))
	copy(out, samples)
	return out
}

// readAllHealthHistory returns the whole history keyed by canonical URL. Used when
// building the health report, so one read serves every row.
func (h *Handlers) readAllHealthHistory() map[string][]HealthSample {
	h.healthHistoryMu.Lock()
	defer h.healthHistoryMu.Unlock()

	return readHealthHistoryFile().Samples
}
