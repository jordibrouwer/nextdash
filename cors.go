package main

import (
	"net/http"
	"os"
	"strings"
	"sync"
)

/*
Who may read this API from a browser.

The dashboard itself is same-origin and needs none of this. Two other callers do
not share the origin: the browser extension, and whatever a reader has built
against the API on a page of their own.

The default used to answer both at once with Access-Control-Allow-Origin: *,
which also answered every other page on the internet. A bookmark collection is
not a secret the way a password is, but it is a list of where somebody works,
banks and reads -- and any site open in a tab could ask a nextDash on a
guessable LAN address for the lot, because the read routes need no token. So the
default is now nobody, except the extensions that could reach it anyway.

"Could reach it anyway" is the whole argument for the exception. A Manifest V3
extension that declares host permissions -- which nextDash's does, for http and
https at large -- is granted cross-origin access by the browser itself, with
CORS never entering into it. Refusing the header would not stop such an
extension, and allowing it does not enable one that lacks the permission. What
it buys is that the extension keeps working if a browser, or a later version of
one, decides to consult the header after all.

A reader who serves a page of their own against this API names that origin in
NEXTDASH_CORS_ORIGINS, and the old behaviour is still one value away:
NEXTDASH_CORS_ORIGINS=*.
*/

var (
	corsConfigOnce sync.Once
	corsAllowAll   bool
	corsOrigins    map[string]struct{}
)

func initCORSConfig() {
	raw := strings.TrimSpace(os.Getenv("NEXTDASH_CORS_ORIGINS"))
	if raw == "" {
		// Same origin, plus the extension exception in applyCORSHeaders.
		return
	}
	// The old default, kept reachable on purpose: somebody whose setup depends
	// on it should be able to say so in one value rather than stay behind.
	if raw == "*" {
		corsAllowAll = true
		return
	}

	corsOrigins = make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		origin := strings.TrimSpace(part)
		if origin == "" {
			continue
		}
		corsOrigins[origin] = struct{}{}
	}
	/*
	 * A value that was set but named nothing usable is a typo, and a typo used
	 * to open the API to everyone: the empty allowlist fell through to the
	 * wildcard. It now means what it says.
	 */
	if len(corsOrigins) == 0 {
		corsOrigins = nil
	}
}

// browserExtensionSchemes are the origins an installed extension speaks from.
var browserExtensionSchemes = []string{
	"chrome-extension://",
	"moz-extension://",
	"safari-web-extension://",
}

/*
isBrowserExtensionOrigin reports whether an Origin belongs to an installed
extension rather than to a web page.

Matched on the scheme rather than on an id, because there is no id to match. An
extension loaded unpacked -- which is how nextDash's is installed -- is given
one derived from where it sits on disk, so it differs on every machine, and
Firefox mints a fresh one per install by design. The README has always told
people to read theirs off chrome://extensions for exactly that reason.

The rest of the origin is checked all the same, so "chrome-extension://x/y" or
one with a space in it is not waved through on the strength of its prefix.
*/
func isBrowserExtensionOrigin(origin string) bool {
	for _, scheme := range browserExtensionSchemes {
		rest, found := strings.CutPrefix(origin, scheme)
		if !found {
			continue
		}
		if rest == "" || len(rest) > 128 {
			return false
		}
		for _, r := range rest {
			switch {
			case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			case r == '-', r == '_', r == '.':
			default:
				return false
			}
		}
		return true
	}
	return false
}

// applyCORSHeaders sets CORS response headers for bookmark API and extension use.
// With NEXTDASH_CORS_ORIGINS unset, only an installed extension's origin is
// echoed; set it to a comma-separated allowlist to add origins of your own, or
// to * for the behaviour before 1.4 of answering everyone.
func applyCORSHeaders(w http.ResponseWriter, r *http.Request) {
	corsConfigOnce.Do(initCORSConfig)

	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	// If-None-Match has to be allowed or a cross-origin caller cannot make a
	// conditional request at all, and ETag has to be exposed or its JS cannot
	// read the validator to send back. Without both, the API's ETags would work
	// same-origin and silently do nothing for the browser extension.
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-NextDash-Token, If-None-Match")
	w.Header().Set("Access-Control-Expose-Headers", "ETag")

	if corsAllowAll {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		return
	}

	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return
	}
	if _, listed := corsOrigins[origin]; !listed && !isBrowserExtensionOrigin(origin) {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	// Add, not Set: the gzip middleware has already put Accept-Encoding in Vary
	// on the same header map, and replacing it let a shared cache serve gzipped
	// bytes to a client that did not ask for them.
	w.Header().Add("Vary", "Origin")
}
