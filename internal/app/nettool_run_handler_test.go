package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// netRunPost posts a one-off test body straight to the handler.
func netRunPost(h *Handlers, body, remote string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/net/run", strings.NewReader(body))
	if remote != "" {
		req.RemoteAddr = remote + ":1234"
	}
	rec := httptest.NewRecorder()
	h.RunNetTest(rec, req)
	return rec
}

// netRunRecorder is a runner that records what it was asked to run and never
// touches the network.
type netRunRecorder struct {
	mu    sync.Mutex
	calls []NetCheck
	hosts []string
	res   NetResult
}

func (r *netRunRecorder) run(ctx context.Context, bm Bookmark, c NetCheck) NetResult {
	r.mu.Lock()
	r.calls = append(r.calls, c)
	r.hosts = append(r.hosts, bm.URL)
	r.mu.Unlock()
	res := r.res
	res.Type, res.CheckID, res.At = c.Type, c.ID, time.Now().UnixMilli()
	return res
}

func (r *netRunRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

func TestNetRunRequiresBookmark(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example","checks":[{"id":"`+netTestCheckID(1)+`","type":"tcp","enabled":true}]}`)
	rec := &netRunRecorder{res: NetResult{OK: true, Ms: 4}}
	h.netRunner = rec.run

	cases := []struct {
		name, body string
		want       int
	}{
		{"unknown url", `{"pageId":1,"url":"https://nope.example","type":"tcp"}`, http.StatusNotFound},
		{"unknown page", `{"pageId":9,"url":"https://a.example","type":"tcp"}`, http.StatusNotFound},
		{"no page", `{"url":"https://a.example","type":"tcp"}`, http.StatusBadRequest},
		{"no url", `{"pageId":1,"type":"tcp"}`, http.StatusBadRequest},
		{"unknown check", `{"pageId":1,"url":"https://a.example","checkId":"` + netTestCheckID(99) + `"}`, http.StatusNotFound},
		{"neither type nor check", `{"pageId":1,"url":"https://a.example"}`, http.StatusBadRequest},
		{"type of a check that is not built", `{"pageId":1,"url":"https://a.example","type":"json"}`, http.StatusBadRequest},
		{"type that does not match the check", `{"pageId":1,"url":"https://a.example","checkId":"` + netTestCheckID(1) + `","type":"ping"}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		if got := netRunPost(h, c.body, "").Code; got != c.want {
			t.Errorf("%s: %d, want %d", c.name, got, c.want)
		}
	}
	if rec.count() != 0 {
		t.Fatalf("a refused request still ran %d check(s)", rec.count())
	}
	if got := netRunPost(h, `{"pageId":1,"url":"https://a.example","type":"tcp"}`, "").Code; got != http.StatusOK {
		t.Fatalf("a valid test: %d", got)
	}
}

func TestNetRunRejectsFreeHostAndPort(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"netToolsAllowCustomHost":true}`)
	netTestPage(t, dir,
		`{"name":"A","url":"https://a.example:8443","checks":[{"id":"`+netTestCheckID(1)+`","type":"tcp","enabled":true,"port":2222}]}`,
		`{"name":"B","url":"https://b.example","checks":[{"id":"`+netTestCheckID(2)+`","type":"tcp","port":22}]}`,
	)
	rec := &netRunRecorder{res: NetResult{OK: true, Ms: 4}}
	h.netRunner = rec.run

	for _, body := range []string{
		`{"pageId":1,"url":"https://a.example:8443","type":"tcp","host":"victim.example"}`,
		`{"pageId":1,"url":"https://a.example:8443","type":"tcp","port":22}`,
		`{"pageId":1,"url":"https://a.example:8443","type":"tcp","address":"10.0.0.1:22"}`,
		`{"pageId":1,"url":"https://a.example:8443","checkId":"` + netTestCheckID(1) + `","port":25}`,
	} {
		if got := netRunPost(h, body, "").Code; got != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", body, got)
		}
	}
	// The check of another bookmark is not this bookmark's to test: its port
	// against this host would be a scan.
	if got := netRunPost(h, `{"pageId":1,"url":"https://a.example:8443","checkId":"`+netTestCheckID(2)+`"}`, "").Code; got != http.StatusNotFound {
		t.Errorf("another bookmark's check: %d, want 404", got)
	}
	if rec.count() != 0 {
		t.Fatalf("a refused request still ran %d check(s)", rec.count())
	}

	// What does run: a type alone is the bookmark's own host and the port of
	// its address (the check names none), a stored check its own saved port.
	if got := netRunPost(h, `{"pageId":1,"url":"https://a.example:8443","type":"tcp"}`, "").Code; got != http.StatusOK {
		t.Fatalf("type only: %d", got)
	}
	if c := rec.calls[0]; c.Host != "" || c.Port != 0 || c.ID != "" {
		t.Fatalf("a one-off test carried a target: %+v", c)
	}
	if target, err := netCheckTarget(Bookmark{URL: "https://a.example:8443"}, rec.calls[0], h.store.GetSettings()); err != nil || target.Host != "a.example" || target.Port != 8443 {
		t.Fatalf("target = %+v, %v", target, err)
	}
	if got := netRunPost(h, `{"pageId":1,"url":"https://a.example:8443","checkId":"`+netTestCheckID(1)+`"}`, "").Code; got != http.StatusOK {
		t.Fatalf("stored check: %d", got)
	}
	if rec.calls[1].Port != 2222 {
		t.Fatalf("the stored check's port was not used: %+v", rec.calls[1])
	}
	if ports := netOneOffPorts(Bookmark{URL: "https://a.example:8443", Checks: []NetCheck{{Type: netTypeTCP, Port: 2222}}}); !ports[8443] || !ports[2222] || ports[22] {
		t.Fatalf("one-off ports = %v", ports)
	}
}

func TestNetRunRateLimit(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example"}`)
	rec := &netRunRecorder{res: NetResult{OK: true, Ms: 4}}
	h.netRunner = rec.run
	h.netToolLimiter = newSlidingWindowLimiter(2, time.Minute)
	h.ssrfAPILimiter = newSlidingWindowLimiter(100, time.Minute)
	body := `{"pageId":1,"url":"https://a.example","type":"tcp"}`

	for i := 0; i < 2; i++ {
		if got := netRunPost(h, body, "10.0.0.1").Code; got != http.StatusOK {
			t.Fatalf("run %d: %d", i, got)
		}
	}
	over := netRunPost(h, body, "10.0.0.1")
	if over.Code != http.StatusTooManyRequests || over.Header().Get("Retry-After") == "" {
		t.Fatalf("third run: %d, retry-after %q", over.Code, over.Header().Get("Retry-After"))
	}
	if rec.count() != 2 {
		t.Fatalf("the refused run reached the engine: %d calls", rec.count())
	}
	if got := netRunPost(h, body, "10.0.0.2").Code; got != http.StatusOK {
		t.Fatalf("another client was held to the first one's budget: %d", got)
	}

	// The shared SSRF budget comes first and holds on its own.
	h.netToolLimiter = newSlidingWindowLimiter(100, time.Minute)
	h.ssrfAPILimiter = newSlidingWindowLimiter(1, time.Minute)
	if got := netRunPost(h, body, "10.0.0.3").Code; got != http.StatusOK {
		t.Fatalf("first run under the SSRF budget: %d", got)
	}
	if got := netRunPost(h, body, "10.0.0.3").Code; got != http.StatusTooManyRequests {
		t.Fatalf("second run under the SSRF budget: %d", got)
	}
}

func TestNetRunOneInflightPerHost(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir,
		`{"name":"A","url":"https://a.example"}`,
		`{"name":"B","url":"https://b.example"}`,
	)
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	h.netRunner = func(ctx context.Context, bm Bookmark, c NetCheck) NetResult {
		if strings.Contains(bm.URL, "a.example") {
			once.Do(func() { close(started) })
			// Bounded, so a second run that gets through fails the test
			// instead of waiting for a release that only comes after it.
			select {
			case <-release:
			case <-time.After(2 * time.Second):
			}
		}
		return NetResult{OK: true, Ms: 1}
	}
	body := func(host string) string { return `{"pageId":1,"url":"https://` + host + `","type":"tcp"}` }

	done := make(chan int, 1)
	go func() { done <- netRunPost(h, body("a.example"), "").Code }()
	<-started
	if got := netRunPost(h, body("a.example"), "").Code; got != http.StatusConflict {
		t.Errorf("a second test of the same host: %d, want 409", got)
	}
	if got := netRunPost(h, body("b.example"), "").Code; got != http.StatusOK {
		t.Errorf("a test of another host: %d", got)
	}
	close(release)
	if got := <-done; got != http.StatusOK {
		t.Fatalf("the first test: %d", got)
	}
	// The place in line is given back once the run is over.
	if got := netRunPost(h, body("a.example"), "").Code; got != http.StatusOK {
		t.Fatalf("after the run: %d, the host stayed busy", got)
	}
	if _, busy := h.netRunInflight.Load("a.example"); busy {
		t.Fatal("the host is still marked as running")
	}
}

func TestNetRunDemoRefused(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "1")
	reached := 0
	guard := demoGuard(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached++ }))
	rec := httptest.NewRecorder()
	guard.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/net/run", strings.NewReader(`{}`)))
	if rec.Code != http.StatusForbidden || reached != 0 {
		t.Fatalf("POST /api/net/run in the demo: %d (reached %d)", rec.Code, reached)
	}
	// Saving checks is a change to the demo's own data and stays open.
	rec = httptest.NewRecorder()
	guard.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/net/checks", strings.NewReader(`{}`)))
	if rec.Code == http.StatusForbidden {
		t.Fatalf("PUT /api/net/checks was refused in the demo")
	}

	// And should a request get past the gate, the engine itself does not reach out.
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example"}`)
	res, status, err := h.runNetTestFor(context.Background(), "x", 1, "https://a.example", "tcp", "")
	if err != nil || status != http.StatusOK || res.OK || res.Class != "demo" {
		t.Fatalf("in the demo: %+v, %d, %v", res, status, err)
	}
}

func TestNetRunDisabledSetting(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"netToolsEnabled":false}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example"}`)
	rec := &netRunRecorder{res: NetResult{OK: true}}
	h.netRunner = rec.run
	if got := netRunPost(h, `{"pageId":1,"url":"https://a.example","type":"tcp"}`, "").Code; got != http.StatusForbidden {
		t.Fatalf("with network tests off: %d, want 403", got)
	}
	if rec.count() != 0 {
		t.Fatal("the engine ran with network tests switched off")
	}
}

func TestNetRunRecordsSampleForEnabledCheck(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	on, off := netTestCheckID(1), netTestCheckID(2)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example","checks":[{"id":"`+on+`","type":"tcp","enabled":true},{"id":"`+off+`","type":"ping"}]}`)
	rec := &netRunRecorder{res: NetResult{OK: true, Ms: 23, Detail: "443 open"}}
	h.netRunner = rec.run

	post := func(extra string) {
		t.Helper()
		if got := netRunPost(h, `{"pageId":1,"url":"https://a.example"`+extra+`}`, "").Code; got != http.StatusOK {
			t.Fatalf("%s: %d", extra, got)
		}
	}
	post(`,"checkId":"` + on + `"`)
	if s := h.healthHistoryFor(netHistoryKey(on)); len(s) != 1 || !s[0].Up || s[0].PingMs != 23 || s[0].D != "443 open" {
		t.Fatalf("samples of the scheduled check = %#v", s)
	}
	post(`,"checkId":"` + off + `"`)
	if s := h.healthHistoryFor(netHistoryKey(off)); len(s) != 0 {
		t.Fatalf("a check that is not scheduled got a sample: %#v", s)
	}
	post(`,"type":"tcp"`)
	if s := h.healthHistoryFor(netHistoryKey(on)); len(s) != 1 {
		t.Fatalf("a one-off test of the type wrote to the history: %#v", s)
	}
}

func TestNetRunAnnouncesRecovery(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":1}`)
	id := netTestCheckID(5)
	key := netHistoryKey(id)
	netTestPage(t, dir, `{"name":"Plex","url":"https://plex.example","checks":[{"id":"`+id+`","type":"tcp","enabled":true,"port":32400}]}`)
	rec := &netRunRecorder{res: NetResult{OK: true, Ms: 9}}
	h.netRunner = rec.run

	// An outage that was announced: its sample is stamped and an alert is open.
	past := time.Now().Add(-10 * time.Minute).UnixMilli()
	if err := h.appendHealthSamples(map[string][]HealthSample{key: {{T: past, Up: false, Alerted: true}}}); err != nil {
		t.Fatal(err)
	}
	down := monitorNotification{Event: "down", Name: "Plex", URL: "https://plex.example", At: past, Check: "TCP 32400", CheckID: id}
	h.trackOpenAlerts(noticeSourceMonitor, []monitorNotification{down})
	alertKey := noticeKey(noticeSourceMonitor, down)
	open := func() bool {
		for _, a := range readOpenFile().Open {
			if a.Key == alertKey {
				return true
			}
		}
		return false
	}
	if !open() {
		t.Fatal("the outage's alert did not open")
	}

	if got := netRunPost(h, `{"pageId":1,"url":"https://plex.example","checkId":"`+id+`"}`, "").Code; got != http.StatusOK {
		t.Fatalf("test: %d", got)
	}
	deadline := time.Now().Add(5 * time.Second)
	for open() && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if open() {
		t.Fatal("the test saw the check come back and did not announce it")
	}
	if s := h.healthHistoryFor(key); len(s) != 2 || !s[1].Up {
		t.Fatalf("samples = %#v", s)
	}

	// A muted check says nothing: its transition is held back.
	muted := h.netRecoveryTransitions(map[string][]HealthSample{key: {{T: time.Now().UnixMilli(), Up: true}}})
	if len(muted) != 1 || muted[0].muted || muted[0].checkID != id || muted[0].check == "" {
		t.Fatalf("transitions = %#v", muted)
	}
	if none := h.netRecoveryTransitions(map[string][]HealthSample{key: {{T: 1, Up: true, Maint: true}}}); len(none) != 0 {
		t.Fatalf("a sample taken in maintenance announced a recovery: %#v", none)
	}
	if none := h.netRecoveryTransitions(map[string][]HealthSample{key: {{T: 1, Up: false}}}); len(none) != 0 {
		t.Fatalf("a failure announced a recovery: %#v", none)
	}
}
