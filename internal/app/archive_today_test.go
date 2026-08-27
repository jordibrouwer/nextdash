package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testNow = "Tue, 25 Aug 2026 12:00:00 GMT"

func mementoNow(t *testing.T) time.Time {
	t.Helper()
	when, err := http.ParseTime(testNow)
	if err != nil {
		t.Fatal(err)
	}
	return when
}

/*
The index carries captures that have not happened yet.

Measured live on 25 August 2026: example.com lists 1135 entries running to
31 December 2035, and Hacker News lists 3686 whose newest real capture is
24 August 2026 followed by one dated 2029. "The last memento" -- the plain
reading of the format -- therefore returns a capture that cannot exist, and it
does so for the busiest pages, which are the ones most likely to be looked up.

The live lookup after this filter reports 3685 captures for Hacker News and
1125 for example.com, so ten and one entries respectively were dropped.
*/
func TestTimeMapIgnoresCapturesDatedInTheFuture(t *testing.T) {
	timemap := strings.Join([]string{
		`<https://example.com/>; rel="original"`,
		`<https://archive.ph/timegate/https://example.com/>; rel="timegate"`,
		`<https://archive.ph/20210820120000/https://example.com/>; rel="first memento"; datetime="Fri, 20 Aug 2021 12:00:00 GMT"`,
		`<https://archive.ph/20260824132531/https://example.com/>; rel="memento"; datetime="Mon, 24 Aug 2026 13:25:31 GMT"`,
		`<https://archive.ph/20291231235959/https://example.com/>; rel="last memento"; datetime="Mon, 31 Dec 2029 23:59:59 GMT"`,
	}, ",\n")

	result, err := parseMementoTimeMap(strings.NewReader(timemap), mementoNow(t))
	if err != nil {
		t.Fatal(err)
	}
	if !result.Available {
		t.Fatal("nothing found in a list with three captures")
	}
	if !strings.Contains(result.URL, "20260824132531") {
		t.Errorf("newest capture is %q -- a 2029 capture cannot exist", result.URL)
	}
	if result.Captures != 2 {
		t.Errorf("counted %d captures, want 2 with the future one dropped", result.Captures)
	}
	// The oldest is the oldest real one, not the future entry.
	if got := time.UnixMilli(result.FirstSeen).UTC().Year(); got != 2021 {
		t.Errorf("first seen in %d, want 2021", got)
	}
}

// original, timegate and self describe the list; only mementos are captures.
func TestTimeMapCountsOnlyMementos(t *testing.T) {
	timemap := strings.Join([]string{
		`<https://example.com/>; rel="original"`,
		`<https://archive.ph/timemap/https://example.com/>; rel="self"; type="application/link-format"`,
		`<https://archive.ph/timegate/https://example.com/>; rel="timegate"`,
		`<https://archive.ph/20240101120000/https://example.com/>; rel="memento"; datetime="Mon, 01 Jan 2024 12:00:00 GMT"`,
	}, ",\n")

	result, err := parseMementoTimeMap(strings.NewReader(timemap), mementoNow(t))
	if err != nil {
		t.Fatal(err)
	}
	if result.Captures != 1 {
		t.Errorf("counted %d, want 1: the list's own metadata is not a capture", result.Captures)
	}
}

// A URL may contain a comma, and the format separates entries with one.
func TestTimeMapSplitsOnEntryBoundariesNotEveryComma(t *testing.T) {
	timemap := `<https://example.com/a,b>; rel="original",` +
		`<https://archive.ph/20240101120000/https://example.com/a,b>; rel="memento"; datetime="Mon, 01 Jan 2024 12:00:00 GMT"`

	result, err := parseMementoTimeMap(strings.NewReader(timemap), mementoNow(t))
	if err != nil {
		t.Fatal(err)
	}
	if result.Captures != 1 {
		t.Fatalf("counted %d, want 1: a comma inside a URL is not a separator", result.Captures)
	}
	if !strings.HasSuffix(result.URL, "/a,b") {
		t.Errorf("the URL was cut at its comma: %q", result.URL)
	}
	// The datetime itself contains a comma too ("Mon, 01 Jan...").
	if time.UnixMilli(result.Timestamp).UTC().Year() != 2024 {
		t.Errorf("lost the datetime across its own comma: %v", time.UnixMilli(result.Timestamp).UTC())
	}
}

/*
Mirrors are not interchangeable, so the lookup tries them in turn.

Measured on 25 August 2026: archive.is did not resolve at all, archive.today
answered 301, archive.ph and archive.li answered 200. Which one works depends on
the network the server sits on, so a single host is a feature that works for
some installs and not others.
*/
func TestLookupTriesTheNextMirrorWhenOneFails(t *testing.T) {
	h := newTestHandlers(t)

	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer dead.Close()

	asked := 0
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked++
		fmt.Fprint(w, `<https://example.com/>; rel="original",`+"\n"+
			`<https://archive.ph/20240101120000/https://example.com/>; rel="memento"; datetime="Mon, 01 Jan 2024 12:00:00 GMT"`)
	}))
	defer good.Close()

	previous := archiveTodayMirrors
	archiveTodayMirrors = []string{dead.URL, good.URL}
	defer func() { archiveTodayMirrors = previous }()

	result, err := h.LookupArchiveToday(context.Background(), "https://example.com/")
	if err != nil {
		t.Fatalf("gave up after one mirror failed: %v", err)
	}
	if !result.Available || asked != 1 {
		t.Errorf("second mirror not used: available=%v asked=%d", result.Available, asked)
	}
	if result.Mirror != good.URL {
		t.Errorf("mirror reported as %q, want the one that answered", result.Mirror)
	}
}

// A mirror saying "nothing here" has answered; the others need not be asked.
func TestLookupStopsWhenAMirrorSaysItHoldsNothing(t *testing.T) {
	h := newTestHandlers(t)

	asked := 0
	empty := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked++
		w.WriteHeader(http.StatusNotFound)
	}))
	defer empty.Close()

	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked += 100
	}))
	defer second.Close()

	previous := archiveTodayMirrors
	archiveTodayMirrors = []string{empty.URL, second.URL}
	defer func() { archiveTodayMirrors = previous }()

	result, err := h.LookupArchiveToday(context.Background(), "https://example.com/")
	if err != nil {
		t.Fatal(err)
	}
	if result.Available {
		t.Error("reported a copy where the mirror said there is none")
	}
	if asked != 1 {
		t.Errorf("asked %d mirrors, want 1: a 404 is an answer", asked)
	}
}

// Every mirror failing is a failure, and says so once rather than per mirror.
func TestLookupReportsWhenNoMirrorAnswers(t *testing.T) {
	h := newTestHandlers(t)
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer dead.Close()

	previous := archiveTodayMirrors
	archiveTodayMirrors = []string{dead.URL, dead.URL}
	defer func() { archiveTodayMirrors = previous }()

	if _, err := h.LookupArchiveToday(context.Background(), "https://example.com/"); err == nil {
		t.Fatal("no error when every mirror failed")
	}
}

/*
A capture must be reachable, and over the connection the reader already has.

Measured live: a lookup answered by archive.ph hands back capture URLs on
archive.md over http, and archive.md does not accept an https connection at all.
Following the URL as given therefore drops the reader onto plaintext at a fourth
domain they never chose, while the mirror that just answered holds the same
capture.
*/
func TestCaptureURLsPointAtTheMirrorThatAnswered(t *testing.T) {
	h := newTestHandlers(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Exactly what archive.ph returned for go.dev/blog.
		fmt.Fprint(w, `<https://go.dev/blog/>; rel="original",`+"\n"+
			`<http://archive.md/20260324065815/https://go.dev/blog/>; rel="memento"; datetime="Tue, 24 Mar 2026 06:58:15 GMT"`)
	}))
	defer server.Close()

	previous := archiveTodayMirrors
	archiveTodayMirrors = []string{server.URL}
	defer func() { archiveTodayMirrors = previous }()

	result, err := h.LookupArchiveToday(context.Background(), "https://go.dev/blog/")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(result.URL, "archive.md") {
		t.Errorf("capture left on a host the reader never chose: %q", result.URL)
	}
	if !strings.HasPrefix(result.URL, server.URL) {
		t.Errorf("capture is at %q, want it on the mirror that answered (%s)", result.URL, server.URL)
	}
	// The timestamp path and the archived address must survive intact.
	if !strings.Contains(result.URL, "20260324065815/https://go.dev/blog/") {
		t.Errorf("the capture path was mangled: %q", result.URL)
	}
}

// Rehosting is scheme and host only; a URL it cannot read is left alone.
func TestRehostCaptureURLLeavesWhatItCannotRead(t *testing.T) {
	if got := rehostCaptureURL("", "https://archive.ph"); got != "" {
		t.Errorf("invented a URL: %q", got)
	}
	if got := rehostCaptureURL("not a url at all", "https://archive.ph"); got != "not a url at all" {
		t.Errorf("mangled an unparseable value: %q", got)
	}
	// Query and fragment are part of the archived address.
	got := rehostCaptureURL("http://archive.md/2024/https://x.example/a?b=1#c", "https://archive.ph")
	if got != "https://archive.ph/2024/https://x.example/a?b=1#c" {
		t.Errorf("got %q", got)
	}
}
