package app

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// Monday 2026-10-12 is the digest day in these tests.
func digestTestHandlers(t *testing.T, extra string) (*Handlers, *[]monitorNotification) {
	t.Helper()
	h, _ := healthRecheckTestHandlers(t, `{"digestEnabled":true,"digestWeekday":1,"digestTime":"08:00","maintenanceTimeZone":"UTC"`+extra+`}`)
	// An install that has run the digest before: the first-ever tick only
	// takes the slot (TestDigestFirstRunWaitsForTheNextSlot).
	writeDigestState(digestState{DueKey: "2026-09-28"})
	sent := &[]monitorNotification{}
	old := digestDeliver
	digestDeliver = func(_ *Handlers, _ context.Context, n monitorNotification) { *sent = append(*sent, n) }
	t.Cleanup(func() { digestDeliver = old })
	return h, sent
}

func seedBroken(h *Handlers, now time.Time) {
	// one bookmark broken since last Friday
	if err := h.store.AddBookmarkToPage(1, Bookmark{Name: "Wiki", URL: "https://wiki.example", BrokenSince: now.Add(-72 * time.Hour).UnixMilli(), LastError: "timeout", CheckStatus: true, LastChecked: now.UnixMilli(), OpenCount: 1, LastOpened: now.UnixMilli()}); err != nil {
		panic(err)
	}
}

func TestDigestDueIsTheLatestSlotAtOrBeforeNow(t *testing.T) {
	s := Settings{DigestWeekday: 1, DigestTime: "08:00", MaintenanceTimeZone: "UTC"}
	due, key := digestDue(s, time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)) // Wednesday
	if key != "2026-10-12" || due.Hour() != 8 {
		t.Fatalf("got %v %s", due, key)
	}
	_, early := digestDue(s, time.Date(2026, 10, 12, 7, 0, 0, 0, time.UTC)) // Monday before 08:00
	if early != "2026-10-05" {
		t.Fatalf("before the slot the previous week counts, got %s", early)
	}
}

func TestDigestSendsOncePerSlotAndSurvivesRestart(t *testing.T) {
	h, sent := digestTestHandlers(t, "")
	now := time.Date(2026, 10, 12, 8, 5, 0, 0, time.UTC)
	seedBroken(h, now)
	h.digestTick(context.Background(), now)
	h.digestTick(context.Background(), now.Add(time.Minute))
	if len(*sent) != 1 {
		t.Fatalf("want 1 digest, got %d", len(*sent))
	}
	// a "restart" is a new tick on the same data dir: state is on disk
	h.digestTick(context.Background(), now.Add(2*time.Hour))
	if len(*sent) != 1 {
		t.Fatalf("restart re-sent: %d", len(*sent))
	}
	next := now.Add(7 * 24 * time.Hour)
	h.digestTick(context.Background(), next)
	if len(*sent) != 2 {
		t.Fatalf("next week should send again, got %d", len(*sent))
	}
}

func TestDigestLateStartSendsOnce(t *testing.T) {
	h, sent := digestTestHandlers(t, "")
	wed := time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)
	seedBroken(h, wed)
	h.digestTick(context.Background(), wed)
	h.digestTick(context.Background(), wed.Add(time.Hour))
	if len(*sent) != 1 {
		t.Fatalf("want 1, got %d", len(*sent))
	}
}

func TestDigestWaitsOutQuietHours(t *testing.T) {
	h, sent := digestTestHandlers(t, `,"quietHoursEnabled":true,"quietHours":[{"start":"07:00","end":"09:00"}]`)
	mon := time.Date(2026, 10, 12, 8, 30, 0, 0, time.UTC)
	seedBroken(h, mon)
	h.digestTick(context.Background(), mon)
	if len(*sent) != 0 {
		t.Fatal("sent inside quiet hours")
	}
	h.digestTick(context.Background(), time.Date(2026, 10, 12, 9, 1, 0, 0, time.UTC))
	if len(*sent) != 1 {
		t.Fatalf("not sent after quiet hours, got %d", len(*sent))
	}
}

func TestEmptyDigestSendsNothingButMarksTheWeek(t *testing.T) {
	// News off: whether a shipped release falls in this week is up to the
	// release dates in static/data/whats-new, not to this test.
	h, sent := digestTestHandlers(t, `,"digestNews":false`)
	now := time.Date(2026, 10, 12, 8, 5, 0, 0, time.UTC)
	h.digestTick(context.Background(), now)
	if len(*sent) != 0 || readDigestState().DueKey != "2026-10-12" {
		t.Fatalf("sent %d state %+v", len(*sent), readDigestState())
	}
}

func TestDigestTickSendsWithAnOldOffSwitch(t *testing.T) {
	h, sent := digestTestHandlers(t, `,"digestEnabled":false`)
	mon := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	seedBroken(h, mon)
	h.digestTick(context.Background(), mon)
	if len(*sent) != 1 {
		t.Fatalf("an old off switch must not stop the digest, sent %d", len(*sent))
	}
}

func TestDigestLatestHandler(t *testing.T) {
	h, _ := digestTestHandlers(t, "")
	rec := httptest.NewRecorder()
	h.DigestLatest(rec, httptest.NewRequest("GET", "/api/digest/latest", nil))
	if rec.Code != 204 {
		t.Fatalf("empty store should be 204, got %d", rec.Code)
	}
	seedBroken(h, time.Now())
	h.digestTick(context.Background(), time.Now().AddDate(0, 0, -int(time.Now().Weekday())+1).Add(12*time.Hour))
	rec = httptest.NewRecorder()
	h.DigestLatest(rec, httptest.NewRequest("GET", "/api/digest/latest", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"newlyBroken"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}

func TestDigestTestHandlerSendsAndStores(t *testing.T) {
	h, sent := digestTestHandlers(t, "")
	seedBroken(h, time.Now())
	rec := httptest.NewRecorder()
	h.DigestTest(rec, httptest.NewRequest("POST", "/api/digest/test", nil))
	if rec.Code != 200 || len(*sent) != 1 || readDigestState().Latest == nil {
		t.Fatalf("%d sent=%d", rec.Code, len(*sent))
	}
}

func TestDigestTestHandlerNeedsTheWriteToken(t *testing.T) {
	h, sent := digestTestHandlers(t, "")
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	seedBroken(h, time.Now())
	rec := httptest.NewRecorder()
	h.DigestTest(rec, httptest.NewRequest("POST", "/api/digest/test", nil))
	if rec.Code != 401 || len(*sent) != 0 {
		t.Fatalf("no token: %d sent=%d", rec.Code, len(*sent))
	}
}

// The digest counts what the health report reports: a broken link the reader
// told the report to ignore is not in the digest either.
func TestDigestReadsTheHealthReport(t *testing.T) {
	h, _ := digestTestHandlers(t, "")
	now := time.Now()
	for _, bm := range []Bookmark{
		{Name: "Wiki", URL: "https://wiki.example", LastError: "timeout", BrokenSince: now.Add(-time.Hour).UnixMilli(), OpenCount: 1, LastOpened: now.UnixMilli()},
		{Name: "Muted", URL: "https://muted.example", LastError: "timeout", BrokenSince: now.Add(-time.Hour).UnixMilli(), OpenCount: 1, LastOpened: now.UnixMilli(),
			HealthIgnored: []HealthIgnore{{Flag: "broken"}}},
	} {
		if err := h.store.AddBookmarkToPage(1, bm); err != nil {
			t.Fatal(err)
		}
	}
	d := buildDigest(h.collectDigestInput(now))
	if d.Health == nil || len(d.Health.NewlyBroken) != 1 || d.Health.NewlyBroken[0] != "Wiki" {
		t.Fatalf("health %+v", d.Health)
	}
}

// A fresh install or the first start of a build with the digest sends nothing
// for the week it started in; the next slot is the first digest.
func TestDigestFirstRunWaitsForTheNextSlot(t *testing.T) {
	h, sent := digestTestHandlers(t, "")
	if err := os.Remove(digestStatePath()); err != nil {
		t.Fatal(err)
	}
	wed := time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC)
	seedBroken(h, wed)
	h.digestTick(context.Background(), wed)
	if len(*sent) != 0 || readDigestState().DueKey != "2026-10-12" {
		t.Fatalf("first run sent %d, state %+v", len(*sent), readDigestState())
	}
	h.digestTick(context.Background(), time.Date(2026, 10, 19, 8, 1, 0, 0, time.UTC))
	if len(*sent) != 1 {
		t.Fatalf("next Monday should send, got %d", len(*sent))
	}
}

func TestDigestSlotAllowed(t *testing.T) {
	slot := time.Date(2026, 10, 12, 8, 0, 0, 0, time.UTC)
	day := int64(24 * 60 * 60 * 1000)
	cases := []struct {
		name     string
		firstRun int64
		want     bool
	}{
		{"existing install, no first run", 0, true},
		{"installed six days before the slot", slot.UnixMilli() - 6*day, false},
		{"installed eight days before the slot", slot.UnixMilli() - 8*day, true},
		{"installed exactly seven days before the slot", slot.UnixMilli() - 7*day, true},
	}
	for _, c := range cases {
		if got := digestSlotAllowed(Settings{FirstRunAt: c.firstRun}, slot); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestDigestTickSkipsASlotBeforeTheFirstWeekIsOut(t *testing.T) {
	mon := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	firstRun := mon.Add(-6*24*time.Hour - time.Hour).UnixMilli() // installed six days before the slot
	h, sent := digestTestHandlers(t, fmt.Sprintf(`,"firstRunAt":%d`, firstRun))
	seedBroken(h, mon)
	h.digestTick(context.Background(), mon)
	if len(*sent) != 0 {
		t.Fatalf("a new install got a digest in its first week: sent %d", len(*sent))
	}
	if readDigestState().DueKey != "2026-10-12" {
		t.Fatalf("the skipped slot must be marked so it is not retried, got %q", readDigestState().DueKey)
	}
	next := mon.AddDate(0, 0, 7)
	h.digestTick(context.Background(), next)
	if len(*sent) != 1 {
		t.Fatalf("the next slot should send, sent %d", len(*sent))
	}
}
