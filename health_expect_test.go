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
