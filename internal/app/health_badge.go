package app

import (
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"
)

/*
An uptime badge: a small SVG a README or forum post can embed.

Off unless Settings.UptimeBadges is on, and then readable by anyone who knows a
monitored address. That is the point of a badge, and also why the switch exists
and defaults off: it tells the web whether a host answers. What it never does is
say whether an address is known -- an unmonitored one and a made-up one both
read "no data" -- and the address itself is not drawn into the image.
*/

// badgeWindows are the periods a badge may report, in days.
var badgeWindows = map[string]int{"7": 7, "30": 30}

// UptimeBadge answers GET /badge/uptime.svg?url=...&days=7|30.
func (h *Handlers) UptimeBadge(w http.ResponseWriter, r *http.Request) {
	if !h.store.GetSettings().UptimeBadges {
		http.NotFound(w, r)
		return
	}
	days := 30
	if d, ok := badgeWindows[strings.TrimSpace(r.URL.Query().Get("days"))]; ok {
		days = d
	}
	key := canonicalBookmarkURLKey(strings.TrimSpace(r.URL.Query().Get("url")))

	value, colour := "no data", "#6b7280"
	// Monitored addresses only. History is kept for every bookmark that was
	// ever re-checked, and a figure for one of those told the web that an
	// address nobody chose to publish is known here.
	if key != "" && h.badgeMonitored(key) {
		h.healthHistoryMu.Lock()
		file := readHealthHistoryFile()
		h.healthHistoryMu.Unlock()
		samples := append([]HealthSample(nil), file.Samples[key]...)
		daysSummary := foldSamplesIntoDays(append([]HealthDay(nil), file.Days[key]...), samples)
		window := uptimeWithDays(samples, daysSummary, time.Duration(days)*24*time.Hour, time.Now())
		if window.Samples > 0 {
			value, colour = badgeValue(window.Ratio)
		}
	}

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	// Short, so a fresh outage reaches a page that embeds the badge within
	// minutes, and public so a proxy in front can absorb a busy README.
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = fmt.Fprint(w, renderUptimeBadge(fmt.Sprintf("uptime %dd", days), value, colour))
}

// badgeMonitored reports whether some bookmark monitors this address.
func (h *Handlers) badgeMonitored(key string) bool {
	for _, bm := range h.store.GetAllBookmarks() {
		if bm.Monitor && canonicalBookmarkURLKey(bm.URL) == key {
			return true
		}
	}
	return false
}

// badgeValue turns a ratio into the text and colour a badge shows.
func badgeValue(ratio float64) (string, string) {
	percent := ratio * 100
	text := fmt.Sprintf("%.2f%%", percent)
	switch {
	case percent >= 99.9:
		return text, "#2e9e5b"
	case percent >= 99:
		return text, "#b88a14"
	default:
		return text, "#c9473f"
	}
}

// renderUptimeBadge draws the two-part badge. Text is escaped and the widths
// are estimated, since no font is measured on the server.
func renderUptimeBadge(label, value, colour string) string {
	const charWidth, pad = 6.6, 10.0
	labelW := float64(len(label))*charWidth + 2*pad
	valueW := float64(len(value))*charWidth + 2*pad
	total := labelW + valueW
	l, v := html.EscapeString(label), html.EscapeString(value)
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%.0f" height="20" role="img" aria-label="%s: %s">`+
		`<title>%s: %s</title>`+
		`<clipPath id="r"><rect width="%.0f" height="20" rx="3"/></clipPath>`+
		`<g clip-path="url(#r)"><rect width="%.0f" height="20" fill="#3b4048"/><rect x="%.0f" width="%.0f" height="20" fill="%s"/></g>`+
		`<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">`+
		`<text x="%.1f" y="14">%s</text><text x="%.1f" y="14">%s</text></g></svg>`,
		total, l, v, l, v, total, labelW, labelW, valueW, colour,
		labelW/2, l, labelW+valueW/2, v)
}
