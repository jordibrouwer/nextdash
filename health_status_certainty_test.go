package main

import (
	"testing"
	"time"
)

/*
The codes that describe the request, not the page.

A bot fetching a page gets 403 from Cloudflare's browser check, 429 from a rate
limiter, 503 from a cold start. Reporting those as rot makes a dashboard of
working bookmarks look half dead, and a reader who learns to ignore the warnings
misses the real 404s along with them.
*/
func TestFailureIsUncertainSeparatesBlockedFromGone(t *testing.T) {
	uncertain := []string{
		"HTTP 403", "HTTP 401", "HTTP 429", "HTTP 500", "HTTP 502", "HTTP 503",
		"HTTP 504", "HTTP 408", "HTTP 999",
		"Timeout", "Unreachable", "Connection refused",
	}
	for _, detail := range uncertain {
		if !failureIsUncertain(detail) {
			t.Errorf("failureIsUncertain(%q) = false; this says nothing about the page", detail)
		}
	}

	gone := []string{
		"HTTP 404", "HTTP 410", "HTTP 451",
		// The host is really not there, which is a fact about the page's home.
		"DNS lookup failed", "TLS error",
		// A content rule that failed is a statement about what was served.
		"Page says it does not exist", "Page is missing the expected text",
	}
	for _, detail := range gone {
		if failureIsUncertain(detail) {
			t.Errorf("failureIsUncertain(%q) = true; this is evidence about the page", detail)
		}
	}

	if failureIsUncertain("") {
		t.Error("an empty detail is not a failure at all")
	}
}

func TestHTTPStatusFromDetail(t *testing.T) {
	cases := map[string]int{
		"HTTP 403":     403,
		"http 404":     404,
		"HTTP 999":     999,
		"HTTP":         0,
		"HTTP abc":     0,
		"Timeout":      0,
		"":             0,
		"HTTP 40":      0,
		"HTTP 4041":    0,
		"HTTP 404 Not": 404,
	}
	for detail, want := range cases {
		if got := httpStatusFromDetail(detail); got != want {
			t.Errorf("httpStatusFromDetail(%q) = %d, want %d", detail, got, want)
		}
	}
}

// The certainty of a code, independent of any sentence.
func TestCertaintyForStatus(t *testing.T) {
	for _, code := range []int{404, 410, 451} {
		if certaintyForStatus(code) != statusCertaintyGone {
			t.Errorf("%d should be evidence the page is gone", code)
		}
	}
	for _, code := range []int{200, 403, 429, 503, 999} {
		if certaintyForStatus(code) != statusCertaintyUnknown {
			t.Errorf("%d should not be evidence the page is gone", code)
		}
	}
}

/*
A blocked link is not dated from the archive.

"gone from the web since 2019" beside a bot check is confidently wrong about a
page that opens fine in a browser -- and it spends an expensive index query to
be so.
*/
func TestArchiveBackfillSkipsUncertainFailures(t *testing.T) {
	now := time.Now()
	blocked := Bookmark{URL: "https://x.example/", LastError: "HTTP 403"}
	if archiveBackfillDue(blocked, now) {
		t.Error("asked the index about a link that is merely blocked")
	}
	gone := Bookmark{URL: "https://x.example/", LastError: "HTTP 404"}
	if !archiveBackfillDue(gone, now) {
		t.Error("skipped a link that really is gone")
	}
}
