package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

func netPut(t *testing.T, h *Handlers, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/net/checks", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.PutNetChecks(rec, req)
	return rec
}

func netGet(t *testing.T, h *Handlers, target string, fn func(http.ResponseWriter, *http.Request)) map[string]any {
	t.Helper()
	rec := httptest.NewRecorder()
	fn(rec, httptest.NewRequest(http.MethodGet, target, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s = %d %s", target, rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

func TestNetChecksPutReplacesList(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example"}`)

	rec := netPut(t, h, `{"pageId":1,"url":"https://a.example","checks":[{"type":"tcp","port":443,"enabled":true},{"type":"ping"}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body.String())
	}
	stored := h.store.GetBookmarksByPage(1)[0].Checks
	if len(stored) != 2 {
		t.Fatalf("stored = %#v", stored)
	}
	idRe := regexp.MustCompile(`^[0-9a-f]{12}$`)
	if !idRe.MatchString(stored[0].ID) || !idRe.MatchString(stored[1].ID) || stored[0].ID == stored[1].ID {
		t.Fatalf("the server must set 12-hex IDs: %#v", stored)
	}

	// A second PUT replaces the whole list: the ping goes, the tcp keeps its ID.
	body := `{"pageId":1,"url":"https://a.example","checks":[{"id":"` + stored[0].ID + `","type":"tcp","port":8443,"enabled":true}]}`
	if rec := netPut(t, h, body); rec.Code != http.StatusOK {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body.String())
	}
	after := h.store.GetBookmarksByPage(1)[0].Checks
	if len(after) != 1 || after[0].ID != stored[0].ID || after[0].Port != 8443 {
		t.Fatalf("after = %#v", after)
	}
	// An empty list clears them.
	if rec := netPut(t, h, `{"pageId":1,"url":"https://a.example","checks":[]}`); rec.Code != http.StatusOK {
		t.Fatalf("PUT = %d", rec.Code)
	}
	if got := h.store.GetBookmarksByPage(1)[0].Checks; len(got) != 0 {
		t.Fatalf("checks = %#v", got)
	}
}

func TestNetChecksPutCap(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"netToolsMaxChecks":1}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example"}`)
	rec := netPut(t, h, `{"pageId":1,"url":"https://a.example","checks":[{"type":"tcp","enabled":true},{"type":"ping","enabled":true}]}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("PUT = %d %s, want 409 over the install-wide ceiling", rec.Code, rec.Body.String())
	}
	if got := h.store.GetBookmarksByPage(1)[0].Checks; len(got) != 0 {
		t.Fatalf("a refused PUT stored %#v", got)
	}
	// One enabled check fits.
	if rec := netPut(t, h, `{"pageId":1,"url":"https://a.example","checks":[{"type":"tcp","enabled":true},{"type":"ping"}]}`); rec.Code != http.StatusOK {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body.String())
	}
}

func TestNetChecksPutKeepsServerFields(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir,
		`{"name":"A","url":"https://a.example","checks":[{"id":"`+netTestCheckID(1)+`","type":"tcp","baseline":"A 1.2.3.4","driftDiff":"x","driftAt":99}]}`,
		`{"name":"B","url":"https://b.example","checks":[{"id":"`+netTestCheckID(2)+`","type":"tcp"}]}`,
	)
	// The client cannot set the baseline, and cannot take over B's ID.
	body := `{"pageId":1,"url":"https://a.example","checks":[
		{"id":"` + netTestCheckID(1) + `","type":"tcp","enabled":true,"baseline":"evil","driftDiff":"evil","driftAt":1},
		{"id":"` + netTestCheckID(2) + `","type":"ping"}]}`
	if rec := netPut(t, h, body); rec.Code != http.StatusOK {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body.String())
	}
	got := h.store.GetBookmarksByPage(1)
	var a Bookmark
	for _, b := range got {
		if b.Name == "A" {
			a = b
		}
	}
	if len(a.Checks) != 2 {
		t.Fatalf("checks = %#v", a.Checks)
	}
	if a.Checks[0].Baseline != "A 1.2.3.4" || a.Checks[0].DriftDiff != "x" || a.Checks[0].DriftAt != 99 {
		t.Errorf("server-owned fields were overwritten by the client: %#v", a.Checks[0])
	}
	if a.Checks[1].ID == netTestCheckID(2) {
		t.Errorf("the ID of another bookmark's check was taken over")
	}
}

func TestNetChecksGetState(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir,
		netTestRow("A", "https://a.example", netTestCheckID(1), `,"port":443`),
		netTestRow("B", "https://b.example", netTestCheckID(2), ""),
	)
	now := time.Now()
	if err := h.appendHealthSamples(map[string][]HealthSample{
		netHistoryKey(netTestCheckID(1)): {{T: msAgo(now, time.Minute), Up: true, PingMs: 12, D: "443 open"}, {T: now.UnixMilli(), Up: true, PingMs: 480, D: "slow"}},
		netHistoryKey(netTestCheckID(2)): {{T: now.UnixMilli(), Up: false, Fail: "refused"}},
	}); err != nil {
		t.Fatal(err)
	}

	one := netGet(t, h, "/api/net/checks?pageId=1&url=https://a.example", h.GetNetChecks)
	checks := one["checks"].([]any)
	if len(checks) != 1 {
		t.Fatalf("checks = %#v", checks)
	}
	c := checks[0].(map[string]any)
	state := c["state"].(map[string]any)
	if state["ok"] != true || state["slow"] != true || state["ms"].(float64) != 480 {
		t.Errorf("state = %#v, want the newest sample (slow, up)", state)
	}
	if c["stats"] == nil || c["port"].(float64) != 443 {
		t.Errorf("check = %#v", c)
	}

	all := netGet(t, h, "/api/net/checks", h.GetNetChecks)
	if len(all["items"].([]any)) != 2 {
		t.Fatalf("items = %#v", all["items"])
	}
	counts := all["counts"].(map[string]any)
	if counts["tcp"].(float64) != 2 || counts["scheduled"].(float64) != 2 || counts["down"].(float64) != 1 {
		t.Errorf("counts = %#v", counts)
	}
}

func TestNetHistoryRoute(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, netTestRow("A", "https://a.example", netTestCheckID(1), ""))
	now := time.Now()
	key := netHistoryKey(netTestCheckID(1))
	if err := h.appendHealthSamples(map[string][]HealthSample{key: {
		{T: msAgo(now, 3*24*time.Hour), Up: true},
		{T: msAgo(now, time.Hour), Up: true, PingMs: 9},
	}}); err != nil {
		t.Fatal(err)
	}
	day := netGet(t, h, "/api/net/history?check="+netTestCheckID(1), h.GetNetHistory)
	if n := len(day["samples"].([]any)); n != 1 {
		t.Fatalf("24h samples = %d, want 1", n)
	}
	week := netGet(t, h, "/api/net/history?check="+netTestCheckID(1)+"&range=7d", h.GetNetHistory)
	if n := len(week["samples"].([]any)); n != 2 {
		t.Fatalf("7d samples = %d, want 2", n)
	}
	if week["stats"] == nil {
		t.Errorf("stats missing")
	}
	rec := httptest.NewRecorder()
	h.GetNetHistory(rec, httptest.NewRequest(http.MethodGet, "/api/net/history?check=unknown", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("unknown check = %d", rec.Code)
	}
}

func TestNetMergeDuplicatesKeepsChecks(t *testing.T) {
	mk := func(ids ...int) []NetCheck {
		var out []NetCheck
		for _, i := range ids {
			out = append(out, NetCheck{ID: netTestCheckID(i), Type: netTypeTCP})
		}
		return out
	}
	keeper := Bookmark{Name: "K", URL: "https://x.example", Checks: mk(1, 2, 3, 4)}
	src := []Bookmark{
		{Name: "S1", URL: "https://x.example", Checks: mk(3, 5)},
		{Name: "S2", URL: "https://x.example", Checks: mk(6, 7, 8)},
	}
	mergeBookmarkMetadata(&keeper, src)
	if len(keeper.Checks) != netMaxChecksPerBookmark {
		t.Fatalf("checks = %d, want the cap of %d", len(keeper.Checks), netMaxChecksPerBookmark)
	}
	want := []int{1, 2, 3, 4, 5, 6}
	for i, w := range want {
		if keeper.Checks[i].ID != netTestCheckID(w) {
			t.Fatalf("checks[%d] = %s, want IDs kept and de-duplicated: %#v", i, keeper.Checks[i].ID, keeper.Checks)
		}
	}
}

func TestNetChecksBulkRecoveredAt(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir,
		netTestRow("A", "https://a.example", netTestCheckID(1), ""),
		netTestRow("B", "https://b.example", netTestCheckID(2), ""),
		netTestRow("C", "https://c.example", netTestCheckID(3), ""),
		netTestRow("D", "https://d.example", netTestCheckID(4), ""),
	)
	now := time.Now()
	if err := h.appendHealthSamples(map[string][]HealthSample{
		// Down, then up an hour ago: recovered.
		netHistoryKey(netTestCheckID(1)): {{T: msAgo(now, 2*time.Hour), Up: false, Fail: "refused"}, {T: msAgo(now, time.Hour), Up: true}, {T: now.UnixMilli(), Up: true}},
		// Still down: no recovery.
		netHistoryKey(netTestCheckID(2)): {{T: msAgo(now, time.Hour), Up: false, Fail: "refused"}, {T: now.UnixMilli(), Up: false, Fail: "refused"}},
		// Recovered two days ago: too old.
		netHistoryKey(netTestCheckID(3)): {{T: msAgo(now, 50*time.Hour), Up: false, Fail: "refused"}, {T: msAgo(now, 49*time.Hour), Up: true}, {T: now.UnixMilli(), Up: true}},
		// Never down.
		netHistoryKey(netTestCheckID(4)): {{T: msAgo(now, time.Hour), Up: true}, {T: now.UnixMilli(), Up: true}},
	}); err != nil {
		t.Fatal(err)
	}
	all := netGet(t, h, "/api/net/checks", h.GetNetChecks)
	got := map[string]float64{}
	for _, it := range all["items"].([]any) {
		m := it.(map[string]any)
		v, _ := m["recoveredAt"].(float64)
		got[m["checkId"].(string)] = v
	}
	if got[netTestCheckID(1)] == 0 {
		t.Errorf("a check that recovered an hour ago needs recoveredAt: %#v", got)
	}
	for _, n := range []int{2, 3, 4} {
		if got[netTestCheckID(n)] != 0 {
			t.Errorf("check %d must have no recoveredAt: %#v", n, got)
		}
	}
}
