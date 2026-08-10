package main

import (
	"io"
	"net/http"
	"strconv"
	"strings"
)

/*
Per-bookmark expectations: what "healthy" means for this one URL.

The default rule is deliberately loose — httpStatusReachable treats anything
under 500 as up, because 401 and 403 are normal for login-gated pages and GitHub
answers 404 without a session. That is right for bookmarks in general and wrong
for the handful you actually monitor, where "the host answered" is a much weaker
claim than "the thing still works".

Two narrower tests, both opt-in per bookmark and both absent from virtually every
bookmark:

  - an expected status code, for endpoints whose correct answer is not 200
  - an expected string in the body, for pages that fail while still answering

Nothing here runs unless the bookmark asks for it. In particular the body is only
read when ExpectText is set, so the common case makes exactly the same requests
it always did.
*/

// expectBodyLimit caps how much of a response is read for a content check.
//
// Enough for the <head> and the top of the body, where an error banner or a
// title lives, and small enough that a monitored bookmark pointing at something
// enormous cannot stall a check round. A string past this point reads as absent,
// which is the safe direction: it shows as a failure to investigate rather than
// silently passing.
const expectBodyLimit = 512 << 10 // 512KB

// statusMatchesExpectation reports whether code satisfies spec.
//
// An empty or unparseable spec returns false, so callers can fall back to the
// default rule rather than treating a typo as "nothing matches" and marking a
// healthy site down.
func statusMatchesExpectation(code int, spec string) (matched bool, usable bool) {
	spec = strings.TrimSpace(spec)
	if spec == "" || code <= 0 {
		return false, false
	}
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		lo, hi, ok := parseStatusRange(part)
		if !ok {
			continue
		}
		usable = true
		if code >= lo && code <= hi {
			return true, true
		}
	}
	return false, usable
}

// parseStatusRange reads "200" or "200-299" into inclusive bounds.
func parseStatusRange(part string) (int, int, bool) {
	if lo, hi, found := strings.Cut(part, "-"); found {
		start, err1 := strconv.Atoi(strings.TrimSpace(lo))
		end, err2 := strconv.Atoi(strings.TrimSpace(hi))
		if err1 != nil || err2 != nil || start > end {
			return 0, 0, false
		}
		return start, end, true
	}
	code, err := strconv.Atoi(part)
	if err != nil {
		return 0, 0, false
	}
	return code, code, true
}

// normalizeExpectStatus keeps a stored spec sane, dropping anything unparseable
// so a hand-edited bookmarks file cannot leave a monitor permanently failing.
// Returns "" when nothing usable is left, which restores the default rule.
func normalizeExpectStatus(spec string) string {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return ""
	}
	kept := make([]string, 0, 4)
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		lo, hi, ok := parseStatusRange(part)
		// Codes outside the HTTP range are a typo, not an intention.
		if !ok || lo < 100 || hi > 599 {
			continue
		}
		if lo == hi {
			kept = append(kept, strconv.Itoa(lo))
			continue
		}
		kept = append(kept, strconv.Itoa(lo)+"-"+strconv.Itoa(hi))
	}
	if len(kept) == 0 {
		return ""
	}
	return strings.Join(kept, ",")
}

// bodyContainsExpectation reads a bounded prefix of the response and reports
// whether the expected text is present.
//
// The comparison is case-insensitive: people type the phrase they remember
// seeing, not the exact casing the page renders it in.
func bodyContainsExpectation(resp *http.Response, want string) bool {
	if resp == nil || resp.Body == nil || want == "" {
		return false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, expectBodyLimit))
	if err != nil && len(body) == 0 {
		return false
	}
	return strings.Contains(
		strings.ToLower(string(body)),
		strings.ToLower(strings.TrimSpace(want)),
	)
}

// expectation is what one bookmark asks of its check, passed to the pinger so it
// knows whether to read a body and which codes count.
type expectation struct {
	Text       string
	TextAbsent bool
	Status     string
}

// wantsBody reports whether this check needs the response body read.
func (e expectation) wantsBody() bool {
	return strings.TrimSpace(e.Text) != ""
}

// isZero reports whether a bookmark asked for nothing beyond the default rule.
func (e expectation) isZero() bool {
	return strings.TrimSpace(e.Text) == "" && strings.TrimSpace(e.Status) == ""
}

// expectationFor reads a bookmark's expectations, normalised.
func expectationFor(b Bookmark) expectation {
	return expectation{
		Text:       strings.TrimSpace(b.ExpectText),
		TextAbsent: b.ExpectTextAbsent,
		Status:     normalizeExpectStatus(b.ExpectStatus),
	}
}
