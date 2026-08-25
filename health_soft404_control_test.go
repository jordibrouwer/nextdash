package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func resetSoftControlCache() {
	softControlCache.Lock()
	softControlCache.hosts = map[string]softControlVerdict{}
	softControlCache.Unlock()
}

/*
A host that answers 200 to anything is a host whose 200 means nothing.

Research puts soft 404s above a quarter of all dead links, and the phrase
matching only catches the pages that say so in words. Measured against the real
web while building this: reddit.com and instagram.com both answer 200 to a path
that cannot exist.
*/
func TestHostSoftNotFoundNoticesAHostThatAlwaysAnswers(t *testing.T) {
	resetSoftControlCache()
	h := newTestHandlers(t)

	var probes int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		probes++
		// Everything is 200, whatever was asked for.
		fmt.Fprint(w, "<html><body><p>Nothing here.</p></body></html>")
	}))
	defer server.Close()

	verdict := h.hostSoftNotFound(context.Background(), server.URL+"/a-real-page")
	if !verdict.SoftNotFound {
		t.Error("a host answering 200 to a nonexistent path was not noticed")
	}
	if verdict.Length == 0 {
		t.Error("no length recorded, so nothing can be compared against it")
	}

	// Cached per host: a site with fifty bookmarks is asked once, not fifty
	// times. The probe is a courtesy request on somebody else's server.
	h.hostSoftNotFound(context.Background(), server.URL+"/another-page")
	if probes != 1 {
		t.Errorf("probed %d times, want one per host", probes)
	}
}

// A host with a real 404 is left alone, which is nearly all of them.
func TestHostSoftNotFoundLeavesAProperHostAlone(t *testing.T) {
	resetSoftControlCache()
	h := newTestHandlers(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	if h.hostSoftNotFound(context.Background(), server.URL+"/page").SoftNotFound {
		t.Error("a host with a real 404 was called a soft-404 host")
	}
}

/*
The verdict is deliberately conservative.

Telling somebody their working bookmark is dead is the failure worth avoiding,
so both signals have to agree: the host answers 200 to anything, and this page's
text is close in length to that not-found page's. Measured on reddit.com, whose
not-found page is six characters, and instagram.com, whose is 107,000 -- the
second is why long pages are excluded entirely.
*/
func TestSoftNotFoundByComparisonRefusesToGuess(t *testing.T) {
	verdict := softControlVerdict{SoftNotFound: true, Length: 500, CheckedAt: time.Now()}

	if !softNotFoundByComparison(verdict, 500) {
		t.Error("a page identical in length to the host's not-found page was not flagged")
	}
	if !softNotFoundByComparison(verdict, 520) {
		t.Error("a page within a fifth was not flagged")
	}
	// Three times the length is a page, not a notice.
	if softNotFoundByComparison(verdict, 1500) {
		t.Error("flagged a page three times the length of the not-found page")
	}
	// An article is an article whatever the host does with unknown addresses.
	if softNotFoundByComparison(softControlVerdict{SoftNotFound: true, Length: 5000}, 5000) {
		t.Error("flagged a page over the length ceiling")
	}
	// A host that behaves properly can never trigger this.
	if softNotFoundByComparison(softControlVerdict{Length: 500}, 500) {
		t.Error("flagged a page on a host with real 404s")
	}
}

// The probe address cannot exist and cannot be special-cased: a fixed path is
// one a site can whitelist, and one a cache can answer from.
func TestSoftControlProbeURLIsUnguessable(t *testing.T) {
	first := softControlProbeURL("https://example.com/some/page?q=1#frag")
	second := softControlProbeURL("https://example.com/some/page?q=1#frag")

	if first == second {
		t.Error("the probe path is fixed, so it can be cached or special-cased")
	}
	if !strings.HasPrefix(first, "https://example.com/") {
		t.Errorf("probe = %q, want it on the same host", first)
	}
	// The query and fragment belong to the real page, not to the probe.
	if strings.Contains(first, "q=1") || strings.Contains(first, "frag") {
		t.Errorf("probe carried the page's own query: %q", first)
	}
	if softControlProbeURL("not a url at all") != "" {
		t.Error("built a probe from something that is not an address")
	}
}
