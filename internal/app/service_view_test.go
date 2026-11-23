package app

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// serviceFixture is a store with one page and one monitored bookmark, a day of
// samples with an outage in it, a network check, a watched feed and a running
// container that carries a secret in its env and a healthcheck with output.
func serviceFixture(t *testing.T) (*Handlers, int64) {
	t.Helper()
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "lscr.io/linuxserver/sonarr:4.0",
		State: "running", Status: "Up 2 hours (healthy)", Env: []string{"SECRET=hunter2-env-value", "PLAIN=1"},
		Healthcheck: []string{"CMD-SHELL", "curl -f localhost"},
		Health: map[string]any{"Status": "healthy", "FailingStreak": 0, "Log": []map[string]any{
			{"Start": "2024-01-01T00:00:00Z", "End": "2024-01-01T00:00:01Z", "ExitCode": 0, "Output": "HEALTHCHECK-LOG-OUTPUT"}}},
		Logs:   []string{"LOG-LINE-SECRET"},
		Ports:  []map[string]any{{"PrivatePort": 8989, "PublicPort": 8989, "Type": "tcp", "IP": "0.0.0.0"}},
		Labels: map[string]string{"com.example.secret": "LABEL-SECRET"},
		Mounts: []map[string]any{{"Type": "bind", "Source": "/srv/MOUNT-SECRET", "Destination": "/config", "RW": true}}})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "hidden-one", Image: "x:1", State: "running", Status: "Up 1 hour"})
	h := dockerTestHandlers(t)
	if err := h.store.SavePage(Page{ID: 1, Name: "Servers"}); err != nil {
		t.Fatal(err)
	}
	checkID := "abcdef012345"
	if err := h.store.SaveBookmarksByPage(1, []Bookmark{{
		Name: "Sonarr", URL: "https://sonarr.example.com/", Monitor: true, MonitorIntervalMinutes: 5, Note: "my note",
		Checks: []NetCheck{{ID: checkID, Type: netTypeTCP, Enabled: true, Port: 443}},
	}}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	ms := func(d time.Duration) int64 { return now.Add(d).UnixMilli() }
	hist := emptyHealthHistory()
	key := canonicalBookmarkURLKey("https://sonarr.example.com/")
	hist.Samples[key] = []HealthSample{
		{T: ms(-5 * time.Hour), Up: true, PingMs: 100, Code: 200},
		{T: ms(-4 * time.Hour), Up: false, Code: 502},
		{T: ms(-3 * time.Hour), Up: true, PingMs: 120, Code: 200},
		{T: ms(-1 * time.Hour), Up: true, PingMs: 90, Code: 200},
	}
	hist.Samples[netHistoryKey(checkID)] = []HealthSample{
		{T: ms(-6 * time.Hour), Up: true, PingMs: 5},
		{T: ms(-2 * time.Hour), Up: false, Fail: "refused"},
		{T: ms(-90 * time.Minute), Up: true, PingMs: 6},
	}
	if err := writeHealthHistoryFile(hist); err != nil {
		t.Fatal(err)
	}
	if err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{{
		BookmarkKey: key, FeedURL: "https://github.com/x/releases.atom", Title: "Releases", NewestAt: ms(-30 * time.Minute),
		Items: []FeedItem{{ID: "1", Title: "v4.1.0", PublishedAt: ms(-30 * time.Minute), FoundAt: ms(-29 * time.Minute)}},
	}}}); err != nil {
		t.Fatal(err)
	}
	dockerTimelines = newDockerTimeline()
	t.Cleanup(func() { dockerTimelines = newDockerTimeline() })
	dockerTimelines.add("sonarr", dockerTimelineEntry{At: ms(-7 * time.Hour), Kind: "start"})
	dockerTimelines.add("sonarr", dockerTimelineEntry{At: ms(-45 * time.Minute), Kind: "crash", Detail: "exit code 1"})
	if err := appendDockerUpdateHistory(dockerUpdateHistoryEntry{At: ms(-20 * time.Minute), Kind: "update", Container: "sonarr",
		FromImageID: "sha256:a", ToImageID: "sha256:b", FromVersion: "4.0", ToVersion: "4.1"}); err != nil {
		t.Fatal(err)
	}
	return h, now.UnixMilli()
}

func getService(t *testing.T, h *Handlers, query string) (serviceView, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServiceViewHandler(rec, httptest.NewRequest("GET", "/api/service?"+query, nil))
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q", cc)
	}
	var v serviceView
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return v, rec.Body.String()
}

func serviceQuery(rawURL, container string) string {
	q := url.Values{}
	q.Set("url", rawURL)
	q.Set("page", "1")
	if container != "" {
		q.Set("container", container)
	}
	return q.Encode()
}

func TestServiceViewAggregates(t *testing.T) {
	h, _ := serviceFixture(t)
	v, _ := getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr"))
	if !v.Bookmark.Found || v.Bookmark.Name != "Sonarr" || v.Bookmark.PageName != "Servers" || v.Bookmark.CheckMode != "monitor" {
		t.Fatalf("bookmark = %+v", v.Bookmark)
	}
	if v.Bookmark.Monitor == nil || v.Bookmark.Monitor.TotalChecks != 4 || v.Bookmark.Monitor.LastPingMs != 90 {
		t.Fatalf("monitor = %+v", v.Bookmark.Monitor)
	}
	if len(v.Days) == 0 {
		t.Fatalf("no days")
	}
	if len(v.Checks) != 1 || !v.Checks[0].OK || v.Checks[0].Since == 0 {
		t.Fatalf("checks = %+v", v.Checks)
	}
	if len(v.Watches) != 1 || len(v.Watches[0].Items) != 1 {
		t.Fatalf("watches = %+v", v.Watches)
	}
	if v.Container == nil || v.Container.Name != "sonarr" || v.Container.State != "running" || len(v.Container.Ports) != 1 {
		t.Fatalf("container = %+v", v.Container)
	}
	if v.Container.HealthStatus != "healthy" {
		t.Fatalf("health status = %q", v.Container.HealthStatus)
	}
	if v.Control || v.Self {
		t.Fatalf("control %v self %v", v.Control, v.Self)
	}
}

// An address nobody saved is an empty service, not an error.
func TestServiceViewUnknownURLIsEmpty(t *testing.T) {
	h, _ := serviceFixture(t)
	v, raw := getService(t, h, serviceQuery("https://nothing.example", ""))
	if v.Bookmark.Found || v.Container != nil || len(v.Timeline) != 0 || len(v.Checks) != 0 {
		t.Fatalf("not empty: %s", raw)
	}
	if !strings.Contains(raw, `"timeline":[]`) || !strings.Contains(raw, `"checks":[]`) {
		t.Fatalf("lists must be [] not null: %s", raw)
	}
	// Nothing at all asked for.
	getService(t, h, "")
}

func TestServiceViewTimelineMergesNewestFirst(t *testing.T) {
	h, _ := serviceFixture(t)
	v, _ := getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr"))
	var got []string
	last := int64(1 << 62)
	for _, it := range v.Timeline {
		if it.At > last {
			t.Fatalf("not newest first: %+v", v.Timeline)
		}
		last = it.At
		got = append(got, it.Source+":"+it.Kind)
	}
	order := strings.Join(got, " ")
	for _, need := range []string{"update:update", "release:release", "docker:crash", "check:up", "check:down", "health:up", "health:down", "docker:start"} {
		if !strings.Contains(order, need) {
			t.Fatalf("missing %s in %s", need, order)
		}
	}
	if !strings.HasPrefix(order, "update:update release:release docker:crash check:up check:down health:up health:down") {
		t.Fatalf("order = %s", order)
	}
}

func TestServiceViewTimelineCapped(t *testing.T) {
	h, _ := serviceFixture(t)
	for i := 0; i < 99; i++ {
		dockerTimelines.add("sonarr", dockerTimelineEntry{At: time.Now().Add(-time.Duration(10+i) * time.Second).UnixMilli(), Kind: "start"})
	}
	v, _ := getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr"))
	if len(v.Timeline) != serviceTimelineMax {
		t.Fatalf("timeline has %d items", len(v.Timeline))
	}
}

func TestServiceViewHealthTransitionsFromSamples(t *testing.T) {
	h, _ := serviceFixture(t)
	v, _ := getService(t, h, serviceQuery("https://sonarr.example.com", ""))
	var down, up *serviceTimelineItem
	for i, it := range v.Timeline {
		if it.Source == "health" && it.Kind == "down" {
			down = &v.Timeline[i]
		}
		if it.Source == "health" && it.Kind == "up" {
			up = &v.Timeline[i]
		}
	}
	if down == nil || up == nil || down.Detail != "HTTP 502" || up.At <= down.At {
		t.Fatalf("transitions: %+v", v.Timeline)
	}
	if len(v.Timeline) != 5 { // two web edges, two check edges, one release (no container asked for)
		for _, it := range v.Timeline {
			t.Logf("%+v", it)
		}
		t.Fatalf("got %d items", len(v.Timeline))
	}
}

func TestServiceViewHiddenContainerExcluded(t *testing.T) {
	h, _ := serviceFixture(t)
	s := h.store.GetSettings()
	s.DockerHiddenContainers = []string{"hidden-one"}
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	v, _ := getService(t, h, serviceQuery("https://sonarr.example.com", "hidden-one"))
	if v.Container != nil {
		t.Fatalf("hidden container in the answer: %+v", v.Container)
	}
	v, _ = getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr"))
	if v.Container == nil {
		t.Fatalf("visible container missing")
	}
}

// What a token guards must not be in an answer that needs none: not the env
// (values or names), not a label, a mount, a log line or the healthcheck's
// output.
func TestServiceViewNeverLeaksSecrets(t *testing.T) {
	h, _ := serviceFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	_, raw := getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr"))
	for _, secret := range []string{"hunter2-env-value", "SECRET=", "PLAIN", "HEALTHCHECK-LOG-OUTPUT", "LOG-LINE-SECRET", "LABEL-SECRET", "MOUNT-SECRET", "curl -f"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("response contains %q:\n%s", secret, raw)
		}
	}
}

func TestServiceViewControlAndRemote(t *testing.T) {
	h, _ := serviceFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	v, _ := getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr"))
	if !v.Control {
		t.Fatalf("control should follow the env opt-in")
	}
	dockerSelfOverride = strings.Repeat("a", 12)
	t.Cleanup(func() { dockerSelfOverride = "" })
	v, _ = getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr"))
	if !v.Self {
		t.Fatalf("self not flagged")
	}
	q := serviceQuery("https://sonarr.example.com", "sonarr") + "&host=d_remote"
	v, _ = getService(t, h, q)
	if v.Container != nil || v.TimelinePartial != "local-only" {
		t.Fatalf("remote: %+v", v)
	}
}

// A remote host's container comes from that host's own daemon, and nothing
// nextDash keeps about its own host's containers (timeline, update history,
// restart count, hidden names) is read for it, even when the names collide.
// Data: reading the local sources for a remote container would show another
// machine's history under this one's name.
func TestServiceViewRemoteContainerSkipsLocalSources(t *testing.T) {
	h, _ := serviceFixture(t)
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("c", 64), Name: "sonarr", Image: "ghcr.io/remote/sonarr:9", State: "running",
		Status: "Up 3 minutes", Env: []string{"REMOTE_SECRET=remote-env-value"},
		Health: map[string]any{"Status": "healthy", "Log": []map[string]any{{"Output": "REMOTE-HEALTH-OUTPUT"}}},
		Logs:   []string{"REMOTE-LOG-LINE"},
		Ports:  []map[string]any{{"PrivatePort": 8989, "PublicPort": 18989, "Type": "tcp", "IP": "0.0.0.0"}}})
	host := addRemoteHost(t, addr, true)
	s := h.store.GetSettings()
	s.DockerHiddenContainers = []string{"sonarr"} // this host's setting only
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}

	v, raw := getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr")+"&host="+host.ID)
	if v.Container == nil || v.Container.Image != "ghcr.io/remote/sonarr:9" {
		t.Fatalf("remote container = %+v", v.Container)
	}
	if v.Host != host.ID || v.TimelinePartial != serviceTimelinePart {
		t.Fatalf("host=%q partial=%q", v.Host, v.TimelinePartial)
	}
	if v.Container.Restarts != 0 || v.Self {
		t.Fatalf("local restart count or self leaked: %+v self=%v", v.Container, v.Self)
	}
	for _, it := range v.Timeline {
		if it.Source == serviceSourceDocker || it.Source == serviceSourceUpdate {
			t.Fatalf("a local container source in a remote timeline: %+v", it)
		}
	}
	// The bookmark's own sources (web checks, feeds) still belong to the service.
	if !v.Bookmark.Found || len(v.Checks) != 1 || len(v.Watches) != 1 {
		t.Fatalf("bookmark sections missing: %+v", v.Bookmark)
	}
	for _, secret := range []string{"remote-env-value", "REMOTE_SECRET", "REMOTE-HEALTH-OUTPUT", "REMOTE-LOG-LINE"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("remote response contains %q", secret)
		}
	}
	// The same name with no host is the local container, hidden.
	if v, _ = getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr")); v.Container != nil || v.Host != "" {
		t.Fatalf("local hidden container = %+v host=%q", v.Container, v.Host)
	}
}

func TestServiceViewUnreachableRemoteSaysWhy(t *testing.T) {
	h, _ := serviceFixture(t)
	host := addRemoteHost(t, "127.0.0.1:1", false)
	v, _ := getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr")+"&host="+host.ID)
	if v.Container != nil || v.Docker["available"] != false || v.Docker["reason"] == "" || v.TimelinePartial != serviceTimelinePart {
		t.Fatalf("unreachable remote: container=%+v docker=%v partial=%q", v.Container, v.Docker, v.TimelinePartial)
	}
}

// A maintenance-window sample neither ends nor extends a run, as in deriveIncidents.
func TestCurrentStateSinceSkipsMaintenance(t *testing.T) {
	s := []HealthSample{
		{T: 100, Up: true},
		{T: 200, Up: false},
		{T: 300, Up: false, Maint: true},
		{T: 400, Up: true, Maint: true},
		{T: 500, Up: false},
	}
	if got := currentStateSince(s); got != 200 {
		t.Fatalf("since = %d, want 200 (the maintenance samples must not break or end the run)", got)
	}
	if got := currentStateSince([]HealthSample{{T: 1, Up: true, Maint: true}}); got != 0 {
		t.Fatalf("only maintenance samples: since = %d, want 0", got)
	}
	if got := currentStateSince(nil); got != 0 {
		t.Fatalf("empty: since = %d, want 0", got)
	}
}

// One read of the history file serves the samples and the daily summaries.
func TestReadHealthHistoryAndDaysReturnsBoth(t *testing.T) {
	h := dockerTestHandlers(t)
	hist := emptyHealthHistory()
	hist.Samples["k"] = []HealthSample{{T: 1, Up: true}}
	hist.Days = map[string][]HealthDay{}
	hist.Days["k"] = []HealthDay{{D: 86400000, N: 3, U: 3}}
	if err := writeHealthHistoryFile(hist); err != nil {
		t.Fatal(err)
	}
	before := healthHistoryFileReads.Load()
	samples, days := h.readAllHealthHistoryAndDays()
	if len(samples["k"]) != 1 || len(days["k"]) != 1 {
		t.Fatalf("samples=%v days=%v, want one of each", samples["k"], days["k"])
	}
	if n := healthHistoryFileReads.Load() - before; n != 1 {
		t.Fatalf("history file read %d times for samples and days, want exactly 1", n)
	}
}

// A request for a service parses the history file at most once (the cached health
// report may add none), not once for the samples and again for the days.
func TestServiceViewReadsHistoryFileOnce(t *testing.T) {
	h, _ := serviceFixture(t)
	getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr")) // warm the report cache
	before := healthHistoryFileReads.Load()
	getService(t, h, serviceQuery("https://sonarr.example.com", "sonarr"))
	if n := healthHistoryFileReads.Load() - before; n > 1 {
		t.Fatalf("one /api/service request read the history file %d times, want at most 1", n)
	}
}
