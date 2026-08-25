package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// cdxAnswer builds an index response: header row first, then captures.
func cdxAnswer(rows [][]string) string {
	all := append([][]string{{"timestamp", "original", "statuscode", "digest"}}, rows...)
	data, _ := json.Marshal(all)
	return string(data)
}

/*
 * The index is asked twice per lookup: once newest-first for what it gets today,
 * and once filtered to the successful captures. They cannot be one query --
 * `filter` and `sort=reverse` return nothing together on the real index, which
 * is exactly the bug this stub shape exists to keep out.
 *
 * `tail` is newest-first; `good` is oldest-first, as the index returns without
 * a sort.
 */
func withCDXQueries(t *testing.T, tail, good [][]string, status int) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		if r.URL.Query().Get("filter") != "" && r.URL.Query().Get("sort") != "" {
			t.Errorf("filter and sort sent together; the real index answers nothing to that")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("filter") == "statuscode:200" {
			fmt.Fprint(w, cdxAnswer(good))
			return
		}
		fmt.Fprint(w, cdxAnswer(tail))
	}))
	original := waybackCDXAPI
	waybackCDXAPI = server.URL
	t.Cleanup(func() {
		waybackCDXAPI = original
		server.Close()
	})
}

func withCDX(t *testing.T, body string, status int) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	}))
	original := waybackCDXAPI
	waybackCDXAPI = server.URL
	t.Cleanup(func() {
		waybackCDXAPI = original
		server.Close()
	})
}

func millis(stamp string) int64 {
	at, _ := time.Parse("20060102150405", stamp)
	return at.UnixMilli()
}

/*
The whole reason for reading the index rather than the availability API.

For a dead link the most recent capture is usually a capture of the error page,
which is exactly what the availability API hands back. The last capture that
answered 200 is the last version of the page that really existed, and the
capture after it is when the archive first saw it stop working.
*/
func TestArchiveHistoryOffersTheLastWorkingCapture(t *testing.T) {
	h := newTestHandlers(t)
	withCDXQueries(t,
		// Newest first: today the archive gets a 404.
		[][]string{
			{"20240301120000", "http://example.com/x", "404", "d3"},
			{"20230601120000", "http://example.com/x", "404", "d2"},
			{"20190315120000", "http://example.com/x", "200", "d1"},
			{"20150101120000", "http://example.com/x", "200", "d0"},
		},
		// Oldest first: the captures that worked.
		[][]string{
			{"20150101120000", "http://example.com/x", "200", "d0"},
			{"20190315120000", "http://example.com/x", "200", "d1"},
		}, http.StatusOK)

	got, err := h.lookupArchiveHistory(context.Background(), "http://example.com/x")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if !got.Snapshot.Available {
		t.Fatal("no snapshot offered although the page was captured working")
	}
	// The 2019 capture, not the 2024 one that archived the 404.
	if got.Snapshot.Timestamp != millis("20190315120000") {
		t.Errorf("offered the capture from %d, want the last working one", got.Snapshot.Timestamp)
	}
	if got.Snapshot.URL != "https://web.archive.org/web/20190315120000/http://example.com/x" {
		t.Errorf("snapshot URL = %q", got.Snapshot.URL)
	}
	// The earliest evidence it stopped working: the capture right after the
	// last good one.
	if got.DiedAt != millis("20230601120000") {
		t.Errorf("diedAt = %d, want the first failing capture", got.DiedAt)
	}
	if got.LastStatus != "404" {
		t.Errorf("lastStatus = %q, want what the archive gets today", got.LastStatus)
	}
	if got.Captures != 4 {
		t.Errorf("captures = %d", got.Captures)
	}
	if got.FirstSeen != millis("20150101120000") {
		t.Errorf("firstSeen = %d, want the oldest working capture read", got.FirstSeen)
	}
}

// A page that still works has no death date, and its newest capture is the one
// worth offering.
func TestArchiveHistoryLeavesAWorkingPageUndated(t *testing.T) {
	h := newTestHandlers(t)
	withCDXQueries(t,
		[][]string{
			{"20260101120000", "http://example.com/live", "200", "d2"},
			{"20200101120000", "http://example.com/live", "200", "d1"},
		},
		[][]string{
			{"20200101120000", "http://example.com/live", "200", "d1"},
			{"20260101120000", "http://example.com/live", "200", "d2"},
		}, http.StatusOK)

	got, err := h.lookupArchiveHistory(context.Background(), "http://example.com/live")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if got.DiedAt != 0 {
		t.Errorf("diedAt = %d, want none for a page whose newest capture works", got.DiedAt)
	}
	if got.Snapshot.Timestamp != millis("20260101120000") {
		t.Errorf("offered %d, want the newest working capture", got.Snapshot.Timestamp)
	}
}

// Captured, never successfully: nothing to offer and nothing to date, since the
// page may have been broken before the archive ever looked.
func TestArchiveHistoryWithNoWorkingCaptureOffersNothing(t *testing.T) {
	h := newTestHandlers(t)
	withCDXQueries(t,
		[][]string{
			{"20240301120000", "http://example.com/x", "404", "d2"},
			{"20230601120000", "http://example.com/x", "500", "d1"},
		},
		nil, http.StatusOK)

	got, err := h.lookupArchiveHistory(context.Background(), "http://example.com/x")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if got.Snapshot.Available {
		t.Error("offered a capture that never worked")
	}
	if got.DiedAt != 0 {
		t.Errorf("diedAt = %d, want none when nothing was ever good", got.DiedAt)
	}
	// It still counted, which is worth more than an empty answer.
	if got.Captures != 2 {
		t.Errorf("captures = %d, want the count it did see", got.Captures)
	}
}

// A never-captured URL answers with an empty array, which is an answer.
func TestArchiveHistoryHandlesNeverCaptured(t *testing.T) {
	h := newTestHandlers(t)
	withCDX(t, "[]", http.StatusOK)

	got, err := h.lookupArchiveHistory(context.Background(), "http://example.com/nope")
	if err != nil {
		t.Fatalf("an empty index answer is not an error: %v", err)
	}
	if got.Snapshot.Available || got.Captures != 0 {
		t.Errorf("got %+v, want nothing", got)
	}
}

/*
Columns are read by name, not by position.

The request names the fields it wants, but the header comes back with the
answer, and reading by position would silently put timestamps in the status
field if the index ever reordered them.
*/
func TestArchiveHistoryReadsColumnsByName(t *testing.T) {
	h := newTestHandlers(t)
	reordered, _ := json.Marshal([][]string{
		{"statuscode", "digest", "original", "timestamp"},
		{"200", "d1", "http://example.com/x", "20190315120000"},
	})
	withCDX(t, string(reordered), http.StatusOK)
	// Both queries hit the same stub here, which is what this is about: the
	// header names the columns, not their position.

	got, err := h.lookupArchiveHistory(context.Background(), "http://example.com/x")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if got.Snapshot.Timestamp != millis("20190315120000") {
		t.Errorf("timestamp = %d, want it read by column name", got.Snapshot.Timestamp)
	}
	if got.LastStatus != "200" {
		t.Errorf("lastStatus = %q", got.LastStatus)
	}
}

func TestArchiveHistoryReportsAnIndexFailure(t *testing.T) {
	h := newTestHandlers(t)
	withCDX(t, "", http.StatusInternalServerError)
	if _, err := h.lookupArchiveHistory(context.Background(), "http://example.com/x"); err == nil {
		t.Error("a failing index read as a successful lookup")
	}
}

func TestWaybackTimestampToMillisRefusesJunk(t *testing.T) {
	for _, bad := range []string{"", "2019", "notatimestamp!", "20191340120000"} {
		if got := waybackTimestampToMillis(bad); got != 0 {
			t.Errorf("waybackTimestampToMillis(%q) = %d, want 0", bad, got)
		}
	}
}

/*
The capture stays where callers already look for it.

This route answered a bare archiveSnapshot for several releases, and the health
view reads url/timestamp/available straight off the top level. Nesting them
under `snapshot` broke "recover from archive" without failing anything: the
request still succeeded, the fields were simply somewhere else. Both shapes are
answered now, and this is here so a future tidy-up cannot quietly drop the flat
one again.
*/
func TestArchiveHistoryKeepsTheFlatSnapshotFields(t *testing.T) {
	h := newTestHandlers(t)
	withCDXQueries(t,
		[][]string{{"20240301120000", "http://example.com/x", "404", "d2"}},
		[][]string{{"20190315120000", "http://example.com/x", "200", "d1"}},
		http.StatusOK)

	got, err := h.lookupArchiveHistory(context.Background(), "http://example.com/x")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}

	payload, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// What the health view reads.
	if decoded["available"] != true {
		t.Errorf("top-level available = %v, want true", decoded["available"])
	}
	if url, _ := decoded["url"].(string); url == "" {
		t.Error("top-level url is missing; the health view has nothing to open")
	}
	// And what a reader of the history shape reads.
	nested, _ := decoded["snapshot"].(map[string]any)
	if nested == nil || nested["url"] != decoded["url"] {
		t.Errorf("nested snapshot = %v, want the same capture", nested)
	}
	if decoded["diedAt"] == nil {
		t.Error("the history is gone from the answer")
	}
}
