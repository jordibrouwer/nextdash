package app

import (
	"net/http"
	"testing"
	"time"
)

/*
 * An outbound transport gives its idle connections up.
 *
 * One is built per request -- per preview, per feed, per ping, per webhook --
 * and then dropped, so a connection it is still holding will never be reused.
 * Without a timeout it stayed open, with its readLoop goroutine, until the
 * remote hung up.
 */
func TestOutboundTransportsGiveUpIdleConnections(t *testing.T) {
	cases := map[string]*http.Client{
		"ordinary":        newOutboundHTTPClient(false, 10*time.Second, 5),
		"slow-header API": newOutboundHTTPClientWithHeaderTimeout(false, 30*time.Second, 20*time.Second, 5),
		"local allowed":   newOutboundHTTPClient(true, 10*time.Second, 5),
	}
	for name, client := range cases {
		limited, ok := client.Transport.(*rateLimitedTransport)
		if !ok {
			t.Fatalf("%s: transport is %T, want the rate-limited wrapper", name, client.Transport)
		}
		transport, ok := limited.base.(*http.Transport)
		if !ok {
			t.Fatalf("%s: base is %T, want *http.Transport", name, limited.base)
		}
		if transport.IdleConnTimeout == 0 {
			t.Errorf("%s: an idle connection is held until the remote hangs up", name)
		}
	}
}

/*
 * The client the importer tests hand to a fetcher.
 *
 * Through the shared constructor, like the real caller -- with allowLocal on,
 * because the stub servers these tests point NEXTDASH_GITHUB_API_BASE and
 * NEXTDASH_RAINDROP_API_BASE at all listen on 127.0.0.1. That is also a real
 * arrangement: a GitHub Enterprise on the same network is what the setting is
 * for.
 */
func testOutboundClient() *http.Client {
	return newOutboundHTTPClient(true, 20*time.Second, 5)
}
