package main

import "strings"

/*
Which failures mean "gone", and which mean "ask again later".

Pew's linkrot study counts a page as gone only on the status codes that say the
page or the host no longer exists, and treats everything else as unknown. That
is not statistical fussiness -- it is the difference between a useful monitor and
one people switch off.

A bot fetching a page gets 403 from Cloudflare's browser check, 429 from a rate
limiter, and 503 from anything behind maintenance or a cold serverless start.
None of those say the page is gone; they say this particular request did not get
through. Reported as rot they make a dashboard of live, working bookmarks look
half dead, and the reader learns to ignore the warnings -- at which point the
real 404s go unnoticed too.

So the failure is still recorded, still shown on the row, and still stops the
link from counting as healthy. What changes is that it is not evidence the page
has died: the rot report leaves it alone, and it is worth retrying.
*/

// uncertainHTTPStatuses are the codes that describe the request rather than the
// page. Every one is routinely returned to a bot for a page a browser loads.
var uncertainHTTPStatuses = map[int]struct{}{
	401: {}, // needs a login this checker does not have
	403: {}, // bot check, geoblock, hotlink protection
	408: {}, // the server gave up waiting, not the page
	425: {}, // too early
	429: {}, // rate limited, which is a compliment to how often we check
	500: {}, // a bug on their side today, not a page that no longer exists
	502: {},
	503: {}, // maintenance, cold start, overload
	504: {},
	// 999 is LinkedIn's, and by now several others', "we do not serve bots".
	999: {},
}

/*
gonePingStatuses say the page or the host is really not there.

Deliberately short, and deliberately not "everything in the 4xx range": these
are the codes a server returns when it knows what it is being asked for and is
telling you it does not exist.
*/
var gonePingStatuses = map[int]struct{}{
	404: {},
	410: {}, // Gone, which is the whole point of the code
	451: {}, // removed for legal reasons -- gone, with a paper trail
}

// statusCertainty says what a status code proves about the page.
type statusCertainty int

const (
	// statusCertaintyUnknown is a failure that says nothing about the page.
	statusCertaintyUnknown statusCertainty = iota
	// statusCertaintyGone is a failure that says the page is not there.
	statusCertaintyGone
)

// certaintyForStatus classifies one HTTP status.
//
// Anything not in either list is treated as unknown: a monitor that guesses
// wrong in this direction costs a retry, and one that guesses wrong the other
// way tells someone their working bookmark is dead.
func certaintyForStatus(code int) statusCertainty {
	if _, ok := gonePingStatuses[code]; ok {
		return statusCertaintyGone
	}
	return statusCertaintyUnknown
}

/*
failureIsUncertain reports whether a recorded failure sentence is one that says
nothing about whether the page still exists.

Reads the sentence rather than the code because that is what is stored on the
bookmark and in every sample -- the code itself is gone by the time anything
downstream asks. classifyPingError writes "HTTP 403" and the transport failures
in words, so both are recognisable here.
*/
func failureIsUncertain(detail string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(detail))
	if trimmed == "" {
		return false
	}

	// Transport failures: nothing answered, so nothing was learned about the
	// page. A site behind a slow CDN times out on a bad day and is fine on a
	// good one.
	switch {
	case strings.Contains(trimmed, "timeout"),
		strings.Contains(trimmed, "deadline exceeded"),
		strings.Contains(trimmed, "unreachable"),
		strings.Contains(trimmed, "connection refused"):
		return true
	}

	// A content rule that failed is a statement about the page, and a DNS or
	// TLS failure is a statement about the host -- neither is uncertain in the
	// way an intercepted request is.
	if !strings.HasPrefix(trimmed, "http ") {
		return false
	}

	code := httpStatusFromDetail(trimmed)
	if code == 0 {
		return false
	}
	_, uncertain := uncertainHTTPStatuses[code]
	return uncertain
}

// httpStatusFromDetail pulls the code out of an "HTTP 403" sentence, or 0.
func httpStatusFromDetail(detail string) int {
	fields := strings.Fields(strings.TrimSpace(detail))
	if len(fields) < 2 || !strings.EqualFold(fields[0], "http") {
		return 0
	}
	code := 0
	for _, r := range fields[1] {
		if r < '0' || r > '9' {
			return 0
		}
		code = code*10 + int(r-'0')
		if code > 999 {
			return 0
		}
	}
	if code < 100 {
		return 0
	}
	return code
}
