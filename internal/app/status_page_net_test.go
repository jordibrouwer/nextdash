package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Fase 7a: network checks on the public status page. Opt-in per service, no
// internals on the page, and a switched-off or deleted check is simply gone.

const (
	statusNetTCPID  = "aabbccddeeff"
	statusNetPingID = "112233445566"
)

// statusNetSetup stores one bookmark with a TCP and a ping check and writes
// history for both: the TCP check is down with a detail that names the host,
// the ping check is up.
func statusNetSetup(t *testing.T, monitor bool) (*Handlers, time.Time) {
	t.Helper()
	h, store := patchTestHandlers(t)
	fakeStatusContainers(t, nil, nil)
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "Plex", URL: "https://plex.secret-host.lan:32400/web/secret/path", Monitor: monitor, MonitorIntervalMinutes: 5, Checks: []NetCheck{
			{ID: statusNetTCPID, Type: netTypeTCP, Port: 32400, Enabled: true, Host: "10.9.8.7"},
			{ID: statusNetPingID, Type: netTypePing, Enabled: true},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	file := HealthHistoryFile{Samples: map[string][]HealthSample{
		netHistoryKey(statusNetTCPID): {
			{T: now.Add(-10 * time.Minute).UnixMilli(), Up: true, PingMs: 9},
			{T: now.Add(-2 * time.Minute).UnixMilli(), Up: false, Fail: "refused", D: "10.9.8.7:32400 connection refused"},
		},
		netHistoryKey(statusNetPingID): {
			{T: now.Add(-2 * time.Minute).UnixMilli(), Up: true, PingMs: 4, D: "4 of 4 replies from 10.9.8.7"},
		},
	}}
	if monitor {
		file.Samples[canonicalBookmarkURLKey("https://plex.secret-host.lan:32400/web/secret/path")] = []HealthSample{
			{T: now.Add(-2 * time.Minute).UnixMilli(), Up: true, PingMs: 30},
		}
	}
	if err := writeHealthHistoryFile(file); err != nil {
		t.Fatal(err)
	}
	return h, now
}

func statusNetSnapshot(h *Handlers, now time.Time, svc StatusService) statusSnapshot {
	cfg := normalizeStatusPage(StatusPageConfig{Enabled: true, Groups: []StatusGroup{{Name: "Media", Services: []StatusService{svc}}}})
	return h.buildStatusSnapshot(context.Background(), cfg, now)
}

// 1. A check is on the page only when the owner opted it in.
func TestStatusPageNetCheckPart(t *testing.T) {
	h, now := statusNetSetup(t, true)

	// Not listed: the failing TCP check does not exist as far as the page goes.
	snap := statusNetSnapshot(h, now, StatusService{Name: "Plex", MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path"})
	if got := snap.Groups[0].Services[0].State; got != statusOperational {
		t.Fatalf("a check that was not opted in changed the state to %s", got)
	}

	// Listed: the worst part counts (monitor up, TCP down => down).
	snap = statusNetSnapshot(h, now, StatusService{Name: "Plex", MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path", NetChecks: []string{statusNetTCPID}})
	if got := snap.Groups[0].Services[0].State; got != statusDown {
		t.Fatalf("opted-in failing check: state %s, want down", got)
	}
	if !snap.AnyDown || snap.Problems != 1 {
		t.Fatalf("snapshot totals: %+v", snap)
	}

	// Only the healthy one is listed: operational.
	snap = statusNetSnapshot(h, now, StatusService{Name: "Plex", MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path", NetChecks: []string{statusNetPingID}})
	if got := snap.Groups[0].Services[0].State; got != statusOperational {
		t.Fatalf("healthy opted-in check: state %s", got)
	}

	// A bookmark without an HTTP monitor can be on the page for its checks alone.
	h, now = statusNetSetup(t, false)
	snap = statusNetSnapshot(h, now, StatusService{Name: "Plex", MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path", NetChecks: []string{statusNetTCPID}})
	if len(snap.Groups[0].Services) != 1 || snap.Groups[0].Services[0].State != statusDown {
		t.Fatalf("checks-only service: %+v", snap.Groups[0].Services)
	}
	// Without the opt-in the same bookmark is an unmonitored service: unknown.
	snap = statusNetSnapshot(h, now, StatusService{Name: "Plex", MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path"})
	if got := snap.Groups[0].Services[0].State; got != statusUnknown {
		t.Fatalf("no opt-in on an unmonitored bookmark: %s, want unknown", got)
	}
}

// A check can only be shown by a service of its own bookmark.
func TestStatusPageNetCheckOfAnotherBookmarkIsIgnored(t *testing.T) {
	h, now := statusNetSetup(t, true)
	snap := statusNetSnapshot(h, now, StatusService{Name: "Other", MonitorURL: "https://other.example/", NetChecks: []string{statusNetTCPID}})
	if len(snap.Groups[0].Services) != 0 {
		t.Fatalf("a foreign check got a service on the page: %+v", snap.Groups[0].Services)
	}
}

// 2. The public snapshot never carries host, port, path, address, error text
// or the check id.
func TestStatusPageNetCheckNoHostLeak(t *testing.T) {
	h, now := statusNetSetup(t, false)
	for _, svc := range []StatusService{
		{Name: "Plex", MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path", NetChecks: []string{statusNetTCPID, statusNetPingID}},
		// No name at all: the page must not fall back to anything internal.
		{MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path", NetChecks: []string{statusNetTCPID}},
		{NetChecks: []string{statusNetTCPID}},
	} {
		snap := statusNetSnapshot(h, now, svc)
		if len(snap.Groups[0].Services) != 1 {
			t.Fatalf("service %+v missing from the page", svc)
		}
		raw, _ := json.Marshal(snap)
		low := strings.ToLower(string(raw))
		for _, leak := range []string{"secret-host", "10.9.8.7", "32400", "secret/path", "refused", "replies", statusNetTCPID, statusNetPingID, "plex.", "tcp", "ping"} {
			if strings.Contains(low, leak) {
				t.Errorf("snapshot leaks %q: %s", leak, raw)
			}
		}
	}
}

// 3. Switched-off and deleted checks vanish, and so does everything when the
// network checks are switched off.
func TestStatusPageNetCheckVanishes(t *testing.T) {
	h, now := statusNetSetup(t, false)
	svc := StatusService{Name: "Plex", MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path", NetChecks: []string{statusNetTCPID}}
	count := func() int { return len(statusNetSnapshot(h, now, svc).Groups[0].Services) }
	if count() != 1 {
		t.Fatal("setup: the service must be on the page")
	}

	// Switched off.
	bms := h.store.GetBookmarksByPage(1)
	bms[0].Checks[0].Enabled = false
	if err := h.store.SaveBookmarksByPage(1, bms); err != nil {
		t.Fatal(err)
	}
	if count() != 0 {
		t.Error("a disabled check is still on the page")
	}

	// Switched on again, then deleted.
	bms[0].Checks[0].Enabled = true
	_ = h.store.SaveBookmarksByPage(1, bms)
	if count() != 1 {
		t.Fatal("switching it back on must bring it back")
	}
	bms[0].Checks = bms[0].Checks[1:]
	_ = h.store.SaveBookmarksByPage(1, bms)
	if count() != 0 {
		t.Error("a deleted check is still on the page")
	}

	// Network checks off as a whole.
	bms[0].Checks = []NetCheck{{ID: statusNetTCPID, Type: netTypeTCP, Port: 32400, Enabled: true}}
	_ = h.store.SaveBookmarksByPage(1, bms)
	if count() != 1 {
		t.Fatal("setup: back on")
	}
	s := h.store.GetSettings()
	s.NetToolsEnabled = false
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if count() != 0 {
		t.Error("checks are on the page while network checks are switched off")
	}

	// A service that also has an HTTP monitor stays, without the check.
	h2, now2 := statusNetSetup(t, true)
	both := StatusService{Name: "Plex", MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path", NetChecks: []string{statusNetTCPID}}
	bms = h2.store.GetBookmarksByPage(1)
	bms[0].Checks[0].Enabled = false
	_ = h2.store.SaveBookmarksByPage(1, bms)
	svcView := statusNetSnapshot(h2, now2, both).Groups[0].Services
	if len(svcView) != 1 || svcView[0].State != statusOperational {
		t.Fatalf("monitor + disabled check: %+v", svcView)
	}
}

// Day bars come from the check's own samples.
func TestStatusSnapshotNetDays(t *testing.T) {
	h, now := statusNetSetup(t, false)
	day := int64(24 * time.Hour / time.Millisecond)
	yesterday := now.UnixMilli() - day
	file := readHealthHistoryFile()
	file.Samples[netHistoryKey(statusNetTCPID)] = []HealthSample{
		{T: yesterday, Up: true}, {T: yesterday + 60_000, Up: false, Fail: "refused"},
		{T: now.Add(-time.Minute).UnixMilli(), Up: true},
	}
	if err := writeHealthHistoryFile(file); err != nil {
		t.Fatal(err)
	}
	snap := statusNetSnapshot(h, now, StatusService{Name: "Plex", MonitorURL: "https://plex.secret-host.lan:32400/web/secret/path", NetChecks: []string{statusNetTCPID}})
	svc := snap.Groups[0].Services[0]
	if len(svc.Days) != statusDays {
		t.Fatalf("%d bars", len(svc.Days))
	}
	if got := svc.Days[statusDays-2].S; got != statusDegraded {
		t.Errorf("yesterday had a failure: %s, want degraded", got)
	}
	if got := svc.Days[statusDays-1].S; got != statusOperational {
		t.Errorf("today is up: %s", got)
	}
	if svc.Uptime == nil || *svc.Uptime >= 1 {
		t.Errorf("uptime %v should reflect the failure", svc.Uptime)
	}
}

// The owner's save keeps well-formed ids of checks that exist on the service's
// bookmark, and drops the rest; the sources list offers them by label.
func TestStatusPageSaveKeepsOnlyRealChecks(t *testing.T) {
	h, _ := statusNetSetup(t, false)
	body := `{"enabled":true,"groups":[{"name":"G","services":[{"monitorUrl":"https://plex.secret-host.lan:32400/web/secret/path","netChecks":["` +
		statusNetTCPID + `","` + statusNetTCPID + `","ffffffffffff","nope"]},{"monitorUrl":"https://other.example/","netChecks":["` + statusNetPingID + `"]}]}]}`
	rec := statusOwner(t, h, "PUT", "/api/status-page", body, "")
	var out struct {
		Config StatusPageConfig `json:"config"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body.String())
	}
	got := out.Config.Groups[0].Services
	if len(got) != 2 || strings.Join(got[0].NetChecks, ",") != statusNetTCPID || len(got[1].NetChecks) != 0 {
		t.Fatalf("saved: %+v", got)
	}
	if got[0].Name != "Plex" {
		t.Errorf("a checks-only bookmark is named after the bookmark, got %q", got[0].Name)
	}

	rec = statusOwner(t, h, "GET", "/api/status-page/sources", "", "")
	var src struct {
		Monitors []statusMonitorSource `json:"monitors"`
	}
	if json.Unmarshal(rec.Body.Bytes(), &src) != nil || len(src.Monitors) != 1 || src.Monitors[0].Monitor || len(src.Monitors[0].Checks) != 2 {
		t.Fatalf("sources: %s", rec.Body.String())
	}
}
