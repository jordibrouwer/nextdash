package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func netAddBookmarkPost(h *Handlers, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.AddBookmark(rec, httptest.NewRequest(http.MethodPost, "/api/bookmarks/add", strings.NewReader(body)))
	return rec
}

func netTestPageN(t *testing.T, dir string, id int, rows ...string) {
	t.Helper()
	body := `{"id":` + strconv.Itoa(id) + `,"name":"Page ` + strconv.Itoa(id) + `","bookmarks":[` + strings.Join(rows, ",") + `]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-"+strconv.Itoa(id)+".json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// M3: a check list the client sends with a new bookmark is never stored.
func TestNetAddBookmarkDropsClientChecks(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"netToolsAllowCustomHost":false}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))

	body := `{"page":1,"bookmark":{"name":"B","url":"https://b.example","checks":[` +
		`{"id":"` + netTestCheckID(1) + `","type":"tcp","enabled":true,"port":70000,"host":"evil.example","credentialId":"nope","baseline":"x"}]}}`
	if rec := netAddBookmarkPost(h, body); rec.Code != http.StatusOK {
		t.Fatalf("add = %d %s", rec.Code, rec.Body.String())
	}
	var b Bookmark
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.Name == "B" {
			b = bm
		}
	}
	if b.Name != "B" || len(b.Checks) != 0 {
		t.Fatalf("the new bookmark kept the client's checks: %#v", b.Checks)
	}
	if got := h.store.GetBookmarksByPage(1)[0].Checks; len(got) != 1 || got[0].ID != netTestCheckID(1) {
		t.Fatalf("the other bookmark's check was touched: %#v", got)
	}
}

// A move is an add and a delete: the row's checks come from the stored source,
// not from what the client says, so the history goes with it.
func TestNetAddBookmarkMoveBringsStoredChecks(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))
	netTestPageN(t, dir, 2)

	body := `{"page":2,"allowDuplicate":true,"movedFrom":"https://a.example","bookmark":{"name":"A","url":"https://a.example","checks":[{"id":"ffffffffffff","type":"ping"}]}}`
	if rec := netAddBookmarkPost(h, body); rec.Code != http.StatusOK {
		t.Fatalf("move = %d %s", rec.Code, rec.Body.String())
	}
	got := h.store.GetBookmarksByPage(2)
	if len(got) != 1 || len(got[0].Checks) != 1 || got[0].Checks[0].ID != netTestCheckID(1) {
		t.Fatalf("the moved row lost its checks or took the client's: %#v", got)
	}
}

func restoreFromTrash(t *testing.T, h *Handlers, bm Bookmark) Bookmark {
	t.Helper()
	if err := h.store.AddTrashedBookmarks([]TrashedBookmark{{PageID: 1, Bookmark: bm}}); err != nil {
		t.Fatal(err)
	}
	items := h.store.GetTrashItems()
	id := items[len(items)-1].ID
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+id+`"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("restore = %d %s", rec.Code, rec.Body.String())
	}
	for _, b := range h.store.GetBookmarksByPage(1) {
		if b.URL == bm.URL {
			return b
		}
	}
	t.Fatal("the bookmark did not come back")
	return Bookmark{}
}

// M3: a bookmark that comes back from the trash gets its checks normalised.
func TestNetTrashRestoreNormalisesChecks(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"netToolsMaxChecks":2}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))

	// An ID that is another bookmark's is not taken over; the baseline is the
	// server's and is not taken from a trash entry; the ceiling (2, one used)
	// switches the surplus off instead of losing the check.
	back := restoreFromTrash(t, h, Bookmark{Name: "T", URL: "https://t.example", Checks: []NetCheck{
		{ID: netTestCheckID(1), Type: netTypeDNS, Record: "A", Enabled: true, WatchDrift: true, Baseline: "x\ny"},
		{ID: netTestCheckID(5), Type: netTypeTCP, Port: 22, Enabled: true},
	}})
	if len(back.Checks) != 2 {
		t.Fatalf("checks = %#v", back.Checks)
	}
	for _, c := range back.Checks {
		if c.ID == netTestCheckID(1) || c.Baseline != "" || c.Enabled {
			t.Fatalf("a check came back unnormalised: %#v", c)
		}
	}

	// A list that does not hold up (a bad port, more than six) is dropped.
	bad := restoreFromTrash(t, h, Bookmark{Name: "U", URL: "https://u.example", Checks: []NetCheck{{Type: netTypeTCP, Port: 70000}}})
	if len(bad.Checks) != 0 {
		t.Fatalf("a check with a bad port came back: %#v", bad.Checks)
	}
	many := make([]NetCheck, 7)
	for i := range many {
		many[i] = NetCheck{Type: netTypePing}
	}
	if big := restoreFromTrash(t, h, Bookmark{Name: "V", URL: "https://v.example", Checks: many}); len(big.Checks) != 0 {
		t.Fatalf("seven checks came back: %#v", big.Checks)
	}
	// A host with custom hosts off is refused as for any other save.
	if hosted := restoreFromTrash(t, h, Bookmark{Name: "W", URL: "https://w.example", Checks: []NetCheck{{Type: netTypePing, Host: "x.example"}}}); len(hosted.Checks) != 0 {
		t.Fatalf("a custom host came back: %#v", hosted.Checks)
	}
}

func netFlatItems(t *testing.T, h *Handlers) (items []map[string]any, counts map[string]any) {
	t.Helper()
	out := netGet(t, h, "/api/net/checks", h.GetNetChecks)
	for _, it := range out["items"].([]any) {
		items = append(items, it.(map[string]any))
	}
	return items, out["counts"].(map[string]any)
}

// M4 and m2: an answer that is about this install's settings (ping off, the
// guard, the demo) is no outage: no alert, no failed sample in the uptime, and
// the state says it is paused rather than down. A real failure still alerts.
func TestNetNotMeasuredNeverAlerts(t *testing.T) {
	fastConfirm(t)
	settings := `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":1,"netToolsPing":"off"}`

	for _, tc := range []struct {
		name  string
		class string
		err   string
		alert bool
	}{
		{"guard", "guard", "The address guard blocks this host: it resolves to 192.168.1.20, a private or reserved address.", false},
		{"icmp", "icmp", "Ping is switched off", false},
		{"demo", "demo", "Network checks do not reach out in the demo.", false},
		{"timeout", "timeout", "No answer within 5 s.", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, dir := healthRecheckTestHandlers(t, settings)
			netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))
			stub := &netStub{res: func(c NetCheck, call int) NetResult {
				return NetResult{Class: tc.class, Error: tc.err}
			}}
			h.netRunner = stub.run
			h.runDueMonitors()
			s := h.healthHistoryFor(netHistoryKey(netTestCheckID(1)))
			if len(s) != 1 {
				t.Fatalf("samples = %#v", s)
			}
			if s[0].Alerted != tc.alert {
				t.Fatalf("alerted = %v, want %v (%#v)", s[0].Alerted, tc.alert, s[0])
			}
			if !tc.alert {
				if !s[0].Maint {
					t.Fatalf("a not-measured sample must not count in the uptime: %#v", s[0])
				}
				items, counts := netFlatItems(t, h)
				st := items[0]["state"].(map[string]any)
				if st["paused"] != true || counts["down"].(float64) != 0 {
					t.Fatalf("state = %v counts = %v, want paused and not down", st, counts)
				}
			}
		})
	}
}

// M4: with Ping off, the real runner answers class icmp for a ping check, and
// nothing is down or alerted.
func TestNetPingOffIsNotDown(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"https://hooks.example/notify","monitorNotifyRetries":1,"netToolsPing":"off"}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example","checks":[{"id":"`+netTestCheckID(1)+`","type":"ping","enabled":true}]}`)

	h.runDueMonitors()

	s := h.healthHistoryFor(netHistoryKey(netTestCheckID(1)))
	if len(s) != 1 || s[0].Alerted || !s[0].Maint || s[0].Fail != "icmp" {
		t.Fatalf("samples = %#v", s)
	}
	if _, counts := netFlatItems(t, h); counts["down"].(float64) != 0 {
		t.Fatalf("counts = %v", counts)
	}
}

// m3: with custom hosts off, a check that already has a host stays on the
// bookmark: the list can still be saved (switched off, muted, other checks
// edited), the check does not run, and what it reports is not an outage.
func TestNetCustomHostOffKeepsStoredHost(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"netToolsAllowCustomHost":false}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example","checks":[`+
		`{"id":"`+netTestCheckID(1)+`","type":"tcp","port":22,"host":"nas.lan","enabled":true},`+
		`{"id":"`+netTestCheckID(2)+`","type":"ping","enabled":true}]}`)

	put := func(checks string) *httptest.ResponseRecorder {
		return netPut(t, h, `{"pageId":1,"url":"https://a.example","checks":`+checks+`}`)
	}
	// Mute the host check and edit the ping: allowed.
	ok := put(`[{"id":"` + netTestCheckID(1) + `","type":"tcp","port":22,"host":"nas.lan","enabled":true,"muted":true},` +
		`{"id":"` + netTestCheckID(2) + `","type":"ping","enabled":false}]`)
	if ok.Code != http.StatusOK {
		t.Fatalf("saving the list with a stored host = %d %s", ok.Code, ok.Body.String())
	}
	got := h.store.GetBookmarksByPage(1)[0].Checks
	if len(got) != 2 || got[0].Host != "nas.lan" || !got[0].Muted || got[1].Enabled {
		t.Fatalf("stored = %#v", got)
	}
	// A changed host, and a host on another check, are still refused.
	if rec := put(`[{"id":"` + netTestCheckID(1) + `","type":"tcp","port":22,"host":"other.lan"}]`); rec.Code != http.StatusBadRequest {
		t.Fatalf("changed host = %d", rec.Code)
	}
	if rec := put(`[{"id":"` + netTestCheckID(1) + `","type":"tcp","port":22,"host":"nas.lan"},{"type":"ping","host":"x.lan"}]`); rec.Code != http.StatusBadRequest {
		t.Fatalf("new host = %d", rec.Code)
	}
	// The stored host check does not run: a refusal that is a setting, not an outage.
	res := h.runNetCheck(t.Context(), h.store.GetBookmarksByPage(1)[0], got[0])
	if res.OK || res.Class != "guard" || !strings.Contains(res.Error, "custom hosts are turned off") {
		t.Fatalf("result = %+v", res)
	}
}

// m4: "slow" and "via TCP" come from flags, not from the text of a detail that
// can be a DNS record or a JSON value.
func TestNetStateFlagsNotText(t *testing.T) {
	dns := NetCheck{Type: netTypeDNS}
	st := netCheckStateFor(dns, []HealthSample{{T: 1, Up: true, D: "CNAME slow.example.org. via TCP"}})
	if st.Slow || st.ViaTCP {
		t.Fatalf("a record's text made the check slow: %+v", st)
	}
	if st := netCheckStateFor(dns, []HealthSample{{T: 1, Up: true, D: "slow", Slow: true}}); !st.Slow {
		t.Fatalf("a flagged slow answer is not slow: %+v", st)
	}
	// A sample from before the flags, of a type whose detail is our own text.
	ping := NetCheck{Type: netTypePing}
	if st := netCheckStateFor(ping, []HealthSample{{T: 1, Up: true, D: "via TCP · slow"}}); !st.Slow || !st.ViaTCP {
		t.Fatalf("an older ping sample lost its words: %+v", st)
	}
	// And the flags are written by the result.
	if s := (NetResult{OK: true, Slow: true, ViaTCP: true}).sample(false); !s.Slow || !s.ViaTCP {
		t.Fatalf("sample = %+v", s)
	}
}

func dnsCheckWithDrift(t *testing.T, h *Handlers, dir string, baseline, driftSet string) {
	t.Helper()
	b, _ := json.Marshal(NetCheck{ID: netTestCheckID(1), Type: netTypeDNS, Enabled: true, Record: "A", WatchDrift: true,
		Baseline: baseline, DriftSet: driftSet, DriftDiff: "A +1.1.1.1", DriftAt: 5})
	netTestPage(t, dir, `{"name":"A","url":"https://a.example","checks":[`+string(b)+`]}`)
}

// m5: an Accept that lands while a round runs is not undone by the round.
func TestNetAcceptDuringRoundIsNotUndone(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	base := dnsEncodeSet("A", []string{"1.1.1.1"})
	drift := dnsEncodeSet("A", []string{"2.2.2.2"})
	dnsCheckWithDrift(t, h, dir, base, drift)

	// The round starts from this view of the check...
	seen := h.store.GetBookmarksByPage(1)[0].Checks[0]
	// ...the user accepts the pending change while it runs...
	if n, err := h.acceptNetBaselines(seen.ID, false); err != nil || n != 1 {
		t.Fatalf("accept = %d, %v", n, err)
	}
	// ...and the round, which found a third set, then writes its answer.
	res := NetResult{OK: true, At: 9, DNS: &DNSResult{Record: "A", Records: []DNSRecord{{Value: "3.3.3.3"}}}}
	h.applyDNSDrift([]netOutcome{{due: netDue{check: seen, pageID: 1}, res: res}})

	got := h.store.GetBookmarksByPage(1)[0].Checks[0]
	if got.Baseline != drift || got.DriftSet != "" || got.DriftAt != 0 {
		t.Fatalf("the round put an old view back: %#v", got)
	}

	// Without a race the same answer is recorded as a drift.
	h.applyDNSDrift([]netOutcome{{due: netDue{check: got, pageID: 1}, res: res}})
	if got := h.store.GetBookmarksByPage(1)[0].Checks[0]; got.DriftSet == "" {
		t.Fatalf("an undisturbed round did not record its drift: %#v", got)
	}
}

// m6: Accept writes only the pages that have something to accept.
func TestNetAcceptWritesOnlyChangedPages(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	dnsCheckWithDrift(t, h, dir, dnsEncodeSet("A", []string{"1.1.1.1"}), dnsEncodeSet("A", []string{"2.2.2.2"}))
	netTestPageN(t, dir, 2, `{"name":"Q","url":"https://q.example"}`)
	quiet := filepath.Join(dir, "bookmarks-2.json")
	old := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(quiet, old, old); err != nil {
		t.Fatal(err)
	}
	if n, err := h.acceptNetBaselines("", true); err != nil || n != 1 {
		t.Fatalf("accept = %d, %v", n, err)
	}
	if st, _ := os.Stat(quiet); !st.ModTime().Equal(old) {
		t.Fatalf("a page without a change was rewritten (%v)", st.ModTime())
	}
	if st, _ := os.Stat(filepath.Join(dir, "bookmarks-1.json")); st.ModTime().Before(time.Now().Add(-time.Minute)) {
		t.Fatalf("the page with the change was not written")
	}
}

// m7: two PUTs at once cannot both take the last free place under the ceiling.
func TestNetParallelPutsRespectTheCeiling(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"netToolsMaxChecks":1}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example"}`, `{"name":"B","url":"https://b.example"}`)

	var arrived atomic.Int32
	gate := make(chan struct{})
	netPutChecksHook = func() {
		if arrived.Add(1) == 2 {
			close(gate)
		}
		select {
		case <-gate:
		case <-time.After(400 * time.Millisecond):
		}
	}
	t.Cleanup(func() { netPutChecksHook = nil })

	codes := make([]int, 2)
	var wg sync.WaitGroup
	for i, u := range []string{"https://a.example", "https://b.example"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = netPut(t, h, `{"pageId":1,"url":"`+u+`","checks":[{"type":"tcp","port":443,"enabled":true}]}`).Code
		}()
	}
	wg.Wait()
	ok, conflict := 0, 0
	for _, c := range codes {
		switch c {
		case http.StatusOK:
			ok++
		case http.StatusConflict:
			conflict++
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("codes = %v, want one saved and one over the ceiling", codes)
	}
}

// m7: a row inserted before the target while a PUT is between finding its row
// and reading the rest of the install does not make the PUT count the wrong row
// as "elsewhere": A holds the one place under the ceiling, so B's PUT is refused.
func TestNetPutSurvivesAPageChangeMidway(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"netToolsMaxChecks":1}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""), `{"name":"B","url":"https://b.example"}`)

	fired := false
	netPutChecksHook = func() {
		if fired {
			return
		}
		fired = true
		_ = h.store.MutateBookmarksOnPage(1, func(cur []Bookmark) ([]Bookmark, error) {
			return append([]Bookmark{{Name: "New", URL: "https://new.example"}}, cur...), nil
		})
	}
	t.Cleanup(func() { netPutChecksHook = nil })

	rec := netPut(t, h, `{"pageId":1,"url":"https://b.example","checks":[{"type":"ping","enabled":true}]}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("PUT = %d %s, want 409: A holds the only place", rec.Code, rec.Body.String())
	}
	for _, bm := range h.store.GetBookmarksByPage(1) {
		if bm.Name == "A" && (len(bm.Checks) != 1 || bm.Checks[0].ID != netTestCheckID(1)) {
			t.Fatalf("A lost its own check: %#v", bm.Checks)
		}
		if bm.Name == "B" && len(bm.Checks) != 0 {
			t.Fatalf("B was saved over the ceiling: %#v", bm.Checks)
		}
	}
}

// m8: more records than are shown must not make the set differ round to round.
func TestNetDNSDriftUsesTheWholeSet(t *testing.T) {
	var many []DNSRecord
	for i := 0; i < 35; i++ {
		many = append(many, DNSRecord{Value: "10.0.0." + strconv.Itoa(i+1)})
	}
	shown := func(from int) *DNSResult {
		// What a round robin hands out: the same 35 records, another 30 of them shown.
		return &DNSResult{Record: "A", Records: append(append([]DNSRecord{}, many[from:]...), many[:from]...)[:netDNSMaxRecords], full: many}
	}
	c := NetCheck{Type: netTypeDNS, Record: "A", WatchDrift: true}
	first := dnsDriftApply(c, NetResult{OK: true, At: 1, DNS: shown(0)})
	if first.check.Baseline == "" || strings.Count(first.check.Baseline, "\n") != 35 {
		t.Fatalf("the baseline should hold all 35 records: %q", first.check.Baseline)
	}
	again := dnsDriftApply(first.check, NetResult{OK: true, At: 2, DNS: shown(5)})
	if again.changed || again.newDrift {
		t.Fatalf("another slice of the same set was seen as a change: %+v", again)
	}
	// A real change is still seen.
	changed := append([]DNSRecord{}, many[1:]...)
	got := dnsDriftApply(first.check, NetResult{OK: true, At: 3, DNS: &DNSResult{Record: "A", Records: changed[:30], full: changed}})
	if !got.changed {
		t.Fatalf("a removed record was not seen: %+v", got)
	}
}

// m10: a network check keeps fewer raw samples than a monitored URL, so 200
// checks stay near 9 MB; what is dropped is folded into the daily summaries.
func TestNetHistoryCapIsLowerForChecks(t *testing.T) {
	now := time.Now().UTC()
	var samples []HealthSample
	for i := 0; i < maxHealthSamplesPerURL; i++ {
		at := now.Add(-time.Duration(maxHealthSamplesPerURL-i) * time.Minute)
		samples = append(samples, HealthSample{T: at.UnixMilli(), Up: true, PingMs: 20})
	}
	key := netHistoryKey(netTestCheckID(1))
	history := pruneHealthHistory(HealthHistoryFile{Samples: map[string][]HealthSample{key: samples, "u": samples}}, nil, now)
	if got := len(history.Samples[key]); got != maxNetSamplesPerCheck {
		t.Fatalf("a check keeps %d samples, want %d", got, maxNetSamplesPerCheck)
	}
	if got := len(history.Samples["u"]); got != maxHealthSamplesPerURL {
		t.Fatalf("a monitored URL keeps %d samples, want %d", got, maxHealthSamplesPerURL)
	}
	if len(history.Days[key]) == 0 {
		t.Fatal("the dropped samples of the check were not folded into days")
	}
}
