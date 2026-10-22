package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
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

Recurring events are expanded: a weekly standup shown only at its first
DTSTART vanished from the tile the week after it was created. RRULE is read for
the four frequencies real feeds use (DAILY, WEEKLY, MONTHLY, YEARLY) with
INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH and WKST; EXDATE removes an
occurrence, RDATE adds one, and a VEVENT carrying a RECURRENCE-ID replaces (or,
cancelled, removes) the occurrence of its UID it names. Occurrences are laid out
in the event's own zone, so a 09:00 meeting stays 09:00 across a clock change.

What is left out is left out on purpose, and degrades to the old behaviour --
the event shown once at its DTSTART -- rather than to a guess: BYSETPOS,
BYWEEKNO, BYYEARDAY, sub-daily frequencies and BYHOUR-style parts, RDATE
periods, and RECURRENCE-ID's RANGE=THISANDFUTURE (read as this one only). Only
occurrences still coming up and inside the widest look-ahead a widget may ask
for are made, so a daily event from 2015 costs a few dozen rows, not thousands.
*/

const (
	// calendarFetchTimeout bounds one read of the feed.
	calendarFetchTimeout = 8 * time.Second
	// calendarMaxBody caps the feed read. A personal calendar's ICS export is
	// tens of kilobytes, but a shared or years-old one runs to megabytes, and
	// past the cap the newest part of the feed was cut off without a word.
	calendarMaxBody = 4 << 20
	// calendarCacheTTL is how long a fetched feed is trusted before the next
	// request re-reads it. Fifteen minutes: a feed does not need to be
	// current to the minute, and re-fetching a provider's calendar every
	// dashboard repaint is not a rate anyone asked this widget to run at.
	calendarCacheTTL = 15 * time.Minute
	// calendarMaxEvents bounds what one parse keeps, so a feed spanning years
	// of history and a thousand recurring instances cannot grow the cache
	// without limit. Cut after sorting, so what is dropped is always the
	// furthest out -- cut in file order, a feed listing far-off items first
	// lost tomorrow's.
	calendarMaxEvents = 500
	// calendarMaxDaysAhead is the furthest one widget may look; its config
	// clamps daysAhead to the same 90.
	calendarMaxDaysAhead = 90
	// calendarRecurHorizon is how far ahead a recurring event is expanded. The
	// parsed feed is one cache shared by every widget, so it is the widest
	// look-ahead any of them may ask for, plus a day for the reader's offset
	// from UTC and the cache's own fifteen minutes.
	calendarRecurHorizon = (calendarMaxDaysAhead + 1) * 24 * time.Hour
	// calendarRecurMaxSteps caps the periods (days, weeks, months, years) one
	// rule walks. A rule without COUNT jumps straight to the present, so this
	// only bites a COUNT rule begun decades ago or one that never matches
	// (BYMONTH=2;BYMONTHDAY=30) -- either way a feed cannot stall the parse.
	calendarRecurMaxSteps = 20000
	// calendarRecurMaxInterval rejects an INTERVAL no calendar app writes, so
	// the date arithmetic stays far from overflow.
	calendarRecurMaxInterval = 10000
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
	if !ok || now.Add(widgetBeatSlack).After(entry.expires) {
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
	raw, err := io.ReadAll(io.LimitReader(resp.Body, calendarMaxBody+1))
	if err != nil {
		return nil, "the feed could not be read"
	}
	if len(raw) > calendarMaxBody {
		logWarn(logComponentWidgets, "the calendar feed from %s is larger than %d MB; the tile shows what fits", hostOf(url), calendarMaxBody>>20)
		raw = raw[:calendarMaxBody]
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

One pass collects the VEVENTs; recurrence is laid out after it, because a
RECURRENCE-ID override may come before or after the master it amends.
*/
func parseICS(raw []byte, now time.Time) []CalendarEvent {
	lines := unfoldICSLines(raw)

	vevents := make([]icsVEvent, 0, 32)
	var inEvent bool
	var cur icsVEvent

	// Components nested in an event (VALARM above all) carry properties of
	// their own: an e-mail reminder's SUMMARY, "Alarm notification" from
	// Google, replaced the event's title. Only depth 0 is the event's.
	nested := 0
	for _, line := range lines {
		switch {
		case line == "BEGIN:VEVENT":
			inEvent = true
			nested = 0
			cur = icsVEvent{}
			continue
		case line == "END:VEVENT":
			if inEvent {
				vevents = append(vevents, cur)
			}
			inEvent = false
			continue
		}
		if !inEvent {
			continue
		}
		if strings.HasPrefix(line, "BEGIN:") {
			nested++
			continue
		}
		if strings.HasPrefix(line, "END:") {
			if nested > 0 {
				nested--
			}
			continue
		}
		if nested > 0 {
			continue
		}

		name, params, value := splitICSProperty(line)
		switch name {
		case "UID":
			cur.uid = strings.TrimSpace(value)
		case "SUMMARY":
			cur.summary = unescapeICSText(value)
		case "DTSTART":
			if t, isAllDay, ok := parseICSDateTime(value, params); ok {
				cur.start, cur.allDay, cur.haveStart = t, isAllDay, true
			}
		case "DTEND":
			if t, _, ok := parseICSDateTime(value, params); ok {
				cur.end = t.UnixMilli()
			}
		case "DURATION":
			cur.duration = parseICSDuration(value)
		case "STATUS":
			cur.cancelled = strings.EqualFold(strings.TrimSpace(value), "CANCELLED")
		case "RRULE":
			// RFC 5545 allows one; a second (deprecated) is ignored rather
			// than half-merged.
			if cur.rrule == "" {
				cur.rrule = strings.TrimSpace(value)
				// Empty still marks the event recurring, so a broken rule
				// falls back like any other unreadable one.
				if cur.rrule == "" {
					cur.rrule = ";"
				}
			}
		case "EXDATE":
			cur.exdates = append(cur.exdates, parseICSDateList(value, params)...)
		case "RDATE":
			// A PERIOD names its own end; nothing a tile row needs badly
			// enough to read a second date shape for.
			if !strings.EqualFold(params["VALUE"], "PERIOD") {
				cur.rdates = append(cur.rdates, parseICSDateList(value, params)...)
			}
		case "RECURRENCE-ID":
			if t, _, ok := parseICSDateTime(value, params); ok {
				cur.recurrenceID, cur.isOverride = t, true
			}
		}
	}

	return calendarEventsFrom(vevents, now)
}

// icsVEvent is one VEVENT as the feed states it, before it becomes rows.
type icsVEvent struct {
	uid, summary string
	// start keeps its zone: recurrence is laid out in it.
	start     time.Time
	haveStart bool
	allDay    bool
	end       int64
	duration  time.Duration
	// A meeting its organiser called off stays in the feed as STATUS:CANCELLED.
	cancelled bool

	rrule        string
	exdates      []icsDate
	rdates       []icsDate
	recurrenceID time.Time
	isOverride   bool
}

// icsDate is one EXDATE or RDATE value; allDay when it was a bare DATE.
type icsDate struct {
	at     time.Time
	allDay bool
}

// parseICSDateList reads the comma-separated values of an EXDATE or RDATE
// line. A PERIOD ("start/end") or an unreadable value is skipped, not fatal.
func parseICSDateList(value string, params map[string]string) []icsDate {
	var out []icsDate
	for _, item := range strings.Split(value, ",") {
		if strings.Contains(item, "/") {
			continue
		}
		if t, allDay, ok := parseICSDateTime(item, params); ok {
			out = append(out, icsDate{at: t, allDay: allDay})
		}
	}
	return out
}

// icsInstanceKey names one occurrence of a series: its UID and start instant.
// The instant, not the text, because a RECURRENCE-ID may name the same moment
// in another zone than the DTSTART did.
func icsInstanceKey(uid string, at time.Time) string {
	return uid + "\x00" + strconv.FormatInt(at.UnixMilli(), 10)
}

/*
calendarEventsFrom turns the collected VEVENTs into the rows the cache keeps:
overrides first noted, every series laid out, everything already over dropped,
sorted and capped.
*/
func calendarEventsFrom(vevents []icsVEvent, now time.Time) []CalendarEvent {
	nowMs := now.UnixMilli()
	horizon := now.Add(calendarRecurHorizon)

	// An override replaces the occurrence it names whether it is kept or
	// cancelled, so every RECURRENCE-ID is noted, and its series' title kept
	// for an override that states only what moved.
	replaced := map[string]bool{}
	titles := map[string]string{}
	for _, ev := range vevents {
		if ev.uid == "" {
			continue
		}
		if ev.isOverride {
			replaced[icsInstanceKey(ev.uid, ev.recurrenceID)] = true
		} else if ev.summary != "" {
			titles[ev.uid] = ev.summary
		}
	}

	events := make([]CalendarEvent, 0, 32)
	for _, ev := range vevents {
		summary := ev.summary
		if summary == "" && ev.isOverride {
			summary = titles[ev.uid]
		}
		if !ev.haveStart || summary == "" || ev.cancelled {
			continue
		}
		start := ev.start.UnixMilli()
		end := ev.end
		// DURATION in place of DTEND: with no end the event was judged by its
		// start and went the moment it began.
		if end == 0 && ev.duration > 0 {
			end = start + ev.duration.Milliseconds()
		}
		// An all-day event without DTEND lasts that one day (RFC 5545 3.6.1).
		// With no end it was over from its own midnight, and a holiday feed
		// lost today's events at 00:00 UTC.
		if ev.allDay && end == 0 {
			end = start + 24*60*60*1000
		}

		var occurrences []time.Time
		recurring := !ev.isOverride && (ev.rrule != "" || len(ev.rdates) > 0)
		if recurring {
			length := int64(0)
			if end > start {
				length = end - start
			}
			// The earliest start that could still be running now; anything
			// before it is over whatever the reader's zone.
			from := now.Add(-time.Duration(length+calendarAllDayGraceMs)*time.Millisecond - 24*time.Hour)
			var ok bool
			if occurrences, ok = expandICSEvent(ev, from, horizon); !ok {
				// A rule this does not read shows the event as the feed states
				// it outright, once, rather than guessing or dropping it.
				recurring, occurrences = false, nil
			}
		}
		if !recurring {
			if row, ok := upcomingCalendarEvent(summary, start, end, ev.allDay, nowMs); ok {
				events = append(events, row)
			}
			continue
		}

		for _, at := range occurrences {
			if ev.uid != "" && replaced[icsInstanceKey(ev.uid, at)] {
				continue
			}
			// Each occurrence keeps the master's length: a one-hour meeting
			// stays an hour even on the night the clocks change.
			instStart, instEnd := at.UnixMilli(), int64(0)
			if end > 0 {
				instEnd = instStart + (end - start)
			}
			if row, ok := upcomingCalendarEvent(summary, instStart, instEnd, ev.allDay, nowMs); ok {
				events = append(events, row)
			}
		}
	}

	sort.Slice(events, func(i, j int) bool { return events[i].Start < events[j].Start })
	if len(events) > calendarMaxEvents {
		events = events[:calendarMaxEvents]
	}
	return events
}

// upcomingCalendarEvent is the row for one occurrence, unless it is over. A
// multi-day or ongoing event is still coming up as long as it has not ended; a
// point-in-time one is judged by its own start.
func upcomingCalendarEvent(title string, start, end int64, allDay bool, nowMs int64) (CalendarEvent, bool) {
	cutoff := start
	if end > 0 {
		cutoff = end
	}
	if allDay {
		cutoff += calendarAllDayGraceMs
	}
	if cutoff < nowMs {
		return CalendarEvent{}, false
	}
	return CalendarEvent{Title: title, Start: start, End: end, AllDay: allDay}, true
}

/*
expandICSEvent lists the start of every occurrence of a recurring VEVENT from
from up to horizon: its RRULE (or DTSTART alone when it has only RDATEs), plus
RDATE, minus EXDATE. ok is false when the RRULE cannot be read, and the caller
then falls back to the single DTSTART.
*/
func expandICSEvent(ev icsVEvent, from, horizon time.Time) ([]time.Time, bool) {
	var starts []time.Time
	if ev.rrule != "" {
		rule, ok := parseICSRule(ev.rrule, ev.start)
		if !ok {
			return nil, false
		}
		starts = rule.expand(ev.start, from, horizon)
	} else if !ev.start.Before(from) && !ev.start.After(horizon) {
		starts = []time.Time{ev.start}
	}

	seen := make(map[int64]bool, len(starts)+len(ev.rdates))
	for _, at := range starts {
		seen[at.UnixMilli()] = true
	}
	for _, rd := range ev.rdates {
		at := rd.at
		// A bare-date RDATE on a timed event happens at the master's time of
		// day, in the master's zone.
		if rd.allDay && !ev.allDay {
			h, m, s := ev.start.Clock()
			y, mo, d := rd.at.Date()
			at = time.Date(y, mo, d, h, m, s, 0, ev.start.Location())
		}
		if at.Before(from) || at.After(horizon) || seen[at.UnixMilli()] {
			continue
		}
		seen[at.UnixMilli()] = true
		starts = append(starts, at)
	}

	if len(ev.exdates) == 0 {
		return starts, true
	}
	excluded := make(map[int64]bool, len(ev.exdates))
	// A bare-date EXDATE on a timed event removes that whole day, read in
	// the event's own zone.
	excludedDays := map[string]bool{}
	for _, ex := range ev.exdates {
		if ex.allDay && !ev.allDay {
			excludedDays[ex.at.Format("20060102")] = true
		} else {
			excluded[ex.at.UnixMilli()] = true
		}
	}
	kept := starts[:0]
	for _, at := range starts {
		if excluded[at.UnixMilli()] || excludedDays[at.In(ev.start.Location()).Format("20060102")] {
			continue
		}
		kept = append(kept, at)
	}
	return kept, true
}

// icsWeekdayNum is one BYDAY entry: a weekday, and which of them in the month
// or year (1 the first, -1 the last), or 0 for every one.
type icsWeekdayNum struct {
	n  int
	wd time.Weekday
}

// icsRule is an RRULE reduced to the parts this expands.
type icsRule struct {
	freq       string
	interval   int
	count      int
	until      time.Time
	hasUntil   bool
	byDay      []icsWeekdayNum
	byMonthDay []int
	byMonth    []int
	wkst       time.Weekday
}

var icsWeekdays = map[string]time.Weekday{
	"SU": time.Sunday, "MO": time.Monday, "TU": time.Tuesday, "WE": time.Wednesday,
	"TH": time.Thursday, "FR": time.Friday, "SA": time.Saturday,
}

/*
parseICSRule reads an RRULE value. ok is false for anything outside the subset
expand understands -- an unknown part, a frequency below a day, a value out of
range -- because an approximation of a rule shows events on days they do not
happen, and the single DTSTART is at least a date the feed stated.
*/
func parseICSRule(value string, start time.Time) (icsRule, bool) {
	rule := icsRule{interval: 1, wkst: time.Monday}
	for _, part := range strings.Split(value, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		eq := strings.IndexByte(part, '=')
		if eq <= 0 {
			return icsRule{}, false
		}
		key, val := strings.ToUpper(part[:eq]), strings.ToUpper(strings.TrimSpace(part[eq+1:]))
		switch key {
		case "FREQ":
			switch val {
			case "DAILY", "WEEKLY", "MONTHLY", "YEARLY":
				rule.freq = val
			default:
				return icsRule{}, false
			}
		case "INTERVAL":
			n, err := strconv.Atoi(val)
			if err != nil || n < 1 || n > calendarRecurMaxInterval {
				return icsRule{}, false
			}
			rule.interval = n
		case "COUNT":
			n, err := strconv.Atoi(val)
			if err != nil || n < 1 {
				return icsRule{}, false
			}
			rule.count = n
		case "UNTIL":
			until, ok := parseICSUntil(val, start)
			if !ok {
				return icsRule{}, false
			}
			rule.until, rule.hasUntil = until, true
		case "BYDAY":
			for _, item := range strings.Split(val, ",") {
				wn, ok := parseICSWeekdayNum(item)
				if !ok {
					return icsRule{}, false
				}
				rule.byDay = append(rule.byDay, wn)
			}
		case "BYMONTHDAY":
			days, ok := parseICSIntList(val, -31, 31)
			if !ok {
				return icsRule{}, false
			}
			rule.byMonthDay = days
		case "BYMONTH":
			months, ok := parseICSIntList(val, 1, 12)
			if !ok {
				return icsRule{}, false
			}
			sort.Ints(months)
			rule.byMonth = months
		case "WKST":
			wd, ok := icsWeekdays[val]
			if !ok {
				return icsRule{}, false
			}
			rule.wkst = wd
		default:
			// BYSETPOS, BYWEEKNO, BYYEARDAY, BYHOUR and the rest.
			return icsRule{}, false
		}
	}
	if rule.freq == "" {
		return icsRule{}, false
	}
	// "The second Monday" means something in a month or a year, not in a day
	// or a week; and combined with BYMONTHDAY it is a BYSETPOS-like
	// intersection this does not attempt.
	for _, wn := range rule.byDay {
		if wn.n != 0 && (rule.freq == "DAILY" || rule.freq == "WEEKLY" || len(rule.byMonthDay) > 0) {
			return icsRule{}, false
		}
	}
	if rule.freq == "WEEKLY" && len(rule.byMonthDay) > 0 {
		return icsRule{}, false
	}
	return rule, true
}

// parseICSWeekdayNum reads one BYDAY item: "MO", "1MO", "-1FR", "+2TU".
func parseICSWeekdayNum(item string) (icsWeekdayNum, bool) {
	item = strings.TrimSpace(item)
	if len(item) < 2 {
		return icsWeekdayNum{}, false
	}
	wd, ok := icsWeekdays[item[len(item)-2:]]
	if !ok {
		return icsWeekdayNum{}, false
	}
	wn := icsWeekdayNum{wd: wd}
	if prefix := item[:len(item)-2]; prefix != "" {
		n, err := strconv.Atoi(prefix)
		if err != nil || n == 0 || n < -53 || n > 53 {
			return icsWeekdayNum{}, false
		}
		wn.n = n
	}
	return wn, true
}

// parseICSIntList reads a comma-separated list of non-zero integers in
// [lo, hi].
func parseICSIntList(val string, lo, hi int) ([]int, bool) {
	var out []int
	for _, item := range strings.Split(val, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(item))
		if err != nil || n == 0 || n < lo || n > hi {
			return nil, false
		}
		out = append(out, n)
	}
	return out, true
}

/*
parseICSUntil reads UNTIL in its three shapes. A bare date covers that whole
day in the event's zone (RFC 5545: UNTIL is inclusive); a floating date-time is
read in the event's zone, where its DTSTART was.
*/
func parseICSUntil(val string, start time.Time) (time.Time, bool) {
	loc := start.Location()
	switch {
	case len(val) == 8:
		d, err := time.ParseInLocation("20060102", val, time.UTC)
		if err != nil {
			return time.Time{}, false
		}
		y, m, day := d.Date()
		return time.Date(y, m, day, 23, 59, 59, 0, loc), true
	case strings.HasSuffix(val, "Z"):
		t, err := time.ParseInLocation("20060102T150405Z", val, time.UTC)
		return t, err == nil
	default:
		t, err := time.ParseInLocation("20060102T150405", val, loc)
		return t, err == nil
	}
}

/*
expand lists the occurrences of the rule from from up to horizon, DTSTART
included when it falls there (RFC 5545 counts it as the first occurrence even
when the rule would not produce it).

Dates are worked out on the calendar in UTC, where a day is always 24 hours,
and each is then given DTSTART's time of day in DTSTART's zone: the wall clock
stays put across a daylight-saving change and the instant moves, which is what
a reader of a 09:00 meeting expects. An all-day or floating event expands the
same way, in its own (UTC or server-local) zone.

A rule without COUNT starts at the period just before from rather than at
DTSTART -- a daily event from 2015 walks three months, not ten years. With
COUNT every period from DTSTART has to be counted, so it walks them, up to
calendarRecurMaxSteps.
*/
func (r icsRule) expand(start, from, horizon time.Time) []time.Time {
	loc := start.Location()
	hour, minute, second := start.Clock()
	sy, sm, sd := start.Date()
	startDay := time.Date(sy, sm, sd, 0, 0, 0, 0, time.UTC)
	at := func(day time.Time) time.Time {
		y, m, d := day.Date()
		return time.Date(y, m, d, hour, minute, second, start.Nanosecond(), loc)
	}

	var out []time.Time
	if !start.Before(from) && !start.After(horizon) {
		out = append(out, start)
	}
	count := 1
	if r.count == 1 {
		return out
	}

	base := r.firstPeriod(startDay)
	k := 0
	if r.count == 0 {
		fy, fm, fd := from.In(loc).Date()
		elapsed := r.periodsBetween(base, time.Date(fy, fm, fd, 0, 0, 0, 0, time.UTC))
		// Back one interval: from is an instant, a period is a stretch of
		// days, and a step too early costs only the occurrences it filters.
		if jump := (elapsed/r.interval - 1) * r.interval; jump > 0 {
			k = jump
		}
	}

	for steps := 0; steps < calendarRecurMaxSteps; steps++ {
		period := r.period(base, k)
		if at(period).After(horizon) {
			break
		}
		for _, day := range r.candidates(period, startDay) {
			// DTSTART is already counted; days before it are not in the set.
			if !day.After(startDay) {
				continue
			}
			t := at(day)
			if r.hasUntil && t.After(r.until) {
				return out
			}
			if r.count > 0 {
				count++
				if count > r.count {
					return out
				}
			}
			if t.After(horizon) {
				return out
			}
			if !t.Before(from) {
				out = append(out, t)
				// Past this many, the feed-wide cap would cut them anyway.
				if len(out) >= calendarMaxEvents {
					return out
				}
			}
		}
		k += r.interval
	}
	return out
}

// firstPeriod is the start of the day, week (from WKST), month or year
// holding DTSTART -- the grid INTERVAL counts on.
func (r icsRule) firstPeriod(startDay time.Time) time.Time {
	switch r.freq {
	case "WEEKLY":
		back := (int(startDay.Weekday()) - int(r.wkst) + 7) % 7
		return startDay.AddDate(0, 0, -back)
	case "MONTHLY":
		return time.Date(startDay.Year(), startDay.Month(), 1, 0, 0, 0, 0, time.UTC)
	case "YEARLY":
		return time.Date(startDay.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	}
	return startDay
}

// period is the k-th period after base.
func (r icsRule) period(base time.Time, k int) time.Time {
	switch r.freq {
	case "WEEKLY":
		return base.AddDate(0, 0, 7*k)
	case "MONTHLY":
		return base.AddDate(0, k, 0)
	case "YEARLY":
		return base.AddDate(k, 0, 0)
	}
	return base.AddDate(0, 0, k)
}

// periodsBetween counts whole periods from base to day; 0 when day is
// earlier. Days are counted from Unix seconds, which unlike time.Duration do
// not overflow for a DTSTART centuries back.
func (r icsRule) periodsBetween(base, day time.Time) int {
	if !day.After(base) {
		return 0
	}
	switch r.freq {
	case "WEEKLY":
		return int((day.Unix() - base.Unix()) / 86400 / 7)
	case "MONTHLY":
		return (day.Year()-base.Year())*12 + int(day.Month()) - int(base.Month())
	case "YEARLY":
		return day.Year() - base.Year()
	}
	return int((day.Unix() - base.Unix()) / 86400)
}

// candidates lists, in order, the days in one period the rule picks.
func (r icsRule) candidates(period, startDay time.Time) []time.Time {
	switch r.freq {
	case "DAILY":
		if r.monthAllowed(period.Month()) && r.weekdayAllowed(period.Weekday()) && r.monthDayAllowed(period) {
			return []time.Time{period}
		}
		return nil
	case "WEEKLY":
		var out []time.Time
		for i := 0; i < 7; i++ {
			day := period.AddDate(0, 0, i)
			if len(r.byDay) == 0 && day.Weekday() != startDay.Weekday() {
				continue
			}
			if r.weekdayAllowed(day.Weekday()) && r.monthAllowed(day.Month()) {
				out = append(out, day)
			}
		}
		return out
	case "MONTHLY":
		if !r.monthAllowed(period.Month()) {
			return nil
		}
		return icsDaysOf(period.Year(), period.Month(), r.monthDays(period.Year(), period.Month(), startDay.Day()))
	}

	// YEARLY. BYDAY alone counts its ordinals through the year ("the 20th
	// Monday"); with BYMONTH they count through each month ("the fourth
	// Thursday of November").
	year := period.Year()
	if len(r.byDay) > 0 && len(r.byMonth) == 0 && len(r.byMonthDay) == 0 {
		first := time.Date(year, time.January, 1, 0, 0, 0, 0, time.UTC)
		length := int((time.Date(year+1, time.January, 1, 0, 0, 0, 0, time.UTC).Unix() - first.Unix()) / 86400)
		var idx []int
		for _, wn := range r.byDay {
			idx = append(idx, icsNthWeekday(first, length, wn)...)
		}
		var out []time.Time
		for _, i := range icsSortedUnique(idx) {
			out = append(out, first.AddDate(0, 0, i-1))
		}
		return out
	}
	months := r.byMonth
	if len(months) == 0 {
		if len(r.byMonthDay) > 0 {
			months = []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}
		} else {
			months = []int{int(startDay.Month())}
		}
	}
	var out []time.Time
	for _, m := range months {
		out = append(out, icsDaysOf(year, time.Month(m), r.monthDays(year, time.Month(m), startDay.Day()))...)
	}
	return out
}

/*
monthDays is the days of one month the rule picks, in order: BYMONTHDAY (a
negative one counting from the month's end), else BYDAY with its ordinals
counted within the month, else DTSTART's own day. A month without that day --
the 31st in April, the 29th of February in most years -- has no occurrence
rather than one moved to its last day, as RFC 5545 has it.
*/
func (r icsRule) monthDays(year int, month time.Month, startDay int) []int {
	dim := icsDaysIn(year, month)
	var days []int
	switch {
	case len(r.byMonthDay) > 0:
		for _, d := range r.byMonthDay {
			if d < 0 {
				d = dim + 1 + d
			}
			if d < 1 || d > dim {
				continue
			}
			if !r.weekdayAllowed(time.Date(year, month, d, 0, 0, 0, 0, time.UTC).Weekday()) {
				continue
			}
			days = append(days, d)
		}
	case len(r.byDay) > 0:
		first := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
		for _, wn := range r.byDay {
			days = append(days, icsNthWeekday(first, dim, wn)...)
		}
	default:
		if startDay <= dim {
			days = []int{startDay}
		}
	}
	return icsSortedUnique(days)
}

func (r icsRule) monthAllowed(month time.Month) bool {
	if len(r.byMonth) == 0 {
		return true
	}
	for _, m := range r.byMonth {
		if time.Month(m) == month {
			return true
		}
	}
	return false
}

// weekdayAllowed ignores ordinals: it is only asked where they are absent.
func (r icsRule) weekdayAllowed(wd time.Weekday) bool {
	if len(r.byDay) == 0 {
		return true
	}
	for _, wn := range r.byDay {
		if wn.wd == wd {
			return true
		}
	}
	return false
}

func (r icsRule) monthDayAllowed(day time.Time) bool {
	if len(r.byMonthDay) == 0 {
		return true
	}
	dim := icsDaysIn(day.Year(), day.Month())
	for _, d := range r.byMonthDay {
		if d == day.Day() || (d < 0 && dim+1+d == day.Day()) {
			return true
		}
	}
	return false
}

// icsNthWeekday lists the 1-based positions, within the length days from
// first, of the weekday wn names: all of them, or only the n-th from the
// start (n > 0) or from the end (n < 0). A fifth Friday in a month with four
// is none.
func icsNthWeekday(first time.Time, length int, wn icsWeekdayNum) []int {
	var all []int
	for i := (int(wn.wd) - int(first.Weekday()) + 7) % 7; i < length; i += 7 {
		all = append(all, i+1)
	}
	switch {
	case wn.n == 0:
		return all
	case wn.n > 0 && wn.n <= len(all):
		return []int{all[wn.n-1]}
	case wn.n < 0 && -wn.n <= len(all):
		return []int{all[len(all)+wn.n]}
	}
	return nil
}

func icsDaysIn(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func icsDaysOf(year int, month time.Month, days []int) []time.Time {
	out := make([]time.Time, 0, len(days))
	for _, d := range days {
		out = append(out, time.Date(year, month, d, 0, 0, 0, 0, time.UTC))
	}
	return out
}

func icsSortedUnique(values []int) []int {
	sort.Ints(values)
	out := make([]int, 0, len(values))
	for _, v := range values {
		if len(out) == 0 || v != out[len(out)-1] {
			out = append(out, v)
		}
	}
	return out
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
// parts. The split is the first colon outside double quotes: a quoted
// parameter may hold one (Outlook's TZID="(UTC+01:00) Amsterdam, …"), and
// split there the event lost its start and vanished.
func splitICSProperty(line string) (name string, params map[string]string, value string) {
	colon, inQuote := -1, false
	for i := 0; i < len(line) && colon < 0; i++ {
		switch {
		case line[i] == '"':
			inQuote = !inQuote
		case line[i] == ':' && !inQuote:
			colon = i
		}
	}
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

	// A floating time (no zone at all) is the reader's local time in RFC
	// 5545; read as UTC it showed the wrong hour. The server's own zone (TZ in
	// the container) is the nearest thing to the reader's.
	loc := time.Local
	if tzid := strings.Trim(params["TZID"], `"`); tzid != "" {
		loc = time.UTC
		// Outlook and Exchange name zones the Windows way, which LoadLocation
		// does not know; those fell back to UTC.
		if iana, ok := windowsTimeZones[tzid]; ok {
			tzid = iana
		}
		if named, err := time.LoadLocation(tzid); err == nil {
			loc = named
		} else if fixed, ok := icsDisplayNameZone(tzid); ok {
			loc = fixed
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

	// Not cancelled with the request: a reader leaving mid-fetch made it fail,
	// and the failure was cached for every other widget for a minute.
	// calendarFetchTimeout still bounds it.
	events, fetchErr := h.calendarFeed(context.WithoutCancel(r.Context()), url, forced)
	result := CalendarWidgetResult{FetchedAt: now.UnixMilli(), Error: fetchErr}
	if fetchErr == "" {
		result.Events = filterCalendarEvents(events, found.Config, now, calendarAllDayGrace(r.URL.Query().Get("tzOffset")))
	}
	_ = json.NewEncoder(w).Encode(result)
}

// calendarAllDayGrace is how long past its UTC end an all-day event lasts for
// this reader: their offset from getTimezoneOffset (minutes, UTC minus local),
// or the widest one when the browser did not say. Judged here, before the row
// cap, so yesterday's all-day event does not take a row the tile then hides.
func calendarAllDayGrace(raw string) int64 {
	if offset, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil && offset >= -840 && offset <= 720 {
		return int64(offset) * 60_000
	}
	return calendarAllDayGraceMs
}

// filterCalendarEvents narrows the cached feed to what this widget asked for:
// nothing already over, nothing past its look-ahead window, capped to its row
// count. allDayGrace is calendarAllDayGrace's answer for the reader.
func filterCalendarEvents(events []CalendarEvent, config map[string]any, now time.Time, allDayGrace int64) []CalendarEvent {
	daysAhead := clampInt(widgetConfigIntOr(config["daysAhead"], 14), 1, calendarMaxDaysAhead)
	rows := clampInt(widgetConfigIntOr(config["rows"], 5), widgetMinRows, widgetMaxRows)
	cutoff := now.Add(time.Duration(daysAhead) * 24 * time.Hour).UnixMilli()
	nowMs := now.UnixMilli()

	out := make([]CalendarEvent, 0, rows)
	for _, event := range events {
		ended := event.Start
		if event.End > 0 {
			ended = event.End
		}
		if event.AllDay {
			ended += allDayGrace
		}
		if ended <= nowMs || event.Start > cutoff {
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

// calendarAllDayGraceMs keeps an all-day event until its day is over west of
// UTC as well. Its end is midnight UTC, so judged by the instant a reader in
// New York lost today's all-day event at 20:00; UTC-12 is the widest offset.
const calendarAllDayGraceMs = int64(14 * time.Hour / time.Millisecond)

// icsDisplayNamePattern is the offset in front of an Outlook display name,
// "(UTC+01:00) Amsterdam, Berlin, …".
var icsDisplayNamePattern = regexp.MustCompile(`^\(UTC(?:([+-])(\d{2}):(\d{2}))?\)`)

// icsDisplayNameZone reads that offset as a fixed zone: without daylight
// saving, but the right day and, half the year, the right hour.
func icsDisplayNameZone(tzid string) (*time.Location, bool) {
	m := icsDisplayNamePattern.FindStringSubmatch(tzid)
	if m == nil {
		return nil, false
	}
	if m[1] == "" {
		return time.UTC, true
	}
	hours, _ := strconv.Atoi(m[2])
	minutes, _ := strconv.Atoi(m[3])
	offset := hours*3600 + minutes*60
	if m[1] == "-" {
		offset = -offset
	}
	return time.FixedZone(m[0], offset), true
}

var icsDurationPattern = regexp.MustCompile(`^[+]?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$`)

// parseICSDuration reads an RFC 5545 DURATION (P1W, P1DT2H, PT90M); 0 when it
// is not one. A negative duration means nothing for an event's end.
func parseICSDuration(raw string) time.Duration {
	m := icsDurationPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if m == nil {
		return 0
	}
	units := []time.Duration{7 * 24 * time.Hour, 24 * time.Hour, time.Hour, time.Minute, time.Second}
	var total time.Duration
	for i, unit := range units {
		if m[i+1] != "" {
			n, _ := strconv.Atoi(m[i+1])
			total += time.Duration(n) * unit
		}
	}
	return total
}

// windowsTimeZones maps the Windows zone names Outlook feeds use most to IANA.
var windowsTimeZones = map[string]string{
	"W. Europe Standard Time":        "Europe/Amsterdam",
	"Romance Standard Time":          "Europe/Paris",
	"Central Europe Standard Time":   "Europe/Budapest",
	"Central European Standard Time": "Europe/Warsaw",
	"GMT Standard Time":              "Europe/London",
	"Greenwich Standard Time":        "Atlantic/Reykjavik",
	"E. Europe Standard Time":        "Europe/Chisinau",
	"FLE Standard Time":              "Europe/Helsinki",
	"GTB Standard Time":              "Europe/Bucharest",
	"Russian Standard Time":          "Europe/Moscow",
	"Eastern Standard Time":          "America/New_York",
	"Central Standard Time":          "America/Chicago",
	"Mountain Standard Time":         "America/Denver",
	"US Mountain Standard Time":      "America/Phoenix",
	"Pacific Standard Time":          "America/Los_Angeles",
	"Alaskan Standard Time":          "America/Anchorage",
	"Hawaiian Standard Time":         "Pacific/Honolulu",
	"Atlantic Standard Time":         "America/Halifax",
	"E. South America Standard Time": "America/Sao_Paulo",
	"China Standard Time":            "Asia/Shanghai",
	"Tokyo Standard Time":            "Asia/Tokyo",
	"India Standard Time":            "Asia/Kolkata",
	"Singapore Standard Time":        "Asia/Singapore",
	"AUS Eastern Standard Time":      "Australia/Sydney",
	"New Zealand Standard Time":      "Pacific/Auckland",
	"South Africa Standard Time":     "Africa/Johannesburg",
	"UTC":                            "UTC",
}
