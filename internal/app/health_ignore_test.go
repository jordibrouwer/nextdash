package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func ignoreRequest(t *testing.T, h *Handlers, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/health/ignore", strings.NewReader(body))
	h.SetBookmarkHealthIgnores(rec, req)
	return rec
}

/*
An ignored condition leaves the flags, the counter and the score together.

The report builds status, flags, score and the summary in one pass so a tile
cannot disagree with the filter of the same name. Ignoring has to hold that
line: hiding "unused" from the filter while the tile still counts it would be
the exact failure that loop is written to prevent.
*/
func TestIgnoredConditionLeavesFlagsAndCountersTogether(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Archive","url":"https://archive.example","openCount":0,"lastOpened":0,
		 "healthIgnored":[{"flag":"unused"}]},
		{"name":"Fresh","url":"https://fresh.example","openCount":0,"lastOpened":0}
	]}`)

	report := healthReportVia(t, h)
	counts := flagCounts(report)

	if counts["unused"] != 1 || report.Summary.UnusedCount != 1 {
		t.Fatalf("unused: flag=%d tile=%d, want 1 and 1", counts["unused"], report.Summary.UnusedCount)
	}
	if report.Summary.IgnoredCount != 1 {
		t.Fatalf("ignoredCount = %d, want 1", report.Summary.IgnoredCount)
	}

	var archive *HealthIssue
	for i := range report.Issues {
		if report.Issues[i].URL == "https://archive.example" {
			archive = &report.Issues[i]
		}
	}
	if archive == nil {
		t.Fatal("the ignored bookmark is missing from the report")
	}
	// It says what it is hiding, or the Ignored list is a list nobody can audit.
	if len(archive.IgnoredFlags) != 1 || archive.IgnoredFlags[0].Flag != "unused" {
		t.Fatalf("ignoredFlags = %+v, want one entry for unused", archive.IgnoredFlags)
	}
	for _, flag := range archive.Flags {
		if flag == "unused" {
			t.Fatalf("the ignored condition is still in flags: %v", archive.Flags)
		}
	}
}

/*
Ignoring one condition does not silence the others.

This is the whole reason ignores are per condition: a bookmark allowed to sit
unopened must still shout the year its host dies.
*/
func TestIgnoringOneConditionLeavesTheRest(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"A","url":"https://a.example","openCount":0,"lastOpened":0,
		 "checkStatus":true,"lastChecked":1,"lastError":"HTTP 500",
		 "healthIgnored":[{"flag":"unused"}]}
	]}`)

	report := healthReportVia(t, h)

	if report.Summary.BrokenCount != 1 {
		t.Fatalf("brokenCount = %d, want 1 — the failure was not ignored", report.Summary.BrokenCount)
	}
	if report.Summary.UnusedCount != 0 {
		t.Fatalf("unusedCount = %d, want 0", report.Summary.UnusedCount)
	}
	if report.Issues[0].Status != "broken" {
		t.Fatalf("status = %q, want broken", report.Issues[0].Status)
	}
}

/*
A hidden failure is not a healthy link.

Ignoring "stale" leaves a healthy bookmark — nothing about the link is wrong.
Ignoring "broken" says do not tell me, and counting that as healthy would
inflate the one figure the reader trusts.
*/
func TestIgnoredFailureCountsAsNeitherBrokenNorHealthy(t *testing.T) {
	// Checked a moment ago and opened a moment ago, so nothing else holds: the
	// hidden failure has to be the only thing this row could be reported for.
	now := strconv.FormatInt(time.Now().UnixMilli(), 10)
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Walled","url":"https://walled.example","openCount":3,"lastOpened":`+now+`,
		 "checkStatus":true,"lastChecked":`+now+`,"lastError":"HTTP 403",
		 "previewTitle":"x","healthIgnored":[{"flag":"broken"}]}
	]}`)

	report := healthReportVia(t, h)

	if report.Summary.BrokenCount != 0 {
		t.Fatalf("brokenCount = %d, want 0", report.Summary.BrokenCount)
	}
	if report.Summary.HealthyCount != 0 {
		t.Fatalf("healthyCount = %d, want 0 — a hidden failure is not health", report.Summary.HealthyCount)
	}
	if report.Summary.IgnoredCount != 1 {
		t.Fatalf("ignoredCount = %d, want 1", report.Summary.IgnoredCount)
	}
	if report.Issues[0].Status != "ignored" {
		t.Fatalf("status = %q, want ignored", report.Issues[0].Status)
	}
}

// A snooze runs out on its own, which is what separates it from an ignore.
func TestExpiredSnoozeReportsAgain(t *testing.T) {
	past := time.Now().Add(-time.Hour).UnixMilli()
	future := time.Now().Add(24 * time.Hour).UnixMilli()

	expired, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"A","url":"https://a.example","openCount":0,"lastOpened":0,
		 "healthIgnored":[{"flag":"unused","until":`+strconv.FormatInt(past, 10)+`}]}
	]}`)
	if got := healthReportVia(t, expired).Summary.UnusedCount; got != 1 {
		t.Fatalf("expired snooze: unusedCount = %d, want 1", got)
	}

	live, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"A","url":"https://a.example","openCount":0,"lastOpened":0,
		 "healthIgnored":[{"flag":"unused","until":`+strconv.FormatInt(future, 10)+`}]}
	]}`)
	if got := healthReportVia(t, live).Summary.UnusedCount; got != 0 {
		t.Fatalf("live snooze: unusedCount = %d, want 0", got)
	}
}

// The endpoint adds without clearing what was there, because the caller is
// acting on a filter: ignoring stale for twelve rows must not un-ignore
// whatever else those rows carried.
func TestIgnoreEndpointAddsWithoutClearing(t *testing.T) {
	h, store := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"A","url":"https://a.example","healthIgnored":[{"flag":"unused"}]}
	]}`)

	rec := ignoreRequest(t, h, `{"targets":[{"pageId":1,"index":0,"url":"https://a.example"}],"add":["stale"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}

	stored := store.GetBookmarksByPage(1)[0].HealthIgnored
	if len(stored) != 2 {
		t.Fatalf("stored = %+v, want unused and stale", stored)
	}
}

// A row that has moved since the report was cached is skipped, not silenced.
func TestIgnoreEndpointSkipsAMovedBookmark(t *testing.T) {
	h, store := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"A","url":"https://a.example"},
		{"name":"B","url":"https://b.example"}
	]}`)

	rec := ignoreRequest(t, h, `{"targets":[{"pageId":1,"index":0,"url":"https://b.example"}],"add":["stale"]}`)
	var body struct{ Changed, Skipped int }
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Changed != 0 || body.Skipped != 1 {
		t.Fatalf("changed=%d skipped=%d, want 0 and 1", body.Changed, body.Skipped)
	}
	if len(store.GetBookmarksByPage(1)[0].HealthIgnored) != 0 {
		t.Fatal("the wrong bookmark was silenced")
	}
}

// Clear is the way back out, and an unknown flag is dropped rather than stored.
func TestIgnoreEndpointClearsAndRefusesNonsense(t *testing.T) {
	h, store := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"A","url":"https://a.example","healthIgnored":[{"flag":"stale"}]}
	]}`)

	ignoreRequest(t, h, `{"targets":[{"pageId":1,"index":0,"url":"https://a.example"}],"add":["not-a-flag"]}`)
	if got := store.GetBookmarksByPage(1)[0].HealthIgnored; len(got) != 1 || got[0].Flag != "stale" {
		t.Fatalf("stored = %+v, want the original entry only", got)
	}

	ignoreRequest(t, h, `{"targets":[{"pageId":1,"index":0,"url":"https://a.example"}],"clear":true}`)
	if got := store.GetBookmarksByPage(1)[0].HealthIgnored; len(got) != 0 {
		t.Fatalf("stored = %+v, want nothing after clear", got)
	}
}
