package main

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
	Length    int
	CheckedAt time.Time
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
covers every bookmark on that site. A failure to reach the probe is remembered
as "behaves normally" rather than retried on the next bookmark -- a host that is
down will fail the real check anyway, and hammering it with probes while it is
struggling is the opposite of polite.
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
	if ok && time.Since(cached.CheckedAt) < softControlTTL {
		return cached
	}

	verdict := softControlVerdict{CheckedAt: time.Now()}
	probe := softControlProbeURL(target)
	if probe == "" {
		return verdict
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, probe, nil)
	if err == nil {
		req.Header.Set("User-Agent", updateCheckUserAgent)
		client := h.outboundHTTPClient(softControlTimeout, 3)
		if resp, err := client.Do(req); err == nil {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, softControlMaxBytes))
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				verdict.SoftNotFound = true
				verdict.Length = readableTextLength(string(body))
			}
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
func softNotFoundByComparison(verdict softControlVerdict, pageLength int) bool {
	if !verdict.SoftNotFound || verdict.Length <= 0 || pageLength <= 0 {
		return false
	}
	// A long page is an article, whatever the host does with unknown addresses.
	if pageLength > 4000 {
		return false
	}
	diff := pageLength - verdict.Length
	if diff < 0 {
		diff = -diff
	}
	return diff*5 <= verdict.Length
}
