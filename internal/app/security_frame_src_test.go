package app

import (
	"strings"
	"testing"
)

/*
A video card drew a black rectangle because child-src blocked every external
frame, and frame-src was not set at all -- so the player fell back to child-src
and never loaded.

The fix names providers rather than opening framing to https: at large, so this
checks both halves: the players that should work, and the reach that should not
be granted along with them.
*/
func TestContentSecurityPolicyFramesOnlyEmbedProviders(t *testing.T) {
	csp := contentSecurityPolicy()
	if csp == "" {
		t.Fatal("no policy")
	}

	var frameSrc string
	for _, directive := range strings.Split(csp, ";") {
		if strings.HasPrefix(strings.TrimSpace(directive), "frame-src ") {
			frameSrc = strings.TrimSpace(directive)
		}
	}
	if frameSrc == "" {
		t.Fatal("no frame-src: players fall back to child-src and are blocked")
	}

	for _, host := range []string{"https://www.youtube.com", "https://player.vimeo.com"} {
		if !strings.Contains(frameSrc, host) {
			t.Errorf("frame-src does not admit %s", host)
		}
	}
	// A wildcard here would let any page the fetcher visited frame anything.
	for _, wildcard := range []string{"https:", "*", "'unsafe-inline'"} {
		for _, field := range strings.Fields(frameSrc) {
			if field == wildcard {
				t.Errorf("frame-src is wide open: %q", wildcard)
			}
		}
	}
}
