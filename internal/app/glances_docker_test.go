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
