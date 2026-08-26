package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// PingResult holds the outcome of a bookmark URL reachability check.
type PingResult struct {
	Status      string
	PingMs      int
	ErrorDetail string
	HTTPStatus  int
	// CertExpiry is when the served leaf certificate stops being valid, in Unix
	// milliseconds; 0 for plain HTTP, or when the handshake never completed.
	// Read from the connection the check already made rather than opened for,
	// so watching expiry costs nothing on top of the reachability check.
	CertExpiry int64
	// CertHost is the host the certificate was served for. Expiry is a property
	// of the host, not of the bookmark: ten bookmarks on one domain share one
	// certificate and must not warn ten times.
	CertHost string
	// FinalURL is where the request ended up after redirects. The check follows
	// them already, so this costs nothing — and a bookmark that quietly started
	// redirecting to a domain root or another host is dead in every way that
	// matters while still answering 200.
	FinalURL string
	// Title and Fingerprint describe the page as it is now, for drift detection.
	// Only filled when the bookmark asked to watch for drift, since both need
	// the body read.
	Title       string
	Fingerprint string
}

// pingURLDetailed checks a URL under the default rule: any status under 500 is
// reachable and the body is never read.
func (h *Handlers) pingURLDetailed(ctx context.Context, urlStr string) PingResult {
	return h.pingURLExpecting(ctx, urlStr, expectation{})
}

// pingURLExpecting is the same check with a bookmark's own expectations applied.
// A zero expectation behaves exactly like pingURLDetailed, so the common path is
// unchanged — same request, no body read.
func (h *Handlers) pingURLExpecting(ctx context.Context, urlStr string, expect expectation) PingResult {
	if ctx == nil {
		ctx = context.Background()
	}
	// How long a check may take, from settings. Three seconds was hardcoded for
	// every check in the app, which permanently classified a self-hosted service
	// that legitimately needs four or five — a large Nextcloud, a Jellyfin, a
	// container that just started — as "Timeout" and therefore offline, with no
	// control anywhere.
	timeout := h.healthCheckTimeout()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	urlStr = strings.TrimSpace(urlStr)
	if urlStr == "" {
		return PingResult{Status: "offline", ErrorDetail: "Invalid URL"}
	}
	/*
	 * A separate address to check, when the bookmark points at something that
	 * cannot answer for itself -- a web interface behind a login, where the
	 * service also offers /ping. Substituted here, before validation, so it
	 * passes exactly the same host checks the bookmark's own URL does: this
	 * value comes from a form, and a check that skipped validateHTTPURL would
	 * be a way to ask the server to fetch anything.
	 */
	if probe := strings.TrimSpace(expect.CheckURL); probe != "" {
		urlStr = probe
	}

	parsed, err := url.Parse(urlStr)
	if err != nil || parsed.Host == "" {
		return PingResult{Status: "offline", ErrorDetail: "Invalid URL"}
	}
	if err := validateHTTPURL(urlStr, h.allowLocalBookmarks()); err != nil {
		return PingResult{Status: "offline", ErrorDetail: "URL host is not allowed"}
	}

	start := time.Now()
	allowLocal := h.allowLocalBookmarks()
	transport := newSSRFSafeTransport(allowLocal, dialTimeoutFor(timeout))
	if expect.AllowInsecureTLS {
		/*
		 * Trust this one certificate, for this one check.
		 *
		 * A service on a home network commonly presents a self-signed
		 * certificate, and the check then fails on the certificate rather than
		 * on the service -- which reads on the row as being down, with nothing
		 * saying otherwise. Cloned rather than mutated: the transport helper
		 * returns a fresh value today, and a future version returning a shared
		 * one would otherwise turn a single bookmark's choice into everyone's.
		 *
		 * The dialer's own address checks are untouched, so this relaxes who
		 * the certificate must prove to be, never which hosts may be reached.
		 */
		relaxed := transport.Clone()
		if relaxed.TLSClientConfig == nil {
			relaxed.TLSClientConfig = &tls.Config{}
		} else {
			relaxed.TLSClientConfig = relaxed.TLSClientConfig.Clone()
		}
		relaxed.TLSClientConfig.InsecureSkipVerify = true
		transport = relaxed
	}
	client := &http.Client{
		Timeout: timeout,
		// The dial budget stays a fraction of the whole: a connection that
		// cannot be opened should fail well before the body has a chance to be
		// read, whatever the total allows.
		Transport: transport,
		// The address rule and the secret rule, in that order: a redirect has
		// to be somewhere this install may reach, and a credential stored for
		// one host does not travel to another that answered with a 302.
		CheckRedirect: credentialRedirectCheck(expect.Credential, safeRedirectCheck(allowLocal, 5)),
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return PingResult{Status: "offline", ErrorDetail: "Invalid URL"}
	}
	req.Header.Set("User-Agent", "nextDash-Health/1.0")
	// The credential last, so a stored Authorization header beats the default
	// User-Agent line above but nothing here can quietly replace the checks
	// already made against the address.
	applyHealthCredential(req, expect.Credential)

	resp, err := client.Do(req)
	elapsed := int(time.Since(start).Milliseconds())
	if elapsed < 1 {
		elapsed = 1
	}

	if err == nil && resp != nil {
		defer drainAndCloseResponse(resp)
		code := resp.StatusCode
		certExpiry, certHost := leafCertExpiry(resp)
		base := PingResult{
			PingMs: elapsed, HTTPStatus: code,
			CertExpiry: certExpiry, CertHost: certHost,
			FinalURL: finalRequestURL(resp),
		}
		down := func(detail string) PingResult {
			r := base
			r.Status = "offline"
			r.ErrorDetail = detail
			return r
		}

		// An explicit list replaces the default rule; an unusable one (all typos)
		// falls back to it rather than failing a healthy site.
		codeOK := httpStatusReachable(code)
		if matched, usable := statusMatchesExpectation(code, expect.Status); usable {
			codeOK = matched
			if !codeOK {
				return down(fmt.Sprintf("HTTP %d, expected %s", code, expect.Status))
			}
		}
		if !codeOK {
			return down(fmt.Sprintf("HTTP %d", code))
		}

		// Only now, and only when asked: reading the body is the one part of a
		// check that costs real bandwidth. Read once and used by both the
		// keyword test and the drift baseline, so a bookmark using both does
		// not pay twice.
		if expect.wantsBody() {
			body := readBoundedBody(resp)
			if expect.WatchDrift {
				base.Title = extractHTMLTitle(body)
				base.Fingerprint = contentFingerprint(body)
			}
			if text := strings.TrimSpace(expect.Text); text != "" {
				found := strings.Contains(strings.ToLower(body), strings.ToLower(text))
				if found == expect.TextAbsent {
					if expect.TextAbsent {
						return down(fmt.Sprintf("Page contains %q", expect.Text))
					}
					return down(fmt.Sprintf("Page is missing %q", expect.Text))
				}
			}
			// Last, so an explicit expectation still wins: someone who spelled
			// out what the page must contain has said what they mean by "up",
			// and a heuristic must not overrule it.
			if expect.SoftNotFound {
				title := base.Title
				if title == "" {
					title = extractHTMLTitle(body)
				}
				if reason := softNotFoundReason(title, body); reason != "" {
					return down(reason)
				}
				/*
				 * The control-URL test, for the pages that do not say so.
				 *
				 * Second, because the phrase check costs no request at all and
				 * catches the pages that announce themselves. This one asks the
				 * host what it does with an address that cannot exist: if that
				 * also answers 200, its 200 proves nothing, and a page whose
				 * text matches that not-found page in length is that page.
				 *
				 * Cached per host, so a site with fifty bookmarks is asked once
				 * rather than fifty times.
				 */
				if verdict := h.hostSoftNotFound(ctx, urlStr); verdict.SoftNotFound {
					if softNotFoundByComparison(verdict, readableTextLength(body)) {
						return down("Page says it does not exist")
					}
				}
			}
		}

		base.Status = "online"
		return base
	}

	detail := classifyPingError(err, resp)
	return PingResult{Status: "offline", PingMs: elapsed, ErrorDetail: detail, HTTPStatus: httpStatusFromResponse(resp)}
}

// leafCertExpiry reads the served certificate's expiry from a completed
// response, in Unix milliseconds, plus the host it was served for.
//
// Returns zeroes for plain HTTP and for any response whose TLS state is missing
// — an absent expiry means "nothing to say", never "expires at the epoch", so
// callers can treat 0 as unknown without a second flag.
func leafCertExpiry(resp *http.Response) (int64, string) {
	if resp == nil || resp.TLS == nil || len(resp.TLS.PeerCertificates) == 0 {
		return 0, ""
	}
	// PeerCertificates[0] is the leaf by definition of the TLS handshake; the
	// rest of the chain expires later or the handshake would have failed.
	leaf := resp.TLS.PeerCertificates[0]
	if leaf == nil || leaf.NotAfter.IsZero() {
		return 0, ""
	}
	host := ""
	if resp.Request != nil && resp.Request.URL != nil {
		host = resp.Request.URL.Hostname()
	}
	return leaf.NotAfter.UnixMilli(), host
}

// finalRequestURL is where a completed response actually came from, after any
// redirects the client followed.
func finalRequestURL(resp *http.Response) string {
	if resp == nil || resp.Request == nil || resp.Request.URL == nil {
		return ""
	}
	return resp.Request.URL.String()
}

// httpStatusReachable reports whether an HTTP status means the host answered.
//
// Client errors (4xx) still prove reachability: login-gated pages often return
// 401/403, and GitHub /issues returns 404 without a session even though the
// link opens fine in a logged-in browser. Only 5xx is treated as down for
// bookmark health and uptime monitoring.
func httpStatusReachable(code int) bool {
	return code >= 200 && code < 500
}

func httpStatusFromResponse(resp *http.Response) int {
	if resp == nil {
		return 0
	}
	return resp.StatusCode
}

func classifyPingError(err error, resp *http.Response) string {
	if err != nil {
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			return "Timeout"
		}
		msg := strings.ToLower(err.Error())
		switch {
		case strings.Contains(msg, "no such host"), strings.Contains(msg, "dns"):
			return "DNS lookup failed"
		case strings.Contains(msg, "connection refused"):
			return "Connection refused"
		case strings.Contains(msg, "tls"), strings.Contains(msg, "certificate"), strings.Contains(msg, "x509"):
			return "TLS error"
		case strings.Contains(msg, "timeout"), strings.Contains(msg, "deadline exceeded"):
			return "Timeout"
		case strings.Contains(msg, "too many redirects"):
			return "Too many redirects"
		default:
			return "Unreachable"
		}
	}
	if resp != nil && resp.StatusCode >= 400 {
		// The code is kept verbatim, including the ones that say nothing about
		// the page. Whether a failure counts as evidence the page has died is
		// failureIsUncertain's job, one layer up: this sentence is the record of
		// what happened, and softening it here would lose the actual code.
		return fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return "Unreachable"
}

const (
	// defaultHealthCheckTimeout is what every check used before the timeout was
	// a setting, so an install that never touches it behaves exactly as it did.
	defaultHealthCheckTimeout = 3 * time.Second
	minHealthCheckTimeout     = 2 * time.Second
	maxHealthCheckTimeout     = 30 * time.Second
)

// healthCheckTimeout is the per-check budget, clamped to a range that keeps a
// sweep bounded: 8 concurrent checks at 30 seconds still finishes far inside
// monitorRunTimeout.
func (h *Handlers) healthCheckTimeout() time.Duration {
	seconds := h.store.GetSettings().HealthCheckTimeoutSeconds
	if seconds <= 0 {
		return defaultHealthCheckTimeout
	}
	d := time.Duration(seconds) * time.Second
	if d < minHealthCheckTimeout {
		return minHealthCheckTimeout
	}
	if d > maxHealthCheckTimeout {
		return maxHealthCheckTimeout
	}
	return d
}

// dialTimeoutFor keeps the connect budget proportional to the whole check —
// two thirds, as the original 2s-of-3s was — with a floor so a short timeout
// still leaves room to connect.
func dialTimeoutFor(total time.Duration) time.Duration {
	dial := total * 2 / 3
	if dial < time.Second {
		dial = time.Second
	}
	return dial
}

// failureClass turns the human sentence classifyPingError produces into the
// short class a sample stores: one word a list can group by and a column can
// hold, where the sentence is for one row read by one person.
//
// Kept beside classifyPingError rather than derived at the call sites, so the
// two cannot drift: a new branch there needs a case here or it lands in "other",
// which is visible in the data rather than silently mapped to something wrong.
func failureClass(detail string) string {
	d := strings.ToLower(strings.TrimSpace(detail))
	switch {
	case d == "":
		return ""
	case strings.Contains(d, "dns"):
		return "dns"
	case strings.Contains(d, "timeout"):
		return "timeout"
	case strings.Contains(d, "refused"):
		return "refused"
	case strings.Contains(d, "tls"), strings.Contains(d, "certificate"):
		return "tls"
	case strings.Contains(d, "redirect"):
		return "redirect"
	case strings.HasPrefix(d, "page says it does not exist"):
		// Its own class rather than "content": the page answered, and what it
		// answered with is a not-found template. Grouping it with a failed
		// keyword rule would hide the one failure a rot report is looking for.
		return "gone"
	case strings.HasPrefix(d, "page is missing"), strings.HasPrefix(d, "page contains"),
		strings.Contains(d, "unexpected content"):
		return "content"
	case strings.HasPrefix(d, "http "):
		return "http"
	default:
		return "other"
	}
}

// failureClassReason turns a stored class back into something a person reads,
// for the incident list and the export. The class is what the file keeps; this
// is only ever presentation, so a class this does not know still shows up as
// itself rather than disappearing.
func failureClassReason(class string) string {
	switch class {
	case "dns":
		return "DNS lookup failed"
	case "timeout":
		return "Timeout"
	case "refused":
		return "Connection refused"
	case "tls":
		return "TLS error"
	case "redirect":
		return "Too many redirects"
	case "content":
		return "Content check failed"
	case "gone":
		return "Page says it does not exist"
	case "http":
		return "HTTP error"
	case "":
		return ""
	default:
		return class
	}
}

func duplicateKeepScore(ref BookmarkRef) (opens int, pinned int, created int64) {
	opens = ref.OpenCount
	if ref.Pinned {
		pinned = 1
	}
	created = ref.CreatedAt
	return opens, pinned, created
}

func duplicateRefBetter(a, b BookmarkRef) bool {
	aOpens, aPinned, aCreated := duplicateKeepScore(a)
	bOpens, bPinned, bCreated := duplicateKeepScore(b)
	if aOpens != bOpens {
		return aOpens > bOpens
	}
	if aPinned != bPinned {
		return aPinned > bPinned
	}
	switch {
	case aCreated == 0 && bCreated == 0:
		return false
	case aCreated == 0:
		return false
	case bCreated == 0:
		return true
	default:
		return aCreated < bCreated
	}
}

func sortDuplicateRefsBestFirst(refs []BookmarkRef) {
	if len(refs) < 2 {
		return
	}
	// Stable sort: best keeper first (most opens → pinned → oldest createdAt).
	for i := 0; i < len(refs); i++ {
		bestIdx := i
		for j := i + 1; j < len(refs); j++ {
			if duplicateRefBetter(refs[j], refs[bestIdx]) {
				bestIdx = j
			}
		}
		if bestIdx != i {
			refs[i], refs[bestIdx] = refs[bestIdx], refs[i]
		}
	}
}

type mergeDeleteRef struct {
	pageID int
	index  int
}
