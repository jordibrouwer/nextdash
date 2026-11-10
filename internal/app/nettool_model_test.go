package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"
)

// Fase 0a: a bookmark carries its network checks, the server owns them, and
// their history ("net:<id>") survives the sweep for as long as the check does.

func netTestChecks() []NetCheck {
	return []NetCheck{{ID: "aabbccddeeff", Type: netTypeTCP, Port: 443, Enabled: true}}
}

func TestNetChecksSurvivePageSave(t *testing.T) {
	_, store := patchTestHandlers(t)
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "A", URL: "https://a.example/", Checks: netTestChecks()},
	}); err != nil {
		t.Fatal(err)
	}

	// A tab loaded before the check existed sends the row without "checks";
	// another tab sends an empty list; a new row smuggles checks in.
	payload := []Bookmark{
		{Name: "A edited", URL: "https://a.example/"},
		{Name: "New", URL: "https://new.example/", Checks: []NetCheck{{ID: "111111111111", Type: netTypeTCP}}},
	}
	if _, err := store.SaveBookmarksByPageCarrying(1, payload, carryServerOwnedBookmarkFields); err != nil {
		t.Fatal(err)
	}
	got := store.GetBookmarksByPage(1)
	a := findByURL(got, "https://a.example/")
	if a == nil || len(a.Checks) != 1 || a.Checks[0].ID != "aabbccddeeff" {
		t.Fatalf("checks were lost on a page save: %+v", a)
	}
	n := findByURL(got, "https://new.example/")
	if n == nil || len(n.Checks) != 0 {
		t.Fatalf("a new row must not bring checks of its own: %+v", n)
	}

	// An explicit empty list (or other checks) in the payload is ignored too.
	payload = []Bookmark{{Name: "A", URL: "https://a.example/", Checks: []NetCheck{}}}
	if _, err := store.SaveBookmarksByPageCarrying(1, payload, carryServerOwnedBookmarkFields); err != nil {
		t.Fatal(err)
	}
	a = findByURL(store.GetBookmarksByPage(1), "https://a.example/")
	if a == nil || len(a.Checks) != 1 {
		t.Fatalf("an empty payload list wiped the checks: %+v", a)
	}
}

func TestNetChecksNotPatchable(t *testing.T) {
	h, store := patchTestHandlers(t)
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "A", URL: "https://a.example/", Checks: netTestChecks()},
	}); err != nil {
		t.Fatal(err)
	}
	rec := doPatch(t, h, map[string]any{
		"page": 1,
		"updates": []map[string]any{{
			"url": "https://a.example/",
			"fields": map[string]any{
				"checks": []map[string]any{{"id": "ffffffffffff", "type": "ping"}},
				"note":   "touched",
			},
		}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	a := findByURL(store.GetBookmarksByPage(1), "https://a.example/")
	if a == nil {
		t.Fatal("row missing")
	}
	if a.Note != "touched" {
		t.Fatalf("the allowed field was not applied (patch did not run?): note = %q", a.Note)
	}
	if len(a.Checks) != 1 || a.Checks[0].ID != "aabbccddeeff" || a.Checks[0].Type != netTypeTCP {
		t.Fatalf("PATCH changed the checks: %+v", a.Checks)
	}
}

func netHistoryFixture(t *testing.T, now time.Time) {
	t.Helper()
	day := now.Add(-72 * time.Hour).Truncate(24 * time.Hour).UnixMilli()
	file := HealthHistoryFile{
		Samples: map[string][]HealthSample{
			"net:aabbccddeeff": {{T: now.Add(-time.Minute).UnixMilli(), Up: true, PingMs: 12, D: "443 open"}},
			"net:deadbeef0000": {{T: now.Add(-time.Minute).UnixMilli(), Up: true}},
		},
		Days: map[string][]HealthDay{
			"net:aabbccddeeff": {{D: day, N: 10, U: 9}},
			"net:deadbeef0000": {{D: day, N: 10, U: 10}},
		},
	}
	if err := writeHealthHistoryFile(file); err != nil {
		t.Fatal(err)
	}
}

func sweepNow(t *testing.T, h *Handlers) HealthHistoryFile {
	t.Helper()
	_, known, _ := h.dueMonitorTargets(time.Now())
	if err := h.sweepHealthHistory(known); err != nil {
		t.Fatal(err)
	}
	return readHealthHistoryFile()
}

func TestNetHistorySweepKeepsKnownChecks(t *testing.T) {
	h, store := patchTestHandlers(t)
	// Not monitored, and the check itself is switched off: the history stays.
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "A", URL: "https://a.example/", Checks: []NetCheck{{ID: "aabbccddeeff", Type: netTypeTCP, Port: 443}}},
		{Name: "B", URL: "https://b.example/", Monitor: true, Checks: []NetCheck{{ID: "deadbeef0000", Type: netTypePing, Enabled: true}}},
	}); err != nil {
		t.Fatal(err)
	}
	netHistoryFixture(t, time.Now())

	got := sweepNow(t, h)
	for _, key := range []string{"net:aabbccddeeff", "net:deadbeef0000"} {
		if len(got.Samples[key]) != 1 {
			t.Errorf("%s: samples were swept: %+v", key, got.Samples[key])
		}
		if len(got.Days[key]) != 1 {
			t.Errorf("%s: day roll-ups were swept: %+v", key, got.Days[key])
		}
	}
}

func TestNetHistorySweepDropsDeletedChecks(t *testing.T) {
	h, store := patchTestHandlers(t)
	// Only the first check still exists; the second one was deleted.
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "A", URL: "https://a.example/", Checks: []NetCheck{{ID: "aabbccddeeff", Type: netTypeTCP, Port: 443}}},
	}); err != nil {
		t.Fatal(err)
	}
	netHistoryFixture(t, time.Now())

	got := sweepNow(t, h)
	if len(got.Samples["net:aabbccddeeff"]) != 1 || len(got.Days["net:aabbccddeeff"]) != 1 {
		t.Errorf("the surviving check lost its history: %+v / %+v", got.Samples, got.Days)
	}
	if _, ok := got.Samples["net:deadbeef0000"]; ok {
		t.Errorf("samples of a deleted check were kept")
	}
	if _, ok := got.Days["net:deadbeef0000"]; ok {
		t.Errorf("day roll-ups of a deleted check were kept")
	}
}

func TestNetSettingsDefaultOnForOldFile(t *testing.T) {
	// A file written before network tests existed: on, ping auto, ceiling 200.
	h, _ := healthRecheckTestHandlers(t, `{"monitorEmphasis":"always"}`)
	s := h.store.GetSettings()
	if !s.NetToolsEnabled || s.NetToolsPing != "auto" || s.NetToolsMaxChecks != netDefaultMaxChecks || s.NetToolsAllowCustomHost {
		t.Fatalf("old file: %+v", s)
	}

	// An explicit false is stored and read back as false.
	h, _ = healthRecheckTestHandlers(t, `{"netToolsEnabled":false}`)
	if h.store.GetSettings().NetToolsEnabled {
		t.Fatal("netToolsEnabled:false came back as true")
	}

	// Rubbish is pulled back in range.
	h, _ = healthRecheckTestHandlers(t, `{"netToolsEnabled":true,"netToolsPing":"weird","netToolsMaxChecks":5000}`)
	s = h.store.GetSettings()
	if s.NetToolsPing != "auto" || s.NetToolsMaxChecks != 1000 {
		t.Fatalf("normalisation: ping %q max %d", s.NetToolsPing, s.NetToolsMaxChecks)
	}
	h, _ = healthRecheckTestHandlers(t, `{"netToolsPing":"tcp-only","netToolsMaxChecks":0}`)
	s = h.store.GetSettings()
	if s.NetToolsPing != "tcp-only" || s.NetToolsMaxChecks != netDefaultMaxChecks {
		t.Fatalf("normalisation: ping %q max %d", s.NetToolsPing, s.NetToolsMaxChecks)
	}
}

func TestNetKeysSkippedInDigestAndExport(t *testing.T) {
	now := digestNow
	week := now.Add(-2 * 24 * time.Hour).UnixMilli()
	plain := map[string][]HealthSample{"https://wiki": {{T: week, Up: true}, {T: week + 1, Up: false}}}
	input := func(samples map[string][]HealthSample) digestInput {
		return digestInput{Now: now, Settings: allOn(), Samples: samples}
	}
	base, _ := json.Marshal(buildDigest(input(plain)))

	withNet := map[string][]HealthSample{
		"https://wiki":     plain["https://wiki"],
		"net:aabbccddeeff": {{T: week, Up: false, Alerted: true}, {T: week + 1, Up: false}, {T: week + 2, Up: false}},
	}
	got, _ := json.Marshal(buildDigest(input(withNet)))
	if string(got) != string(base) {
		t.Fatalf("a net: history key changed the digest:\nbase %s\ngot  %s", base, got)
	}

	// The CSV export: one name-less "net:" row would otherwise appear.
	ms := strconv.FormatInt(time.Now().UnixMilli(), 10)
	history := `{"generatedAt":0,"samples":{
		"https://alpha.example":[{"t":` + ms + `,"u":true,"p":10,"c":200}],
		"net:aabbccddeeff":[{"t":` + ms + `,"u":true,"p":10,"d":"443 open"}]
	}}`
	eh := newExportFixture(t, exportPageJSON, history)
	rec, records := exportCSV(t, eh, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("export: %d", rec.Code)
	}
	if len(records) != 2 { // header + the one URL sample
		t.Fatalf("export rows = %d, want 2: %v", len(records), records)
	}
	for _, row := range records {
		for _, cell := range row {
			if isNetHistoryKey(cell) {
				t.Fatalf("a net: key reached the CSV: %v", row)
			}
		}
	}
}
