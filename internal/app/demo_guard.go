package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

/*
What the public demo keeps closed, in three layers.

Outbound: the server reaches no other host. Every outbound client but two
dials through ssrfSafeDialContext, which refuses in the demo; the install ping
and browser push have their own client and refuse at their source. The one
exception is the round at the first start that fetches the demo's favicons,
link previews and the app-icon sets (demoOutboundOpen), before the demo is serving visitors for
long. TestDemoKnowsEveryOutboundClient fails when a new client appears that is
not on that list.

Routes: every route that writes is either allowed or refused in the demo, and
TestDemoClassifiesEveryWriteRoute fails when a new one is neither. Refused:
what replaces or wipes the data, uploads, anything that sends or fetches on
the visitor's behalf, and the secrets.

Limits: writes per address per minute, bookmarks per page, and pages, so one
visitor cannot fill the demo for the next before the reset clears it.
*/

var (
	// demoOutboundOpen is the start-up round's window; closed the rest of
	// the time.
	demoOutboundOpen atomic.Bool
	errDemoOutbound  = errors.New("outbound requests are off in the demo")
	errDemoLimit     = errors.New("the demo holds no more than this")
)

const (
	// demoMaxBody bounds every write's body: some handlers read theirs whole,
	// which is fine at home and is a way to fill the demo's memory.
	demoMaxBody             = 4 << 20
	demoInboxCap            = 200
	demoWritesPerMinute     = 120
	demoMaxBookmarksPerPage = 150
	demoMaxPages            = 20
)

// demoOutboundRefused says whether an outbound request must be refused now.
func demoOutboundRefused() bool {
	return demoMode() && !demoOutboundOpen.Load()
}

// demoVisitorKey marks a request a visitor made (demoGuard). The start-up
// window is for the seed round only: a dial on a visitor's context is refused
// while it is open, as it is the rest of the time.
type demoVisitorKey struct{}

func demoVisitorContext(ctx context.Context) bool {
	visitor, _ := ctx.Value(demoVisitorKey{}).(bool)
	return visitor
}

// demoDialRefused is the dialer's question: closed outside the window, and
// closed to visitors inside it.
func demoDialRefused(ctx context.Context) bool {
	return demoOutboundRefused() || (demoMode() && ctx != nil && demoVisitorContext(ctx))
}

const (
	demoStarting  = "The demo is starting; try again in a minute"
	demoResetting = "The demo is being reset; try again in a moment"
)

// demoDeniedWrites are the write routes refused in the demo, as main.go
// registers them.
var demoDeniedWrites = []string{
	// Replacing or wiping what every visitor shares.
	"/api/import", "/api/auto-backups/restore", "/api/reset", "/api/bookmarks/delete-all",
	// Uploads land on the server's disk.
	"/api/favicon", "/api/font", "/api/icon", "/api/icon/from-url",
	// Sending or fetching on the visitor's behalf.
	"/api/push/subscribe", "/api/push/unsubscribe", "/api/push/test",
	"/api/webhooks", "/api/webhooks/test", "/api/health/test-notification",
	"/api/widgets/custom/test", "/api/unraid/test", "/api/unraid/settings",
	"/api/sources/{id}", "/api/sources/{id}/run", "/api/sources/{id}/forget",
	"/api/feeds/poll", "/api/feeds/retry", "/api/previews/refresh", "/api/bookmarks/prefetch-icons",
	"/api/health/retest-all", "/api/health/auto-heal-apply", "/api/health/check-url",
	"/api/health/archive-save", "/api/health/archive-settings", "/api/archives/capture", "/api/archives/",
	"/mcp",
	// Secrets.
	"/api/health/credentials", "/api/web-search/brave-key",
	"/api/status-page", "/api/status-page/token",
}

// demoAllowedWrites work in the demo as they do anywhere: they change the
// demo's own data, which the next reset puts back.
var demoAllowedWrites = []string{
	"/api/auto-backups", "/api/auto-backups/run",
	"/api/bookmarks", "/api/bookmarks/add", "/api/bookmarks/delete", "/api/bookmarks/move",
	"/api/bookmarks/import-browser", "/api/bookmarks/import-html",
	"/api/categories", "/api/colors", "/api/colors/reset", "/api/finders",
	"/api/docker/binds/measure", "/api/docker/containers/{id}/{action}", "/api/docker/prune/{kind}",
	"/api/docker/updates/choice", "/api/docker/volumes/{name}",
	// Docker is the demo's own daemon, registry and changelog (docker_demo.go):
	// checking for updates asks nobody outside, and the token is never sent.
	"/api/docker/updates/check", "/api/docker/github-token",
	"/api/health/accept-drift", "/api/health/cache-scan", "/api/health/check-mode", "/api/health/check-mode-all",
	"/api/health/delete-bookmark", "/api/health/delete-bookmarks", "/api/health/expectations",
	"/api/health/expectations-bulk", "/api/health/ignore", "/api/health/merge-duplicates",
	"/api/health/open-broken", "/api/health/statuses", "/api/health/update-status",
	"/api/icon-sets/adopt", "/api/icon-sets/match",
	"/api/inbox", "/api/inbox/batch", "/api/logs", "/api/onboarding/template",
	"/api/pages", "/api/pages/template", "/api/pages/{id:[0-9]+}", "/api/pages/{id:[0-9]+}/blocks",
	"/api/pages/{id:[0-9]+}/template", "/api/previews/clear", "/api/previews/images/clear",
	"/api/settings", "/api/tags/keywords/clear", "/api/tags/rewrite", "/api/tags/scan", "/api/tags/scan/reset",
	"/api/track-clienterror", "/api/track-keys", "/api/track-nav", "/api/track-open", "/api/track-search",
	"/api/track-session", "/api/trash", "/api/trash/restore",
	"/api/widgets/notes/command", "/api/widgets/notes/render",
}

var muxVarRE = regexp.MustCompile(`\{[^}]+\}`)

// demoRouteMatcher turns a route as main.go writes it into a matcher for a
// request path. A pattern ending in "/" is a prefix, as PathPrefix is.
func demoRouteMatcher(route string) *regexp.Regexp {
	parts := muxVarRE.Split(route, -1)
	for i := range parts {
		parts[i] = regexp.QuoteMeta(parts[i])
	}
	expr := strings.Join(parts, `[^/]+`)
	if strings.HasSuffix(route, "/") {
		return regexp.MustCompile("^" + expr)
	}
	return regexp.MustCompile("^" + expr + "$")
}

var demoDeniedMatchers = func() []*regexp.Regexp {
	out := make([]*regexp.Regexp, 0, len(demoDeniedWrites))
	for _, route := range demoDeniedWrites {
		out = append(out, demoRouteMatcher(route))
	}
	return out
}()

func isWriteMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

// demoWriteRefused says whether a request is one the demo refuses.
func demoWriteRefused(r *http.Request) bool {
	if r.URL.Path == "/mcp" {
		return true
	}
	if !isWriteMethod(r.Method) {
		return false
	}
	for _, matcher := range demoDeniedMatchers {
		if matcher.MatchString(r.URL.Path) {
			return true
		}
	}
	return false
}

// demoCountsAsWrite says whether the guard treats a request as a write: the
// API's write methods, and the two capture routes, which write the inbox on
// a GET (share_capture.go).
func demoCountsAsWrite(r *http.Request) bool {
	if r.URL.Path == "/share" || r.URL.Path == "/add" {
		return true
	}
	return isWriteMethod(r.Method) && strings.HasPrefix(r.URL.Path, "/api/")
}

var demoWriteLimiter = newSlidingWindowLimiter(demoWritesPerMinute, time.Minute)

/*
demoGuard is the demo's middleware, around every route: no indexing, refused
routes refused, writes counted per address, held during a reset, and noted for
the idle reset. Outside the demo it passes everything through untouched.
*/
func demoGuard(next http.Handler) http.Handler {
	if !demoMode() {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		if demoWriteRefused(r) {
			http.Error(w, demoNotAvailable, http.StatusForbidden)
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), demoVisitorKey{}, true))
		if demoCountsAsWrite(r) {
			track := strings.HasPrefix(r.URL.Path, "/api/track-")
			// While the seed round is out fetching, a write could set off work
			// of its own -- a new bookmark's favicon and preview -- on a
			// background context the dialer cannot tell from the round's.
			if !track && demoOutboundOpen.Load() {
				http.Error(w, demoStarting, http.StatusServiceUnavailable)
				return
			}
			// Try, not wait: a waiting reset blocks new readers, and a write
			// that waited it out ran against the fresh seed -- a delete by
			// index then took another bookmark than the one on screen.
			if demo.resetting.Load() || !demo.writes.TryRLock() {
				http.Error(w, demoResetting, http.StatusServiceUnavailable)
				return
			}
			defer demo.writes.RUnlock()
			// Usage counters are posted on their own, by readers too: they
			// are not a change that should arm the idle reset or spend the
			// visitor's limit.
			if !track {
				if !demoWriteLimiter.allow(clientIP(r)) {
					w.Header().Set("Retry-After", "60")
					http.Error(w, "Too many changes in a minute; the demo is shared", http.StatusTooManyRequests)
					return
				}
				demo.lastWrite.Store(time.Now().UnixMilli())
			}
			r.Body = http.MaxBytesReader(w, r.Body, demoMaxBody)
		}
		next.ServeHTTP(w, r)
	})
}

/*
demoCheckPageWrite holds a page file to the demo's limits before it is
written: no more than demoMaxBookmarksPerPage bookmarks on it, and no new page
past demoMaxPages.
*/
func demoCheckPageWrite(path string, page PageWithBookmarks) error {
	if len(page.Bookmarks) > demoMaxBookmarksPerPage {
		return fmt.Errorf("%w: %d bookmarks on a page", errDemoLimit, demoMaxBookmarksPerPage)
	}
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	pages, _ := filepath.Glob(filepath.Join(filepath.Dir(path), "bookmarks-*.json"))
	if len(pages) >= demoMaxPages {
		return fmt.Errorf("%w: %d pages", errDemoLimit, demoMaxPages)
	}
	return nil
}

// demoInboxLimit is the inbox's limit in the demo, where the inbox otherwise
// has none: the oldest link makes room, as it did before the limit was lifted.
func demoInboxLimit(maxItems int) int {
	if demoMode() && (maxItems == 0 || maxItems > demoInboxCap) {
		return demoInboxCap
	}
	return maxItems
}
