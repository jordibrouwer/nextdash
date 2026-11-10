package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// netTestPage writes page 1 with the given bookmark rows.
func netTestPage(t *testing.T, dir string, rows ...string) {
	t.Helper()
	body := `{"id":1,"name":"Page 1","bookmarks":[` + strings.Join(rows, ",") + `]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(body), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
}

func netTestCheckID(n int) string { return fmt.Sprintf("%012x", n) }

// netTestRow is a bookmark with one enabled tcp check.
func netTestRow(name, url string, checkID string, extra string) string {
	return `{"name":"` + name + `","url":"` + url + `","checks":[{"id":"` + checkID + `","type":"tcp","enabled":true` + extra + `}]}`
}

// netStub is a runner that never touches the network.
type netStub struct {
	mu    sync.Mutex
	calls map[string]int
	res   func(c NetCheck, call int) NetResult
}

func (s *netStub) run(ctx context.Context, bm Bookmark, c NetCheck) NetResult {
	s.mu.Lock()
	if s.calls == nil {
		s.calls = map[string]int{}
	}
	s.calls[c.ID]++
	n := s.calls[c.ID]
	s.mu.Unlock()
	r := s.res(c, n)
	r.Type, r.CheckID = c.Type, c.ID
	if r.At == 0 {
		r.At = time.Now().UnixMilli()
	}
	return r
}

func (s *netStub) count(id string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls[id]
}

func netUp(c NetCheck, call int) NetResult { return NetResult{OK: true, Ms: 5} }

func fastConfirm(t *testing.T) {
	t.Helper()
	old := monitorConfirmDelay
	monitorConfirmDelay = time.Millisecond
	t.Cleanup(func() { monitorConfirmDelay = old })
}

func TestNetDueSelection(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	now := time.Now()
	netTestPage(t, dir,
		netTestRow("New", "https://new.example", netTestCheckID(1), ""),
		`{"name":"Off","url":"https://off.example","checks":[{"id":"`+netTestCheckID(2)+`","type":"tcp"}]}`,
		netTestRow("Fresh", "https://fresh.example", netTestCheckID(3), ""),
		netTestRow("Old", "https://old.example", netTestCheckID(4), ""),
	)
	if err := h.appendHealthSamples(map[string][]HealthSample{
		netHistoryKey(netTestCheckID(3)): {{T: msAgo(now, 1*time.Minute), Up: true}},
		netHistoryKey(netTestCheckID(4)): {{T: msAgo(now, 2*time.Hour), Up: true}},
	}); err != nil {
		t.Fatal(err)
	}
	history := h.readAllHealthHistory()
	due, known := h.dueNetChecks(now, history, h.store.GetSettings())
	got := map[string]bool{}
	for _, d := range due {
		got[d.check.ID] = true
	}
	if !got[netTestCheckID(1)] || !got[netTestCheckID(4)] || len(got) != 2 {
		t.Fatalf("due = %v, want the never-run and the old enabled check only", got)
	}
	if len(known) != 4 {
		t.Fatalf("known = %v, want every check, enabled or not", known)
	}
}

func TestNetDueInheritsBookmarkInterval(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	now := time.Now()
	netTestPage(t, dir,
		`{"name":"Slow","url":"https://slow.example","monitorIntervalMinutes":60,"checks":[{"id":"`+netTestCheckID(1)+`","type":"tcp","enabled":true}]}`,
		`{"name":"Own","url":"https://own.example","monitorIntervalMinutes":60,"checks":[{"id":"`+netTestCheckID(2)+`","type":"tcp","enabled":true,"intervalMinutes":5}]}`,
	)
	if err := h.appendHealthSamples(map[string][]HealthSample{
		netHistoryKey(netTestCheckID(1)): {{T: msAgo(now, 20*time.Minute), Up: true}},
		netHistoryKey(netTestCheckID(2)): {{T: msAgo(now, 20*time.Minute), Up: true}},
	}); err != nil {
		t.Fatal(err)
	}
	due, _ := h.dueNetChecks(now, h.readAllHealthHistory(), h.store.GetSettings())
	if len(due) != 1 || due[0].check.ID != netTestCheckID(2) {
		t.Fatalf("due = %#v, want only the check with its own 5 minute interval", due)
	}
	if due[0].interval != 5*time.Minute {
		t.Errorf("interval = %v", due[0].interval)
	}
}

func TestNetMaxPerTick(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	now := time.Now()
	var rows []string
	hist := map[string][]HealthSample{}
	for i := 0; i < 30; i++ {
		rows = append(rows, netTestRow(fmt.Sprintf("B%d", i), fmt.Sprintf("https://b%d.example", i), netTestCheckID(i+1), ""))
		hist[netHistoryKey(netTestCheckID(i+1))] = []HealthSample{{T: msAgo(now, time.Duration(2+i)*time.Hour), Up: true}}
	}
	netTestPage(t, dir, rows...)
	if err := h.appendHealthSamples(hist); err != nil {
		t.Fatal(err)
	}
	due, _ := h.dueNetChecks(now, h.readAllHealthHistory(), h.store.GetSettings())
	if len(due) != netMaxPerTick {
		t.Fatalf("due = %d, want %d", len(due), netMaxPerTick)
	}
	// The longest unchecked first: check 30 is the oldest, check 1 the newest.
	if due[0].check.ID != netTestCheckID(30) {
		t.Errorf("first due = %s, want the longest unchecked", due[0].check.ID)
	}
	for _, d := range due {
		if d.check.ID == netTestCheckID(1) {
			t.Errorf("the most recently checked made the cut")
		}
	}
}

func TestNetDisabledSettingPausesScheduling(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"netToolsEnabled":false}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))
	due, known := h.dueNetChecks(time.Now(), nil, h.store.GetSettings())
	if len(due) != 0 {
		t.Fatalf("due = %#v with network checks switched off", due)
	}
	if len(known) != 1 {
		t.Fatalf("known = %v: switching off must keep the history", known)
	}
}

func TestNetRunsWhenNoHTTPTargets(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))
	stub := &netStub{res: netUp}
	h.netRunner = stub.run

	h.runDueMonitors()

	samples := h.healthHistoryFor(netHistoryKey(netTestCheckID(1)))
	if len(samples) != 1 || !samples[0].Up {
		t.Fatalf("samples = %#v, want one up sample from a round with no HTTP target", samples)
	}
}

func TestNetSharesHostGate(t *testing.T) {
	var active, maxActive int32
	enter := func() {
		n := atomic.AddInt32(&active, 1)
		for {
			m := atomic.LoadInt32(&maxActive)
			if n <= m || atomic.CompareAndSwapInt32(&maxActive, m, n) {
				break
			}
		}
		time.Sleep(150 * time.Millisecond)
		atomic.AddInt32(&active, -1)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		enter()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	netTestPage(t, dir,
		`{"name":"Web","url":"`+server.URL+`","monitor":true,"monitorIntervalMinutes":5}`,
		netTestRow("Port", server.URL+"/other", netTestCheckID(1), ""),
	)
	stub := &netStub{res: func(c NetCheck, call int) NetResult {
		enter()
		return NetResult{OK: true, Ms: 1}
	}}
	h.netRunner = stub.run

	h.runDueMonitors()

	if got := atomic.LoadInt32(&maxActive); got != 1 {
		t.Fatalf("an HTTP check and a network check ran together on one host (max concurrent %d)", got)
	}
	if stub.count(netTestCheckID(1)) != 1 || len(h.healthHistoryFor(canonicalBookmarkURLKey(server.URL))) != 1 {
		t.Fatalf("both checks must have run once")
	}
}

func TestNetRetryConfirmsFailure(t *testing.T) {
	fastConfirm(t)
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))
	stub := &netStub{res: func(c NetCheck, call int) NetResult {
		if call == 1 {
			return NetResult{Class: "timeout", Error: "No answer"}
		}
		return NetResult{OK: true, Ms: 3}
	}}
	h.netRunner = stub.run

	h.runDueMonitors()

	if n := stub.count(netTestCheckID(1)); n != 2 {
		t.Fatalf("runs = %d, want a failure to be confirmed once", n)
	}
	if s := h.healthHistoryFor(netHistoryKey(netTestCheckID(1))); len(s) != 1 || !s[0].Up {
		t.Fatalf("samples = %#v, want the confirmed (up) answer", s)
	}
}

func TestNetGuardRefusalNotRetried(t *testing.T) {
	fastConfirm(t)
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))
	stub := &netStub{res: func(c NetCheck, call int) NetResult {
		return NetResult{Class: "guard", Error: "blocked"}
	}}
	h.netRunner = stub.run

	h.runDueMonitors()

	if n := stub.count(netTestCheckID(1)); n != 1 {
		t.Fatalf("runs = %d, a guard refusal is final", n)
	}
	s := h.healthHistoryFor(netHistoryKey(netTestCheckID(1)))
	if len(s) != 1 || s[0].Up || s[0].Fail != "guard" {
		t.Fatalf("samples = %#v", s)
	}
}

func TestNetMaintenanceMarksSamples(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"maintenanceWindows":[{"start":"00:00","end":"23:59"}]}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))
	stub := &netStub{res: netUp}
	h.netRunner = stub.run

	h.runDueMonitors()

	s := h.healthHistoryFor(netHistoryKey(netTestCheckID(1)))
	if len(s) != 1 || !s[0].Maint {
		t.Fatalf("samples = %#v, want the sample marked as taken in maintenance", s)
	}
}

func TestNetMutedCheckNoAlert(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":1}`)
	netTestPage(t, dir,
		netTestRow("Own", "https://own.example", netTestCheckID(1), `,"muted":true`),
		`{"name":"BM","url":"https://bm.example","notifyMuted":true,"checks":[{"id":"`+netTestCheckID(2)+`","type":"tcp","enabled":true}]}`,
		netTestRow("Loud", "https://loud.example", netTestCheckID(3), ""),
	)
	due, _ := h.dueNetChecks(time.Now(), nil, h.store.GetSettings())
	var trans []monitorTransition
	for _, d := range due {
		trans = append(trans, monitorTransition{
			key: d.key, name: d.bm.Name, url: d.bm.URL, up: false, reason: "down", at: time.Now().UnixMilli(),
			muted: d.muted, check: "TCP", checkID: d.check.ID,
		})
	}
	pending := h.pendingMonitorNotifications(trans)
	if len(pending) != 1 || pending[0].CheckID != netTestCheckID(3) {
		t.Fatalf("pending = %#v, want only the loud check to alert", pending)
	}
}

func TestNetAlertDownUpWithCheckField(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":1}`)
	_ = dir
	id := netTestCheckID(7)
	key := netHistoryKey(id)
	now := time.Now()
	down := monitorTransition{key: key, name: "Plex", url: "https://plex.example", up: false, reason: "refused", at: now.UnixMilli(), check: "TCP 32400", checkID: id}
	pending := h.pendingMonitorNotifications([]monitorTransition{down})
	if len(pending) != 1 || pending[0].Event != "down" || pending[0].Check != "TCP 32400" || pending[0].CheckID != id {
		t.Fatalf("down = %#v", pending)
	}
	if monitorNotificationFields(pending[0])["check"] != "TCP 32400" {
		t.Errorf("the webhook payload lacks the check")
	}

	// The outage was announced: its sample is stamped, the next up is a recovery.
	if err := h.appendHealthSamples(map[string][]HealthSample{key: {{T: now.UnixMilli(), Up: false, Alerted: true}}}); err != nil {
		t.Fatal(err)
	}
	up := monitorTransition{key: key, name: "Plex", url: "https://plex.example", up: true, at: now.Add(time.Minute).UnixMilli(), check: "TCP 32400", checkID: id}
	pending = h.pendingMonitorNotifications([]monitorTransition{up})
	if len(pending) != 1 || pending[0].Event != "up" || pending[0].Check != "TCP 32400" || pending[0].CheckID != id {
		t.Fatalf("up = %#v", pending)
	}
}

func TestNetAlertKeyDoesNotCloseHTTPAlert(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	at := time.Now().UnixMilli()
	httpDown := monitorNotification{Event: "down", Name: "Plex", URL: "https://plex.example", At: at}
	netUpN := monitorNotification{Event: "up", Name: "Plex", URL: "https://plex.example", At: at + 1000, Check: "TCP 443", CheckID: netTestCheckID(9)}
	if noticeKey(noticeSourceMonitor, httpDown) == noticeKey(noticeSourceMonitor, netUpN) {
		t.Fatalf("a network check shares the key of the bookmark's own alert")
	}
	h.trackOpenAlerts(noticeSourceMonitor, []monitorNotification{httpDown})
	h.trackOpenAlerts(noticeSourceMonitor, []monitorNotification{netUpN})
	open := readOpenFile().Open
	if len(open) != 1 || open[0].Key != noticeKey(noticeSourceMonitor, httpDown) {
		t.Fatalf("open alerts = %#v, the HTTP outage must stay open", open)
	}
}

// Ten hosts that all time out in one round say more about this server than
// about them: the failures are not recorded. Answers that are not about the
// network (the guard) are recorded as they are.
func TestNetNetworkGuardHoldsFailures(t *testing.T) {
	fastConfirm(t)
	h, dir := healthRecheckTestHandlers(t, `{}`)
	var rows []string
	for i := 1; i <= 10; i++ {
		rows = append(rows, netTestRow(fmt.Sprintf("H%d", i), fmt.Sprintf("https://h%d.example.com", i), netTestCheckID(i), ""))
	}
	netTestPage(t, dir, rows...)
	stub := &netStub{res: func(c NetCheck, call int) NetResult {
		return NetResult{Class: "timeout", Error: "No answer"}
	}}
	h.netRunner = stub.run

	h.runDueMonitors()

	for i := 1; i <= 10; i++ {
		if s := h.healthHistoryFor(netHistoryKey(netTestCheckID(i))); len(s) != 0 {
			t.Fatalf("check %d recorded %#v while every host timed out", i, s)
		}
	}

	stub = &netStub{res: func(c NetCheck, call int) NetResult {
		return NetResult{Class: "guard", Error: "blocked"}
	}}
	h.netRunner = stub.run
	h.runDueMonitors()
	for i := 1; i <= 10; i++ {
		if s := h.healthHistoryFor(netHistoryKey(netTestCheckID(i))); len(s) != 1 || s[0].Fail != "guard" {
			t.Fatalf("check %d = %#v, a guard refusal is no network outage and must be recorded", i, s)
		}
	}
}

func TestNetStartupGraceHolds(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	h.startedAt = time.Now()
	h.graceWindow = 10 * time.Minute
	netTestPage(t, dir,
		netTestRow("Bad", "https://bad.example", netTestCheckID(1), ""),
		netTestRow("Good", "https://good.example", netTestCheckID(2), ""),
	)
	fastConfirm(t)
	stub := &netStub{res: func(c NetCheck, call int) NetResult {
		if c.ID == netTestCheckID(1) {
			return NetResult{Class: "refused", Error: "refused"}
		}
		return NetResult{OK: true, Ms: 2}
	}}
	h.netRunner = stub.run

	h.runDueMonitors()

	if s := h.healthHistoryFor(netHistoryKey(netTestCheckID(1))); len(s) != 0 {
		t.Fatalf("a first failure right after start was recorded: %#v", s)
	}
	if s := h.healthHistoryFor(netHistoryKey(netTestCheckID(2))); len(s) != 1 || !s[0].Up {
		t.Fatalf("a good check must still be recorded: %#v", s)
	}
}

func TestNetOpenAlertWanted(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir,
		netTestRow("Loud", "https://loud.example", netTestCheckID(1), ""),
		netTestRow("Muted", "https://muted.example", netTestCheckID(2), `,"muted":true`),
	)
	if err := h.appendHealthSamples(map[string][]HealthSample{
		netHistoryKey(netTestCheckID(1)): {{T: time.Now().UnixMilli(), Up: false}},
		netHistoryKey(netTestCheckID(2)): {{T: time.Now().UnixMilli(), Up: false}},
	}); err != nil {
		t.Fatal(err)
	}
	wanted := h.openAlertWanted()
	loud := openAlert{Key: noticeSourceMonitor + ":net:" + netTestCheckID(1), Source: noticeSourceMonitor}
	muted := openAlert{Key: noticeSourceMonitor + ":net:" + netTestCheckID(2), Source: noticeSourceMonitor}
	gone := openAlert{Key: noticeSourceMonitor + ":net:" + netTestCheckID(3), Source: noticeSourceMonitor}
	if !wanted(loud) {
		t.Errorf("a reminder for an enabled, down check is wanted")
	}
	if wanted(muted) {
		t.Errorf("a muted check must not be reminded")
	}
	if wanted(gone) {
		t.Errorf("a check that no longer exists must not be reminded")
	}
}
