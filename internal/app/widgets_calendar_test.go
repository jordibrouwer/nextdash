package app

import (
	"context"
	"net/http"
	"net/http/httptest"
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
	// escaped text, and one has an RRULE but no expansion is expected.
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
	// after, which is +12h from a fixture anchored at noon).
	if len(events) != len(want) {
		t.Fatalf("got %d events, want %d: %v", len(events), len(want), titles)
	}
	for i, title := range want {
		if titles[i] != title {
			t.Errorf("event %d = %q, want %q", i, titles[i], title)
		}
	}
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

	got := filterCalendarEvents(events, map[string]any{"daysAhead": 14, "rows": 20}, now)
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

	capped := filterCalendarEvents(events, map[string]any{"daysAhead": 90, "rows": 1}, now)
	if len(capped) != 1 {
		t.Fatalf("rows=1 kept %d events", len(capped))
	}
}

func TestFilterCalendarEventsFallsBackWithNoConfig(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	events := []CalendarEvent{{Title: "soon", Start: now.Add(time.Hour).UnixMilli()}}
	got := filterCalendarEvents(events, nil, now)
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
