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
