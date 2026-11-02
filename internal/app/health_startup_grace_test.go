package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGraceDecide(t *testing.T) {
	start := time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC)
	at := func(d time.Duration) time.Time { return start.Add(d) }
	type step struct {
		after  time.Duration
		failed bool
		hold   bool
	}
	cases := []struct {
		name  string
		start time.Time
		steps []step
	}{
		{"first failure is held", start, []step{{time.Minute, true, true}}},
		{"second failure 45s later is recorded", start, []step{{time.Minute, true, true}, {time.Minute + 45*time.Second, true, false}}},
		{"second failure 44s later is still held", start, []step{{time.Minute, true, true}, {time.Minute + 44*time.Second, true, true}}},
		{"after confirming, later failures are recorded", start, []step{{time.Minute, true, true}, {2 * time.Minute, true, false}, {3 * time.Minute, true, false}, {9 * time.Minute, true, false}}},
		{"success clears the pending failure", start, []step{{time.Minute, true, true}, {2 * time.Minute, false, false}, {3 * time.Minute, true, true}}},
		{"an unconfirmed first failure expires after five minutes", start, []step{{time.Minute, true, true}, {time.Minute + startupGraceFirstFailureTTL + time.Second, true, true}}},
		{"just inside the window", start, []step{{startupGraceWindow - time.Second, true, true}}},
		{"at the edge of the window", start, []step{{startupGraceWindow, true, false}}},
		{"after the window", start, []step{{startupGraceWindow + time.Hour, true, false}}},
		{"no start time means no grace", time.Time{}, []step{{time.Minute, true, false}}},
		{"a first failure before the edge does not carry past it", start, []step{{startupGraceWindow - time.Minute, true, true}, {startupGraceWindow + time.Second, true, false}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pending := map[string]graceEntry{}
			for i, s := range tc.steps {
				if got := graceDecide(at(s.after), tc.start, startupGraceWindow, pending, "k", s.failed); got != s.hold {
					t.Fatalf("step %d: hold = %v, want %v", i, got, s.hold)
				}
			}
		})
	}
	t.Run("keys are independent", func(t *testing.T) {
		pending := map[string]graceEntry{}
		graceDecide(at(time.Minute), start, startupGraceWindow, pending, "a", true)
		if !graceDecide(at(2*time.Minute), start, startupGraceWindow, pending, "b", true) {
			t.Fatal("b's first failure was not held")
		}
	})
}

// A fixture of n LAN bookmarks (monitored, checked) and m internet ones.
func graceFixture(t *testing.T, lan, internet int) (*Handlers, *time.Time) {
	t.Helper()
	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	var items []string
	for i := 0; i < lan; i++ {
		items = append(items, fmt.Sprintf(`{"name":"L%d","url":"http://192.168.1.%d:8080/","monitor":true,"monitorIntervalMinutes":5,"checkStatus":true}`, i, i+10))
	}
	for i := 0; i < internet; i++ {
		items = append(items, fmt.Sprintf(`{"name":"I%d","url":"https://host%d.example.com/","monitor":true,"monitorIntervalMinutes":5,"checkStatus":true}`, i, i))
	}
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(`{"id":1,"name":"P","bookmarks":[`+strings.Join(items, ",")+`]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	old := monitorConfirmDelay
	monitorConfirmDelay = 0
	t.Cleanup(func() { monitorConfirmDelay = old })
	clock := time.Now()
	h.startedAt = clock.Add(-time.Minute)
	h.clock = func() time.Time { return clock }
	return h, &clock
}

var serviceDown = PingResult{Status: "offline", ErrorDetail: "Connection refused"}

func TestGraceHoldsAFirstFailureThenRecordsTheSecond(t *testing.T) {
	h, clock := graceFixture(t, 12, 0)
	hookAll(h, serviceDown)
	h.runDueMonitors()
	if n := totalSamples(h); n != 0 {
		t.Fatalf("%d samples after a first failure", n)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError != "" || bm.LastChecked != 0 {
			t.Fatalf("%s changed", bm.Name)
		}
	}
	if len(readHealthCacheFile().Cache) != 0 {
		t.Fatal("the scan cache was written")
	}
	// The next tick.
	*clock = clock.Add(time.Minute)
	h.runDueMonitors()
	if n := totalSamples(h); n != 12 {
		t.Fatalf("expected the second failure to be recorded, got %d samples", n)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError == "" {
			t.Fatalf("%s not marked on the second failure", bm.Name)
		}
	}
}

func TestGraceFailureThenSuccessIsRecordedAsSuccess(t *testing.T) {
	h, clock := graceFixture(t, 12, 0)
	hookAll(h, serviceDown)
	h.runDueMonitors()
	*clock = clock.Add(time.Minute)
	hookAll(h, reachable)
	h.runDueMonitors()
	if n := totalSamples(h); n != 12 {
		t.Fatalf("%d samples", n)
	}
	for _, s := range h.readAllHealthHistory() {
		if !s[0].Up {
			t.Fatal("a success was recorded as a failure")
		}
	}
	if len(h.gracePending) != 0 {
		t.Fatalf("pending not cleared: %v", h.gracePending)
	}
	// A new failure is a first one again.
	*clock = clock.Add(10 * time.Minute)
	h.startedAt = clock.Add(-time.Minute)
	hookAll(h, serviceDown)
	if !h.graceHold("http://192.168.1.10:8080", true, time.Time{}) {
		t.Fatal("a failure after a success should be a first failure")
	}
}

func TestGraceEndsWithTheWindow(t *testing.T) {
	h, clock := graceFixture(t, 12, 0)
	h.startedAt = clock.Add(-startupGraceWindow - time.Second)
	hookAll(h, serviceDown)
	h.runDueMonitors()
	if n := totalSamples(h); n != 12 {
		t.Fatalf("after the window a failure must be recorded at once, got %d samples", n)
	}
}

func TestGraceFollowsTheGuardForTheFailuresItDidNotHold(t *testing.T) {
	h, clock := graceFixture(t, 3, 12)
	// Internet hosts fail on DNS (the guard holds them), LAN hosts refuse.
	h.pingHook = func(ctx context.Context, urlStr string, expect expectation) PingResult {
		if strings.Contains(urlStr, "192.168.") {
			return serviceDown
		}
		return dnsDown
	}
	h.runDueMonitors()
	if n := totalSamples(h); n != 0 {
		t.Fatalf("%d samples: the guard held the internet hosts and the grace the LAN ones", n)
	}
	if readHealthCacheFile().NetworkDownSince == 0 {
		t.Fatal("the guard did not see the episode")
	}
	*clock = clock.Add(time.Minute)
	h.runDueMonitors()
	// Second round: LAN failures confirmed and recorded; internet still held.
	if n := totalSamples(h); n != 3 {
		t.Fatalf("expected only the 3 LAN failures recorded, got %d", n)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if strings.HasPrefix(bm.Name, "I") && bm.LastError != "" {
			t.Fatalf("%s was marked while the guard holds", bm.Name)
		}
	}
}

func TestGraceRetestHoldsAndRetries(t *testing.T) {
	h, clock := graceFixture(t, 12, 0)
	hookAll(h, serviceDown)
	res, err := h.runHealthRetest(context.Background(), false, healthAutoRecheckSource)
	if err != nil {
		t.Fatal(err)
	}
	if res.HeldGrace != 12 || res.Tested != 0 {
		t.Fatalf("unexpected result: %+v", res)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError != "" {
			t.Fatal("marked on a first failure")
		}
	}
	*clock = clock.Add(time.Minute)
	res, err = h.runHealthRetest(context.Background(), false, healthAutoRecheckSource)
	if err != nil || res.Tested != 12 || res.HeldGrace != 0 {
		t.Fatalf("second run: %+v %v", res, err)
	}
}

func TestGraceBatchHoldsFirstFailuresDuringTheWindow(t *testing.T) {
	h, clock := graceFixture(t, 12, 0)
	var results []bookmarkStatusResult
	for i := 0; i < 12; i++ {
		results = append(results, bookmarkStatusResult{URL: fmt.Sprintf("http://192.168.1.%d:8080/", i+10), Status: "offline", Error: "Connection refused"})
	}
	postStatusBatch(t, h, bookmarkStatusBatch{PageID: 1, Results: results})
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError != "" {
			t.Fatalf("%s marked on a first failure", bm.Name)
		}
	}
	*clock = clock.Add(time.Minute)
	postStatusBatch(t, h, bookmarkStatusBatch{PageID: 1, Results: results})
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError == "" {
			t.Fatalf("%s not marked on the second failure", bm.Name)
		}
	}
}

// Two rule copies of one URL on one page: one has a text rule the page fails,
// the other has none. failingFirst puts the failing copy first (the primary).
func graceCopiesFixture(t *testing.T, failingFirst bool) (*Handlers, *time.Time) {
	t.Helper()
	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	ruled := `{"name":"Ruled","url":"http://192.168.1.50:8080/","monitor":true,"monitorIntervalMinutes":5,"checkStatus":true,"expectText":"Welcome"}`
	plain := `{"name":"Plain","url":"http://192.168.1.50:8080/","monitor":true,"monitorIntervalMinutes":5,"checkStatus":true}`
	items := []string{ruled, plain}
	if !failingFirst {
		items = []string{plain, ruled}
	}
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(`{"id":1,"name":"P","bookmarks":[`+strings.Join(items, ",")+`]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	old := monitorConfirmDelay
	monitorConfirmDelay = 0
	t.Cleanup(func() { monitorConfirmDelay = old })
	clock := time.Now()
	h.startedAt = clock.Add(-time.Minute)
	h.clock = func() time.Time { return clock }
	h.pingHook = func(ctx context.Context, urlStr string, expect expectation) PingResult {
		if expect.Text != "" {
			return PingResult{Status: "offline", ErrorDetail: `Page is missing "Welcome"`}
		}
		return reachable
	}
	return h, &clock
}

func TestGraceCopiesOfOneURLShareOneDecision(t *testing.T) {
	for _, failingFirst := range []bool{true, false} {
		t.Run(fmt.Sprintf("failing copy first=%v", failingFirst), func(t *testing.T) {
			h, clock := graceCopiesFixture(t, failingFirst)
			h.runDueMonitors()
			for _, bm := range h.store.GetBookmarksByPage(1) {
				if bm.LastError != "" {
					t.Fatalf("%s marked on a first failure", bm.Name)
				}
			}
			*clock = clock.Add(time.Minute)
			h.runDueMonitors()
			var ruledErr string
			for _, bm := range h.store.GetBookmarksByPage(1) {
				if bm.Name == "Ruled" {
					ruledErr = bm.LastError
				}
			}
			if ruledErr == "" {
				t.Fatal("the failing copy was held a second time: the passing copy cleared its pending failure")
			}
		})
	}
}

func TestGraceRetestAllIsTheUsersOwnClick(t *testing.T) {
	h, _ := graceFixture(t, 3, 0)
	hookAll(h, serviceDown)
	req := httptest.NewRequest(http.MethodPost, "/api/health/retest-all?scope=all", nil)
	rec := httptest.NewRecorder()
	h.RetestAll(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError == "" {
			t.Fatalf("%s: a manual Retest all held its failure", bm.Name)
		}
	}
	// The scheduled run still holds a first failure on another handler.
	h2, _ := graceFixture(t, 3, 0)
	hookAll(h2, serviceDown)
	res, err := h2.runHealthRetest(context.Background(), true, healthAutoRecheckSource)
	if err != nil || res.HeldGrace != 3 {
		t.Fatalf("scheduled run: %+v %v", res, err)
	}
}

func TestGraceRetryHappensOncePerProcess(t *testing.T) {
	h, _ := graceFixture(t, 3, 0)
	if err := os.WriteFile(filepath.Join(os.Getenv("NEXTDASH_DATA_DIR"), "settings.json"), []byte(`{"allowLocalBookmarks":true,"healthAutoRecheckEnabled":true}`), 0o644); err != nil {
		t.Fatal(err)
	}
	scheduled := 0
	h.recheckAfter = func(d time.Duration, f func()) { scheduled++ }
	hookAll(h, serviceDown)
	h.maybeRunHealthAutoRecheck()
	if scheduled != 1 {
		t.Fatalf("expected one retry, got %d", scheduled)
	}
	h.recheckRetryPending.Store(false) // the retry would have run
	h.maybeRunHealthAutoRecheck()      // held again, the clock has not moved
	if scheduled != 1 {
		t.Fatalf("a second grace retry was scheduled (%d)", scheduled)
	}
}

func TestGraceDecidesFromTheRoundStart(t *testing.T) {
	h, clock := graceFixture(t, 1, 0)
	start := *clock
	slow := true
	h.pingHook = func(ctx context.Context, urlStr string, expect expectation) PingResult {
		if slow {
			*clock = clock.Add(40 * time.Second) // a slow first round
		}
		return serviceDown
	}
	h.runDueMonitors() // starts at `start`, ends 40 s later
	slow = false
	// Round 2 starts 50 s after round 1 started: 10 s after it ended.
	*clock = start.Add(50 * time.Second)
	h.runDueMonitors()
	if totalSamples(h) != 1 {
		t.Fatalf("expected the second failure recorded (50 s after the first round began), got %d samples", totalSamples(h))
	}
}

func TestGraceWindowFromEnv(t *testing.T) {
	for raw, want := range map[string]time.Duration{
		"": startupGraceWindow, "15m": 15 * time.Minute, "2m": 2 * time.Minute, "0": 0,
		"banana": startupGraceWindow, "-5m": startupGraceWindow, "90": startupGraceWindow,
	} {
		if got := graceWindowFromEnv(raw); got != want {
			t.Errorf("%q -> %v, want %v", raw, got, want)
		}
	}
}

func TestNewHandlersReadsTheGraceEnv(t *testing.T) {
	base, _ := healthRecheckTestHandlers(t, `{}`)
	t.Setenv("NEXTDASH_HEALTH_STARTUP_GRACE", "0")
	if h := NewHandlers(base.store, nil); !h.startedAt.IsZero() {
		t.Fatal("0 should switch the grace off")
	} else if h.graceHold("k", true, time.Time{}) {
		t.Fatal("a first failure was held with the grace off")
	}
	t.Setenv("NEXTDASH_HEALTH_STARTUP_GRACE", "nonsense")
	if h := NewHandlers(base.store, nil); h.startedAt.IsZero() || h.graceWindow != startupGraceWindow {
		t.Fatalf("invalid value should fall back to 15m, got %v / %v", h.startedAt, h.graceWindow)
	}
	t.Setenv("NEXTDASH_HEALTH_STARTUP_GRACE", "1m")
	if h := NewHandlers(base.store, nil); h.graceWindow != time.Minute {
		t.Fatalf("1m not read: %v", h.graceWindow)
	}
}
