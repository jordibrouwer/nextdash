package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// appVersionToken is a short fingerprint of every static asset's contents. It
// changes whenever any CSS/JS file changes, and is embedded in the HTML shell and
// served at /api/app-version so a running page can detect it is stale and reload
// itself. Derived from file bytes rather than hand-written version strings, so a
// deploy can never ship with the fingerprint accidentally left unchanged.
var appVersionToken = func() func() string {
	var once sync.Once
	var token string
	return func() string {
		once.Do(func() {
			token = assetFingerprint()
		})
		return token
	}
}()

// AppVersion serves the current asset fingerprint, never cached, so a stale page can
// compare it against the version baked into its HTML and force a one-time reload.
func (h *Handlers) AppVersion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	fmt.Fprintf(w, `{"version":%q}`, appVersionToken())
}

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

// writeJSONWithETag serves a JSON API response with a content-based ETag, the
// same deal writeHTMLShell gives the HTML shell.
//
// Why: the dashboard re-reads /api/bookmarks, /api/categories, /api/pages and
// friends on every page load, every page switch and every cross-tab sync. Those
// responses are usually byte-identical to the last one — /api/data-revision
// exists precisely because the client wants to know "did anything change?" —
// yet the full JSON was sent every time. With a validator the browser asks
// conditionally and an unchanged body costs a 304 with no payload.
//
// "no-cache" rather than a max-age: bookmark data must never be served from
// cache without asking, because a write from another tab or the extension has
// to show up immediately. This buys the round trip back, not the request.
//
// The body is buffered so it can be hashed before anything is written. These
// payloads are a few KB of bookmarks, not a stream, so that costs nothing worth
// measuring. An encoding failure writes a 500 and returns false, leaving the
// caller nothing to do — no partial body has reached the client yet, which is
// the other reason to buffer.
func writeJSONWithETag(w http.ResponseWriter, r *http.Request, v any) bool {
	body, err := json.Marshal(v)
	if err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return false
	}

	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-cache, must-revalidate")

	if match := r.Header.Get("If-None-Match"); match != "" && etagMatches(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}

	w.WriteHeader(http.StatusOK)
	w.Write(body)
	return true
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
