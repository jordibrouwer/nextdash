package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// PingResult holds the outcome of a bookmark URL reachability check.
type PingResult struct {
	Status      string
	PingMs      int
	ErrorDetail string
	HTTPStatus  int
}

func (h *Handlers) pingURL(ctx context.Context, urlStr string) (string, int) {
	result := h.pingURLDetailed(ctx, urlStr)
	return result.Status, result.PingMs
}

func (h *Handlers) pingURLDetailed(ctx context.Context, urlStr string) PingResult {
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	urlStr = strings.TrimSpace(urlStr)
	if urlStr == "" {
		return PingResult{Status: "offline", ErrorDetail: "Invalid URL"}
	}

	parsed, err := url.Parse(urlStr)
	if err != nil || parsed.Host == "" {
		return PingResult{Status: "offline", ErrorDetail: "Invalid URL"}
	}
	if err := validateHTTPURL(urlStr, h.allowLocalBookmarks()); err != nil {
		return PingResult{Status: "offline", ErrorDetail: "URL host is not allowed"}
	}

	start := time.Now()
	allowLocal := h.allowLocalBookmarks()
	client := &http.Client{
		Timeout:       3 * time.Second,
		Transport:     newSSRFSafeTransport(allowLocal, 2*time.Second),
		CheckRedirect: safeRedirectCheck(allowLocal, 5),
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return PingResult{Status: "offline", ErrorDetail: "Invalid URL"}
	}
	req.Header.Set("User-Agent", "nextDash-Health/1.0")

	resp, err := client.Do(req)
	elapsed := int(time.Since(start).Milliseconds())
	if elapsed < 1 {
		elapsed = 1
	}

	if err == nil && resp != nil {
		defer drainAndCloseResponse(resp)
		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			return PingResult{Status: "online", PingMs: elapsed, HTTPStatus: resp.StatusCode}
		}
		if resp.StatusCode >= 400 {
			return PingResult{
				Status:      "offline",
				PingMs:      elapsed,
				ErrorDetail: fmt.Sprintf("HTTP %d", resp.StatusCode),
				HTTPStatus:  resp.StatusCode,
			}
		}
	}

	detail := classifyPingError(err, resp)
	return PingResult{Status: "offline", PingMs: elapsed, ErrorDetail: detail, HTTPStatus: httpStatusFromResponse(resp)}
}

func httpStatusFromResponse(resp *http.Response) int {
	if resp == nil {
		return 0
	}
	return resp.StatusCode
}

func classifyPingError(err error, resp *http.Response) string {
	if err != nil {
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			return "Timeout"
		}
		msg := strings.ToLower(err.Error())
		switch {
		case strings.Contains(msg, "no such host"), strings.Contains(msg, "dns"):
			return "DNS lookup failed"
		case strings.Contains(msg, "connection refused"):
			return "Connection refused"
		case strings.Contains(msg, "tls"), strings.Contains(msg, "certificate"), strings.Contains(msg, "x509"):
			return "TLS error"
		case strings.Contains(msg, "timeout"), strings.Contains(msg, "deadline exceeded"):
			return "Timeout"
		case strings.Contains(msg, "too many redirects"):
			return "Too many redirects"
		default:
			return "Unreachable"
		}
	}
	if resp != nil && resp.StatusCode >= 400 {
		return fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return "Unreachable"
}

func duplicateKeepScore(ref BookmarkRef) (opens int, pinned int, created int64) {
	opens = ref.OpenCount
	if ref.Pinned {
		pinned = 1
	}
	created = ref.CreatedAt
	return opens, pinned, created
}

func duplicateRefBetter(a, b BookmarkRef) bool {
	aOpens, aPinned, aCreated := duplicateKeepScore(a)
	bOpens, bPinned, bCreated := duplicateKeepScore(b)
	if aOpens != bOpens {
		return aOpens > bOpens
	}
	if aPinned != bPinned {
		return aPinned > bPinned
	}
	switch {
	case aCreated == 0 && bCreated == 0:
		return false
	case aCreated == 0:
		return false
	case bCreated == 0:
		return true
	default:
		return aCreated < bCreated
	}
}

func sortDuplicateRefsBestFirst(refs []BookmarkRef) {
	if len(refs) < 2 {
		return
	}
	// Stable sort: best keeper first (most opens → pinned → oldest createdAt).
	for i := 0; i < len(refs); i++ {
		bestIdx := i
		for j := i + 1; j < len(refs); j++ {
			if duplicateRefBetter(refs[j], refs[bestIdx]) {
				bestIdx = j
			}
		}
		if bestIdx != i {
			refs[i], refs[bestIdx] = refs[bestIdx], refs[i]
		}
	}
}

type mergeDeleteRef struct {
	pageID int
	index  int
}
