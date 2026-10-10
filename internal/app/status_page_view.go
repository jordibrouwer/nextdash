package app

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// statusPageLimiter throttles /s/* per visitor IP. It runs before the token
// compare, so guessing the link costs a minute per sixty tries.
var statusPageLimiter = newSlidingWindowLimiter(60, time.Minute)

// statusPageLocales are the languages the page speaks; anything else is English.
var statusPageLocales = map[string]bool{"en": true, "nl": true, "de": true, "fr": true, "zh": true, "es": true}

// statusPageStrings maps each key under statusPage. to its English fallback.
var statusPageStrings = map[string]string{
	"defaultTitle":       "Service status",
	"allWorking":         "All services are working",
	"oneProblem":         "1 service has a problem",
	"manyProblems":       "{n} services have a problem",
	"operational":        "Operational",
	"degraded":           "Degraded",
	"down":               "Down",
	"maintenance":        "Maintenance",
	"unknown":            "Unknown",
	"downSince":          "Down since {time}",
	"degradedSince":      "Degraded since {time}",
	"restarting":         "Restarting repeatedly",
	"lastCheck":          "Last check {ago}",
	"updated":            "Updated {ago}",
	"plannedMaintenance": "Planned maintenance",
	"maintenanceNow":     "Maintenance in progress",
	"working":            "{n}/{total} working",
	"daysAgo":            "30 days ago",
	"today":              "Today",
	"last30":             "Last 30 days",
	"legendWorking":      "Working",
	"refreshes":          "Refreshes every minute",
	"noData":             "no data",
	"noProblems":         "no problems",
	"justNow":            "just now",
	"secondsAgo":         "{n} s ago",
	"minutesAgo":         "{n} min ago",
	"hoursAgo":           "{n} h ago",
	"daysAgoN":           "{n} d ago",
	"loadFailed":         "Could not refresh. Showing the last known state.",
	"noscript":           "Turn on JavaScript to see the services.",
	"unnamed":            "Service",
}

// statusPageLang picks the visitor's language from Accept-Language. Header
// order is trusted: browsers already send it sorted by preference.
func statusPageLang(acceptLanguage string) string {
	for _, part := range strings.Split(acceptLanguage, ",") {
		tag, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		refused := false
		for _, p := range strings.Split(params, ";") {
			k, v, ok := strings.Cut(strings.TrimSpace(p), "=")
			if ok && strings.EqualFold(strings.TrimSpace(k), "q") {
				q, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
				refused = err == nil && q <= 0
			}
		}
		if refused {
			continue
		}
		primary, _, _ := strings.Cut(strings.TrimSpace(tag), "-")
		primary = strings.ToLower(primary)
		if statusPageLocales[primary] {
			return primary
		}
	}
	return "en"
}

func isHomeNetworkIP(ip string) bool {
	parsed := net.ParseIP(strings.TrimSpace(ip))
	return parsed != nil && (parsed.IsPrivate() || parsed.IsLoopback() || parsed.IsLinkLocalUnicast())
}

// statusVisitor is who is asking, as far as this install can tell, and
// whether it can tell at all.
//
// A direct request is its peer. Through a named proxy it is the rightmost
// X-Forwarded-For entry that is not a named proxy: entries to the left of it
// were written by the client and prove nothing, which matters because a proxy
// that appends (nginx's $proxy_add_x_forwarded_for) keeps whatever the client
// sent first. A named proxy that forwards no address, or an unnamed one that
// does, leaves the visitor unknown.
func statusVisitor(r *http.Request) (ip string, known bool) {
	peer := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(peer); err == nil && host != "" {
		peer = host
	}
	if !isTrustedProxy(peer) {
		for _, h := range []string{"X-Forwarded-For", "Forwarded", "X-Real-IP"} {
			if strings.TrimSpace(r.Header.Get(h)) != "" {
				return peer, false
			}
		}
		return peer, true
	}
	hops := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop := strings.TrimSpace(hops[i])
		if hop == "" {
			continue
		}
		if host, _, err := net.SplitHostPort(hop); err == nil {
			hop = host
		}
		// A hop that is not an address ("unknown") ends the walk: skipping it
		// would reach the entries the client wrote itself.
		if net.ParseIP(hop) == nil {
			return peer, false
		}
		if !isTrustedProxy(hop) {
			return hop, true
		}
	}
	return peer, false
}

// statusVisitorKey is the rate-limit bucket. Never a client-written header
// entry, so a visitor cannot buy a fresh bucket per request.
func statusVisitorKey(r *http.Request) string {
	ip, _ := statusVisitor(r)
	return ip
}

// statusRequestIsHome decides "Only from the home network": only a visitor
// this install can actually identify, on a private address, is home.
func statusRequestIsHome(r *http.Request) bool {
	ip, known := statusVisitor(r)
	return known && isHomeNetworkIP(ip)
}

// statusPageGuard answers the shared 404 and returns false when the request
// may not see the page. Every failure looks like an unknown address, so a
// visitor cannot tell a wrong link from a switched-off page or a throttle.
func (h *Handlers) statusPageGuard(w http.ResponseWriter, r *http.Request) (StatusPageConfig, bool) {
	cfg, err := readStatusPage()
	if err != nil || !cfg.Enabled ||
		!statusPageLimiter.allow(statusVisitorKey(r)) ||
		!statusTokenMatches(mux.Vars(r)["token"]) ||
		(cfg.LANOnly && !statusRequestIsHome(r)) {
		h.NotFoundHandler(w, r)
		return StatusPageConfig{}, false
	}
	return cfg, true
}

// setStatusPageHeaders replaces the dashboard defaults securityHeaders set:
// this page loads only its own two files and must not be cached or indexed.
func setStatusPageHeaders(w http.ResponseWriter) {
	hd := w.Header()
	hd.Set("Cache-Control", "no-store")
	hd.Set("X-Robots-Tag", "noindex, nofollow")
	hd.Set("Referrer-Policy", "no-referrer")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("X-Frame-Options", "DENY")
	hd.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
}

type statusPageContent struct {
	Lang     string
	Title    string
	Notice   string
	DataURL  string
	NoScript string
	Strings  map[string]string
}

// StatusPageView serves the shell; status.js fills it from data.json.
func (h *Handlers) StatusPageView(w http.ResponseWriter, r *http.Request) {
	cfg, ok := h.statusPageGuard(w, r)
	if !ok {
		return
	}
	setStatusPageHeaders(w)

	lang := statusPageLang(r.Header.Get("Accept-Language"))
	files := h.assetFiles()
	strs := make(map[string]string, len(statusPageStrings))
	for key, fallback := range statusPageStrings {
		strs[key] = localeText(files, lang, "statusPage."+key, fallback)
	}
	title := cfg.Title
	if title == "" {
		title = strs["defaultTitle"]
	}

	tmpl, err := h.parsePageTemplates("templates/status.html")
	if err != nil {
		http.Error(w, "Could not show this page", http.StatusInternalServerError)
		return
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, statusPageContent{
		Lang:     lang,
		Title:    title,
		Notice:   cfg.Notice,
		DataURL:  "/s/" + mux.Vars(r)["token"] + "/data.json",
		NoScript: strs["noscript"],
		Strings:  strs,
	}); err != nil {
		http.Error(w, "Could not show this page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(buf.Bytes())
}

// StatusPageData serves the snapshot the page polls.
func (h *Handlers) StatusPageData(w http.ResponseWriter, r *http.Request) {
	cfg, ok := h.statusPageGuard(w, r)
	if !ok {
		return
	}
	setStatusPageHeaders(w)

	snap := h.buildStatusSnapshot(r.Context(), cfg, time.Now())
	if cfg.Title == "" {
		lang := statusPageLang(r.Header.Get("Accept-Language"))
		snap.Title = localeText(h.assetFiles(), lang, "statusPage.defaultTitle", statusPageStrings["defaultTitle"])
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}
