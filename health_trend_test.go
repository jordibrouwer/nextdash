package main

import (
	"os"
	"testing"
	"time"
)

// The trend is the only record of what the collection looked like on a day other
// than today, so the rules that protect it matter more than the arithmetic: one
// point per day, history never rewritten, retention applied, and a corrupt file
// never blocking a report.

func withTrendDir(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	_ = os.MkdirAll(dir, 0o755)
}

func TestDayStartIsStableWithinADay(t *testing.T) {
	base := time.Date(2026, 3, 14, 0, 0, 0, 0, time.UTC)
	morning := dayStart(base.Add(2 * time.Hour))
	evening := dayStart(base.Add(23 * time.Hour))
	if morning != evening {
		t.Errorf("same day produced different keys: %d vs %d", morning, evening)
	}
	if next := dayStart(base.Add(25 * time.Hour)); next == morning {
		t.Errorf("the next day reused the same key: %d", next)
	}
}

// A day is recorded once. Rebuilding the report many times a day must not append
// a point each time, or a week of use would look like thousands of days.
func TestUpsertKeepsOnePointPerDay(t *testing.T) {
	day := dayStart(time.Now())
	points := []HealthTrendPoint{{T: day, Healthy: 1, Total: 10}}
	points = upsertTrendPoint(points, HealthTrendPoint{T: day, Healthy: 7, Total: 10})

	if len(points) != 1 {
		t.Fatalf("got %d points, want 1", len(points))
	}
	// Last write wins: the most recent view of today is the truthful one.
	if points[0].Healthy != 7 {
		t.Errorf("Healthy = %d, want 7 (the later value)", points[0].Healthy)
	}
}

// An earlier day must survive a later one being recorded, or the trend would
// only ever hold today.
func TestUpsertKeepsEarlierDays(t *testing.T) {
	now := time.Now()
	yesterday := dayStart(now.Add(-24 * time.Hour))
	today := dayStart(now)

	points := []HealthTrendPoint{{T: yesterday, Healthy: 3, Total: 10}}
	points = upsertTrendPoint(points, HealthTrendPoint{T: today, Healthy: 9, Total: 10})

	if len(points) != 2 {
		t.Fatalf("got %d points, want 2", len(points))
	}
	if points[0].T != yesterday || points[0].Healthy != 3 {
		t.Errorf("yesterday was rewritten: %+v", points[0])
	}
}

func TestTrimTrendPointsDropsOldAndSorts(t *testing.T) {
	now := time.Now()
	cutoff := now.Add(-healthTrendRetention).UnixMilli()
	points := []HealthTrendPoint{
		{T: now.UnixMilli(), Healthy: 3},
		{T: now.Add(-200 * 24 * time.Hour).UnixMilli(), Healthy: 1}, // beyond retention
		{T: now.Add(-24 * time.Hour).UnixMilli(), Healthy: 2},
	}
	kept := trimTrendPoints(points, cutoff)

	if len(kept) != 2 {
		t.Fatalf("got %d points, want 2 (the stale one dropped)", len(kept))
	}
	if kept[0].T > kept[1].T {
		t.Errorf("points came back unsorted: %d then %d", kept[0].T, kept[1].T)
	}
}

func TestAverageHealthScore(t *testing.T) {
	if got := averageHealthScore(nil); got != 0 {
		t.Errorf("empty collection scored %d, want 0", got)
	}
	issues := []HealthIssue{{Score: 100}, {Score: 50}, {Score: 60}}
	if got := averageHealthScore(issues); got != 70 {
		t.Errorf("average = %d, want 70", got)
	}
}

// The trend is derived, disposable data. A corrupt file must restart the record
// rather than propagate an error into the report path.
func TestReadHealthTrendFileToleratesCorruption(t *testing.T) {
	withTrendDir(t)
	if err := os.WriteFile(healthTrendFilePath(), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	trend := readHealthTrendFile()
	if len(trend.Points) != 0 {
		t.Errorf("corrupt file produced %d points, want 0", len(trend.Points))
	}
}

// End to end through the handler: recording twice in one day leaves one point,
// and reading it back returns what was written.
func TestRecordHealthTrendRoundTrip(t *testing.T) {
	withTrendDir(t)
	h := &Handlers{}

	report := BookmarkHealthReport{
		Summary: HealthSummary{TotalBookmarks: 10, HealthyCount: 6, BrokenCount: 2},
		Issues:  []HealthIssue{{Score: 80}, {Score: 60}},
	}
	h.recordHealthTrend(report)
	h.recordHealthTrend(report)

	points := h.readHealthTrend()
	if len(points) != 1 {
		t.Fatalf("got %d points after two recordings on one day, want 1", len(points))
	}
	if points[0].Total != 10 || points[0].Healthy != 6 {
		t.Errorf("stored point = %+v, want Total 10 / Healthy 6", points[0])
	}
	if points[0].Score != 70 {
		t.Errorf("Score = %d, want 70 (the mean of 80 and 60)", points[0].Score)
	}
}

// The daily point carries the collection, not only its health.
//
// Statistics could show every figure as a number and none as a direction:
// "102 bookmarks" says nothing about whether that is ten more than last week.
// Untagged and opens are the two that move on their own — tagging is the
// tidying people actually do, opens are what the library is for — and both are
// already counted when a report is built.
func TestTrendPointCarriesUntaggedAndOpens(t *testing.T) {
	bookmarks := []Bookmark{
		{URL: "https://a.example", Tags: []string{"dev"}, OpenCount: 4},
		{URL: "https://b.example", OpenCount: 6},
		{URL: "https://c.example"},
	}

	point := trendPointFromSummary(HealthSummary{TotalBookmarks: 3}, 90, time.Now(), bookmarks)

	if point.Untagged != 2 {
		t.Fatalf("untagged = %d, want 2", point.Untagged)
	}
	if point.Opens != 10 {
		t.Fatalf("opens = %d, want 10", point.Opens)
	}
	if point.Total != 3 {
		t.Fatalf("total = %d, want 3 — the summary still drives the rest", point.Total)
	}
}
