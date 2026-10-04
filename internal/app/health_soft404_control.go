package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"net/http"
	neturl "net/url"
	"strings"
	"sync"
	"time"
)

/*
The control-URL test: asking a host what its "not found" looks like.

A site that answers 200 for a page that no longer exists makes the whole monitor
untrustworthy, and it is not a rare case -- research puts soft 404s at more than
a quarter of all dead links. The phrase matching in health_soft404.go catches the
ones that say so in words, in four languages. This catches the rest.

The method is the classic one: ask for a URL on the same host that certainly
does not exist. If that also answers 200, then a 200 from this host means
nothing, and the real page's status has to be judged on its content instead.

Two things make it affordable. The answer is a property of the host, not of the
page, so it is cached per host -- one extra request per site, not per bookmark.
And it only runs when there is something to decide: a page that answered 404 is
already known to be gone, and a host that behaves normally is asked once a day.
*/

const (
	// softControlTTL is how long a host's behaviour is trusted. Servers change
	// their 404 handling when they are rebuilt, which is not a daily event.
	softControlTTL = 24 * time.Hour
	// softControlRetry is how long a probe that got no answer is remembered.
	// That says nothing about the host's 404s, only that this attempt failed.
	softControlRetry = 10 * time.Minute
	// softControlTimeout bounds the extra request. It is a courtesy check on
	// somebody else's server, so it gives up quickly.
	softControlTimeout = 8 * time.Second
	// softControlMaxBytes is enough to compare two pages without reading them.
	softControlMaxBytes = 256 << 10
)

// softControlVerdict is what a host does with an address that cannot exist.
type softControlVerdict struct {
	// SoftNotFound is true when the host answered 200 to a URL that does not
	// exist -- so a 200 from it is not evidence the page is there.
	SoftNotFound bool
	// Length of that answer, so a real page can be compared against it: a page
	// whose body matches the host's not-found page in size is that page.
	Length int
	// Landing is where the probe ended up when the host sent it somewhere else
	// -- an address without its query, so a login page that carries the asked-for
	// path in a returnUrl still compares equal. Empty when the probe stayed on
	// its own address, which is the ordinary not-found template.
	Landing   string
	CheckedAt time.Time
	// Unanswered marks a probe that got no HTTP answer at all; it is kept for
	// softControlRetry rather than a day.
	Unanswered bool
}

var softControlCache = struct {
	sync.Mutex
	hosts map[string]softControlVerdict
}{hosts: map[string]softControlVerdict{}}

// softControlProbeURL builds an address on the same host that cannot exist.
//
// Random rather than fixed, because a fixed path is one a site can special-case
// -- and because a cached 404 for /nextdash-probe would make every install after
// the first read a cached answer rather than the host's real behaviour.
func softControlProbeURL(target string) string {
	parsed, err := neturl.Parse(strings.TrimSpace(target))
	if err != nil || parsed.Host == "" {
		return ""
	}
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	probe := *parsed
	probe.Path = "/nextdash-probe-" + hex.EncodeToString(buf)
	probe.RawQuery = ""
	probe.Fragment = ""
	return probe.String()
}

/*
hostSoftNotFound reports whether this host answers 200 to anything.

Cached per host: the question is about the server's behaviour, so asking it once
covers every bookmark on that site. A probe that got no answer is remembered
as "behaves normally" for ten minutes, not a day: it is not retried on the next
bookmark -- hammering a struggling host is the opposite of polite -- but a
timeout says nothing about how the host treats a missing page.

The probe gets its own deadline. The check's context may have little left
after a slow page, and that leftover is our budget, not the host's behaviour.
*/
func (h *Handlers) hostSoftNotFound(ctx context.Context, target string) softControlVerdict {
	parsed, err := neturl.Parse(strings.TrimSpace(target))
	if err != nil || parsed.Host == "" {
		return softControlVerdict{}
	}
	host := strings.ToLower(parsed.Host)

	softControlCache.Lock()
	cached, ok := softControlCache.hosts[host]
	softControlCache.Unlock()
	ttl := softControlTTL
	if cached.Unanswered {
		ttl = softControlRetry
	}
	if ok && time.Since(cached.CheckedAt) < ttl {
		return cached
	}

	verdict := softControlVerdict{CheckedAt: time.Now()}
	probe := softControlProbeURL(target)
	if probe == "" {
		return verdict
	}

	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), softControlTimeout)
	defer cancel()
	client := h.outboundHTTPClient(softControlTimeout, 3)
	status, length, final, answered := fetchSoftControl(ctx, client, probe)
	verdict.Unanswered = !answered
	if answered && status == http.StatusOK {
		verdict.SoftNotFound = true
		verdict.Length = length
		if landing := softControlAddress(final); landing != "" && landing != softControlAddress(probe) {
			verdict.Landing = landing
		}
	}
	// A single-page app serves its one shell document for every path, the
	// front page included, so its "not-found page" is the app itself and every
	// page compares equal to it. When the front page is that same document,
	// the probe proves nothing about any page on this host.
	if verdict.SoftNotFound && verdict.Landing == "" {
		root := *parsed
		root.Path, root.RawPath, root.RawQuery, root.Fragment = "/", "", "", ""
		if status, length, _, ok := fetchSoftControl(ctx, client, root.String()); ok && status == http.StatusOK && softLengthsClose(length, verdict.Length) {
			verdict.SoftNotFound = false
		}
	}

	softControlCache.Lock()
	softControlCache.hosts[host] = verdict
	softControlCache.Unlock()
	return verdict
}

/*
softNotFoundByComparison decides whether a 200 is really a missing page.

Only asked when the page answered 200 and said nothing about being gone -- the
phrase check runs first because it costs no request at all.

Two signals, and both have to point the same way:

The host answers 200 to an address that cannot exist, so its 200 proves nothing.
And this page's text is close in length to that not-found page's -- which is what
separates "this host is sloppy about status codes" from "this particular page is
its not-found page".

Deliberately conservative: within a fifth of the probe's length, and only for
pages short enough to be a notice rather than an article. Telling somebody their
working bookmark is dead is the failure worth avoiding.
*/
func softNotFoundByComparison(verdict softControlVerdict, pageLength int, pageFinalURL string) bool {
	if !verdict.SoftNotFound || verdict.Length <= 0 || pageLength <= 0 {
		return false
	}
	/*
	 * The gate case, which looks identical to a soft 404 and is not one.
	 *
	 * A site behind a login sends every address it does not hand out -- the
	 * probe's and the bookmark's alike -- to the same sign-in page, with the
	 * same 200 and the same body. Length alone therefore says "this page is the
	 * host's not-found page" about a page that is perfectly there; the user is
	 * simply not signed in. Prowlarr, Portainer and their kind all behave this
	 * way, so this is the common case, not a curiosity.
	 *
	 * What separates the two is where the probe went. A not-found template
	 * answers on the address that was asked for; a gate redirects elsewhere. So
	 * a probe that landed somewhere else, and a bookmark that landed on that
	 * same somewhere else, is a gate -- and a gate is not evidence of anything.
	 */
	if verdict.Landing != "" && verdict.Landing == softControlAddress(pageFinalURL) {
		return false
	}
	// A long page is an article, whatever the host does with unknown addresses.
	if pageLength > 4000 {
		return false
	}
	// The front page cannot be a missing page.
	if u, err := neturl.Parse(strings.TrimSpace(pageFinalURL)); err == nil && strings.Trim(u.Path, "/") == "" {
		return false
	}
	return softLengthsClose(pageLength, verdict.Length)
}

// softLengthsClose reports whether a page's readable length is within a fifth
// of the host's not-found page.
func softLengthsClose(pageLength, notFoundLength int) bool {
	if pageLength <= 0 || notFoundLength <= 0 {
		return false
	}
	diff := pageLength - notFoundLength
	if diff < 0 {
		diff = -diff
	}
	return diff*5 <= notFoundLength
}

// fetchSoftControl asks one address for the soft-404 test and returns its
// status, readable length and the address it ended on.
func fetchSoftControl(ctx context.Context, client *http.Client, target string) (int, int, string, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return 0, 0, "", false
	}
	req.Header.Set("User-Agent", updateCheckUserAgent)
	resp, err := client.Do(req)
	if err != nil {
		return 0, 0, "", false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, softControlMaxBytes))
	return resp.StatusCode, readableTextLength(string(body)), finalRequestURL(resp), true
}

// softControlAddress reduces a URL to what identifies the page it landed on:
// scheme, host and path, lowercased host, no query and no fragment.
//
// The query has to go because a gate puts the address it turned away into it --
// /login?returnUrl=%2Fnextdash-probe-1a2b against /login?returnUrl=%2F is the
// same page reached twice, and comparing them whole would say otherwise.
func softControlAddress(raw string) string {
	parsed, err := neturl.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return ""
	}
	return strings.ToLower(parsed.Scheme+"://"+parsed.Host) + parsed.Path
}
