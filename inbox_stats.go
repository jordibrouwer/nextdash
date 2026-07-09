package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const inboxStatsVersion = 1

// inboxStatsBucketRetentionDays caps how many daily trend buckets we keep so the
// aggregate file cannot grow without bound.
const inboxStatsBucketRetentionDays = 400

// Inbox lifecycle event types recorded into the durable aggregate.
const (
	inboxEventAdded    = "added"
	inboxEventPromoted = "promoted"
	inboxEventDeleted  = "deleted"
	inboxEventKept     = "kept"
)

// InboxDayCounts holds per-day inbox throughput for the trend sparkline.
type InboxDayCounts struct {
	Added    int `json:"added"`
	Promoted int `json:"promoted"`
	Deleted  int `json:"deleted"`
	Kept     int `json:"kept"`
}

// InboxStats is a durable aggregate persisted at data/inbox-stats.json. It
// survives after inbox items are triaged away (promoted/deleted), which the
// items themselves cannot record because they are removed on triage.
type InboxStats struct {
	Version int `json:"version"`

	// Lifetime counters.
	TotalAdded    int `json:"totalAdded"`
	TotalPromoted int `json:"totalPromoted"`
	TotalDeleted  int `json:"totalDeleted"`
	TotalKept     int `json:"totalKept"`

	// Retention (time from added to triaged), for a running average.
	RetentionCount int   `json:"retentionCount"`
	SumRetentionMs int64 `json:"sumRetentionMs"`

	// Lifetime inflow per source (paste, extension, …).
	BySource map[string]int `json:"bySource,omitempty"`

	// Per-day throughput keyed by YYYY-MM-DD (UTC), for the trend chart.
	DailyBuckets map[string]InboxDayCounts `json:"dailyBuckets,omitempty"`

	// Timestamp (ms) of the first recorded event, so the UI can label lifetime
	// counters with a "since" date instead of implying they cover all history.
	FirstEventAt int64 `json:"firstEventAt,omitempty"`
}

// InboxEvent describes a single inbox lifecycle event to record.
type InboxEvent struct {
	Type        string
	Source      string
	AtMs        int64 // event time (ms); defaults to now when 0
	RetentionMs int64 // time from added to this event; 0 when unknown/not applicable
}

func inboxStatsFilePath(dataDir string) string {
	return filepath.Join(dataDir, "inbox-stats.json")
}

func (fs *FileStore) inboxStatsFile() string {
	return inboxStatsFilePath(fs.dataDir)
}

func (fs *FileStore) readInboxStatsLocked() InboxStats {
	data, err := os.ReadFile(fs.inboxStatsFile())
	if err != nil {
		return newInboxStats()
	}
	var stats InboxStats
	if err := json.Unmarshal(data, &stats); err != nil {
		return newInboxStats()
	}
	if stats.Version == 0 {
		stats.Version = inboxStatsVersion
	}
	if stats.BySource == nil {
		stats.BySource = map[string]int{}
	}
	if stats.DailyBuckets == nil {
		stats.DailyBuckets = map[string]InboxDayCounts{}
	}
	return stats
}

func newInboxStats() InboxStats {
	return InboxStats{
		Version:      inboxStatsVersion,
		BySource:     map[string]int{},
		DailyBuckets: map[string]InboxDayCounts{},
	}
}

func (fs *FileStore) saveInboxStatsLocked(stats InboxStats) error {
	if stats.Version == 0 {
		stats.Version = inboxStatsVersion
	}
	if stats.BySource == nil {
		stats.BySource = map[string]int{}
	}
	if stats.DailyBuckets == nil {
		stats.DailyBuckets = map[string]InboxDayCounts{}
	}
	return writeIndentJSONFile(fs.inboxStatsFile(), stats)
}

// pruneInboxStatsBuckets drops daily buckets older than the retention window.
func pruneInboxStatsBuckets(buckets map[string]InboxDayCounts) {
	if len(buckets) == 0 {
		return
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -inboxStatsBucketRetentionDays).Format("2006-01-02")
	for day := range buckets {
		if day < cutoff {
			delete(buckets, day)
		}
	}
}

// RecordInboxEvent updates the durable aggregate. It is best-effort: a failure
// to persist must never block the inbox action that triggered it, mirroring the
// activity-log philosophy.
func (fs *FileStore) RecordInboxEvent(evt InboxEvent) {
	evtType := strings.ToLower(strings.TrimSpace(evt.Type))
	switch evtType {
	case inboxEventAdded, inboxEventPromoted, inboxEventDeleted, inboxEventKept:
	default:
		return
	}

	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	stats := fs.readInboxStatsLocked()

	at := evt.AtMs
	if at <= 0 {
		at = time.Now().UnixMilli()
	}
	if stats.FirstEventAt == 0 || at < stats.FirstEventAt {
		stats.FirstEventAt = at
	}

	day := time.UnixMilli(at).UTC().Format("2006-01-02")
	bucket := stats.DailyBuckets[day]

	switch evtType {
	case inboxEventAdded:
		stats.TotalAdded++
		bucket.Added++
		source := strings.ToLower(strings.TrimSpace(evt.Source))
		if source == "" {
			source = "unknown"
		}
		stats.BySource[source]++
	case inboxEventPromoted:
		stats.TotalPromoted++
		bucket.Promoted++
	case inboxEventDeleted:
		stats.TotalDeleted++
		bucket.Deleted++
	case inboxEventKept:
		stats.TotalKept++
		bucket.Kept++
	}

	if evt.RetentionMs > 0 && (evtType == inboxEventPromoted || evtType == inboxEventDeleted) {
		stats.RetentionCount++
		stats.SumRetentionMs += evt.RetentionMs
	}

	stats.DailyBuckets[day] = bucket
	pruneInboxStatsBuckets(stats.DailyBuckets)

	_ = fs.saveInboxStatsLocked(stats)
}

// GetInboxStats returns a copy of the durable aggregate for the stats API.
func (fs *FileStore) GetInboxStats() InboxStats {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	stats := fs.readInboxStatsLocked()
	// Return copies of the maps so callers cannot mutate internal state.
	bySource := make(map[string]int, len(stats.BySource))
	for k, v := range stats.BySource {
		bySource[k] = v
	}
	buckets := make(map[string]InboxDayCounts, len(stats.DailyBuckets))
	for k, v := range stats.DailyBuckets {
		buckets[k] = v
	}
	stats.BySource = bySource
	stats.DailyBuckets = buckets
	return stats
}

// sortedInboxStatBucketDays returns the bucket day keys in ascending order,
// used by tests and any server-side consumers that need a stable sequence.
func sortedInboxStatBucketDays(buckets map[string]InboxDayCounts) []string {
	days := make([]string, 0, len(buckets))
	for day := range buckets {
		days = append(days, day)
	}
	sort.Strings(days)
	return days
}
