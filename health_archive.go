package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// The Wayback Machine as an actual way out of a dead link.
//
// The row has linked to archive.org's *listing* for a while, which opens a
// calendar of captures and leaves the reading to you. What a rotten bookmark
// needs is the last capture that worked, its date, and the choice to keep it —
// so "this is gone" becomes something you can act on rather than something you
// are told.

const (
	archiveAvailabilityAPI     = "https://archive.org/wayback/available?url=%s"
	archiveRequestTimeout      = 8 * time.Second
	archiveMaxResponseBodySize = 64 * 1024
)

// archiveSnapshot is what the row is offered: where the capture lives and when
// it was taken.
type archiveSnapshot struct {
	URL       string `json:"url,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"` // Unix milliseconds, 0 when unknown
	Available bool   `json:"available"`
}

// waybackAvailability is the subset of the availability API's payload we read.
type waybackAvailability struct {
	ArchivedSnapshots struct {
		Closest struct {
			Available bool   `json:"available"`
			URL       string `json:"url"`
			Timestamp string `json:"timestamp"` // YYYYMMDDhhmmss
			Status    string `json:"status"`
		} `json:"closest"`
	} `json:"archived_snapshots"`
}

// ArchiveSnapshot answers "is there a copy of this, and from when".
//
// Rate-limited with the other outbound lookups: it takes a URL from the client
// and asks a third party about it, which is exactly the shape the SSRF limiter
// exists for.
func (h *Handlers) ArchiveSnapshot(w http.ResponseWriter, r *http.Request) {
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	target := strings.TrimSpace(r.URL.Query().Get("url"))
	w.Header().Set("Content-Type", "application/json")
	if target == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "url is required"})
		return
	}
	if parsed, err := url.Parse(target); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "url must be http or https"})
		return
	}

	snapshot, err := h.lookupArchiveSnapshot(r.Context(), target)
	if err != nil {
		// A lookup that fails is not an error the user can act on — the answer
		// is simply "nothing to offer" — so it reads the same as no capture.
		_ = json.NewEncoder(w).Encode(archiveSnapshot{})
		return
	}
	_ = json.NewEncoder(w).Encode(snapshot)
}

func (h *Handlers) lookupArchiveSnapshot(ctx context.Context, target string) (archiveSnapshot, error) {
	endpoint := fmt.Sprintf(archiveAvailabilityAPI, url.QueryEscape(target))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return archiveSnapshot{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", updateCheckUserAgent)

	client := h.outboundHTTPClient(archiveRequestTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return archiveSnapshot{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return archiveSnapshot{}, fmt.Errorf("archive API HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, archiveMaxResponseBodySize))
	if err != nil {
		return archiveSnapshot{}, err
	}
	var payload waybackAvailability
	if err := json.Unmarshal(body, &payload); err != nil {
		return archiveSnapshot{}, err
	}

	closest := payload.ArchivedSnapshots.Closest
	if !closest.Available || strings.TrimSpace(closest.URL) == "" {
		return archiveSnapshot{}, nil
	}
	return archiveSnapshot{
		URL:       normalizeArchiveURL(closest.URL),
		Timestamp: parseWaybackTimestamp(closest.Timestamp),
		Available: true,
	}, nil
}

// normalizeArchiveURL upgrades the http:// the API still hands out, so a capture
// opened from an https dashboard is not a mixed-content link.
func normalizeArchiveURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "http://web.archive.org/") {
		return "https://" + strings.TrimPrefix(trimmed, "http://")
	}
	return trimmed
}

// parseWaybackTimestamp reads the API's YYYYMMDDhhmmss into Unix milliseconds.
// Returns 0 when it is not that, since a wrong date is worse than none.
func parseWaybackTimestamp(raw string) int64 {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) != 14 {
		return 0
	}
	at, err := time.Parse("20060102150405", trimmed)
	if err != nil {
		return 0
	}
	return at.UTC().UnixMilli()
}
