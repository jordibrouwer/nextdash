package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
)

// writeHTMLShell serves a generated HTML document (dashboard/config shell) with a
// content-based ETag so browsers can revalidate cheaply.
//
// Why this exists: the shell must be revalidated on every load so clients pick up
// the latest ?v= asset URLs. "no-cache" alone asks the browser to revalidate, but
// without a validator (ETag/Last-Modified) some browsers — notably Safari — fall
// back to their internal page cache and keep serving a stale shell with old ?v=
// tokens. A strong ETag gives them a validator: unchanged shell → 304 (fast),
// changed shell → 200 with the new asset URLs.
func writeHTMLShell(w http.ResponseWriter, r *http.Request, body []byte) {
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("ETag", etag)
	// Revalidate every time. With the ETag above this is a real conditional check,
	// not a hint the browser may ignore. bfcache stays usable (no "no-store").
	w.Header().Set("Cache-Control", "no-cache, must-revalidate")

	if match := r.Header.Get("If-None-Match"); match != "" && etagMatches(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write(body)
}

// etagMatches reports whether the client's If-None-Match header covers etag.
// Handles the common "*" wildcard and comma-separated lists; a weak "W/" prefix
// still matches its strong counterpart for revalidation purposes.
func etagMatches(ifNoneMatch, etag string) bool {
	strip := func(s string) string {
		s = trimSpace(s)
		if len(s) >= 2 && s[0] == 'W' && s[1] == '/' {
			s = s[2:]
		}
		return s
	}
	target := strip(etag)
	start := 0
	for i := 0; i <= len(ifNoneMatch); i++ {
		if i == len(ifNoneMatch) || ifNoneMatch[i] == ',' {
			candidate := trimSpace(ifNoneMatch[start:i])
			if candidate == "*" || strip(candidate) == target {
				return true
			}
			start = i + 1
		}
	}
	return false
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}
