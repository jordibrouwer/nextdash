package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
The calendar widget: what is coming up, from one ICS feed.

One feed for the whole install, the same way the weather widget reads one
location rather than a location per tile -- CalendarIcsUrl lives in Settings,
and every calendar widget on every page reads it. Fetched and parsed here
rather than in the browser, for the same two reasons the custom widget is:
most calendar providers hand out a private feed address that is not meant for
browser JS to read across origins, and a feed address is not a thing to leave
sitting in every script on the page.

Recurring events are shown once, at their own DTSTART, and never expanded.
RRULE expansion means timezones, EXDATE, and a handful of real-world feeds
that get it wrong -- a second product's worth of edge cases for a dashboard
tile. A weekly standup shows the occurrence the feed states outright and
nothing this does not understand.
*/

const (
	// calendarFetchTimeout bounds one read of the feed.
	calendarFetchTimeout = 8 * time.Second
	// calendarMaxBody caps the feed read. A personal calendar's ICS export is
	// tens of kilobytes; a megabyte is far past that and short of anything
	// that would hurt to hold.
	calendarMaxBody = 1 << 20
	// calendarCacheTTL is how long a fetched feed is trusted before the next
	// request re-reads it. Fifteen minutes: a feed does not need to be
	// current to the minute, and re-fetching a provider's calendar every
	// dashboard repaint is not a rate anyone asked this widget to run at.
	calendarCacheTTL = 15 * time.Minute
	// calendarMaxEvents bounds what one parse keeps, so a feed spanning years
	// of history and a thousand recurring instances cannot grow the cache
	// without limit. Sorted ascending, so what is dropped is always the
	// furthest out.
	calendarMaxEvents = 500
)

// CalendarEvent is one entry as the tile should show it.
type CalendarEvent struct {
	Title string `json:"title"`
	// Start and End are unix milliseconds. End is 0 when the feed named none.
	Start  int64 `json:"start"`
	End    int64 `json:"end,omitempty"`
	AllDay bool  `json:"allDay,omitempty"`
}

// CalendarWidgetResult is what the tile draws.
type CalendarWidgetResult struct {
	Events []CalendarEvent `json:"events,omitempty"`
	// FetchedAt says how old this is, because a cached feed that looks live
	// is worse than a stale one that says so.
	FetchedAt int64  `json:"fetchedAt"`
	Error     string `json:"error,omitempty"`
}

/*
calendarFeedCache holds one parsed feed per address, for calendarCacheTTL.

Per address rather than per widget: the feed is one setting for the whole
install, so two calendar widgets asking about the same address are asking the
same question and should not cost two fetches.
*/
var calendarFeedCache = struct {
	sync.Mutex
	at map[string]calendarFeedEntry
}{at: map[string]calendarFeedEntry{}}

type calendarFeedEntry struct {
	events  []CalendarEvent
	err     string
	expires time.Time
}

func calendarFeedCached(url string, now time.Time) (calendarFeedEntry, bool) {
	calendarFeedCache.Lock()
	defer calendarFeedCache.Unlock()
	entry, ok := calendarFeedCache.at[url]
	if !ok || now.After(entry.expires) {
		return calendarFeedEntry{}, false
	}
	return entry, true
}

func calendarFeedStore(url string, entry calendarFeedEntry, now time.Time) {
	calendarFeedCache.Lock()
	defer calendarFeedCache.Unlock()
	if len(calendarFeedCache.at) > 50 {
		for key, existing := range calendarFeedCache.at {
			if now.After(existing.expires) {
				delete(calendarFeedCache.at, key)
			}
		}
	}
	calendarFeedCache.at[url] = entry
}

// calendarFeed returns this install's feed, fetching and parsing it only when
// nothing cached is still fresh.
func (h *Handlers) calendarFeed(ctx context.Context, url string, forceRefresh bool) ([]CalendarEvent, string) {
	now := time.Now()
	if !forceRefresh {
		if cached, ok := calendarFeedCached(url, now); ok {
			return cached.events, cached.err
		}
	}

	events, err := h.fetchCalendarFeed(ctx, url)
	entry := calendarFeedEntry{events: events, err: err, expires: now.Add(calendarCacheTTL)}
	if err != "" {
		// A feed that is down does not become a retry loop for a dashboard
		// left open: the failure is cached too, just for less long.
		entry.expires = now.Add(1 * time.Minute)
	}
	calendarFeedStore(url, entry, now)
	return events, err
}

func (h *Handlers) fetchCalendarFeed(ctx context.Context, url string) ([]CalendarEvent, string) {
	if err := validateHTTPURL(url, h.allowLocalBookmarks()); err != nil {
		return nil, "that address is not allowed"
	}

	ctx, cancel := context.WithTimeout(ctx, calendarFetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "that address cannot be requested"
	}
	req.Header.Set("Accept", "text/calendar, text/plain, */*")
	req.Header.Set("User-Agent", "nextDash Widget/1.0")

	client := h.outboundHTTPClient(calendarFetchTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		logWarn(logComponentWidgets, "%s could not be reached; the calendar tile will show what it has: %v", hostOf(url), err)
		return nil, "no answer from that address"
	}
	defer drainAndCloseResponse(resp)

	if resp.StatusCode >= 400 {
		logWarn(logComponentWidgets, "%s answered %d; the calendar tile will show what it has", hostOf(url), resp.StatusCode)
		return nil, "the service answered " + strconv.Itoa(resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, calendarMaxBody))
	if err != nil {
		return nil, "the feed could not be read"
	}
	events := parseICS(raw, time.Now())
	return events, ""
}

/*
parseICS reads VEVENT blocks out of raw ICS text.

Only what a tile needs: the title and when it starts and ends. Anything past
the next few months is not what a "what's coming up" tile is for, so events
that have already ended are dropped here rather than carried into the cache
only to be filtered out on every request that follows.
*/
func parseICS(raw []byte, now time.Time) []CalendarEvent {
	lines := unfoldICSLines(raw)

	events := make([]CalendarEvent, 0, 32)
	var inEvent bool
	var summary string
	var start, end int64
	var allDay bool
	var haveStart bool

	flush := func() {
		if !haveStart || summary == "" {
			return
		}
		// A multi-day or ongoing event is still coming up as long as it has
		// not ended; a point-in-time one is judged by its own start.
		cutoff := start
		if end > 0 {
			cutoff = end
		}
		if cutoff < now.UnixMilli() {
			return
		}
		if len(events) < calendarMaxEvents {
			events = append(events, CalendarEvent{Title: summary, Start: start, End: end, AllDay: allDay})
		}
	}

	for _, line := range lines {
		switch {
		case line == "BEGIN:VEVENT":
			inEvent = true
			summary, start, end = "", 0, 0
			allDay, haveStart = false, false
			continue
		case line == "END:VEVENT":
			if inEvent {
				flush()
			}
			inEvent = false
			continue
		}
		if !inEvent {
			continue
		}

		name, params, value := splitICSProperty(line)
		switch name {
		case "SUMMARY":
			summary = unescapeICSText(value)
		case "DTSTART":
			if t, isAllDay, ok := parseICSDateTime(value, params); ok {
				start, allDay, haveStart = t.UnixMilli(), isAllDay, true
			}
		case "DTEND":
			if t, _, ok := parseICSDateTime(value, params); ok {
				end = t.UnixMilli()
			}
		}
	}

	sort.Slice(events, func(i, j int) bool { return events[i].Start < events[j].Start })
	return events
}

// unfoldICSLines reverses RFC 5545 line folding: a line that starts with a
// space or a tab is a continuation of the one before it, the leading
// whitespace itself discarded.
func unfoldICSLines(raw []byte) []string {
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	rawLines := strings.Split(text, "\n")

	lines := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		if (strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t")) && len(lines) > 0 {
			lines[len(lines)-1] += line[1:]
			continue
		}
		lines = append(lines, line)
	}
	return lines
}

// splitICSProperty reads "NAME;PARAM=VALUE;...:the value" into its three
// parts. A value never carries an unescaped colon in the properties this
// reads (dates and plain text), so the first one found is the split point.
func splitICSProperty(line string) (name string, params map[string]string, value string) {
	colon := strings.IndexByte(line, ':')
	if colon < 0 {
		return "", nil, ""
	}
	head, value := line[:colon], line[colon+1:]
	parts := strings.Split(head, ";")
	name = strings.ToUpper(parts[0])
	if len(parts) > 1 {
		params = make(map[string]string, len(parts)-1)
		for _, part := range parts[1:] {
			if eq := strings.IndexByte(part, '='); eq > 0 {
				params[strings.ToUpper(part[:eq])] = part[eq+1:]
			}
		}
	}
	return name, params, value
}

/*
parseICSDateTime reads a DTSTART/DTEND value in the three shapes a feed
actually uses: an all-day DATE, a UTC DATE-TIME ending in Z, and a floating or
TZID-qualified DATE-TIME.

A TZID this install's Go binary does not recognise, or none named at all,
reads as UTC -- an approximation, not a lookup that guesses: the alternative
is dropping the event, and a time off by the reader's own offset from UTC is
still the right day for the "what's coming up" question this tile answers.
*/
func parseICSDateTime(value string, params map[string]string) (t time.Time, allDay bool, ok bool) {
	value = strings.TrimSpace(value)
	if params["VALUE"] == "DATE" || (len(value) == 8 && !strings.Contains(value, "T")) {
		parsed, err := time.ParseInLocation("20060102", value, time.UTC)
		if err != nil {
			return time.Time{}, false, false
		}
		return parsed, true, true
	}

	if strings.HasSuffix(value, "Z") {
		parsed, err := time.ParseInLocation("20060102T150405Z", value, time.UTC)
		if err != nil {
			return time.Time{}, false, false
		}
		return parsed, false, true
	}

	loc := time.UTC
	if tzid := params["TZID"]; tzid != "" {
		if named, err := time.LoadLocation(tzid); err == nil {
			loc = named
		}
	}
	parsed, err := time.ParseInLocation("20060102T150405", value, loc)
	if err != nil {
		return time.Time{}, false, false
	}
	return parsed, false, true
}

// unescapeICSText undoes RFC 5545 TEXT escaping. A tile shows one line per
// event, so an escaped newline becomes a space rather than a line break.
func unescapeICSText(value string) string {
	replacer := strings.NewReplacer(`\n`, " ", `\N`, " ", `\,`, ",", `\;`, ";", `\\`, `\`)
	return strings.TrimSpace(replacer.Replace(value))
}

/*
CalendarWidgetHandler answers what one calendar widget should draw: this
install's feed, filtered to that widget's own look-ahead and row count.
*/
func (h *Handlers) CalendarWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	pageID, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("pageId")))
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	widgetID := strings.TrimSpace(r.URL.Query().Get("id"))
	if widgetID == "" {
		http.Error(w, "Missing widget id", http.StatusBadRequest)
		return
	}

	widgets, _ := h.store.GetPageBlocks(pageID)
	var found *Widget
	for i := range widgets {
		if widgets[i].ID == widgetID && widgets[i].Type == WidgetTypeCalendar {
			found = &widgets[i]
			break
		}
	}
	if found == nil {
		http.Error(w, "No such widget", http.StatusNotFound)
		return
	}

	url := strings.TrimSpace(h.store.GetSettings().CalendarIcsUrl)
	now := time.Now()
	if url == "" {
		_ = json.NewEncoder(w).Encode(CalendarWidgetResult{FetchedAt: now.UnixMilli(), Error: "no calendar feed set"})
		return
	}

	forced := r.URL.Query().Get("refresh") == "1"
	if forced && !h.requireWriteAccess(w, r) {
		return
	}

	events, fetchErr := h.calendarFeed(r.Context(), url, forced)
	result := CalendarWidgetResult{FetchedAt: now.UnixMilli(), Error: fetchErr}
	if fetchErr == "" {
		result.Events = filterCalendarEvents(events, found.Config, now)
	}
	_ = json.NewEncoder(w).Encode(result)
}

// filterCalendarEvents narrows the cached feed to what this widget asked for:
// nothing already over, nothing past its look-ahead window, capped to its row
// count.
func filterCalendarEvents(events []CalendarEvent, config map[string]any, now time.Time) []CalendarEvent {
	daysAhead := clampInt(widgetConfigIntOr(config["daysAhead"], 14), 1, 90)
	rows := clampInt(widgetConfigIntOr(config["rows"], 5), widgetMinRows, widgetMaxRows)
	cutoff := now.Add(time.Duration(daysAhead) * 24 * time.Hour).UnixMilli()
	nowMs := now.UnixMilli()

	out := make([]CalendarEvent, 0, rows)
	for _, event := range events {
		ended := event.Start
		if event.End > 0 {
			ended = event.End
		}
		if ended < nowMs || event.Start > cutoff {
			continue
		}
		out = append(out, event)
		if len(out) >= rows {
			break
		}
	}
	return out
}

func widgetConfigIntOr(raw any, fallback int) int {
	if value, ok := widgetConfigInt(raw); ok {
		return value
	}
	return fallback
}
