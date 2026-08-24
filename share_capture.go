package main

import (
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
)

// Saving a link from outside the dashboard.
//
// Until now the only ways in were the Chrome extension and the dashboard itself:
// on a phone, that meant opening nextDash, tapping +, and pasting. Two routes fix
// that, and they share everything except how they answer.
//
//   GET /share  — the PWA's share target. The phone's share sheet sends title,
//                 text and url; the link lands in the inbox and the app opens on
//                 it. Android is inconsistent about which field holds the URL,
//                 which is what firstHTTPURL is for.
//   GET /add    — a bookmarklet, a Shortcut, a script. Same save, but it answers
//                 with a page rather than a redirect: a bookmarklet opens a tab,
//                 and a tab showing raw JSON is a bad ending.
//
// Both are GET, because neither a share target nor a bookmarklet can set a
// header — which is also why the write token cannot protect them. See
// captureAccessAllowed.

// urlInText finds the first http(s) URL inside a string. Android's share sheet
// sends "Some title https://example.com/x" about as often as it fills in `url`.
var urlInText = regexp.MustCompile(`https?://[^\s<>"']+`)

// firstHTTPURL returns the first usable http(s) URL among the candidates, in the
// order given. Each candidate is tried whole first — a bare URL is the common
// case — and then scanned for one inside a sentence.
func firstHTTPURL(candidates ...string) string {
	for _, candidate := range candidates {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}
		if isHTTPURL(trimmed) {
			return trimmed
		}
		if found := urlInText.FindString(trimmed); found != "" {
			// Trailing punctuation belongs to the sentence, not to the URL.
			found = strings.TrimRight(found, ".,;:!?)]}\"'")
			if isHTTPURL(found) {
				return found
			}
		}
	}
	return ""
}

func isHTTPURL(candidate string) bool {
	parsed, err := url.Parse(strings.TrimSpace(candidate))
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	return parsed.Host != ""
}

// titleFromShare works out what to call the link.
//
// The share sheet's `title` is empty as often as not, and `text` is frequently
// "Some title https://…" — so the text with the URL taken out of it is usually
// the better title, and the raw text is never one.
func titleFromShare(title, text, chosenURL string) string {
	if t := strings.TrimSpace(title); t != "" && !isHTTPURL(t) {
		return t
	}
	rest := strings.TrimSpace(strings.Replace(strings.TrimSpace(text), chosenURL, "", 1))
	rest = strings.Trim(rest, " -–—:|\n\t")
	if rest != "" && !isHTTPURL(rest) {
		return rest
	}
	return ""
}

// captureToken is a second, deliberately weaker key for the two capture routes.
//
// A share target and a bookmarklet cannot send a header, so the write token —
// which unlocks every write in the app — cannot guard them without travelling in
// a URL, where it would end up in browser history and in a bookmark. This one
// opens nothing else: worst case, a leaked capture URL lets someone put links in
// an inbox.
func captureToken() string {
	return strings.TrimSpace(os.Getenv("NEXTDASH_CAPTURE_TOKEN"))
}

// captureAccessAllowed decides whether a capture request may write.
//
// With no write token configured — the documented LAN/Tailscale setup — the app
// is already open to whoever can reach it, and capture is no different. With one
// configured, capture needs its own token: silently allowing it would punch a
// hole through the very setting that closed the door.
func captureAccessAllowed(r *http.Request) bool {
	if writeAccessToken() == "" {
		return true
	}
	provided := strings.TrimSpace(r.URL.Query().Get("token"))
	capture := captureToken()
	if capture != "" && provided == capture {
		return true
	}
	// The write token itself is accepted too, for a script that already has it.
	return provided != "" && provided == writeAccessToken()
}

// captureToInbox performs the save both routes share.
//
// Deliberately goes through the same store call the API uses, so dedupe, the
// item cap and eviction behave exactly as they do everywhere else — a second
// implementation would be a second set of rules.
func (h *Handlers) captureToInbox(rawURL, title, source string) (InboxLink, error) {
	if err := h.validateBookmarkURL(rawURL); err != nil {
		return InboxLink{}, fmt.Errorf("invalid URL: %w", err)
	}
	settings := h.store.GetSettings()
	maxItems := settings.InboxMaxItems
	if maxItems <= 0 {
		maxItems = 500
	}
	created, evicted, err := h.store.AddInboxLink(InboxLink{
		URL:    rawURL,
		Title:  title,
		Source: source,
	}, settings.InboxDedupeUrls, maxItems)
	// AddInboxLink hands back what the capacity trim dropped instead of cleaning
	// up itself, because removeUnusedIconFile needs the store lock AddInboxLink
	// still holds. Discarding the slice here stranded one favicon per capture
	// once the inbox was at its cap -- exactly the leak the return value exists
	// to prevent, and which AddInboxItem already handles.
	for _, item := range evicted {
		h.store.removeUnusedIconFile(item.Icon)
	}
	return created, err
}

// ShareTargetCapture handles GET /share — the PWA share target.
func (h *Handlers) ShareTargetCapture(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !captureAccessAllowed(r) {
		logAuthDenied(r, "capture_token_missing")
		http.Redirect(w, r, "/?captured=denied#inbox", http.StatusSeeOther)
		return
	}

	target := firstHTTPURL(q.Get("url"), q.Get("text"), q.Get("title"))
	if target == "" {
		http.Redirect(w, r, "/?captured=nourl#inbox", http.StatusSeeOther)
		return
	}

	_, err := h.captureToInbox(target, titleFromShare(q.Get("title"), q.Get("text"), target), "share")
	switch {
	case err == nil:
		http.Redirect(w, r, "/?captured=ok#inbox", http.StatusSeeOther)
	case errors.Is(err, ErrInboxDuplicateURL):
		// Already there is a success from the sharer's point of view: the link is
		// in the inbox, which is what they asked for.
		http.Redirect(w, r, "/?captured=duplicate#inbox", http.StatusSeeOther)
	case errors.Is(err, ErrInboxAtCapacity):
		http.Redirect(w, r, "/?captured=full#inbox", http.StatusSeeOther)
	default:
		http.Redirect(w, r, "/?captured=error#inbox", http.StatusSeeOther)
	}
}

// captureResultPage is the one-line answer /add gives a bookmarklet.
var captureResultPage = template.Must(template.New("capture").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Heading}}</title>
<style>
 :root { color-scheme: light dark; }
 body { font: 16px/1.5 system-ui, sans-serif; margin: 0; display: grid; place-items: center;
        min-height: 100vh; background: Canvas; color: CanvasText; }
 main { max-width: 32rem; padding: 2rem; text-align: center; }
 h1 { font-size: 1.15rem; margin: 0 0 .35rem; }
 p { margin: 0 0 1rem; opacity: .8; word-break: break-word; }
 a { color: inherit; }
</style></head>
<body><main>
 <h1>{{.Heading}}</h1>
 <p>{{.Detail}}</p>
 <p><a href="/#inbox">Open the inbox</a></p>
</main></body></html>`))

type captureResult struct {
	Heading string
	Detail  string
}

func (h *Handlers) writeCaptureResult(w http.ResponseWriter, status int, result captureResult) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = captureResultPage.Execute(w, result)
}

// AddCapture handles GET /add — the bookmarklet and script route.
func (h *Handlers) AddCapture(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !captureAccessAllowed(r) {
		logAuthDenied(r, "capture_token_missing")
		h.writeCaptureResult(w, http.StatusUnauthorized, captureResult{
			Heading: "Not saved",
			Detail:  "This nextDash needs a capture token. Add ?token=… to the bookmarklet.",
		})
		return
	}

	target := firstHTTPURL(q.Get("url"), q.Get("text"), q.Get("title"))
	if target == "" {
		h.writeCaptureResult(w, http.StatusBadRequest, captureResult{
			Heading: "Nothing to save",
			Detail:  "No web address was found in what was sent.",
		})
		return
	}

	title := titleFromShare(q.Get("title"), q.Get("text"), target)
	created, err := h.captureToInbox(target, title, "capture")
	switch {
	case err == nil:
		name := created.Title
		if strings.TrimSpace(name) == "" {
			name = created.URL
		}
		h.writeCaptureResult(w, http.StatusOK, captureResult{
			Heading: "Saved to the inbox",
			Detail:  name,
		})
	case errors.Is(err, ErrInboxDuplicateURL):
		h.writeCaptureResult(w, http.StatusOK, captureResult{
			Heading: "Already in the inbox",
			Detail:  target,
		})
	case errors.Is(err, ErrInboxAtCapacity):
		h.writeCaptureResult(w, http.StatusConflict, captureResult{
			Heading: "Inbox is full",
			Detail:  "Clear some links and try again.",
		})
	default:
		h.writeCaptureResult(w, http.StatusInternalServerError, captureResult{
			Heading: "Could not save",
			Detail:  err.Error(),
		})
	}
}
