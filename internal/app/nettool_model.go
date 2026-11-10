package app

import (
	"fmt"
	"strings"
	"time"
)

// Netwerktests op bookmarks. Dit bestand is het datamodel; de guard, de motor
// en de planner komen in latere bestanden (nettool_*.go).

const (
	netTypeTCP  = "tcp"
	netTypePing = "ping"
	netTypeDNS  = "dns"
	netTypeTLS  = "tls"
	netTypeHTTP = "http" // HTTP-detail
	netTypeJSON = "json"

	netMaxChecksPerBookmark = 6
	netDefaultMaxChecks     = 200
	netMaxPerTick           = 25
	netDetailMax            = 120
	netHistoryPrefix        = "net:"
)

// netTypesBuilt is what PUT /api/net/checks and /api/net/run accept.
// Elke fase zet zijn type hier aan; niets anders gate't op type-beschikbaarheid.
var netTypesBuilt = map[string]bool{netTypeTCP: true, netTypePing: true} // fase 1a: tcp, ping; 2a: dns; 3a: tls; 3b: http; 4: json

// NetCheck is one network check on a bookmark. The ID is unique across the
// whole install (a bookmark has no ID of its own) and is set by the server.
type NetCheck struct {
	ID              string `json:"id"` // 12 hex, globaal uniek, door de server gezet
	Type            string `json:"type"`
	Enabled         bool   `json:"enabled,omitempty"`         // gepland ("Plannen")
	Label           string `json:"label,omitempty"`           // optioneel, max 60
	Host            string `json:"host,omitempty"`            // alleen met NetToolsAllowCustomHost
	Port            int    `json:"port,omitempty"`            // tcp/tls; 0 = uit URL/schema
	IntervalMinutes int    `json:"intervalMinutes,omitempty"` // 0 = "zoals de bookmark"
	TimeoutSec      int    `json:"timeoutSec,omitempty"`      // 1..10, 0 = default per type
	Muted           bool   `json:"muted,omitempty"`
	// ping
	Count      int `json:"count,omitempty"`      // 1..10, default 4
	MaxLossPct int `json:"maxLossPct,omitempty"` // default 50
	MaxMs      int `json:"maxMs,omitempty"`      // ping/tcp/http: trager = "slow" (blijft up)
	// Server-eigendom (alleen DNS-drift, fase 2a); de client kan ze niet zetten.
	Baseline  string `json:"baseline,omitempty"`
	DriftDiff string `json:"driftDiff,omitempty"` // ≤120
	DriftAt   int64  `json:"driftAt,omitempty"`
}

// netHistoryKey is the history key of a check: "net:" + id. Not the bookmark's
// URL key, so it survives a URL change or a move to another page.
func netHistoryKey(checkID string) string { return netHistoryPrefix + checkID }

// isNetHistoryKey tells a network check's history key from a URL key.
func isNetHistoryKey(key string) bool { return strings.HasPrefix(key, netHistoryPrefix) }

// newNetCheckID returns a fresh 12-hex ID that is not in taken, and records it.
func newNetCheckID(taken map[string]bool) string {
	for {
		id := randomHex(6)
		if !taken[id] {
			if taken != nil {
				taken[id] = true
			}
			return id
		}
	}
}

// netCheckLabel is the short name of a check: its own label, else "TCP 443",
// "Ping", "DNS · MX", "TLS 8443", "HTTP", "JSON · <path>".
func netCheckLabel(c NetCheck, bm Bookmark) string {
	if l := strings.TrimSpace(c.Label); l != "" {
		return l
	}
	switch c.Type {
	case netTypeTCP:
		if c.Port > 0 {
			return fmt.Sprintf("TCP %d", c.Port)
		}
		return "TCP"
	case netTypePing:
		return "Ping"
	case netTypeDNS:
		return "DNS"
	case netTypeTLS:
		if c.Port > 0 {
			return fmt.Sprintf("TLS %d", c.Port)
		}
		return "TLS"
	case netTypeHTTP:
		return "HTTP"
	case netTypeJSON:
		return "JSON"
	}
	return strings.ToUpper(c.Type)
}

// netCheckInterval is how often a check runs: its own interval, else the
// bookmark's monitor interval, clamped like any monitor cadence.
func netCheckInterval(c NetCheck, bm Bookmark) time.Duration {
	minutes := c.IntervalMinutes
	if minutes <= 0 {
		minutes = bm.MonitorIntervalMinutes
	}
	return time.Duration(clampMonitorIntervalMinutes(minutes)) * time.Minute
}

// allNetCheckIDs is every check ID in the install, on every page.
func allNetCheckIDs(store Store) map[string]bool {
	ids := map[string]bool{}
	for _, page := range store.GetPages() {
		for _, bm := range store.GetBookmarksByPage(page.ID) {
			for _, c := range bm.Checks {
				if c.ID != "" {
					ids[c.ID] = true
				}
			}
		}
	}
	return ids
}

// findNetCheck looks a check up by ID across all pages.
func findNetCheck(store Store, id string) (bm Bookmark, pageID int, chk NetCheck, ok bool) {
	if id == "" {
		return Bookmark{}, 0, NetCheck{}, false
	}
	for _, page := range store.GetPages() {
		for _, b := range store.GetBookmarksByPage(page.ID) {
			for _, c := range b.Checks {
				if c.ID == id {
					return b, page.ID, c, true
				}
			}
		}
	}
	return Bookmark{}, 0, NetCheck{}, false
}

// truncateNetDetail cuts a sample detail to netDetailMax runes.
func truncateNetDetail(s string) string {
	r := []rune(s)
	if len(r) <= netDetailMax {
		return s
	}
	return string(r[:netDetailMax])
}
