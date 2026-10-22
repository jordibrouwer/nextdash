package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func icsFixture(now time.Time) string {
	amsterdam, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		amsterdam = time.UTC
	}
	past := now.Add(-48 * time.Hour).UTC().Format("20060102T150405Z")
	standup := now.Add(1 * time.Hour).UTC().Format("20060102T150405Z")
	standupEnd := now.Add(90 * time.Minute).UTC().Format("20060102T150405Z")
	weeklySync := now.Add(2 * time.Hour).UTC().Format("20060102T150405Z")
	// Formatted through the zone itself, so the DTSTART's wall clock parses
	// back to exactly now+3h regardless of daylight saving on the test date.
	zonedWallClock := now.Add(3 * time.Hour).In(amsterdam).Format("20060102T150405")
	allDay := now.Add(24 * time.Hour).Format("20060102")

	// One line is folded (continued on the next with a leading space), one
	// event has already ended, one is all-day, one carries a TZID, one has
	// escaped text, and one has a weekly RRULE.
	return "BEGIN:VCALENDAR\r\n" +
		"BEGIN:VEVENT\r\n" +
		"SUMMARY:Already happened\r\n" +
		"DTSTART:" + past + "\r\n" +
		"END:VEVENT\r\n" +
		"BEGIN:VEVENT\r\n" +
		"SUMMARY:Team standup\\, weekly\r\n" +
		"DTSTART:" + standup + "\r\n" +
		"DTEND:" + standupEnd + "\r\n" +
		"END:VEVENT\r\n" +
		"BEGIN:VEVENT\r\n" +
		"SUMMARY:Weekly sync\r\n" +
		"DTSTART:" + weeklySync + "\r\n" +
		"RRULE:FREQ=WEEKLY\r\n" +
		"END:VEVENT\r\n" +
		"BEGIN:VEVENT\r\n" +
		"SUMMARY:Zoned meeting\r\n" +
		"DTSTART;TZID=Europe/Amsterdam:" + zonedWallClock + "\r\n" +
		"END:VEVENT\r\n" +
		"BEGIN:VEVENT\r\n" +
		"SUMMARY:A long tit\r\n" +
		" le that folds\r\n" +
		"DTSTART;VALUE=DATE:" + allDay + "\r\n" +
		"END:VEVENT\r\n" +
		"END:VCALENDAR\r\n"
}

func TestParseICSKeepsWhatIsComingUp(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	events := parseICS([]byte(icsFixture(now)), now)

	titles := make([]string, len(events))
	for i, e := range events {
		titles[i] = e.Title
	}
	// "Already happened" is dropped; the rest survive, sorted by start.
	want := []string{"Team standup, weekly", "Weekly sync", "Zoned meeting", "A long title that folds"}
	// standup(+1h) < weeklySync(+2h) < zoned(+3h) < allDay(midnight the day
	// after, which is +12h from a fixture anchored at noon). The weekly sync
	// then repeats, a week apart, after all four.
	if len(events) < len(want) {
		t.Fatalf("got %d events, want at least %d: %v", len(events), len(want), titles)
	}
	for i, title := range want {
		if titles[i] != title {
			t.Errorf("event %d = %q, want %q", i, titles[i], title)
		}
	}
	for _, title := range titles[len(want):] {
		if title != "Weekly sync" {
			t.Errorf("after the first four, only the weekly sync repeats; got %v", titles)
			break
		}
	}
	if len(events) == len(want) || events[len(want)].Start != events[1].Start+7*24*60*60*1000 {
		t.Errorf("weekly sync did not repeat a week later: %v", titles)
	}
}

// --- Recurrence ---

// calendarNow is a Tuesday, five days before Europe's clocks go back (25
// October 2026), so a weekly event straddles the change.
var calendarNow = time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

// icsCalendar wraps VEVENT property lines (each event's lines separated by
// "--") into a feed.
func icsCalendar(lines ...string) []byte {
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n")
	for _, line := range lines {
		if line == "--" {
			b.WriteString("END:VEVENT\r\nBEGIN:VEVENT\r\n")
			continue
		}
		b.WriteString(line + "\r\n")
	}
	b.WriteString("END:VEVENT\r\nEND:VCALENDAR\r\n")
	return []byte(b.String())
}

// calendarStarts lists the UTC starts of the events titled title.
func calendarStarts(events []CalendarEvent, title string) []time.Time {
	var out []time.Time
	for _, e := range events {
		if e.Title == title {
			out = append(out, time.UnixMilli(e.Start).UTC())
		}
	}
	return out
}

func assertCalendarStarts(t *testing.T, got []time.Time, want ...time.Time) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d starts %v, want %v", len(got), got, want)
	}
	for i := range want {
		if !got[i].Equal(want[i]) {
			t.Errorf("start %d = %v, want %v", i, got[i], want[i])
		}
	}
}

func utc(y int, m time.Month, d, h, min int) time.Time {
	return time.Date(y, m, d, h, min, 0, 0, time.UTC)
}

func TestParseICSExpandsWeeklyByDay(t *testing.T) {
	events := parseICS(icsCalendar(
		"SUMMARY:Gym", "DTSTART:20261005T100000Z", "DTEND:20261005T110000Z",
		"RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
	), calendarNow)
	got := calendarStarts(events, "Gym")
	if len(got) < 3 {
		t.Fatalf("got %v", got)
	}
	assertCalendarStarts(t, got[:3], utc(2026, 10, 21, 10, 0), utc(2026, 10, 26, 10, 0), utc(2026, 10, 28, 10, 0))
	if events[0].End-events[0].Start != int64(time.Hour/time.Millisecond) {
		t.Errorf("occurrence lost the master's hour: %+v", events[0])
	}
}

func TestParseICSExpandsDailyIntervalWithCount(t *testing.T) {
	// 19, 21, 23, 25, 27 October; the 19th is over.
	events := parseICS(icsCalendar(
		"SUMMARY:Water plants", "DTSTART:20261019T080000Z", "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5",
	), calendarNow)
	assertCalendarStarts(t, calendarStarts(events, "Water plants"),
		utc(2026, 10, 21, 8, 0), utc(2026, 10, 23, 8, 0), utc(2026, 10, 25, 8, 0), utc(2026, 10, 27, 8, 0))
}

func TestParseICSExpandsMonthlyByDayOrdinals(t *testing.T) {
	events := parseICS(icsCalendar(
		"SUMMARY:Drinks", "DTSTART:20260925T170000Z", "RRULE:FREQ=MONTHLY;BYDAY=-1FR",
		"--",
		"SUMMARY:Planning", "DTSTART:20260907T090000Z", "RRULE:FREQ=MONTHLY;BYDAY=1MO",
	), calendarNow)
	// The horizon (now + 91 days) ends on 19 January 2027.
	assertCalendarStarts(t, calendarStarts(events, "Drinks"),
		utc(2026, 10, 30, 17, 0), utc(2026, 11, 27, 17, 0), utc(2026, 12, 25, 17, 0))
	assertCalendarStarts(t, calendarStarts(events, "Planning"),
		utc(2026, 11, 2, 9, 0), utc(2026, 12, 7, 9, 0), utc(2027, 1, 4, 9, 0))
}

// RFC 5545: a month without the day has no occurrence, not one on its last day.
func TestParseICSMonthlyThirtyFirstSkipsShortMonths(t *testing.T) {
	events := parseICS(icsCalendar(
		"SUMMARY:Invoices", "DTSTART:20260131T120000Z", "RRULE:FREQ=MONTHLY;BYMONTHDAY=31",
	), calendarNow)
	assertCalendarStarts(t, calendarStarts(events, "Invoices"), utc(2026, 10, 31, 12, 0), utc(2026, 12, 31, 12, 0))
}

func TestParseICSYearlyAllDayBirthday(t *testing.T) {
	events := parseICS(icsCalendar(
		"SUMMARY:Birthday", "DTSTART;VALUE=DATE:19901103", "DTEND;VALUE=DATE:19901104", "RRULE:FREQ=YEARLY",
	), calendarNow)
	assertCalendarStarts(t, calendarStarts(events, "Birthday"), utc(2026, 11, 3, 0, 0))
	if !events[0].AllDay || events[0].End-events[0].Start != 24*60*60*1000 {
		t.Errorf("birthday should stay one all-day day: %+v", events[0])
	}
}

func TestParseICSUntilInBothForms(t *testing.T) {
	// The 19th and 20th are over at noon on the 20th; UNTIL is inclusive.
	want := []time.Time{utc(2026, 10, 21, 9, 0), utc(2026, 10, 22, 9, 0), utc(2026, 10, 23, 9, 0)}
	for _, until := range []string{"20261023T090000Z", "20261023"} {
		events := parseICS(icsCalendar(
			"SUMMARY:Course", "DTSTART:20261019T090000Z", "RRULE:FREQ=DAILY;UNTIL="+until,
		), calendarNow)
		t.Run(until, func(t *testing.T) { assertCalendarStarts(t, calendarStarts(events, "Course"), want...) })
	}
	// A zoned DTSTART with a UTC UNTIL naming the same instant as its last
	// occurrence (09:00 in Amsterdam is 07:00Z before the change).
	events := parseICS(icsCalendar(
		"SUMMARY:Course", "DTSTART;TZID=Europe/Amsterdam:20261019T090000", "RRULE:FREQ=DAILY;UNTIL=20261023T070000Z",
	), calendarNow)
	assertCalendarStarts(t, calendarStarts(events, "Course"),
		utc(2026, 10, 21, 7, 0), utc(2026, 10, 22, 7, 0), utc(2026, 10, 23, 7, 0))
}

func TestParseICSExdateRemovesAndRdateAdds(t *testing.T) {
	events := parseICS(icsCalendar(
		"SUMMARY:Run", "DTSTART:20261021T090000Z", "RRULE:FREQ=DAILY;COUNT=5",
		"EXDATE:20261022T090000Z,20261024T090000Z",
		"EXDATE:20261025T090000Z",
		"--",
		"SUMMARY:Class", "DTSTART:20261021T090000Z", "RRULE:FREQ=WEEKLY;COUNT=2",
		"RDATE:20261030T150000Z",
	), calendarNow)
	assertCalendarStarts(t, calendarStarts(events, "Run"), utc(2026, 10, 21, 9, 0), utc(2026, 10, 23, 9, 0))
	assertCalendarStarts(t, calendarStarts(events, "Class"),
		utc(2026, 10, 21, 9, 0), utc(2026, 10, 28, 9, 0), utc(2026, 10, 30, 15, 0))
}

func TestParseICSRecurrenceIDMovesAndCancels(t *testing.T) {
	events := parseICS(icsCalendar(
		"UID:series-1", "SUMMARY:Standup", "DTSTART:20261021T090000Z", "RRULE:FREQ=WEEKLY;COUNT=3",
		"--",
		// Listed after the master, moved a day and retitled.
		"UID:series-1", "RECURRENCE-ID:20261028T090000Z", "SUMMARY:Standup (moved)", "DTSTART:20261029T140000Z",
		"--",
		"UID:series-1", "RECURRENCE-ID:20261104T090000Z", "SUMMARY:Standup", "DTSTART:20261104T090000Z", "STATUS:CANCELLED",
	), calendarNow)
	assertCalendarStarts(t, calendarStarts(events, "Standup"), utc(2026, 10, 21, 9, 0))
	assertCalendarStarts(t, calendarStarts(events, "Standup (moved)"), utc(2026, 10, 29, 14, 0))
	if len(events) != 2 {
		t.Fatalf("events = %+v, want the first standup and the moved one", events)
	}
}

// 09:00 in Amsterdam is 07:00Z in summer time and 08:00Z after 25 October.
func TestParseICSKeepsWallClockAcrossDST(t *testing.T) {
	if _, err := time.LoadLocation("Europe/Amsterdam"); err != nil {
		t.Skip("no zone database")
	}
	events := parseICS(icsCalendar(
		"SUMMARY:Review", "DTSTART;TZID=Europe/Amsterdam:20261007T090000", "RRULE:FREQ=WEEKLY",
	), calendarNow)
	got := calendarStarts(events, "Review")
	if len(got) < 2 {
		t.Fatalf("got %v", got)
	}
	assertCalendarStarts(t, got[:2], utc(2026, 10, 21, 7, 0), utc(2026, 10, 28, 8, 0))
}

// A daily event from 2015 with no end yields only what is coming up within the
// horizon -- with and without a COUNT that is still running.
func TestParseICSOldMasterStaysBounded(t *testing.T) {
	for _, rule := range []string{"FREQ=DAILY", "FREQ=DAILY;COUNT=2000000000"} {
		t.Run(rule, func(t *testing.T) {
			events := parseICS(icsCalendar("SUMMARY:Pills", "DTSTART:20150101T090000Z", "RRULE:"+rule), calendarNow)
			got := calendarStarts(events, "Pills")
			if len(got) == 0 || len(got) > calendarMaxEvents {
				t.Fatalf("got %d occurrences", len(got))
			}
			if !got[0].Equal(utc(2026, 10, 21, 9, 0)) {
				t.Errorf("first = %v, want tomorrow 09:00", got[0])
			}
			horizon := calendarNow.Add(calendarRecurHorizon)
			if last := got[len(got)-1]; last.After(horizon) || last.Before(horizon.Add(-48*time.Hour)) {
				t.Errorf("last = %v, want just inside the horizon %v", last, horizon)
			}
		})
	}
}

// A rule this does not read shows the event once, at its DTSTART, and nothing
// a feed can write makes the parse panic or drop the event.
func TestParseICSUnreadableRulesFallBackToDTSTART(t *testing.T) {
	rules := []string{
		"FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
		"FREQ=DAILY;INTERVAL=0",
		"FREQ=DAILY;INTERVAL=-3",
		"FREQ=DAILY;INTERVAL=999999999999",
		"FREQ=DAILY;COUNT=99999999999999999999",
		"FREQ=DAILY;COUNT=0",
		"FREQ=HOURLY",
		"FREQ=WEEKLY;BYDAY=2MO",
		"FREQ=MONTHLY;BYDAY=",
		"FREQ=DAILY;UNTIL=nope",
		"FREQ=YEARLY;BYWEEKNO=20",
		"",
		"garbage",
		";;;=",
	}
	dtstart := calendarNow.Add(time.Hour)
	for _, rule := range rules {
		t.Run(rule, func(t *testing.T) {
			events := parseICS(icsCalendar(
				"SUMMARY:Thing", "DTSTART:"+dtstart.Format("20060102T150405Z"), "RRULE:"+rule,
			), calendarNow)
			assertCalendarStarts(t, calendarStarts(events, "Thing"), dtstart)
		})
	}
	// Readable but never matching: DTSTART still counts as the first.
	events := parseICS(icsCalendar(
		"SUMMARY:Never", "DTSTART:"+dtstart.Format("20060102T150405Z"), "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30",
	), calendarNow)
	assertCalendarStarts(t, calendarStarts(events, "Never"), dtstart)
}

func TestParseICSAllDayEventHasNoTime(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	events := parseICS([]byte(icsFixture(now)), now)
	for _, e := range events {
		if e.Title == "A long title that folds" {
			if !e.AllDay {
				t.Error("VALUE=DATE event was not read as all-day")
			}
			return
		}
	}
	t.Fatal("all-day event not found")
}

func TestParseICSUnknownTZIDFallsBackToUTC(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	raw := "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\n" +
		"DTSTART;TZID=Not/AZone:20260908T140000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
	events := parseICS([]byte(raw), now)
	if len(events) != 1 {
		t.Fatalf("got %d events", len(events))
	}
	want := time.Date(2026, 9, 8, 14, 0, 0, 0, time.UTC).UnixMilli()
	if events[0].Start != want {
		t.Errorf("start = %d, want %d (UTC fallback)", events[0].Start, want)
	}
}

func TestFilterCalendarEventsHonoursDaysAheadAndRows(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	// In start order, as parseICS's own sort would hand them to a real
	// caller -- filterCalendarEvents trusts that order rather than sorting
	// again.
	events := []CalendarEvent{
		{Title: "already over", Start: now.Add(-48 * time.Hour).UnixMilli(), End: now.Add(-47 * time.Hour).UnixMilli()},
		{Title: "ongoing", Start: now.Add(-24 * time.Hour).UnixMilli(), End: now.Add(24 * time.Hour).UnixMilli()},
		{Title: "in 1 day", Start: now.Add(24 * time.Hour).UnixMilli()},
		{Title: "in 10 days", Start: now.Add(10 * 24 * time.Hour).UnixMilli()},
		{Title: "in 40 days", Start: now.Add(40 * 24 * time.Hour).UnixMilli()},
	}

	got := filterCalendarEvents(events, map[string]any{"daysAhead": 14, "rows": 20}, now, calendarAllDayGraceMs)
	titles := make([]string, len(got))
	for i, e := range got {
		titles[i] = e.Title
	}
	want := []string{"ongoing", "in 1 day", "in 10 days"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", titles, want)
	}
	for i, title := range want {
		if titles[i] != title {
			t.Errorf("event %d = %q, want %q", i, titles[i], title)
		}
	}

	capped := filterCalendarEvents(events, map[string]any{"daysAhead": 90, "rows": 1}, now, calendarAllDayGraceMs)
	if len(capped) != 1 {
		t.Fatalf("rows=1 kept %d events", len(capped))
	}
}

func TestFilterCalendarEventsFallsBackWithNoConfig(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	events := []CalendarEvent{{Title: "soon", Start: now.Add(time.Hour).UnixMilli()}}
	got := filterCalendarEvents(events, nil, now, calendarAllDayGraceMs)
	if len(got) != 1 {
		t.Fatalf("default daysAhead/rows dropped the event: %v", got)
	}
}

func TestFetchCalendarFeedReadsAWorkingAddress(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	now := time.Now().UTC()
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/calendar")
		_, _ = w.Write([]byte(icsFixture(now)))
	}))
	defer service.Close()

	events, errText := h.fetchCalendarFeed(context.Background(), service.URL)
	if errText != "" {
		t.Fatalf("fetch failed: %s", errText)
	}
	if len(events) == 0 {
		t.Fatal("expected events from the fixture feed")
	}
}

func TestFetchCalendarFeedRefusesADisallowedAddress(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, false)

	_, errText := h.fetchCalendarFeed(context.Background(), "http://127.0.0.1:1/feed.ics")
	if errText == "" {
		t.Error("expected the local address to be refused")
	}
}

func TestFetchCalendarFeedReportsAFailedService(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer service.Close()

	_, errText := h.fetchCalendarFeed(context.Background(), service.URL)
	if errText == "" {
		t.Error("expected a 500 to be reported as an error")
	}
}

func TestCalendarWidgetConfigIsNarrowed(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeCalendar, map[string]any{
		"daysAhead": 200, "rows": 5, "smuggled": "value",
	})
	if _, present := clean["smuggled"]; present {
		t.Error("an undeclared key reached the stored widget")
	}
	if clean["daysAhead"] != 90 {
		t.Errorf("daysAhead = %v, want clamped to 90", clean["daysAhead"])
	}
	if clean["rows"] != 5 {
		t.Errorf("rows = %v", clean["rows"])
	}
}

// An all-day event with no DTEND lasts its day: it is still coming up at
// noon on that day.
func TestParseICSAllDayWithoutEndLastsItsDay(t *testing.T) {
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	ics := "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261001\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
	events := parseICS([]byte(ics), now)
	if len(events) != 1 {
		t.Fatalf("events = %+v: today's all-day event was dropped at midnight", events)
	}
	if events[0].End != events[0].Start+24*60*60*1000 {
		t.Errorf("end = %d, want start + one day", events[0].End)
	}
}

// Google puts an e-mail reminder inside the event, with a SUMMARY of its own.
// Read at the same level, it became the event's title.
func TestParseICSIgnoresAReminderInsideTheEvent(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	ics := strings.Join([]string{
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		"DTSTART:20260908T150000Z",
		"DTEND:20260908T160000Z",
		"SUMMARY:Dentist",
		"BEGIN:VALARM",
		"ACTION:EMAIL",
		"DESCRIPTION:This is an event reminder",
		"SUMMARY:Alarm notification",
		"TRIGGER:-P0DT0H30M0S",
		"END:VALARM",
		"END:VEVENT",
		"END:VCALENDAR",
	}, "\r\n")
	events := parseICS([]byte(ics), now)
	if len(events) != 1 || events[0].Title != "Dentist" {
		t.Fatalf("events = %+v, want one called Dentist", events)
	}
}

// An event given a DURATION rather than an end stays while it runs, and an
// all-day event stays until its day is over west of UTC too.
func TestCalendarKeepsDurationAndAllDayEventsWhileTheyLast(t *testing.T) {
	now := time.Date(2026, 9, 9, 0, 30, 0, 0, time.UTC) // 20:30 on the 8th in New York
	ics := strings.Join([]string{
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260908", "SUMMARY:Holiday", "END:VEVENT",
		"BEGIN:VEVENT", "DTSTART:20260909T000000Z", "DURATION:PT2H", "SUMMARY:Running", "END:VEVENT",
		"END:VCALENDAR",
	}, "\r\n")
	events := parseICS([]byte(ics), now)
	titles := map[string]bool{}
	for _, e := range events {
		titles[e.Title] = true
	}
	if !titles["Holiday"] || !titles["Running"] {
		t.Fatalf("events = %+v, want both still listed", events)
	}
	if got := filterCalendarEvents(events, map[string]any{}, now, calendarAllDayGraceMs); len(got) != 2 {
		t.Fatalf("filtered = %+v, want both", got)
	}
}

// Outlook names zones the Windows way; read as UTC, a 14:00 meeting in
// Amsterdam showed at 16:00.
func TestParseICSReadsAWindowsZoneName(t *testing.T) {
	got, _, ok := parseICSDateTime("20260908T140000", map[string]string{"TZID": "W. Europe Standard Time"})
	want := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	if !ok || !got.Equal(want) {
		t.Fatalf("got %v, want %v", got.UTC(), want)
	}
}

// The 500-event cap was applied in file order. A feed that lists far-off
// events first lost the ones coming up tomorrow.
func TestParseICSKeepsTheSoonestWhenCapped(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\n")
	for i := 0; i < calendarMaxEvents+50; i++ {
		day := now.AddDate(1, 0, i).Format("20060102")
		b.WriteString("BEGIN:VEVENT\r\nSUMMARY:Far " + strconv.Itoa(i) + "\r\nDTSTART:" + day + "T090000Z\r\nEND:VEVENT\r\n")
	}
	b.WriteString("BEGIN:VEVENT\r\nSUMMARY:Tomorrow\r\nDTSTART:" + now.AddDate(0, 0, 1).Format("20060102") + "T090000Z\r\nEND:VEVENT\r\n")
	b.WriteString("END:VCALENDAR\r\n")
	events := parseICS([]byte(b.String()), now)
	if len(events) != calendarMaxEvents {
		t.Fatalf("kept %d events, want %d", len(events), calendarMaxEvents)
	}
	if events[0].Title != "Tomorrow" {
		t.Fatalf("first event = %q, want the one coming up tomorrow", events[0].Title)
	}
}

// An all-day event ends at the reader's midnight, judged before the rows are
// capped: in Amsterdam at 09:00, yesterday's took a row the tile then hid.
func TestFilterCalendarEventsEndsAllDayAtTheReadersMidnight(t *testing.T) {
	now := time.Date(2026, 10, 6, 7, 0, 0, 0, time.UTC) // 09:00 in Amsterdam
	yesterday := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	events := []CalendarEvent{
		{Title: "Bin day", Start: yesterday.UnixMilli(), End: yesterday.Add(24 * time.Hour).UnixMilli(), AllDay: true},
		{Title: "a", Start: now.Add(time.Hour).UnixMilli()},
		{Title: "b", Start: now.Add(2 * time.Hour).UnixMilli()},
		{Title: "c", Start: now.Add(3 * time.Hour).UnixMilli()},
	}
	got := filterCalendarEvents(events, map[string]any{"rows": 3}, now, calendarAllDayGrace("-120"))
	if len(got) != 3 || got[0].Title != "a" {
		t.Fatalf("got %+v, want a b c", got)
	}
	// At 03:00Z it is still the 5th in New York.
	early := time.Date(2026, 10, 6, 3, 0, 0, 0, time.UTC)
	if got := filterCalendarEvents(events, map[string]any{"rows": 3}, early, calendarAllDayGrace("240")); got[0].Title != "Bin day" {
		t.Fatalf("New York lost today's all-day event: %+v", got)
	}
	if calendarAllDayGrace("") != calendarAllDayGraceMs || calendarAllDayGrace("9999") != calendarAllDayGraceMs {
		t.Fatal("a missing or odd offset must fall back to the widest grace")
	}
}

// A cancelled meeting is not coming up, and Outlook's quoted display-name
// TZID with a colon in it no longer drops the event.
func TestParseICSCancelledAndOutlookDisplayNameZone(t *testing.T) {
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	ics := strings.Join([]string{
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT", "DTSTART:20261006T090000Z", "STATUS:CANCELLED", "SUMMARY:Team sync", "END:VEVENT",
		"BEGIN:VEVENT", `DTSTART;TZID="(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna":20261006T090000`, "SUMMARY:Review", "END:VEVENT",
		"END:VCALENDAR",
	}, "\r\n")
	events := parseICS([]byte(ics), now)
	if len(events) != 1 || events[0].Title != "Review" {
		t.Fatalf("events = %+v, want only Review", events)
	}
	if want := time.Date(2026, 10, 6, 8, 0, 0, 0, time.UTC).UnixMilli(); events[0].Start != want {
		t.Fatalf("start = %v, want 08:00Z", time.UnixMilli(events[0].Start).UTC())
	}
}

// A reader who leaves while the feed is loading cancels their request. That
// used to cancel the fetch too, and the failure was cached for every other
// calendar widget for a minute.
func TestCalendarFetchOutlivesTheRequestThatStartedIt(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)

	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/calendar")
		_, _ = w.Write([]byte(icsFixture(time.Now().UTC())))
	}))
	defer service.Close()

	settings := h.store.GetSettings()
	settings.CalendarIcsUrl = service.URL
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SavePageBlocks(1, []Widget{{ID: "w_ca0000000001", Type: WidgetTypeCalendar}}, nil); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/widgets/calendar?pageId=1&id=w_ca0000000001", nil).WithContext(ctx)
	h.CalendarWidgetHandler(httptest.NewRecorder(), req)

	entry, ok := calendarFeedCached(service.URL, time.Now())
	if !ok {
		t.Fatal("nothing cached for the feed")
	}
	if entry.err != "" {
		t.Fatalf("a left request cached a failure for everyone: %q", entry.err)
	}
}
