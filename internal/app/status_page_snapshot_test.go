package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func seedMonitoredBookmark(t *testing.T, h *Handlers, url, name string) {
	t.Helper()
	pages := h.store.GetPages()
	if len(pages) == 0 {
		t.Fatal("store has no page")
	}
	if err := h.store.AddBookmarkToPage(pages[0].ID, Bookmark{Name: name, URL: url, Monitor: true, MonitorIntervalMinutes: 5}); err != nil {
		t.Fatal(err)
	}
}

func seedSamples(t *testing.T, url string, samples []HealthSample) {
	t.Helper()
	hist := readHealthHistoryFile()
	if hist.Samples == nil {
		hist.Samples = map[string][]HealthSample{}
	}
	hist.Samples[canonicalBookmarkURLKey(url)] = samples
	if err := writeHealthHistoryFile(hist); err != nil {
		t.Fatal(err)
	}
}

func fakeStatusContainers(t *testing.T, list []dockerContainerSummary, err error) *int {
	t.Helper()
	calls := 0
	old := statusListContainers
	statusListContainers = func(context.Context) ([]dockerContainerSummary, error) { calls++; return list, err }
	resetStatusContainerCache()
	t.Cleanup(func() { statusListContainers = old; resetStatusContainerCache() })
	return &calls
}

func TestStatusSnapshotCombinesAndHidesInternals(t *testing.T) {
	h := newTestHandlers(t)
	now := time.Now()
	seedMonitoredBookmark(t, h, "https://jellyfin.home.lan", "Jellyfin")
	seedSamples(t, "https://jellyfin.home.lan", []HealthSample{{T: now.Add(-2 * time.Minute).UnixMilli(), Up: true, PingMs: 64}})
	fakeStatusContainers(t, []dockerContainerSummary{{Names: []string{"/jellyfin"}, Image: "lscr.io/linuxserver/jellyfin", State: "running", Status: "Up 1 hour (unhealthy)"}}, nil)

	cfg := normalizeStatusPage(StatusPageConfig{Enabled: true, Title: "Home", Groups: []StatusGroup{{Name: "Media", Services: []StatusService{
		{Name: "Films", MonitorURL: "https://jellyfin.home.lan", Container: "jellyfin"},
	}}}})
	snap := h.buildStatusSnapshot(context.Background(), cfg, now)
	svc := snap.Groups[0].Services[0]
	if svc.State != statusDegraded || snap.Problems != 1 || snap.AnyDown {
		t.Fatalf("worse of monitor (up) and container (unhealthy) must count: %+v", svc)
	}
	raw, _ := json.Marshal(snap)
	for _, leak := range []string{"home.lan", "linuxserver", "jellyfin"} {
		if strings.Contains(strings.ToLower(string(raw)), leak) {
			t.Errorf("snapshot leaks %q with ShowLink off: %s", leak, raw)
		}
	}
	if svc.Ms != 0 || svc.Spark != nil {
		t.Error("response time shown without ShowSpeed")
	}
}

func TestStatusSnapshotNeverUsesTheAddressAsAName(t *testing.T) {
	h := newTestHandlers(t)
	fakeStatusContainers(t, nil, nil)
	// No bookmark to take a name from: the name falls back to the address.
	cfg := normalizeStatusPage(StatusPageConfig{Groups: []StatusGroup{{Name: "G", Services: []StatusService{
		{MonitorURL: "https://nas.home.lan"},
	}}}})
	raw, _ := json.Marshal(h.buildStatusSnapshot(context.Background(), cfg, time.Now()))
	if strings.Contains(string(raw), "home.lan") {
		t.Fatalf("internal address on the page with Link off: %s", raw)
	}
}

func TestStatusSnapshotShowsLinkAndSpeedWhenAsked(t *testing.T) {
	h := newTestHandlers(t)
	now := time.Now()
	seedMonitoredBookmark(t, h, "https://photos.home.lan", "Photos")
	seedSamples(t, "https://photos.home.lan", []HealthSample{
		{T: now.Add(-7 * time.Minute).UnixMilli(), Up: true, PingMs: 150},
		{T: now.Add(-2 * time.Minute).UnixMilli(), Up: true, PingMs: 143},
	})
	fakeStatusContainers(t, nil, nil)
	cfg := normalizeStatusPage(StatusPageConfig{Groups: []StatusGroup{{Name: "Home", Services: []StatusService{
		{Name: "Photos", MonitorURL: "https://photos.home.lan", ShowLink: true, ShowSpeed: true},
	}}}})
	svc := h.buildStatusSnapshot(context.Background(), cfg, now).Groups[0].Services[0]
	if svc.URL != "https://photos.home.lan" || svc.Ms != 143 || len(svc.Spark) != 2 || svc.Uptime == nil {
		t.Fatalf("link/speed/uptime missing: %+v", svc)
	}
}

func TestStatusSnapshotDockerUnreachable(t *testing.T) {
	h := newTestHandlers(t)
	fakeStatusContainers(t, nil, errors.New("dial unix: no such file"))
	cfg := normalizeStatusPage(StatusPageConfig{Groups: []StatusGroup{{Name: "G", Services: []StatusService{{Container: "pihole"}}}}})
	svc := h.buildStatusSnapshot(context.Background(), cfg, time.Now()).Groups[0].Services[0]
	if svc.State != statusUnknown {
		t.Fatalf("container-only service with Docker down is unknown, got %s", svc.State)
	}
}

func TestStatusContainerCacheIsShared(t *testing.T) {
	calls := fakeStatusContainers(t, []dockerContainerSummary{{Names: []string{"/a"}, State: "running"}}, nil)
	now := time.Now()
	for i := 0; i < 5; i++ {
		statusContainers(context.Background(), now.Add(time.Duration(i)*time.Second))
	}
	if *calls != 1 {
		t.Fatalf("Docker asked %d times within 30 s, want 1", *calls)
	}
	statusContainers(context.Background(), now.Add(31*time.Second))
	if *calls != 2 {
		t.Fatalf("cache not refreshed after 30 s: %d calls", *calls)
	}
}

func TestStatusSnapshotMaintenanceReplacesDown(t *testing.T) {
	h := newTestHandlers(t)
	fakeStatusContainers(t, []dockerContainerSummary{{Names: []string{"/nas"}, State: "exited"}}, nil)
	cfg := normalizeStatusPage(StatusPageConfig{Groups: []StatusGroup{
		{ID: "home", Name: "Home", Services: []StatusService{{Container: "nas"}}},
	}})
	now := time.Now().In(time.Local)
	settings := h.store.GetSettings()
	settings.MaintenanceWindows = []MaintenanceWindow{{
		Start: now.Add(-10 * time.Minute).Format("15:04"), End: now.Add(50 * time.Minute).Format("15:04"),
		Label: "Backups", StatusGroups: []string{"home", "gone"},
	}}
	settings.MaintenanceTimeZone = ""
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	snap := h.buildStatusSnapshot(context.Background(), cfg, now)
	if got := snap.Groups[0].Services[0].State; got != statusMaintenance {
		t.Fatalf("down inside a linked window = %s, want maintenance", got)
	}
	if snap.Problems != 0 || len(snap.Maintenance) != 1 || !snap.Maintenance[0].Active || len(snap.Maintenance[0].Groups) != 1 || snap.Maintenance[0].Groups[0] != "Home" {
		t.Fatalf("maintenance listing wrong: %+v", snap.Maintenance)
	}
}

// The event log only knows days with an event; a container Docker lists now
// was up on its quiet days since it was created.
func TestStatusSnapshotQuietContainerDaysAreOperational(t *testing.T) {
	h := newTestHandlers(t)
	now := time.Now()
	fakeStatusContainers(t, []dockerContainerSummary{
		{Names: []string{"/status-quiet-old"}, State: "running", Created: now.Add(-40 * 24 * time.Hour).Unix()},
		{Names: []string{"/status-quiet-new"}, State: "running", Created: now.Add(-3 * 24 * time.Hour).Unix()},
	}, nil)
	cfg := normalizeStatusPage(StatusPageConfig{Groups: []StatusGroup{{Name: "G", Services: []StatusService{
		{Name: "Old", Container: "status-quiet-old"},
		{Name: "New", Container: "status-quiet-new"},
	}}}})
	svcs := h.buildStatusSnapshot(context.Background(), cfg, now).Groups[0].Services
	for i, b := range svcs[0].Days {
		if b.S != statusOperational {
			t.Fatalf("old container day %d = %s, want operational", i, b.S)
		}
	}
	for i, b := range svcs[1].Days {
		want := statusUnknown
		if i >= statusDays-4 {
			want = statusOperational
		}
		if b.S != want {
			t.Fatalf("new container day %d = %s, want %s", i, b.S, want)
		}
	}
}

func TestStatusSnapshotUptimeCountsTheContainerToo(t *testing.T) {
	h := newTestHandlers(t)
	now := time.Now()
	seedMonitoredBookmark(t, h, "https://cached.home.lan", "Cached")
	seedSamples(t, "https://cached.home.lan", []HealthSample{{T: now.Add(-2 * time.Minute).UnixMilli(), Up: true, PingMs: 20}})
	name := "status-uptime-combined"
	dockerTimelines.add(name, dockerTimelineEntry{At: now.Add(-3 * 24 * time.Hour).UnixMilli(), Kind: "crash"})
	dockerTimelines.add(name, dockerTimelineEntry{At: now.Add(-3*24*time.Hour + time.Hour).UnixMilli(), Kind: "start"})
	fakeStatusContainers(t, []dockerContainerSummary{
		{Names: []string{"/" + name}, State: "running", Created: now.Add(-40 * 24 * time.Hour).Unix()},
	}, nil)
	cfg := normalizeStatusPage(StatusPageConfig{Groups: []StatusGroup{{Name: "G", Services: []StatusService{
		{Name: "Cached", MonitorURL: "https://cached.home.lan", Container: name},
	}}}})
	svc := h.buildStatusSnapshot(context.Background(), cfg, now).Groups[0].Services[0]
	if svc.Uptime == nil || *svc.Uptime >= 1 {
		t.Fatalf("a red container day must lower the percentage, got %v", svc.Uptime)
	}
}

func TestStatusSnapshotStoppedContainerStaysDown(t *testing.T) {
	h := newTestHandlers(t)
	now := time.Now()
	name := "status-stopped-five-days"
	dockerTimelines.add(name, dockerTimelineEntry{At: now.Add(-5 * 24 * time.Hour).UnixMilli(), Kind: "exit"})
	fakeStatusContainers(t, []dockerContainerSummary{
		{Names: []string{"/" + name}, State: "exited", Created: now.Add(-40 * 24 * time.Hour).Unix()},
	}, nil)
	cfg := normalizeStatusPage(StatusPageConfig{Groups: []StatusGroup{{Name: "G", Services: []StatusService{{Container: name}}}}})
	days := h.buildStatusSnapshot(context.Background(), cfg, now).Groups[0].Services[0].Days
	for i, b := range days {
		want := statusOperational
		if i >= statusDays-6 {
			want = statusDown
		}
		if b.S != want {
			t.Fatalf("day %d = %s, want %s: a stopped container must not turn green on quiet days", i, b.S, want)
		}
	}
}
