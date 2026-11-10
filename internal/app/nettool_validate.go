package app

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
)

// errNetCheckCap is the install-wide ceiling on enabled checks (HTTP 409).
var errNetCheckCap = errors.New("too many scheduled network checks; raise the limit in the settings or turn one off")

// normalizeNetChecks turns an incoming list into the list to store.
// stored is this bookmark's current checks; taken holds every ID in the install
// except this bookmark's own; enabledElsewhere counts enabled checks on other
// bookmarks, so this bookmark's old checks never count against the ceiling.
// Errors are English sentences for the UI.
func normalizeNetChecks(in, stored []NetCheck, bm Bookmark, s Settings,
	taken map[string]bool, enabledElsewhere int) ([]NetCheck, error) {
	if len(in) > netMaxChecksPerBookmark {
		return nil, fmt.Errorf("a bookmark can have at most %d checks", netMaxChecksPerBookmark)
	}
	storedByID := map[string]NetCheck{}
	for _, c := range stored {
		storedByID[c.ID] = c
	}
	// An ID is kept only if it is one of this bookmark's own and not yet used
	// in this list. An ID from another bookmark is never taken over.
	used := map[string]bool{}
	allTaken := map[string]bool{}
	for id := range taken {
		allTaken[id] = true
	}
	for id := range storedByID {
		allTaken[id] = true
	}

	out := make([]NetCheck, 0, len(in))
	enabled := 0
	for _, c := range in {
		if !netTypesBuilt[c.Type] {
			return nil, fmt.Errorf("unknown or unavailable check type %q", c.Type)
		}
		prev, own := storedByID[c.ID]
		next := NetCheck{Type: c.Type, Enabled: c.Enabled, Muted: c.Muted}
		if own && !used[c.ID] && !taken[c.ID] {
			next.ID = c.ID
			next.Baseline, next.DriftDiff, next.DriftAt = prev.Baseline, prev.DriftDiff, prev.DriftAt
		} else {
			next.ID = newNetCheckID(allTaken)
		}
		used[next.ID] = true

		label := strings.TrimSpace(c.Label)
		if len([]rune(label)) > 60 {
			return nil, errors.New("the label can be at most 60 characters")
		}
		for _, r := range label {
			if unicode.IsControl(r) {
				return nil, errors.New("the label cannot contain control characters")
			}
		}
		next.Label = label

		if host := strings.ToLower(strings.TrimSpace(c.Host)); host != "" {
			if !s.NetToolsAllowCustomHost {
				return nil, errNetCustomHostOff
			}
			if !validNetCheckHost(host) {
				return nil, errors.New("the host must be a host name or an IP address, without scheme, port or path")
			}
			next.Host = host
		}
		if c.Port < 0 || c.Port > 65535 {
			return nil, errors.New("the port must be between 1 and 65535")
		}
		if c.Type == netTypeTCP || c.Type == netTypeTLS {
			next.Port = c.Port
		}
		if c.IntervalMinutes != 0 && (c.IntervalMinutes < minMonitorIntervalMinutes || c.IntervalMinutes > maxMonitorIntervalMinutes) {
			return nil, fmt.Errorf("the interval must be between %d and %d minutes", minMonitorIntervalMinutes, maxMonitorIntervalMinutes)
		}
		next.IntervalMinutes = c.IntervalMinutes
		if c.TimeoutSec < 0 || c.TimeoutSec > 10 {
			return nil, errors.New("the timeout must be between 1 and 10 seconds")
		}
		next.TimeoutSec = c.TimeoutSec
		if c.Count < 0 || c.Count > 10 {
			return nil, errors.New("the packet count must be between 1 and 10")
		}
		if c.MaxLossPct < 0 || c.MaxLossPct > 100 {
			return nil, errors.New("the allowed loss must be between 0 and 100 percent")
		}
		if c.MaxMs < 0 || c.MaxMs > 60000 {
			return nil, errors.New("the slow threshold must be between 0 and 60000 ms")
		}
		next.Count, next.MaxLossPct, next.MaxMs = c.Count, c.MaxLossPct, c.MaxMs

		if next.Enabled {
			enabled++
		}
		out = append(out, next)
	}
	if enabledElsewhere+enabled > s.NetToolsMaxChecks {
		return nil, errNetCheckCap
	}
	return out, nil
}
