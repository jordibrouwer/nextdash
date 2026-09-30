package app

import (
	"errors"
	"net/url"
	"testing"
)

// The address in a *url.Error is not the cause: nextdns.io refusing a
// connection is "Connection refused", not a DNS failure.
func TestClassifyPingErrorIgnoresTheAddress(t *testing.T) {
	err := &url.Error{Op: "Get", URL: "https://nextdns.io/", Err: errors.New("dial tcp 1.2.3.4:443: connect: connection refused")}
	if got := classifyPingError(err, nil); got != "Connection refused" {
		t.Fatalf("classifyPingError = %q", got)
	}
}
