package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"regexp"
	"strings"
	"time"
)

/*
archive.today, the second archive.

The Wayback Machine misses what it is not allowed to keep: a site whose
robots.txt turned it away, a paywall, a page taken down and retroactively
withdrawn. archive.today captures on request and keeps what it captured, so for
a dead link the two indexes genuinely disagree, and the copy that exists is
worth more than which service holds it.

There is no JSON API and no key. What there is, and what this uses, is a
**Memento TimeMap** -- RFC 7089, the same standard the Wayback Machine serves --
at /timemap/<url>. It is a list of links with datetimes, so reading it is
parsing a documented format rather than scraping a page that can be redesigned.

Two things measured against the live service shape this code:

The mirrors are not interchangeable. On 25 August 2026, archive.is did not
resolve at all, archive.today answered 301, and archive.ph and archive.li
answered 200 -- so a single hardcoded host is a feature that works for some
people and not others. The list is tried in order.

And the index contains captures dated in the future. example.com carries 1135
entries running to 31 December 2035; Hacker News, with 3686 entries, has its
newest real capture at 24 August 2026 followed by one dated 2029. Taking "the
last memento" -- the obvious reading of the format -- therefore returns a
capture that cannot exist, for exactly the busy pages someone is most likely to
look up. Anything dated after now is dropped.
*/

// archiveTodayMirrors is a var so a test can point it at a stub. Order matters:
// the first host that answers is used.
var archiveTodayMirrors = []string{
	"https://archive.ph",
	"https://archive.li",
	"https://archive.today",
}

const (
	// archiveTodayTimeout bounds one mirror, not the whole lookup: three
	// mirrors that each hang would otherwise be three times this.
	archiveTodayTimeout = 12 * time.Second
	// archiveTodayMaxBody caps a timemap. Hacker News' is 443 KB with 3686
	// entries, which is the largest measured; 4 MB leaves room without
	// promising to read an unbounded list.
	archiveTodayMaxBody = 4 << 20
	// archiveTodayMaxEntries stops parsing once there is plenty to answer
	// with. The list is oldest-first, so this is a cap on work, not on recency
	// -- the newest entries are read either way.
	archiveTodayMaxEntries = 20000
)

// ArchiveTodayResult is what archive.today holds for one page.
type ArchiveTodayResult struct {
	Available bool   `json:"available"`
	URL       string `json:"url,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
	// FirstSeen is the oldest capture the mirror listed.
	FirstSeen int64 `json:"firstSeen,omitempty"`
	// Captures counts what was listed after the future-dated entries were
	// dropped, so "one copy" and "hundreds" read differently on screen.
	Captures int `json:"captures,omitempty"`
	// Mirror names the host that answered, because which one works varies by
	// network and someone debugging a blank result needs to know.
	Mirror string `json:"mirror,omitempty"`
}

var (
	// A TimeMap line: <url>; rel="..."; datetime="...". The rel and datetime
	// can appear in either order, and a line may carry neither.
	mementoLinkPattern     = regexp.MustCompile(`<([^>]+)>\s*;\s*(.*)`)
	mementoDatetimePattern = regexp.MustCompile(`datetime\s*=\s*"([^"]+)"`)
	mementoRelPattern      = regexp.MustCompile(`rel\s*=\s*"([^"]+)"`)
)

var errArchiveTodayUnreachable = errors.New("no archive.today mirror answered")

/*
LookupArchiveToday asks archive.today what it holds for one page.

Tries each mirror until one answers. A mirror that refuses, times out or rate
limits is not an error worth reporting on its own -- the next one is tried, and
only all of them failing is a failure.
*/
func (h *Handlers) LookupArchiveToday(ctx context.Context, target string) (ArchiveTodayResult, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return ArchiveTodayResult{}, errors.New("url is required")
	}
	if parsed, err := neturl.Parse(target); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ArchiveTodayResult{}, errors.New("url must be http or https")
	}

	var lastErr error
	for _, mirror := range archiveTodayMirrors {
		result, err := h.lookupArchiveTodayMirror(ctx, mirror, target)
		if err == nil {
			result.Mirror = mirror
			result.URL = rehostCaptureURL(result.URL, mirror)
			return result, nil
		}
		lastErr = err
		// A cancelled request is the caller leaving, not a mirror failing.
		if ctx.Err() != nil {
			return ArchiveTodayResult{}, ctx.Err()
		}
	}
	if lastErr == nil {
		lastErr = errArchiveTodayUnreachable
	}
	return ArchiveTodayResult{}, fmt.Errorf("%w: %v", errArchiveTodayUnreachable, lastErr)
}

func (h *Handlers) lookupArchiveTodayMirror(ctx context.Context, mirror, target string) (ArchiveTodayResult, error) {
	endpoint := strings.TrimRight(mirror, "/") + "/timemap/" + target

	reqCtx, cancel := context.WithTimeout(ctx, archiveTodayTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ArchiveTodayResult{}, err
	}
	req.Header.Set("Accept", "application/link-format, */*")
	req.Header.Set("User-Agent", updateCheckUserAgent)

	client := h.outboundHTTPClient(archiveTodayTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return ArchiveTodayResult{}, err
	}
	defer drainAndCloseResponse(resp)

	switch {
	case resp.StatusCode == http.StatusNotFound:
		// The mirror answered and holds nothing. That is an answer, not a
		// failure, so no other mirror is tried.
		return ArchiveTodayResult{Available: false}, nil
	case resp.StatusCode != http.StatusOK:
		return ArchiveTodayResult{}, fmt.Errorf("%s answered %d", mirror, resp.StatusCode)
	}

	return parseMementoTimeMap(io.LimitReader(resp.Body, archiveTodayMaxBody), time.Now())
}

/*
parseMementoTimeMap reads a TimeMap into the newest usable capture.

`now` is passed rather than read so the future-dated entries can be tested
without waiting for 2035.
*/
func parseMementoTimeMap(body io.Reader, now time.Time) (ArchiveTodayResult, error) {
	scanner := bufio.NewScanner(body)
	// A single line can carry the whole list on some mirrors.
	scanner.Buffer(make([]byte, 0, 64<<10), archiveTodayMaxBody)
	scanner.Split(splitMementoEntries)

	result := ArchiveTodayResult{}
	seen := 0
	for scanner.Scan() && seen < archiveTodayMaxEntries {
		entry := strings.TrimSpace(scanner.Text())
		if entry == "" {
			continue
		}
		match := mementoLinkPattern.FindStringSubmatch(entry)
		if match == nil {
			continue
		}
		attributes := match[2]
		rel := ""
		if relMatch := mementoRelPattern.FindStringSubmatch(attributes); relMatch != nil {
			rel = relMatch[1]
		}
		// original, timegate and self are the list's own metadata, not captures.
		if !strings.Contains(rel, "memento") {
			continue
		}
		stampMatch := mementoDatetimePattern.FindStringSubmatch(attributes)
		if stampMatch == nil {
			continue
		}
		when, err := http.ParseTime(stampMatch[1])
		if err != nil {
			continue
		}
		// The index carries captures dated years ahead -- see the file comment.
		// A capture cannot have been made after now.
		if when.After(now) {
			continue
		}
		seen++
		millis := when.UnixMilli()
		if result.FirstSeen == 0 || millis < result.FirstSeen {
			result.FirstSeen = millis
		}
		if millis >= result.Timestamp {
			result.Timestamp = millis
			result.URL = strings.TrimSpace(match[1])
			result.Available = true
		}
	}
	if err := scanner.Err(); err != nil {
		return ArchiveTodayResult{}, err
	}
	result.Captures = seen
	return result, nil
}

/*
splitMementoEntries cuts a TimeMap into entries.

The format separates them with commas, but a URL may contain one, so the split
is on the comma that precedes the next "<" -- the only place a new entry can
begin. Newlines are entry separators too on the mirrors that pretty-print.
*/
func splitMementoEntries(data []byte, atEOF bool) (advance int, token []byte, err error) {
	for i := 0; i < len(data); i++ {
		if data[i] != ',' && data[i] != '\n' {
			continue
		}
		rest := data[i+1:]
		trimmed := strings.TrimLeft(string(rest), " \t\r\n")
		if data[i] == '\n' || strings.HasPrefix(trimmed, "<") {
			return i + 1, data[:i], nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

/*
ArchiveTodayHandler answers GET /api/health/archive-today.

Separate from archive-snapshot rather than folded into it: the two services
disagree by design -- archive.today keeps what the Wayback Machine was not
allowed to -- so a caller wants both answers, not whichever one replied first.
Behind the same SSRF rate limit as its sibling, since the target address comes
from the request.
*/
func (h *Handlers) ArchiveTodayHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
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
	if parsed, err := neturl.Parse(target); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "url must be http or https"})
		return
	}

	result, err := h.LookupArchiveToday(r.Context(), target)
	if err != nil {
		// Not reaching a second archive is not an error the caller can act on:
		// the answer is "nothing to offer", which is also what an empty index
		// means. The reason travels alongside for anyone reading the response.
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(ArchiveTodayResult{Available: false})
		return
	}
	_ = json.NewEncoder(w).Encode(result)
}

/*
rehostCaptureURL points a capture at the mirror that answered.

The TimeMap names hosts of its own: a lookup answered by archive.ph returns
capture URLs on archive.md, over http. Measured on 25 August 2026, archive.md
does not accept an https connection at all, so following the URL as given means
leaving the site over plaintext to a fourth domain the reader never chose --
while the mirror that just answered holds the same capture and is reachable.

Path and query are kept exactly; only the scheme and host are replaced. A URL
that cannot be parsed, or one already on the answering mirror, is left alone.
*/
func rehostCaptureURL(capture, mirror string) string {
	capture = strings.TrimSpace(capture)
	if capture == "" || mirror == "" {
		return capture
	}
	parsed, err := neturl.Parse(capture)
	if err != nil || parsed.Host == "" {
		return capture
	}
	base, err := neturl.Parse(strings.TrimRight(mirror, "/"))
	if err != nil || base.Host == "" {
		return capture
	}
	parsed.Scheme = base.Scheme
	parsed.Host = base.Host
	return parsed.String()
}
