package main

import (
	"encoding/json"
	"log"
	"os"
	"sort"
	"time"
)

const (
	// healthTrendRetention is how far back daily points are kept. Longer than the
	// 30-day sample retention on purpose: a point is a few dozen bytes, and "how
	// did this quarter go" is the question a trend exists to answer.
	healthTrendRetention = 90 * 24 * time.Hour
	// maxHealthTrendPoints bounds the file even if the clock jumps around. One
	// point per day means retention hits first under any sane clock; this is the
	// backstop for one that is not.
	maxHealthTrendPoints = 400
)

// dayStart truncates to midnight UTC, which is the key a point is stored under.
//
// UTC rather than local time so a machine that changes timezone does not create
// a second point for a day it already recorded, or silently reorder history.
func dayStart(t time.Time) int64 {
	return t.UTC().Truncate(24 * time.Hour).UnixMilli()
}

func emptyHealthTrend() HealthTrendFile {
	return HealthTrendFile{GeneratedAt: time.Now().UnixMilli()}
}

// readHealthTrendFile loads the recorded points. Like the sample history, a
// missing or corrupt file is not an error: the trend is derived data and losing
// it must never block a report from being served — it just restarts the record.
func readHealthTrendFile() HealthTrendFile {
	data, err := os.ReadFile(healthTrendFilePath())
	if err != nil {
		return emptyHealthTrend()
	}
	var trend HealthTrendFile
	if err := json.Unmarshal(data, &trend); err != nil {
		return emptyHealthTrend()
	}
	return trend
}

func writeHealthTrendFile(trend HealthTrendFile) error {
	return writeCompactJSONFile(healthTrendFilePath(), trend)
}

// trimTrendPoints applies both retention rules: drop anything older than the
// cutoff, then keep only the newest maxHealthTrendPoints. Input is sorted first
// so a clock that went backwards cannot truncate good data.
func trimTrendPoints(points []HealthTrendPoint, cutoff int64) []HealthTrendPoint {
	if len(points) == 0 {
		return nil
	}
	if !sort.SliceIsSorted(points, func(i, j int) bool { return points[i].T < points[j].T }) {
		sort.SliceStable(points, func(i, j int) bool { return points[i].T < points[j].T })
	}
	start := sort.Search(len(points), func(i int) bool { return points[i].T >= cutoff })
	kept := points[start:]
	if len(kept) > maxHealthTrendPoints {
		kept = kept[len(kept)-maxHealthTrendPoints:]
	}
	if len(kept) == 0 {
		return nil
	}
	out := make([]HealthTrendPoint, len(kept))
	copy(out, kept)
	return out
}

// trendPointFromSummary turns a report summary into the day's point.
func trendPointFromSummary(s HealthSummary, averageScore int, at time.Time) HealthTrendPoint {
	return HealthTrendPoint{
		T:         dayStart(at),
		Total:     s.TotalBookmarks,
		Healthy:   s.HealthyCount,
		Broken:    s.BrokenCount,
		MonDown:   s.MonitorDownCount,
		Monitored: s.MonitoredCount,
		Unchecked: s.UncheckedCount,
		Stale:     s.StaleCount,
		Unused:    s.UnusedCount,
		Duplicate: s.DuplicateCount,
		Score:     averageScore,
	}
}

// upsertTrendPoint records one day's point, replacing any point already stored
// for that day.
//
// Last write wins within a day rather than first: the report is rebuilt many
// times a day, and the most recent view of today is the truthful one. Yesterday
// and earlier are never rewritten, so history cannot be revised by a later run.
func upsertTrendPoint(points []HealthTrendPoint, point HealthTrendPoint) []HealthTrendPoint {
	for i := range points {
		if points[i].T == point.T {
			points[i] = point
			return points
		}
	}
	return append(points, point)
}

// averageHealthScore is the mean score across every issue in the report, which is
// what the trend line plots. Returns 0 for an empty collection rather than
// dividing by zero — an install with no bookmarks has no score to report.
func averageHealthScore(issues []HealthIssue) int {
	if len(issues) == 0 {
		return 0
	}
	total := 0
	for _, issue := range issues {
		total += issue.Score
	}
	return total / len(issues)
}

// recordHealthTrend stores today's point for a freshly built report.
//
// Called after a report build rather than on a timer: the report is the only
// thing that knows these numbers, and building one is already the moment they
// are known to be current. A day with no visit records no point, which the UI
// renders as a gap rather than inventing a flat line through it.
func (h *Handlers) recordHealthTrend(report BookmarkHealthReport) {
	h.healthTrendMu.Lock()
	defer h.healthTrendMu.Unlock()

	now := time.Now()
	trend := readHealthTrendFile()
	point := trendPointFromSummary(report.Summary, averageHealthScore(report.Issues), now)
	trend.Points = upsertTrendPoint(trend.Points, point)
	trend.Points = trimTrendPoints(trend.Points, now.Add(-healthTrendRetention).UnixMilli())
	trend.GeneratedAt = now.UnixMilli()

	if err := writeHealthTrendFile(trend); err != nil {
		// A trend that cannot be written is not worth failing a report over.
		log.Printf("health trend: failed to record today's point: %v", err)
	}
}

// readHealthTrend returns the stored points, newest last, with retention applied
// so a file left over from a long-idle install cannot serve stale points.
func (h *Handlers) readHealthTrend() []HealthTrendPoint {
	h.healthTrendMu.Lock()
	defer h.healthTrendMu.Unlock()

	trend := readHealthTrendFile()
	return trimTrendPoints(trend.Points, time.Now().Add(-healthTrendRetention).UnixMilli())
}
