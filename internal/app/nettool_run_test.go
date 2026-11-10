package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNetResultSampleTruncatesDetail(t *testing.T) {
	long := strings.Repeat("é", 300)
	s := NetResult{At: 7, OK: false, Ms: 12, Class: "timeout", Detail: long, Secondary: 25}.sample(true)
	if got := len([]rune(s.D)); got != netDetailMax {
		t.Fatalf("detail is %d runes, want %d", got, netDetailMax)
	}
	if s.T != 7 || s.Up || s.PingMs != 12 || s.Fail != "timeout" || s.L != 25 || !s.Maint {
		t.Fatalf("sample: %+v", s)
	}
	if short := (NetResult{Detail: "443 open"}).sample(false); short.D != "443 open" {
		t.Fatalf("a short detail changed: %q", short.D)
	}
}

func TestRunNetCheckUnbuiltTypeAnswersOther(t *testing.T) {
	h, _ := patchTestHandlers(t)
	// Every kind is built now, so the type that nothing runs is one that does not exist.
	res := h.runNetCheck(context.Background(), Bookmark{URL: "https://a.example/"}, NetCheck{ID: "x", Type: "nothing"})
	if res.OK || res.Class != "other" || res.Error == "" || res.Host != "a.example" || res.CheckID != "x" {
		t.Fatalf("%+v", res)
	}
	bad := h.runNetCheck(context.Background(), Bookmark{URL: "https://a.example/"}, NetCheck{Type: netTypeTCP, Host: "b.example"})
	if bad.OK || bad.Error == "" {
		t.Fatalf("a custom host passed with the setting off: %+v", bad)
	}
}

func TestNetCapabilitiesRoute(t *testing.T) {
	icmpState.Store(icmpUnknown)
	h, store := patchTestHandlers(t)
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "A", URL: "https://a.example/", Checks: []NetCheck{
			{ID: "aaaaaaaaaaaa", Type: netTypeTCP, Enabled: true}, {ID: "bbbbbbbbbbbb", Type: netTypeTCP},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.GetNetCapabilities(rec, httptest.NewRequest(http.MethodGet, "/api/net/capabilities", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["enabled"] != true || got["icmp"] != "unknown" || got["pingMode"] != "auto" ||
		got["allowCustomHost"] != false || got["maxChecks"] != float64(200) || got["scheduled"] != float64(1) {
		t.Fatalf("capabilities: %v", got)
	}
	types, ok := got["typesBuilt"].([]any)
	if !ok || len(types) != 6 || types[0] != "dns" || types[1] != "http" || types[2] != "json" || types[3] != "ping" || types[4] != "tcp" || types[5] != "tls" {
		t.Fatalf("typesBuilt should be [dns http json ping tcp tls], got %#v", got["typesBuilt"])
	}
	icmpState.Store(icmpBlocked)
	t.Cleanup(func() { icmpState.Store(icmpUnknown) })
	rec = httptest.NewRecorder()
	h.GetNetCapabilities(rec, httptest.NewRequest(http.MethodGet, "/api/net/capabilities", nil))
	if !strings.Contains(rec.Body.String(), `"icmp":"blocked"`) {
		t.Fatalf("icmp state not reported: %s", rec.Body.String())
	}
}
