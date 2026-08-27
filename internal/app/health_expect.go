package app

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

// expectTextMaxLen bounds the phrase a bookmark can look for. Long enough for a
// sentence from the page, short enough that the field cannot be used to store
// something else in the bookmarks file.
const expectTextMaxLen = 200

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

// readBoundedBody reads at most expectBodyLimit of the response.
//
// One read serves every body-based check, so a bookmark that both looks for a
// keyword and watches for drift fetches the page once. A partial read is
// returned rather than discarded: the prefix is where titles and error banners
// live, which is exactly what these checks are looking at.
func readBoundedBody(resp *http.Response) string {
	if resp == nil || resp.Body == nil {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, expectBodyLimit))
	if err != nil && len(body) == 0 {
		return ""
	}
	return string(body)
}

// extractHTMLTitle pulls the <title> out of a page, whitespace collapsed.
//
// Deliberately not the preview pipeline's extractor: that one is a method on
// Handlers and reaches for more of the document than this needs. A title is the
// one tag simple enough that a second small reader beats threading a dependency
// into the check path.
func extractHTMLTitle(body string) string {
	lower := strings.ToLower(body)
	open := strings.Index(lower, "<title")
	if open < 0 {
		return ""
	}
	rel := strings.Index(lower[open:], ">")
	if rel < 0 {
		return ""
	}
	start := open + rel + 1
	end := strings.Index(lower[start:], "</title>")
	if end < 0 {
		return ""
	}
	return strings.Join(strings.Fields(body[start:start+end]), " ")
}

// isContentFailure reports whether an error means "the host answered, but not
// the way this bookmark expects" rather than "the host did not answer".
//
// The distinction matters on screen: a server that is down and a page whose
// checkout button vanished are different problems, and showing both as offline
// hides which one you have.
//
// Derived from the message instead of a new stored field: the error is already
// persisted on the bookmark and mirrored into the cache, so a parallel boolean
// would be a second source of the same truth — and the two would drift the first
// time one was written without the other.
func isContentFailure(detail string) bool {
	detail = strings.TrimSpace(detail)
	if detail == "" {
		return false
	}
	if strings.HasPrefix(detail, "Page is missing ") || strings.HasPrefix(detail, "Page contains ") {
		return true
	}
	// Deliberately not a content failure: a soft 404 comes from the page, not
	// from a rule the user set, so clearing the rule must not clear it.
	if strings.HasPrefix(detail, "Page says it does not exist") {
		return false
	}
	// "HTTP 404, expected 200" is a content failure; a bare "HTTP 503" is not.
	return strings.HasPrefix(detail, "HTTP ") && strings.Contains(detail, ", expected ")
}

// expectation is what one bookmark asks of its check, passed to the pinger so it
// knows whether to read a body and which codes count.
type expectation struct {
	Text       string
	TextAbsent bool
	Status     string
	// WatchDrift asks the check to keep the page body long enough to compare
	// title and wording against the stored baseline. Shares the single bounded
	// read with the keyword check, so a bookmark using both pays for one.
	WatchDrift bool
	// SoftNotFound asks the check to judge whether a 200 is really a "page not
	// found" template. Shares the same single body read as the two above.
	SoftNotFound bool
	// Monitored records that this expectation came from a monitored bookmark.
	// The per-bookmark fields can all be empty on one — that is the ordinary
	// case — so "did anything ask for a check" cannot stand in for it.
	Monitored bool
	/*
	 * How to reach the service, as opposed to what to expect back.
	 *
	 * These three sit outside the Monitor gate below, unlike everything above
	 * them: they do not evaluate anything, they say which address to request
	 * and how to be let in. A bookmark that is not monitored still gets checked
	 * by "Retest all" and by a manual re-check, and answering 401 there is the
	 * same wrong answer it would be on a schedule.
	 */
	CheckURL         string
	Credential       HealthCredential
	AllowInsecureTLS bool
}

// wantsBody reports whether this check needs the response body read.
func (e expectation) wantsBody() bool {
	return strings.TrimSpace(e.Text) != "" || e.WatchDrift || e.SoftNotFound
}

// isZero reports whether a bookmark asked for nothing beyond the default rule.
func (e expectation) isZero() bool {
	return strings.TrimSpace(e.Text) == "" && strings.TrimSpace(e.Status) == "" && !e.WatchDrift
}

// expectFieldsFor is expectationFor, kept as a separate name at call sites that
// are specifically building the report: an unmonitored bookmark's stored
// expectation is never acted on, so sending it would show a setting that does
// nothing.
func expectFieldsFor(b Bookmark) expectation {
	return expectationFor(b)
}

// expectationFor reads a bookmark's expectations, normalised.
//
// Gated on Monitor for every field, drift included: expectation checks (the
// keyword/status rules, and drift's baseline comparison) are monitor
// features, and a bookmark that is not monitored keeps its stored settings
// but they must not act — otherwise a manual re-check (PingURL,
// CheckBookmarkHealthURL) or "Retest all" on a bookmark that once was a
// monitor would silently keep evaluating drift against a stored baseline
// nobody is meant to be watching anymore, evolving it further with each
// check. Monitor's own dueMonitorTargets already filters to bm.Monitor
// bookmarks before it ever reaches here, so this changes nothing for the
// scheduled path — only the unconditional call sites that previously skipped
// the check.
func expectationFor(b Bookmark) expectation {
	// Reachability first, because it applies whether or not anyone asked for
	// monitoring: an unmonitored bookmark is still checked by "Retest all".
	reach := expectation{
		CheckURL:         strings.TrimSpace(b.CheckURL),
		AllowInsecureTLS: b.AllowInsecureTLS,
	}
	if id := strings.TrimSpace(b.CredentialID); id != "" {
		// A bookmark pointing at a credential that was deleted checks
		// anonymously rather than failing -- the same answer it gave before
		// the credential existed.
		if credential, ok := lookupHealthCredential(id); ok {
			reach.Credential = credential
		}
	}
	if !b.Monitor {
		return reach
	}
	reach.Text = strings.TrimSpace(b.ExpectText)
	reach.TextAbsent = b.ExpectTextAbsent
	reach.Status = normalizeExpectStatus(b.ExpectStatus)
	reach.WatchDrift = b.WatchDrift
	reach.Monitored = true
	return reach
}

// withSoftNotFound layers the one expectation that is a setting rather than a
// per-bookmark field. The Monitor gate in expectationFor still decides whether
// anything is evaluated: a bookmark that is not monitored is not read for a soft
// 404 either, since it is not read at all.
func (e expectation) withSoftNotFound(on bool) expectation {
	if !on || !e.Monitored {
		return e
	}
	e.SoftNotFound = true
	return e
}
