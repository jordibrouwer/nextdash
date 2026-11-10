package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Fase 6: the dashboard's check badges (a setting) and the Network tests widget
// (a type, a config and a route that reads history and nothing else).

func TestNetBadgesSettingNormalized(t *testing.T) {
	// A file written before the setting existed: problems only.
	h, _ := healthRecheckTestHandlers(t, `{"monitorEmphasis":"always"}`)
	if got := h.store.GetSettings().NetToolsDashboardBadges; got != "problems" {
		t.Fatalf("old file: %q, want problems", got)
	}
	for _, want := range []string{"always", "never", "problems"} {
		h, _ = healthRecheckTestHandlers(t, `{"netToolsDashboardBadges":"`+want+`"}`)
		if got := h.store.GetSettings().NetToolsDashboardBadges; got != want {
			t.Errorf("%s came back as %q", want, got)
		}
	}
	// Rubbish and an empty string are pulled back to the default.
	for _, raw := range []string{`"loud"`, `""`, `"ALWAYS"`, `7`} {
		h, _ = healthRecheckTestHandlers(t, `{"netToolsDashboardBadges":`+raw+`}`)
		got := h.store.GetSettings().NetToolsDashboardBadges
		if raw == `7` {
			// Not a string at all: the file is read with the defaults.
			if got != "problems" {
				t.Errorf("%s came back as %q", raw, got)
			}
			continue
		}
		if got != "problems" {
			t.Errorf("%s came back as %q, want problems", raw, got)
		}
	}
}

func netDashboardGet(t *testing.T, h *Handlers, query string) (map[string]any, []map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.GetNetDashboard(rec, httptest.NewRequest(http.MethodGet, "/api/net/dashboard"+query, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	for _, raw := range body["items"].([]any) {
		rows = append(rows, raw.(map[string]any))
	}
	return body, rows
}

func TestNetDashboardRouteNoNetwork(t *testing.T) {
	h, store := patchTestHandlers(t)
	// Whatever would run a check is wired to fail the test: the route reads
	// history and bookmark lists only.
	h.netRunner = func(context.Context, Bookmark, NetCheck) NetResult {
		t.Error("the dashboard route ran a check")
		return NetResult{}
	}
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "A", URL: "https://a.example/", Checks: []NetCheck{
			{ID: "aabbccddeeff", Type: netTypeTCP, Port: 443, Enabled: true},
			{ID: "deadbeef0000", Type: netTypePing, Enabled: true},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	file := HealthHistoryFile{Samples: map[string][]HealthSample{
		"net:aabbccddeeff": {
			{T: now.Add(-2 * time.Hour).UnixMilli(), Up: true, PingMs: 20, D: "443 open"},
			{T: now.Add(-time.Minute).UnixMilli(), Up: true, PingMs: 23, D: "443 open"},
		},
		"net:deadbeef0000": {
			{T: now.Add(-2 * time.Hour).UnixMilli(), Up: true, PingMs: 14},
			{T: now.Add(-time.Minute).UnixMilli(), Up: false, Fail: "timeout", D: "loss 100%", L: 100},
		},
	}}
	if err := writeHealthHistoryFile(file); err != nil {
		t.Fatal(err)
	}

	// In the order asked, with the newest state, the name and a strip.
	body, rows := netDashboardGet(t, h, "?checks=deadbeef0000,aabbccddeeff")
	if len(rows) != 2 || rows[0]["checkId"] != "deadbeef0000" || rows[1]["checkId"] != "aabbccddeeff" {
		t.Fatalf("rows: %+v", rows)
	}
	if rows[0]["name"] != "A" || rows[0]["label"] != "Ping" {
		t.Errorf("row: %+v", rows[0])
	}
	if st := rows[0]["state"].(map[string]any); st["ok"] != false || st["class"] != "timeout" {
		t.Errorf("state: %+v", st)
	}
	if beat, _ := rows[1]["beat"].([]any); len(beat) != netWidgetBeatSlices {
		t.Errorf("beat of %d slices, want %d", len(beat), netWidgetBeatSlices)
	}
	counts := body["counts"].(map[string]any)
	if counts["down"] != float64(1) || counts["total"] != float64(2) {
		t.Errorf("counts: %+v", counts)
	}
}

func TestNetDashboardAsksOnlyForWhatItIsGiven(t *testing.T) {
	h, store := patchTestHandlers(t)
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "A", URL: "https://a.example/", Checks: []NetCheck{{ID: "aabbccddeeff", Type: netTypeTCP, Enabled: true}}},
	}); err != nil {
		t.Fatal(err)
	}

	// An id nothing has any more is "gone"; junk, repeats and uppercase are cleaned.
	_, rows := netDashboardGet(t, h, "?checks=aabbccddeeff,AABBCCDDEEFF,nothex,ffffffffffff,,aabbccddeeff")
	if len(rows) != 2 || rows[0]["checkId"] != "aabbccddeeff" {
		t.Fatalf("rows: %+v", rows)
	}
	if rows[1]["checkId"] != "ffffffffffff" || rows[1]["gone"] != true {
		t.Errorf("a removed check must say so, not fail: %+v", rows[1])
	}

	// At most netWidgetMaxChecks ids are read.
	var ids []string
	for i := 0; i < netWidgetMaxChecks+10; i++ {
		ids = append(ids, "0000000000"+string("0123456789abcdef"[i/16])+string("0123456789abcdef"[i%16]))
	}
	if _, rows = netDashboardGet(t, h, "?checks="+strings.Join(ids, ",")); len(rows) != netWidgetMaxChecks {
		t.Errorf("%d rows, want the cap of %d", len(rows), netWidgetMaxChecks)
	}

	// Switched off: no rows, and it says why.
	s := store.GetSettings()
	s.NetToolsEnabled = false
	if err := store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	body, rows := netDashboardGet(t, h, "?checks=aabbccddeeff")
	if body["enabled"] != false || len(rows) != 0 {
		t.Errorf("off: %+v", body)
	}
}

func TestNetWidgetConfigSpec(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeNetTests, map[string]any{
		"checks":   []any{"AABBCCDDEEFF", "aabbccddeeff", "not-an-id", 7, "deadbeef0000"},
		"look":     "heartbeat",
		"sort":     "name",
		"rows":     500,
		"ttl":      5,
		"smuggled": "value",
	})
	if got, _ := clean["checks"].([]string); strings.Join(got, ",") != "aabbccddeeff,deadbeef0000" {
		t.Errorf("checks: %#v", clean["checks"])
	}
	if clean["look"] != "heartbeat" || clean["sort"] != "name" {
		t.Errorf("look/sort: %v / %v", clean["look"], clean["sort"])
	}
	if clean["rows"] != widgetMaxRows || clean["ttl"] != 30 {
		t.Errorf("rows/ttl not brought into range: %v / %v", clean["rows"], clean["ttl"])
	}
	if _, ok := clean["smuggled"]; ok {
		t.Error("an undeclared key reached the stored widget")
	}
	// A look this version does not know falls back to the default, not an error.
	clean = sanitizeWidgetConfig(WidgetTypeNetTests, map[string]any{"look": "carousel", "sort": "random"})
	if _, ok := clean["look"]; ok {
		t.Errorf("look: %v", clean["look"])
	}
	if _, ok := clean["sort"]; ok {
		t.Errorf("sort: %v", clean["sort"])
	}

	// The list is cut at the cap, and read back from what the store holds ([]string),
	// which is how a drag that reorders the page hands it over again.
	var many []any
	for i := 0; i < netWidgetMaxChecks+5; i++ {
		many = append(many, "00000000"+string("0123456789abcdef"[i/256%16])+string("0123456789abcdef"[i/16%16])+string("0123456789abcdef"[i%16])+"0")
	}
	clean = sanitizeWidgetConfig(WidgetTypeNetTests, map[string]any{"checks": many})
	stored, _ := clean["checks"].([]string)
	if len(stored) != netWidgetMaxChecks {
		t.Fatalf("%d checks kept, want the cap of %d", len(stored), netWidgetMaxChecks)
	}
	again := sanitizeWidgetConfig(WidgetTypeNetTests, map[string]any{"checks": stored})
	if got, _ := again["checks"].([]string); len(got) != netWidgetMaxChecks {
		t.Errorf("a stored list read back as %d checks", len(got))
	}

	// Through the whole path a client takes.
	widget, err := normalizeWidget(Widget{Type: WidgetTypeNetTests, Config: map[string]any{"look": "tiles"}})
	if err != nil || widget.Config["look"] != "tiles" {
		t.Fatalf("normalizeWidget: %v %v", widget.Config, err)
	}
}

func TestWidgetTypeNamesListsNetTests(t *testing.T) {
	if _, ok := knownWidgetTypes[WidgetTypeNetTests]; !ok {
		t.Fatal("nettests is not registered")
	}
	if !strings.Contains(","+strings.Join(widgetTypeNames(), ",")+",", ",nettests,") {
		t.Error("widgetTypeNames() does not offer nettests")
	}
}

// A page exported as a template names no check of this install.
func TestNetWidgetChecksStayOutOfTemplates(t *testing.T) {
	page := PageWithBookmarks{
		Page: Page{ID: 1, Name: "Net"},
		Widgets: []Widget{{ID: "w_1", Type: WidgetTypeNetTests,
			Config: map[string]any{"checks": []string{"aabbccddeeff"}, "look": "rows"}}},
	}
	tpl := buildPageTemplate(page, TemplateExportOptions{}, "")
	if len(tpl.Widgets) != 1 {
		t.Fatalf("%d widgets exported", len(tpl.Widgets))
	}
	out := tpl.Widgets[0].Config
	if _, ok := out["checks"]; ok {
		t.Errorf("a check id left in an exported template: %v", out)
	}
	if out["look"] != "rows" {
		t.Errorf("the look was lost: %v", out)
	}
}
