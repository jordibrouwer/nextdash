package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestMatchGlancesContainersPrefersTheIdThenTheNameThenThePort(t *testing.T) {
	glances := []glancesLinkSide{
		{Name: "renamed-in-glances", ID: "aaaaaaaaaaaa"},
		{Name: "Jellyfin", ID: "bbbbbbbbbbbb"},
		{Name: "stack-app-1", ID: "000000000000"},
		{Name: "web", ID: "000000000000", Ports: []int{8080}},
		{Name: "only-here", ID: "cccccccccccc"},
	}
	docker := []glancesLinkSide{
		{Name: "the-docker-name", ID: "aaaaaaaaaaaa1111111111111111"},
		{Name: "jellyfin", ID: "bbbbbbbbbbbb2222222222222222"},
		{Name: "stack-app-2", ID: "dddddddddddd3333"},
		{Name: "nginx", ID: "eeeeeeeeeeee4444", Ports: []int{8080}},
		{Name: "only-there", ID: "ffffffffffff5555"},
	}
	matches, onlyG, onlyD := matchGlancesContainers(glances, docker)
	got := map[string]string{}
	for _, m := range matches {
		got[m.Glances] = m.Docker + ":" + m.By
	}
	want := map[string]string{
		"renamed-in-glances": "the-docker-name:id",
		"Jellyfin":           "jellyfin:id",
		"stack-app-1":        "stack-app-2:compose",
		"web":                "nginx:port",
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s matched %q, want %q", k, got[k], v)
		}
	}
	if len(onlyG) != 1 || onlyG[0] != "only-here" || len(onlyD) != 1 || onlyD[0] != "only-there" {
		t.Errorf("only: glances %v docker %v", onlyG, onlyD)
	}
	// A scrubbed or empty id never pairs two containers.
	if m, _, _ := matchGlancesContainers([]glancesLinkSide{{Name: "a", ID: "000000000000"}}, []glancesLinkSide{{Name: "b", ID: "000000000000"}}); len(m) != 0 {
		t.Errorf("zero ids matched: %v", m)
	}
}

func TestGlancesHostLabelIgnoresCaseAndDomain(t *testing.T) {
	for _, pair := range [][2]string{{"NAS", "nas.lan"}, {"nas.local", "NAS"}, {" tower ", "Tower.home.arpa"}} {
		if glancesHostLabel(pair[0]) != glancesHostLabel(pair[1]) {
			t.Errorf("%q and %q are one machine", pair[0], pair[1])
		}
	}
	if glancesHostLabel("nas") == glancesHostLabel("tower") {
		t.Error("different machines read as one")
	}
}

// linkSetup gives a Glances host with two containers and a Docker with the same two, under other names for one.
func linkSetup(t *testing.T, dockerName string) (*Handlers, *fakeDocker, *glancesViewFake, GlancesConfig) {
	t.Helper()
	h, fake, cfg := glancesViewSetup(t)
	docker := startFakeDocker(t)
	docker.hostName = dockerName
	docker.add(fakeContainer{ID: "aaaaaaaaaaaa1111111111111111", Name: "app-docker", Image: "x", State: "running", Status: "Up"})
	docker.add(fakeContainer{ID: "bbbbbbbbbbbb2222222222222222", Name: "jellyfin", Image: "y", State: "running", Status: "Up"})
	docker.add(fakeContainer{ID: "cccccccccccc3333333333333333", Name: "idle-one", Image: "z", State: "exited", Status: "Exited"})
	fake.mu.Lock()
	fake.override["containers"] = []byte(`[{"name":"app-glances","id":"aaaaaaaaaaaa","status":"running"},{"name":"jellyfin","id":"bbbbbbbbbbbb","status":"running"},{"name":"glances-only","id":"999999999999","status":"running"}]`)
	fake.mu.Unlock()
	glancesLinkForget()
	return h, docker, fake, cfg
}

func TestGlancesDockerLinkAutoDetectsTheSameMachine(t *testing.T) {
	h, _, _, cfg := linkSetup(t, "NAS.lan") // the fixture's Glances host is "nas"
	answer := h.glancesComputeDockerLink(context.Background(), cfg)
	if !answer.Same || answer.Reason != "same-name" || answer.Mode != "auto" {
		t.Fatalf("detection: %+v", answer)
	}
	if answer.ByID != 2 || len(answer.Matches) != 2 {
		t.Errorf("matches: %+v", answer.Matches)
	}
	if len(answer.OnlyGlances) != 1 || answer.OnlyGlances[0] != "glances-only" || len(answer.OnlyDocker) != 1 || answer.OnlyDocker[0] != "idle-one" {
		t.Errorf("only: glances %v docker %v", answer.OnlyGlances, answer.OnlyDocker)
	}
}

func TestGlancesDockerLinkDifferentMachineHasNoLinks(t *testing.T) {
	h, _, _, cfg := linkSetup(t, "another-box")
	answer := h.glancesComputeDockerLink(context.Background(), cfg)
	if answer.Same || answer.Reason != "different-name" || len(answer.Matches) != 0 {
		t.Fatalf("detection: %+v", answer)
	}
	// Chosen by hand it is the same machine whatever the names say; "no" is never.
	cfg.DockerLink = "yes"
	if a := h.glancesComputeDockerLink(context.Background(), cfg); !a.Same || a.Reason != "chosen" || len(a.Matches) != 2 {
		t.Errorf("yes: %+v", a)
	}
	cfg.DockerLink = "no"
	if a := h.glancesComputeDockerLink(context.Background(), cfg); a.Same || a.Reason != "off" {
		t.Errorf("no: %+v", a)
	}
}

func TestGlancesDockerLinkWithoutADockerSocket(t *testing.T) {
	h, _, cfg := glancesViewSetup(t)
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	cfg.DockerLink = "yes"
	if a := h.glancesComputeDockerLink(context.Background(), cfg); a.Same || a.Reason != "no-docker" {
		t.Errorf("no socket: %+v", a)
	}
}

func TestGlancesDockerLinkSettingIsKept(t *testing.T) {
	for in, want := range map[string]string{"": "auto", "AUTO": "auto", "yes": "yes", " Yes ": "yes", "no": "no", "maybe": "auto"} {
		if got := normalizeGlancesLink(in); got != want {
			t.Errorf("%q became %q, want %q", in, got, want)
		}
	}
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	req := httptest.NewRequest(http.MethodPut, "/api/glances/config", stringsReader(`{"dockerLink":"yes"}`))
	req.Header.Set("X-NextDash-Token", "tok")
	rec := httptest.NewRecorder()
	h.glancesConfigHandler(rec, req)
	if rec.Code != http.StatusOK || loadGlancesConfig().DockerLink != "yes" {
		t.Errorf("save: %d, stored %q", rec.Code, loadGlancesConfig().DockerLink)
	}
}

// The history answer carries when the container restarted, from the Containers view's timeline.
func TestGlancesHistoryCarriesContainerRestarts(t *testing.T) {
	h, _, _, _ := linkSetup(t, "nas")
	now := time.Now().UnixMilli()
	dockerTimelines.add("app-docker", dockerTimelineEntry{At: now - 7200000, Kind: "start"})
	dockerTimelines.add("app-docker", dockerTimelineEntry{At: now - 3600000, Kind: "exit"})
	dockerTimelines.add("app-docker", dockerTimelineEntry{At: now - 3500000, Kind: "start"})
	ask := func(name string) []int64 {
		req := httptest.NewRequest(http.MethodGet, "/api/glances/history?series=cpu&restarts="+name+"&since="+strconv.FormatInt(now-86400000, 10), nil)
		return h.glancesRestartsAsked(req, loadGlancesConfig(), now-86400000)
	}
	// Asked by either name; the first start on record is not a restart.
	for _, name := range []string{"app-glances", "app-docker"} {
		if got := ask(name); len(got) != 1 || got[0] != now-3500000 {
			t.Errorf("%s: %v", name, got)
		}
	}
	// Several names at once: every restart of each, once and in order.
	dockerTimelines.add("other", dockerTimelineEntry{At: now - 5400000, Kind: "start"})
	dockerTimelines.add("other", dockerTimelineEntry{At: now - 5000000, Kind: "exit"})
	dockerTimelines.add("other", dockerTimelineEntry{At: now - 4900000, Kind: "start"})
	if got := ask("other,app-glances,app-docker"); len(got) != 2 || got[0] != now-4900000 || got[1] != now-3500000 {
		t.Errorf("several names: %v", got)
	}
	// Another machine: nothing.
	cfg := loadGlancesConfig()
	cfg.DockerLink = "no"
	if _, err := saveGlancesConfig(cfg, nil); err != nil {
		t.Fatal(err)
	}
	glancesLinkForget()
	if got := ask("app-glances"); len(got) != 0 {
		t.Errorf("restarts for a container on another machine: %v", got)
	}
}

func stringsReader(s string) *strings.Reader { return strings.NewReader(s) }

// Containers Glances has already read are not asked of Docker; the rest are.
func TestStatsSamplerTakesReadyReadingsAndAsksDockerForTheRest(t *testing.T) {
	src := &fakeStatsSource{list: []dockerContainerSummary{{ID: "a", State: "running"}, {ID: "b", State: "running"}}}
	hist := newDockerStatsHistory()
	now := time.Now()
	ready := map[string]dockerStatsPoint{"a": {T: now.UnixMilli(), CPU: 50, Mem: 10}}
	sampleDockerStatsFrom(context.Background(), src, hist, now, ready)
	if len(src.asked) != 1 || src.asked[0] != "b" {
		t.Errorf("Docker was asked for %v, want only b", src.asked)
	}
	if p, ok := hist.latest("a"); !ok || p.CPU != 50 {
		t.Errorf("a: %+v %v", p, ok)
	}
}

// The Docker host's containers read from Glances become stats points: CPU as
// a share of the cores, memory without the page cache; and a host that keeps
// Docker's own readings gives none.
func TestGlancesContainerPointsFromTheDockerHost(t *testing.T) {
	h, _, fake, cfg := linkSetup(t, "NAS.lan")
	fake.mu.Lock()
	fake.override["containers"] = []byte(`[{"name":"app-glances","id":"aaaaaaaaaaaa","status":"running","cpu_percent":60,"cpu_limit":12,"memory_usage":1000,"memory_inactive_file":200,"memory_limit":8000,"network_rx":5,"network_tx":6,"io_rx":7,"io_wx":8},{"name":"jellyfin","id":"bbbbbbbbbbbb","status":"running"}]`)
	fake.mu.Unlock()
	glancesViewForgetAll()
	now := time.Now()
	got := h.glancesContainerPoints(context.Background(), now)
	p, ok := got["aaaaaaaaaaaa1111111111111111"]
	if !ok || len(got) != 1 {
		t.Fatalf("points: %+v", got)
	}
	if p.CPU != 60 || p.cpuShare != 5 || p.Mem != 800 || p.memShare != 10 || p.NetIn != 5 || p.NetOut != 6 || p.DiskRead != 7 || p.DiskWrite != 8 {
		t.Errorf("point: %+v", p)
	}
	cfg.KeepDockerStats = true
	if _, err := saveGlancesConfig(cfg, nil); err != nil {
		t.Fatal(err)
	}
	if got := h.glancesContainerPoints(context.Background(), now); got != nil {
		t.Errorf("a host that keeps Docker's own readings gave %+v", got)
	}
}

// A container that only shares a port with a Glances one is not that container,
// and a host that does not answer gives Docker its turn at once.
func TestGlancesContainerPointsOnlyForTheSameContainer(t *testing.T) {
	h, docker, fake, _ := linkSetup(t, "NAS.lan")
	// "app-glances" pairs with "app-docker" by id in the fixture; add a pair that can only meet by port.
	docker.add(fakeContainer{ID: "dddddddddddd4444444444444444", Name: "nginx", Image: "n", State: "running", Status: "Up", Ports: []map[string]any{{"PublicPort": 443, "PrivatePort": 443, "Type": "tcp"}}})
	fake.mu.Lock()
	fake.override["containers"] = []byte(`[{"name":"caddy","id":"eeeeeeeeeeee","status":"running","cpu_percent":50,"cpu_limit":4,"memory_usage":10,"memory_limit":100,"ports":["0.0.0.0:443->443/tcp"]}]`)
	fake.mu.Unlock()
	glancesLinkForget()
	glancesViewForgetAll()
	byPort := false
	for _, m := range h.glancesDockerLink(context.Background()).Matches {
		byPort = byPort || m.By == "port"
	}
	if !byPort {
		t.Fatal("the fixture no longer pairs the two by port")
	}
	if got := h.glancesContainerPoints(context.Background(), time.Now()); len(got) != 0 {
		t.Errorf("a port-only match took readings: %+v", got)
	}
	// No core count: left to Docker.
	fake.mu.Lock()
	fake.override["containers"] = []byte(`[{"name":"app-glances","id":"aaaaaaaaaaaa","status":"running","cpu_percent":50,"memory_usage":10,"memory_limit":100}]`)
	fake.mu.Unlock()
	glancesViewForgetAll()
	if got := h.glancesContainerPoints(context.Background(), time.Now()); len(got) != 0 {
		t.Errorf("a reading without cores was taken: %+v", got)
	}
	// Glances gone: nothing, and without waiting for it.
	fake.Close()
	glancesViewForgetAll()
	glancesLinkForget()
	start := time.Now()
	if got := h.glancesPointsWithin(context.Background(), time.Now(), 3*time.Second); got != nil || time.Since(start) > 5*time.Second {
		t.Errorf("an unreachable host: %v after %s", got, time.Since(start))
	}
}

// A series that stopped is not a current reading, and "not answering since"
// is when the host last answered.
func TestGlancesHostRowsAreCurrentAndRememberTheLastAnswer(t *testing.T) {
	hs := newGlancesHost("rows")
	now := time.Now().UnixMilli()
	hs.record(now-10*60*1000, map[string]float64{"fs:/usb": 95, "temp:old": 90})
	hs.record(now, map[string]float64{"cpu": 10, "fs:/data": 40})
	cpu, _, disk, mount, temp := hs.lastValues()
	if cpu == nil || disk == nil || *disk != 40 || mount != "/data" || temp != nil {
		t.Errorf("cpu %v disk %v (%s) temp %v", cpu, disk, mount, temp)
	}
	hs.setState(now, true, "ok", "")
	hs.setState(now+5000, false, "unknown", "unreachable")
	hs.state.Lock()
	ok, okAt := hs.state.ok, hs.state.okAt
	hs.state.Unlock()
	if ok || okAt != now {
		t.Errorf("ok %v, last answer %d want %d", ok, okAt, now)
	}
}

// Glances 4 sends a container's ports as one string, not a list. A list that
// cannot be read must never end the whole pairing.
func TestGlancesDockerLinkReadsPortsAsOneString(t *testing.T) {
	h, _, fake, cfg := linkSetup(t, "NAS.lan")
	fake.mu.Lock()
	fake.override["containers"] = []byte(`[` +
		`{"name":"app-glances","id":"aaaaaaaaaaaa","status":"running","ports":"1900->1900/udp,8096->8096/tcp"},` +
		`{"name":"jellyfin","id":"bbbbbbbbbbbb","status":"running","ports":"61208->61208/tcp,61209/tcp"},` +
		`{"name":"glances-only","id":"999999999999","status":"running","ports":""}]`)
	fake.mu.Unlock()
	glancesLinkForget()
	answer := h.glancesComputeDockerLink(context.Background(), cfg)
	if answer.ByID != 2 || len(answer.Matches) != 2 || len(answer.OnlyGlances) != 1 {
		t.Fatalf("string ports ended the pairing: %+v", answer)
	}
}

func TestGlancesPortsOfReadsEveryShape(t *testing.T) {
	cases := map[string][]int{
		`"1900->1900/udp,7359->7359/udp,8096->8096/tcp"`: {1900, 7359, 8096},
		`"61208->61208/tcp,61209/tcp"`:                   {61208},
		`"0.0.0.0:8080->80/tcp"`:                         {8080},
		`""`:                                             nil,
		`["0.0.0.0:8080->80/tcp","443->443/tcp"]`:        {8080, 443},
		`[{"PublicPort":9000},{"host_port":9001}]`:       {9000, 9001},
		`null`:                    nil,
		`{"unexpected":"object"}`: nil,
	}
	for in, want := range cases {
		got := glancesPortsOf([]byte(in))
		if len(got) != len(want) {
			t.Errorf("%s: %v, want %v", in, got, want)
			continue
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("%s: %v, want %v", in, got, want)
			}
		}
	}
}

// A link that pairs nothing says why, so the page can tell the reader instead of showing a bare zero.
func TestGlancesDockerLinkSaysWhyNothingPaired(t *testing.T) {
	h, _, fake, cfg := linkSetup(t, "NAS.lan")
	ask := func() glancesDockerLinkAnswer {
		glancesLinkForget()
		glancesViewForgetAll()
		return h.glancesComputeDockerLink(context.Background(), cfg)
	}
	if a := ask(); a.Problem != "" || a.GlancesCount != 3 || a.DockerCount != 3 {
		t.Errorf("a good pairing has no problem: %+v", a)
	}
	fake.mu.Lock()
	fake.override["containers"] = []byte(`not json`)
	fake.mu.Unlock()
	if a := ask(); a.Problem != "glances-unreadable" {
		t.Errorf("unreadable list: %+v", a)
	}
	fake.mu.Lock()
	fake.override["containers"] = []byte(`[{"name":"x","id":"123456789abc","status":"running"}]`)
	fake.mu.Unlock()
	if a := ask(); a.Problem != "none-matched" || len(a.Matches) != 0 {
		t.Errorf("both sides have containers, none alike: %+v", a)
	}
	fake.mu.Lock()
	fake.override["containers"] = []byte(`[]`)
	fake.mu.Unlock()
	if a := ask(); a.Problem != "" {
		t.Errorf("an empty Glances list is not a failed pairing: %+v", a)
	}
}
