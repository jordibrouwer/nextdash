package app

import (
	"strconv"
	"testing"
	"time"
)

// The KPI tiles read Summary.*Count while the filter pills list issues matching a
// flag. If those two are derived differently, a tile becomes a dead end: it shows
// a count, you click it, and the list is empty.
//
// Status alone cannot carry this — it holds only the worst condition — so every
// counted condition has to appear in Flags too. These tests pin the two together.

// flagCounts tallies how many issues carry each flag, which is exactly what the
// filter pills list.
func flagCounts(r BookmarkHealthReport) map[string]int {
	counts := map[string]int{}
	for _, issue := range r.Issues {
		for _, f := range issue.Flags {
			counts[f]++
		}
	}
	return counts
}

// A bookmark can be several things at once. Two copies of one URL that were never
// opened and have no preview are duplicate *and* unused *and* missing-preview:
// status reports only "duplicate", so the other two tiles must still find them.
func TestSummaryCountsMatchFlagsWhenConditionsOverlap(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"A","url":"https://dup.example","openCount":0,"lastOpened":0},
		{"name":"B","url":"https://dup.example","openCount":0,"lastOpened":0}
	]}`)

	report := healthReportVia(t, h)
	counts := flagCounts(report)
	s := report.Summary

	// Guard the premise: if status stopped being overruled here, this test would
	// pass without proving anything.
	for _, issue := range report.Issues {
		if issue.Status != "duplicate" {
			t.Fatalf("premise broken: status = %q, want \"duplicate\" (the overlap this test relies on)", issue.Status)
		}
	}

	if s.DuplicateCount != counts["duplicate"] {
		t.Errorf("duplicate: tile=%d filter=%d", s.DuplicateCount, counts["duplicate"])
	}
	if s.UnusedCount != counts["unused"] {
		t.Errorf("unused: tile=%d filter=%d", s.UnusedCount, counts["unused"])
	}
	if s.MissingPreviewCount != counts["missing-preview"] {
		t.Errorf("missing-preview: tile=%d filter=%d", s.MissingPreviewCount, counts["missing-preview"])
	}
	// The other direction of exclusivity: a bookmark with problems must not carry
	// the healthy flag, or the Healthy filter would list bookmarks the Healthy
	// tile never counted — the same dead end, mirrored.
	if counts["healthy"] != 0 {
		t.Errorf("healthy flag on %d issue(s) that have problems", counts["healthy"])
	}
	if s.HealthyCount != counts["healthy"] {
		t.Errorf("healthy: tile=%d filter=%d", s.HealthyCount, counts["healthy"])
	}
}

// A broken bookmark outranks everything, so without flags none of its other
// problems would be listable. Broken is also the one status that is *not* mirrored
// into BrokenCount for monitors, so this pins the flag to the condition, not the
// counter.
func TestBrokenBookmarkStillCarriesItsOtherFlags(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Dead","url":"https://dead.example","checkStatus":true,"lastError":"HTTP 500","lastChecked":1,"openCount":0,"lastOpened":0}
	]}`)

	report := healthReportVia(t, h)
	issue := report.Issues[0]
	if issue.Status != "broken" {
		t.Fatalf("premise broken: status = %q, want \"broken\"", issue.Status)
	}

	counts := flagCounts(report)
	if counts["broken"] != 1 {
		t.Errorf("broken flag missing: %v", issue.Flags)
	}
	if report.Summary.UnusedCount != counts["unused"] {
		t.Errorf("unused: tile=%d filter=%d — a broken bookmark that was never opened is still unused",
			report.Summary.UnusedCount, counts["unused"])
	}
}

// Healthy is the absence of every other condition, so it must never sit alongside
// one — otherwise the Healthy tile would count bookmarks that have something wrong.
func TestHealthyFlagIsExclusive(t *testing.T) {
	recent := strconv.FormatInt(time.Now().Add(-2*time.Hour).UnixMilli(), 10)
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Fine","url":"https://fine.example","previewTitle":"Fine","openCount":3,"lastOpened":`+recent+`}
	]}`)

	report := healthReportVia(t, h)
	issue := report.Issues[0]
	if issue.Status != "healthy" {
		t.Fatalf("premise broken: status = %q, want \"healthy\" (flags: %v)", issue.Status, issue.Flags)
	}
	if len(issue.Flags) != 1 || issue.Flags[0] != "healthy" {
		t.Errorf("healthy issue carries extra flags: %v", issue.Flags)
	}
	if report.Summary.HealthyCount != flagCounts(report)["healthy"] {
		t.Errorf("healthy: tile=%d filter=%d", report.Summary.HealthyCount, flagCounts(report)["healthy"])
	}
}

// Both "never run" and "overdue" are reported as unchecked and both increment
// UncheckedCount, so both have to produce the flag.
func TestStaleCheckCountsAsUnchecked(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"NeverRun","url":"https://never.example","checkStatus":true,"lastChecked":0},
		{"name":"Overdue","url":"https://overdue.example","checkStatus":true,"lastChecked":1}
	]}`)

	report := healthReportVia(t, h)
	counts := flagCounts(report)
	if report.Summary.UncheckedCount != counts["unchecked"] {
		t.Errorf("unchecked: tile=%d filter=%d", report.Summary.UncheckedCount, counts["unchecked"])
	}
	if counts["unchecked"] != 2 {
		t.Errorf("unchecked flag count = %d, want 2 (never-run and overdue)", counts["unchecked"])
	}
}
