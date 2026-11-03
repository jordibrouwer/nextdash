package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func guardHosts(n int, answered bool, class string, prefix string) []sweepHostResult {
	out := make([]sweepHostResult, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, sweepHostResult{Host: fmt.Sprintf("%s%d.example.com", prefix, i), Answered: answered, Class: class})
	}
	return out
}

func joinSweeps(parts ...[]sweepHostResult) []sweepHostResult {
	var all []sweepHostResult
	for _, p := range parts {
		all = append(all, p...)
	}
	return all
}

func TestSweepLooksOffline(t *testing.T) {
	cases := []struct {
		name    string
		results []sweepHostResult
		want    bool
	}{
		{"ten hosts all dns", guardHosts(10, false, "dns", "a"), true},
		{"nine hosts all dns is too few", guardHosts(9, false, "dns", "a"), false},
		{"no results", nil, false},
		{"ten hosts, seven dns, three ok", joinSweeps(guardHosts(7, false, "dns", "a"), guardHosts(3, true, "", "b")), false},
		{"ten hosts, eight dns, two ok sits on the line", joinSweeps(guardHosts(8, false, "dns", "a"), guardHosts(2, true, "", "b")), true},
		{"twenty hosts, sixteen dns, four ok sits on the line", joinSweeps(guardHosts(16, false, "dns", "a"), guardHosts(4, true, "", "b")), true},
		{"twenty hosts, fifteen dns, five ok is under it", joinSweeps(guardHosts(15, false, "dns", "a"), guardHosts(5, true, "", "b")), false},
		{"dns and timeout mixed", joinSweeps(guardHosts(6, false, "dns", "a"), guardHosts(6, false, "timeout", "b")), true},
		{"failures that are mostly http are real rot", joinSweeps(guardHosts(2, false, "dns", "a"), guardHosts(10, false, "http", "b")), false},
		{"failures that are mostly tls are real rot", guardHosts(12, false, "tls", "a"), false},
		{"refused alone reads as transport here (a refused resolver port)", guardHosts(12, false, "refused", "a"), true},
		{"exactly 80 percent of failures transport", joinSweeps(guardHosts(8, false, "dns", "a"), guardHosts(2, false, "http", "b")), true},
		{"one past that", joinSweeps(guardHosts(7, false, "dns", "a"), guardHosts(3, false, "http", "b")), false},
		{"the same host many times is one host", func() []sweepHostResult {
			var r []sweepHostResult
			for i := 0; i < 30; i++ {
				r = append(r, sweepHostResult{Host: "same.example.com", Class: "dns"})
			}
			return r
		}(), false},
		{"a host that answered once counts as answered", func() []sweepHostResult {
			r := guardHosts(10, false, "dns", "a")
			// Three more bookmarks on host a0: one answered.
			r = append(r, sweepHostResult{Host: "a0.example.com", Answered: true})
			r = append(r, sweepHostResult{Host: "a1.example.com", Answered: true})
			r = append(r, sweepHostResult{Host: "a2.example.com", Answered: true})
			return r
		}(), false},
		{"lan names and ip addresses count as answered", joinSweeps(
			guardHosts(6, false, "dns", "a"),
			[]sweepHostResult{
				{Host: "nas.lan", Class: "dns"}, {Host: "printer.local", Class: "timeout"}, {Host: "192.168.1.5", Class: "timeout"},
				{Host: "10.0.0.2", Class: "timeout"}, {Host: "homeassistant", Class: "dns"}, {Host: "localhost", Class: "dns"},
			}), false},
		{"lan only install with failing external hosts never trips", joinSweeps(
			guardHosts(5, false, "dns", "a"),
			[]sweepHostResult{
				{Host: "nas.lan", Answered: true}, {Host: "pi.local", Answered: true}, {Host: "192.168.1.5", Answered: true},
				{Host: "router", Answered: true}, {Host: "[::1]", Answered: true},
			}), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sweepLooksOffline(tc.results); got != tc.want {
				t.Fatalf("sweepLooksOffline = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestHostNeedsNoInternet(t *testing.T) {
	for host, want := range map[string]bool{
		"192.168.1.1": true, "::1": true, "nas.lan": true, "pi.local": true, "router": true,
		"x.home.arpa": true, "example.com": false, "www.example.co.uk": false, "": true,
	} {
		if got := hostNeedsNoInternet(host); got != want {
			t.Errorf("hostNeedsNoInternet(%q) = %v, want %v", host, got, want)
		}
	}
}

// Twelve monitored bookmarks on twelve hosts, written as the page file.
func guardFixture(t *testing.T) *Handlers {
	t.Helper()
	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	var items []string
	for i := 0; i < 12; i++ {
		items = append(items, fmt.Sprintf(`{"name":"B%d","url":"https://host%d.example.com/","monitor":true,"monitorIntervalMinutes":5,"checkStatus":true}`, i, i))
	}
	page := `{"id":1,"name":"Page 1","bookmarks":[` + strings.Join(items, ",") + `]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	old := monitorConfirmDelay
	monitorConfirmDelay = 0
	t.Cleanup(func() { monitorConfirmDelay = old })
	return h
}

func (h *Handlers) setEpisode(since, last time.Time) {
	cache := readHealthCacheFile()
	cache.NetworkDownSince = since.UnixMilli()
	cache.LastOfflineSweepAt = last.UnixMilli()
	if err := writeHealthCacheFile(cache); err != nil {
		panic(err)
	}
}

func hookAll(h *Handlers, result PingResult) {
	h.pingHook = func(ctx context.Context, urlStr string, expect expectation) PingResult { return result }
}

var dnsDown = PingResult{Status: "offline", ErrorDetail: "DNS lookup failed"}
var reachable = PingResult{Status: "online", PingMs: 20, HTTPStatus: 200}

func totalSamples(h *Handlers) int {
	n := 0
	for _, s := range h.readAllHealthHistory() {
		n += len(s)
	}
	return n
}

func TestRunDueMonitorsHoldsBackAnOfflineLookingSweep(t *testing.T) {
	h := guardFixture(t)

	hookAll(h, dnsDown)
	h.runDueMonitors()

	if n := totalSamples(h); n != 0 {
		t.Fatalf("%d samples written by a sweep that looked offline", n)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError != "" || bm.LastChecked != 0 {
			t.Fatalf("%s changed: lastError=%q lastChecked=%d", bm.Name, bm.LastError, bm.LastChecked)
		}
	}
	cache := readHealthCacheFile()
	if len(cache.Cache) != 0 {
		t.Fatalf("the scan cache got %d entries", len(cache.Cache))
	}
	if cache.NetworkDownSince == 0 || cache.LastOfflineSweepAt == 0 {
		t.Fatalf("the flag was not set: %+v", cache)
	}
	if report := h.buildBookmarkHealthReport(); report.NetworkDown == nil || report.NetworkDown.Since != cache.NetworkDownSince {
		t.Fatalf("the report does not say so: %+v", report.NetworkDown)
	}

	// The held checks have no new sample, so they are due again on the next
	// tick; the connection is back by then.
	hookAll(h, reachable)
	h.runDueMonitors()

	if n := totalSamples(h); n != 12 {
		t.Fatalf("expected 12 samples after the healthy sweep, got %d", n)
	}
	cache = readHealthCacheFile()
	if cache.NetworkDownSince != 0 || cache.LastOfflineSweepAt != 0 {
		t.Fatalf("the flag was not cleared: %+v", cache)
	}
	if report := h.buildBookmarkHealthReport(); report.NetworkDown != nil {
		t.Fatalf("the report still says so: %+v", report.NetworkDown)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastChecked == 0 {
			t.Fatalf("%s was not recorded", bm.Name)
		}
	}
}

func TestRunDueMonitorsKeepsTheAnswersOfAnOfflineLookingSweep(t *testing.T) {
	h := guardFixture(t)
	// Eleven of twelve fail: the sweep looks offline, the one answer is real.
	h.pingHook = func(ctx context.Context, urlStr string, expect expectation) PingResult {
		if strings.Contains(urlStr, "host0.") {
			return reachable
		}
		return dnsDown
	}
	h.runDueMonitors()

	if n := totalSamples(h); n != 1 {
		t.Fatalf("expected only the answer to be recorded, got %d samples", n)
	}
	if readHealthCacheFile().NetworkDownSince == 0 {
		t.Fatal("the flag was not set")
	}
}

func TestRunDueMonitorsRecordsARealLongOutage(t *testing.T) {
	h := guardFixture(t)
	hookAll(h, dnsDown)

	// An episode that has been going on for longer than the limit, last seen a
	// minute ago.
	now := time.Now()
	cache := readHealthCacheFile()
	cache.NetworkDownSince = now.Add(-networkGuardMaxHold - time.Minute).UnixMilli()
	cache.LastOfflineSweepAt = now.Add(-time.Minute).UnixMilli()
	if err := writeHealthCacheFile(cache); err != nil {
		t.Fatal(err)
	}

	h.runDueMonitors()

	if n := totalSamples(h); n != 12 {
		t.Fatalf("expected the outage to be recorded after the limit, got %d samples", n)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError == "" {
			t.Fatalf("%s was not marked", bm.Name)
		}
	}
	// Still down, but no longer paused: the report must not claim a pause.
	if report := h.buildBookmarkHealthReport(); report.NetworkDown != nil {
		t.Fatalf("the report claims a pause during recording: %+v", report.NetworkDown)
	}
}

func TestRunDueMonitorsStaleFlagDoesNotCountAsALongOutage(t *testing.T) {
	h := guardFixture(t)
	hookAll(h, dnsDown)

	// The flag was left by a run hours ago (a reboot in between).
	cache := readHealthCacheFile()
	cache.NetworkDownSince = time.Now().Add(-5 * time.Hour).UnixMilli()
	cache.LastOfflineSweepAt = time.Now().Add(-5*time.Hour + time.Minute).UnixMilli()
	if err := writeHealthCacheFile(cache); err != nil {
		t.Fatal(err)
	}
	h.runDueMonitors()

	if n := totalSamples(h); n != 0 {
		t.Fatalf("%d samples written: an old flag made the first sweep after a boot count", n)
	}
}

func TestRetestAllHoldsBackAnOfflineLookingRun(t *testing.T) {
	h := guardFixture(t)

	hookAll(h, dnsDown)
	res, err := h.runHealthRetest(context.Background(), false, "test")
	if err != nil {
		t.Fatal(err)
	}
	if !res.NetworkDown || res.HeldOffline != 12 || res.Tested != 0 {
		t.Fatalf("unexpected result: %+v", res)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError != "" || bm.LastChecked != 0 {
			t.Fatalf("%s changed: %q", bm.Name, bm.LastError)
		}
	}
	if n := totalSamples(h); n != 0 {
		t.Fatalf("%d samples", n)
	}

	hookAll(h, reachable)
	res, err = h.runHealthRetest(context.Background(), false, "test")
	if err != nil {
		t.Fatal(err)
	}
	if res.NetworkDown || res.Tested != 12 {
		t.Fatalf("unexpected result: %+v", res)
	}
	if readHealthCacheFile().NetworkDownSince != 0 {
		t.Fatal("the flag was not cleared")
	}
}

func TestStatusBatchHoldsBackDuringAnEpisode(t *testing.T) {
	h := guardFixture(t)
	now := time.Now()
	h.setEpisode(now.Add(-5*time.Minute), now.Add(-time.Minute))
	var results []bookmarkStatusResult
	for i := 0; i < 12; i++ {
		results = append(results, bookmarkStatusResult{URL: fmt.Sprintf("https://host%d.example.com/", i), Status: "offline", Error: "DNS lookup failed"})
	}
	postStatusBatch(t, h, bookmarkStatusBatch{PageID: 1, Results: results})
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError != "" {
			t.Fatalf("%s marked broken by a page that looked offline", bm.Name)
		}
	}
	if readHealthCacheFile().NetworkDownSince == 0 {
		t.Fatal("the episode went away")
	}
}

func postStatusBatch(t *testing.T, h *Handlers, batch bookmarkStatusBatch) {
	t.Helper()
	body, _ := json.Marshal(batch)
	req := httptest.NewRequest(http.MethodPost, "/api/health/statuses", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	h.UpdateBookmarkHealthStatuses(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status batch: %d %s", rec.Code, rec.Body.String())
	}
}

// The real chain: the error the transport gives, classifyPingError's text, and
// what the guard makes of it.
func TestGuardReadsTheErrorsAnOfflineMachineGives(t *testing.T) {
	wrap := func(err error) error { return &url.Error{Op: "Get", URL: "https://x.example.com/", Err: err} }
	cases := map[string]error{
		"no such host":        wrap(&net.DNSError{Err: "no such host", Name: "x.example.com", IsNotFound: true}),
		"i/o timeout":         wrap(&net.DNSError{Err: "i/o timeout", Name: "x.example.com", IsTimeout: true}),
		"server misbehaving":  wrap(&net.DNSError{Err: "server misbehaving", Name: "x.example.com", Server: "127.0.0.11:53"}),
		"network unreachable": wrap(&net.OpError{Op: "dial", Net: "tcp", Err: &os.SyscallError{Syscall: "connect", Err: syscall.ENETUNREACH}}),
		"connection refused":  wrap(&net.OpError{Op: "read", Net: "udp", Err: &os.SyscallError{Syscall: "read", Err: syscall.ECONNREFUSED}}),
	}
	for name, err := range cases {
		t.Run(name, func(t *testing.T) {
			detail := classifyPingError(err, nil)
			r, ok := sweepHostResultFor("https://x.example.com/", PingResult{Status: "offline", ErrorDetail: detail})
			if !ok || r.Answered || (r.Class != "dns" && r.Class != "timeout") {
				t.Fatalf("%q (%q) read as %+v", name, detail, r)
			}
		})
	}
	for _, detail := range []string{"Invalid URL", "URL host is not allowed", demoNotAvailable, "HTTP 503", "TLS error"} {
		r, _ := sweepHostResultFor("https://x.example.com/", PingResult{Status: "offline", ErrorDetail: detail})
		if r.Class == "dns" || r.Class == "timeout" {
			t.Errorf("%q must not read as transport, got %q", detail, r.Class)
		}
	}
}

func TestGuardOnlyAnInternetAnswerEndsAnEpisode(t *testing.T) {
	h := guardFixture(t)
	now := time.Now()
	h.setEpisode(now.Add(-5*time.Minute), now.Add(-time.Minute))

	// Few hosts, only LAN answers: the episode stays.
	lan := []sweepHostResult{{Host: "nas.lan", Answered: true}, {Host: "192.168.1.5", Answered: true}}
	h.networkGuard(lan, now, now, true)
	if readHealthCacheFile().NetworkDownSince == 0 {
		t.Fatal("a sweep with only LAN answers ended the episode")
	}
	// Twelve hosts, mostly LAN and answering, so it does not look offline: same.
	big := joinSweeps(guardHosts(2, false, "dns", "a"), []sweepHostResult{
		{Host: "a.lan", Answered: true}, {Host: "b.lan", Answered: true}, {Host: "c.local", Answered: true}, {Host: "d.local", Answered: true},
		{Host: "10.0.0.1", Answered: true}, {Host: "10.0.0.2", Answered: true}, {Host: "10.0.0.3", Answered: true}, {Host: "nas", Answered: true},
		{Host: "pi", Answered: true}, {Host: "router", Answered: true},
	})
	if hold := h.networkGuard(big, now, now, true); !hold || readHealthCacheFile().NetworkDownSince == 0 {
		t.Fatalf("a LAN-heavy sweep that does not look offline ended or skipped the episode (hold=%v)", hold)
	}
	// An internet host answering ends it.
	h.networkGuard([]sweepHostResult{{Host: "example.com", Answered: true}}, now, now, true)
	if readHealthCacheFile().NetworkDownSince != 0 {
		t.Fatal("an internet answer did not end the episode")
	}
}

func TestGuardLongSweepContinuesTheEpisode(t *testing.T) {
	h := guardFixture(t)
	end := time.Now()
	sinceMs := end.Add(-20 * time.Minute)
	// Last offline-looking sweep ended 15 minutes ago; this sweep took 14 minutes.
	h.setEpisode(sinceMs, end.Add(-15*time.Minute))
	start := end.Add(-14 * time.Minute)
	h.networkGuard(guardHosts(12, false, "dns", "a"), start, end, true)
	if got := readHealthCacheFile().NetworkDownSince; got != sinceMs.UnixMilli() {
		t.Fatalf("a long sweep restarted the episode: %d != %d", got, sinceMs.UnixMilli())
	}
	// Judged from its end it would have been a new one.
	h.setEpisode(sinceMs, end.Add(-15*time.Minute))
	h.networkGuard(guardHosts(12, false, "dns", "a"), end, end, true)
	if got := readHealthCacheFile().NetworkDownSince; got != end.UnixMilli() {
		t.Fatal("control: a start past the gap should begin a new episode")
	}
}

func TestGuardBatchesNeverStartOrRefreshAnEpisode(t *testing.T) {
	h := guardFixture(t)
	// Ten rows that are not bookmarks on the page, all dns.
	var fake []bookmarkStatusResult
	for i := 0; i < 12; i++ {
		fake = append(fake, bookmarkStatusResult{URL: fmt.Sprintf("https://fake%d.example.org/", i), Status: "offline", Error: "DNS lookup failed"})
	}
	postStatusBatch(t, h, bookmarkStatusBatch{PageID: 1, Results: fake})
	if readHealthCacheFile().NetworkDownSince != 0 {
		t.Fatal("fake rows started an episode")
	}
	// Real rows, all dns: a batch does not start one either.
	var real []bookmarkStatusResult
	for i := 0; i < 12; i++ {
		real = append(real, bookmarkStatusResult{URL: fmt.Sprintf("https://host%d.example.com/", i), Status: "offline", Error: "DNS lookup failed"})
	}
	postStatusBatch(t, h, bookmarkStatusBatch{PageID: 1, Results: real})
	if readHealthCacheFile().NetworkDownSince != 0 {
		t.Fatal("a posted batch started an episode")
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.LastError != "" {
			goto marked
		}
	}
	t.Fatal("without an episode the failures should have been recorded")
marked:
	// With an episode running the batch's failures are held, and its time is not refreshed.
	now := time.Now()
	h.setEpisode(now.Add(-5*time.Minute), now.Add(-time.Minute))
	last := readHealthCacheFile().LastOfflineSweepAt
	h2 := guardFixture(t)
	h2.setEpisode(now.Add(-5*time.Minute), now.Add(-time.Minute))
	postStatusBatch(t, h2, bookmarkStatusBatch{PageID: 1, Results: real})
	for _, bm := range h2.store.GetBookmarksByPage(1) {
		if bm.LastError != "" {
			t.Fatalf("%s marked during an episode", bm.Name)
		}
	}
	if got := readHealthCacheFile().LastOfflineSweepAt; got == 0 || got > now.UnixMilli() {
		t.Fatalf("the batch refreshed the episode (%d, was %d)", got, last)
	}
}

func TestRetestRecordsLANFailuresDuringAnEpisode(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	var items []string
	for i := 0; i < 12; i++ {
		items = append(items, fmt.Sprintf(`{"name":"B%d","url":"https://host%d.example.com/","checkStatus":true}`, i, i))
	}
	items = append(items, `{"name":"Nas","url":"http://nas.lan/","checkStatus":true}`)
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(`{"id":1,"name":"P","bookmarks":[`+strings.Join(items, ",")+`]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	hookAll(h, dnsDown)
	res, err := h.runHealthRetest(context.Background(), false, "test")
	if err != nil {
		t.Fatal(err)
	}
	if !res.NetworkDown || res.HeldOffline != 12 {
		t.Fatalf("unexpected result: %+v", res)
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.Name == "Nas" && bm.LastError == "" {
			t.Fatal("a real LAN failure was held back")
		}
		if bm.Name != "Nas" && bm.LastError != "" {
			t.Fatalf("%s was marked", bm.Name)
		}
	}
}

func TestRecheckDoesNotOverlapItself(t *testing.T) {
	h := guardFixture(t)
	if err := os.WriteFile(filepath.Join(os.Getenv("NEXTDASH_DATA_DIR"), "settings.json"), []byte(`{"allowLocalBookmarks":true,"healthAutoRecheckEnabled":true}`), 0o644); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	h.pingHook = func(ctx context.Context, urlStr string, expect expectation) PingResult {
		calls.Add(1)
		return reachable
	}
	h.recheckRunning.Store(true)
	h.maybeRunHealthAutoRecheck()
	if calls.Load() != 0 {
		t.Fatal("a second run started while one was in progress")
	}
	h.recheckRunning.Store(false)
	h.maybeRunHealthAutoRecheck()
	if calls.Load() == 0 {
		t.Fatal("control: the run did not happen when none was in progress (setting not read?)")
	}
}
