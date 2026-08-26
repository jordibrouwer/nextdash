package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"strings"
	"time"
)

/*
The CDX index: not just "is there a copy", but "when did this die".

The availability API answers one question — the capture closest to now — and it
answers it about any capture, including the ones that archived a 404 page. That
is enough to offer a link and not enough to say anything about the link's
history, which is the part a health view actually wants.

The CDX index hands back a row per capture with its status code and a content
digest. Two things follow from that, and neither is possible with availability:

The last capture that returned 200 is the last version of the page that really
existed. That is the one worth offering, rather than whatever was captured most
recently -- which for a dead link is usually a capture of the error page.

And the first capture after it that did not return 200 is, within the archive's
sampling, when the page stopped working. A row that says "gone since March 2019"
is a different thing from a row that says "dead": one is a fact about the web,
the other is a fact about today's request.

No auth, no key, no documented quota. One request.
*/

// waybackCDXAPI is a var so a test can point it at a stub.
var waybackCDXAPI = "https://web.archive.org/cdx/search/cdx"

const (
	// archiveCDXTimeout bounds one index query.
	//
	// Generous because the index is genuinely slow: measured against the real
	// service, a newest-first query for a heavily captured URL took thirteen
	// seconds, which a fifteen-second budget turned into an intermittent
	// failure that fell back to the availability API and looked like the
	// feature simply not working. This is a background lookup for a row that is
	// already on screen, so waiting costs nothing anyone is watching.
	archiveCDXTimeout = 45 * time.Second
	// archiveCDXMaxBody caps the response. With the limits below the answer is
	// a few hundred bytes; anything approaching this is not an index answer.
	archiveCDXMaxBody = 256 << 10
	// archiveCDXTailRows is how many of the most recent captures are read to
	// find where a page stopped working. Enough to step over a run of errors
	// and back to the last good one, small enough that the index does not have
	// to hand over a decade of history to answer a question about last year.
	archiveCDXTailRows = 40
	// archiveCDXGoodRows bounds the successful-captures query. Asked for in the
	// index's own order because filtering and reverse sorting do not combine,
	// so this is a window from the start of the history -- wide enough that a
	// page captured working at any point in a normal life is inside it.
	archiveCDXGoodRows = 2000
)

/*
ArchiveHistory is what the index can say that availability cannot.

Snapshot is the capture worth offering: the most recent one that answered 200.
DiedAt is when captures stopped answering 200, in Unix milliseconds, and is 0
whenever that cannot be established -- no captures, still working, or the
archive simply has not looked since.
*/
type ArchiveHistory struct {
	/*
	 * The capture itself is inlined, not nested.
	 *
	 * This route answered a bare archiveSnapshot for several releases and the
	 * health view reads `url`, `timestamp` and `available` straight off the
	 * top level. Nesting them under `snapshot` silently broke "recover from
	 * archive" -- the call still succeeded, the fields were simply not where
	 * the caller looked. Embedding keeps both shapes true at once: old readers
	 * find the fields where they always were, new ones get the history beside
	 * them.
	 */
	archiveSnapshot
	// Snapshot repeats the capture as a nested object, so a caller written
	// against the history shape does not have to know it was ever flat.
	Snapshot archiveSnapshot `json:"snapshot"`
	// FirstSeen is the oldest capture in the tail read, not necessarily the
	// oldest capture there is: it says "at least this long", never "since".
	FirstSeen int64 `json:"firstSeen,omitempty"`
	DiedAt    int64 `json:"diedAt,omitempty"`
	// LastStatus is the status code of the newest capture, whatever it was, so
	// a caller can tell "the archive also gets a 404" from "never captured".
	LastStatus string `json:"lastStatus,omitempty"`
	Captures   int    `json:"captures,omitempty"`
}

// cdxRow is one capture: the fields asked for, in the order asked for.
type cdxRow struct {
	Timestamp string
	Original  string
	StatusRaw string
	Digest    string
}

/*
lookupArchiveHistory reads the tail of a URL's capture history.

Sorted newest-first by the index (`sort=reverse`) and capped, so the cost does
not grow with how heavily archived a page is. Asking for specific fields rather
than the default set keeps the response small and the parsing honest -- the
column order is the one requested, not whatever the index defaults to today.
*/
func (h *Handlers) lookupArchiveHistory(ctx context.Context, target string) (ArchiveHistory, error) {
	// Newest-first, unfiltered: what the archive gets today, and how many
	// captures there are to talk about.
	tail, err := h.fetchCDXRows(ctx, cdxQuery(target, neturl.Values{
		"sort":  {"reverse"},
		"limit": {fmt.Sprint(archiveCDXTailRows)},
	}))
	if err != nil {
		return ArchiveHistory{}, err
	}

	history := ArchiveHistory{Captures: len(tail)}
	if len(tail) > 0 {
		history.LastStatus = tail[0].StatusRaw
	}

	/*
	 * The working captures, asked for separately.
	 *
	 * `filter` and `sort=reverse` do not combine on this index -- together they
	 * return nothing at all, which is how the first version of this quietly
	 * fell back to the availability API for every genuinely dead link. So the
	 * successful captures are asked for in the index's own order, oldest
	 * first, and the last row is the most recent one that worked.
	 *
	 * Bounded by asking for a window rather than the whole history: a page
	 * captured every day for fifteen years has thousands of rows, and only the
	 * ends of that list say anything.
	 */
	good, err := h.fetchCDXRows(ctx, cdxQuery(target, neturl.Values{
		"filter": {"statuscode:200"},
		"limit":  {fmt.Sprint(archiveCDXGoodRows)},
	}))
	if err != nil {
		// The tail still answers "what does the archive get today", which is
		// worth returning even when the successful captures cannot be read.
		return history, nil
	}
	if len(good) == 0 {
		// Captured, never successfully -- or never captured at all. Nothing to
		// offer and nothing to date.
		return history, nil
	}

	newestGood := good[len(good)-1]
	if oldest := waybackTimestampToMillis(good[0].Timestamp); oldest > 0 {
		history.FirstSeen = oldest
	}
	if url := waybackCaptureURL(newestGood); url != "" {
		history.setSnapshot(archiveSnapshot{
			URL:       url,
			Timestamp: waybackTimestampToMillis(newestGood.Timestamp),
			Available: true,
		})
	}

	/*
	 * When it stopped working: the oldest capture in the tail that is newer
	 * than the last good one.
	 *
	 * The tail is newest-first, so walking back from its end finds the earliest
	 * failing capture the archive has. A page whose newest capture still
	 * answers 200 is not dead and gets no date at all.
	 */
	lastGoodAt := waybackTimestampToMillis(newestGood.Timestamp)
	if lastGoodAt > 0 {
		for i := len(tail) - 1; i >= 0; i-- {
			at := waybackTimestampToMillis(tail[i].Timestamp)
			if at <= lastGoodAt {
				continue
			}
			if tail[i].StatusRaw != "200" {
				history.DiedAt = at
			}
			break
		}
	}
	return history, nil
}

// cdxQuery builds an index URL, always asking for the same fields in the same
// order so the column names in the answer mean what the parser expects.
func cdxQuery(target string, extra neturl.Values) string {
	query := neturl.Values{}
	query.Set("url", target)
	query.Set("output", "json")
	query.Set("fl", "timestamp,original,statuscode,digest")
	for key, values := range extra {
		query[key] = values
	}
	return waybackCDXAPI + "?" + query.Encode()
}

func (h *Handlers) fetchCDXRows(ctx context.Context, endpoint string) ([]cdxRow, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", updateCheckUserAgent)

	// A client of its own: the shared one waits ten seconds for the first
	// response byte, and this index regularly needs more than that before it
	// says anything at all.
	client := newOutboundHTTPClientWithHeaderTimeout(h.allowLocalBookmarks(), archiveCDXTimeout, archiveCDXTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("CDX API HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, archiveCDXMaxBody))
	if err != nil {
		return nil, err
	}

	// The index answers with an array of arrays whose first row is the header.
	// An empty body and a bare "[]" both mean "never captured", which is an
	// answer rather than a failure.
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" || trimmed == "[]" {
		return nil, nil
	}
	var raw [][]string
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		return nil, fmt.Errorf("CDX sent something that is not an index answer: %w", err)
	}
	if len(raw) < 2 {
		return nil, nil
	}

	// Read by column name rather than by position: the header is right there,
	// and a silently reordered response would otherwise put timestamps in the
	// status field.
	index := map[string]int{}
	for i, name := range raw[0] {
		index[strings.TrimSpace(name)] = i
	}
	at := func(row []string, name string) string {
		i, ok := index[name]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}

	out := make([]cdxRow, 0, len(raw)-1)
	for _, row := range raw[1:] {
		out = append(out, cdxRow{
			Timestamp: at(row, "timestamp"),
			Original:  at(row, "original"),
			StatusRaw: at(row, "statuscode"),
			Digest:    at(row, "digest"),
		})
	}
	return out, nil
}

// waybackCaptureURL builds the playback URL for one capture. The id_ suffix is
// deliberately absent: the reader wants the page as the archive renders it, not
// the raw stored bytes.
func waybackCaptureURL(row cdxRow) string {
	stamp := strings.TrimSpace(row.Timestamp)
	original := strings.TrimSpace(row.Original)
	if stamp == "" || original == "" {
		return ""
	}
	return "https://web.archive.org/web/" + stamp + "/" + original
}

// waybackTimestampToMillis converts YYYYMMDDhhmmss to Unix milliseconds.
func waybackTimestampToMillis(stamp string) int64 {
	stamp = strings.TrimSpace(stamp)
	if len(stamp) != 14 {
		return 0
	}
	at, err := time.Parse("20060102150405", stamp)
	if err != nil {
		return 0
	}
	return at.UnixMilli()
}

// setSnapshot writes the capture to both the inlined fields and the nested
// object, so the two can never disagree about what was found.
func (h *ArchiveHistory) setSnapshot(snapshot archiveSnapshot) {
	h.archiveSnapshot = snapshot
	h.Snapshot = snapshot
}
