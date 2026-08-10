package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The default rule treats anything under 500 as reachable, which is right for
// bookmarks generally and unable to tell an endpoint that should return 401 from
// one that just started to. An explicit list replaces it.
func TestStatusExpectationReplacesDefaultRule(t *testing.T) {
	for _, tc := range []struct {
		name    string
		code    int
		spec    string
		matched bool
		usable  bool
	}{
		{"exact hit", 200, "200", true, true},
		{"exact miss", 200, "404", false, true},
		{"range hit", 204, "200-299", true, true},
		{"range miss", 301, "200-299", false, true},
		{"list hit", 401, "200,301,401", true, true},
		{"empty spec is not usable", 200, "", false, false},
		// A typo must fall back to the default rule rather than fail a healthy
		// site, so "usable" has to stay false when nothing parses.
		{"typo only", 200, "abc", false, false},
		{"typo plus a real code", 200, "abc,200", true, true},
		{"reversed range is ignored", 200, "299-200", false, false},
	} {
		matched, usable := statusMatchesExpectation(tc.code, tc.spec)
		if matched != tc.matched || usable != tc.usable {
			t.Errorf("%s: code %d against %q = (%v, %v), want (%v, %v)",
				tc.name, tc.code, tc.spec, matched, usable, tc.matched, tc.usable)
		}
	}
}

func TestNormalizeExpectStatusDropsNonsense(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"", ""},
		{"200", "200"},
		{" 200 , 404 ", "200,404"},
		{"200-299", "200-299"},
		{"abc", ""},
		{"999", ""}, // outside the HTTP range is a typo, not an intention
		{"12", ""},  // ditto
		{"abc,200", "200"},
	} {
		if got := normalizeExpectStatus(tc.in); got != tc.want {
			t.Errorf("normalize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// A page answering 200 while showing an error is up by every other measure.
func TestContentExpectationDecidesHealth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("<html><body>Database connection failed</body></html>"))
	}))
	defer server.Close()

	h := &Handlers{store: NewStore()}
	t.Setenv("NEXTDASH_ALLOW_LOCAL", "1")

	// Present when required: healthy.
	if got := h.pingURLExpecting(t.Context(), server.URL, expectation{Text: "database connection"}); got.Status != "online" {
		t.Errorf("expected text present: status %q (%s), want online", got.Status, got.ErrorDetail)
	}
	// Required but missing: down, and the reason says why rather than "HTTP 200".
	got := h.pingURLExpecting(t.Context(), server.URL, expectation{Text: "welcome back"})
	if got.Status != "offline" || !strings.Contains(got.ErrorDetail, "missing") {
		t.Errorf("expected text missing: (%q, %q), want offline mentioning the missing string", got.Status, got.ErrorDetail)
	}
	// Absent-mode catches the error banner the other direction cannot.
	got = h.pingURLExpecting(t.Context(), server.URL, expectation{Text: "database connection", TextAbsent: true})
	if got.Status != "offline" || !strings.Contains(got.ErrorDetail, "contains") {
		t.Errorf("banner present in absent-mode: (%q, %q), want offline", got.Status, got.ErrorDetail)
	}
	// No expectation reads the body at all, and the page is up.
	if got := h.pingURLExpecting(t.Context(), server.URL, expectation{}); got.Status != "online" {
		t.Errorf("no expectation: status %q, want online", got.Status)
	}
}

// expectationFor must gate on Monitor, not just read the stored fields
// verbatim: manual re-check paths (PingURL, CheckBookmarkHealthURL, "Retest
// all") call it unconditionally on any bookmark, monitored or not. Without
// the gate, a bookmark that once was a monitor but had it turned off would
// still have its keyword/status rules enforced and its drift baseline
// silently re-evaluated on every manual check, even though the health report
// and the UI both treat it as if expectations do nothing while unmonitored.
func TestExpectationForIgnoresStoredFieldsWhenNotMonitored(t *testing.T) {
	bm := Bookmark{
		Monitor:      false,
		ExpectText:   "must contain this",
		ExpectStatus: "200,401",
		WatchDrift:   true,
	}
	got := expectationFor(bm)
	if !got.isZero() {
		t.Errorf("expectationFor on an unmonitored bookmark = %+v, want zero", got)
	}

	bm.Monitor = true
	got = expectationFor(bm)
	if got.isZero() || got.Text != "must contain this" || got.Status != "200,401" || !got.WatchDrift {
		t.Errorf("expectationFor on a monitored bookmark = %+v, want the stored fields", got)
	}
}

func TestExpectationIsZeroAndWantsBody(t *testing.T) {
	if !(expectation{}).isZero() {
		t.Error("an empty expectation should be zero")
	}
	if (expectation{}).wantsBody() {
		t.Error("an empty expectation must not read the body — that is what keeps the common path free")
	}
	if !(expectation{Text: "x"}).wantsBody() {
		t.Error("a text expectation needs the body")
	}
	if (expectation{Status: "200"}).wantsBody() {
		t.Error("a status expectation must not trigger a body read")
	}
}

// A host that answered with the wrong content is a different problem from one
// that did not answer. Reading it off the stored error keeps it from being a
// second source of truth that can drift from the message on screen.
func TestContentFailureIsDistinguishedFromUnreachable(t *testing.T) {
	for _, tc := range []struct {
		detail string
		want   bool
	}{
		{`Page is missing "Add to cart"`, true},
		{`Page contains "Service unavailable"`, true},
		{"HTTP 404, expected 200", true},
		// A bare status failure is the host answering badly, not the content
		// being wrong — that stays an ordinary broken link.
		{"HTTP 503", false},
		{"Unreachable", false},
		{"Connection refused", false},
		{"", false},
	} {
		if got := isContentFailure(tc.detail); got != tc.want {
			t.Errorf("isContentFailure(%q) = %v, want %v", tc.detail, got, tc.want)
		}
	}
}
