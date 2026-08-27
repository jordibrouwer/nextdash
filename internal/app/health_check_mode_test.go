package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// findIssue returns the report row for a bookmark name.
func findIssue(t *testing.T, report BookmarkHealthReport, name string) HealthIssue {
	t.Helper()
	for _, issue := range report.Issues {
		if issue.Name == name {
			return issue
		}
	}
	t.Fatalf("no report row for %q", name)
	return HealthIssue{}
}

// Reasons are human-readable sentences, so match on a stable fragment rather
// than the full string.
func hasReason(issue HealthIssue, substr string) bool {
	for _, r := range issue.Reasons {
		if strings.Contains(strings.ToLower(r), strings.ToLower(substr)) {
			return true
		}
	}
	return false
}

// Flags are exact machine values, unlike reasons — match them whole.
func hasFlag(issue HealthIssue, flag string) bool {
	for _, f := range issue.Flags {
		if f == flag {
			return true
		}
	}
	return false
}

// A monitored bookmark is checked more often than a periodic one, so it must not
// be scored as "never checked" just because checkStatus is off. Before this, the
// two flags overlapped and only checkStatus counted.
func TestMonitoredBookmarkCountsAsChecked(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	recent := time.Now().Add(-2 * time.Minute).UnixMilli()
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Monitored","url":"https://mon.example","monitor":true,"monitorIntervalMinutes":5,"lastChecked":` +
		itoa(recent) + `},
		{"name":"NeverChecked","url":"https://never.example","checkStatus":true}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	report := h.buildBookmarkHealthReport()

	mon := findIssue(t, report, "Monitored")
	if hasReason(mon, "never run") {
		t.Errorf("a monitored bookmark checked 2 minutes ago must not be 'unchecked': %#v", mon.Reasons)
	}
	if !mon.Monitor {
		t.Errorf("expected Monitor flag on the report row")
	}

	never := findIssue(t, report, "NeverChecked")
	if !hasReason(never, "never run") {
		t.Errorf("a checkStatus bookmark that was never checked should still be flagged: %#v", never.Reasons)
	}
}

// Staleness for a monitor is measured against its own interval: a 5-minute
// monitor that has been silent for a day is broken, even though the weekly
// threshold used for periodic checks would still call it fresh.
func TestMonitorStalenessUsesItsOwnInterval(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	dayOld := time.Now().Add(-24 * time.Hour).UnixMilli()
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"SilentMonitor","url":"https://mon.example","monitor":true,"monitorIntervalMinutes":5,"lastChecked":` +
		itoa(dayOld) + `},
		{"name":"PeriodicFine","url":"https://per.example","checkStatus":true,"lastChecked":` +
		itoa(dayOld) + `}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	report := h.buildBookmarkHealthReport()

	silent := findIssue(t, report, "SilentMonitor")
	if !hasReason(silent, "stale") {
		t.Errorf("a 5-minute monitor silent for a day should be flagged stale: %#v", silent.Reasons)
	}
	fine := findIssue(t, report, "PeriodicFine")
	if hasReason(fine, "stale") {
		t.Errorf("a daily-checked periodic bookmark is well inside the weekly bar: %#v", fine.Reasons)
	}
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
