package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// dockerTestHandlers wraps newTestHandlers (auto_backup_test.go), which
// already points NEXTDASH_DATA_DIR at a temp dir -- no need to set it again.
func dockerTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	h := newTestHandlers(t)
	h.wireDockerSettings()
	t.Cleanup(func() { dockerHiddenNames = nil })
	return h
}

func TestDockerContainersRouteListsTheReadModel(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "lscr.io/linuxserver/sonarr:4.0",
		State: "running", Status: "Up 2 hours (unhealthy)",
		Labels: map[string]string{"com.docker.compose.project": "arr", "net.unraid.docker.webui": "http://[IP]:[PORT:8989]/"},
		Ports:  []map[string]any{{"PrivatePort": 8989, "PublicPort": 8989, "Type": "tcp", "IP": "0.0.0.0"}}})
	h := dockerTestHandlers(t)

	rec := httptest.NewRecorder()
	h.DockerContainersHandler(rec, httptest.NewRequest("GET", "/api/docker/containers", nil))
	var body struct {
		Available  bool                  `json:"available"`
		Containers []dockerViewContainer `json:"containers"`
	}
	json.NewDecoder(rec.Body).Decode(&body)
	if !body.Available || len(body.Containers) != 1 {
		t.Fatalf("body = %+v", body)
	}
	c := body.Containers[0]
	if c.Name != "sonarr" || c.Tag != "4.0" || c.Health != "unhealthy" || c.ComposeProject != "arr" {
		t.Fatalf("container = %+v", c)
	}
	if len(c.Ports) != 1 || c.Ports[0].Public != 8989 {
		t.Fatalf("ports = %+v", c.Ports)
	}
	if c.ShortID != strings.Repeat("a", 12) {
		t.Fatalf("shortId = %q", c.ShortID)
	}
}

func TestDockerStatusReportsControl(t *testing.T) {
	startFakeDocker(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
	h := dockerTestHandlers(t)
	rec := httptest.NewRecorder()
	h.DockerStatusHandler(rec, httptest.NewRequest("GET", "/api/docker/status", nil))
	var st map[string]any
	json.NewDecoder(rec.Body).Decode(&st)
	if st["socket"] != true || st["control"] != false {
		t.Fatalf("status = %v", st)
	}
}

func TestResolveDockerIDRejectsJunk(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("d", 64), Name: "web", State: "running"})
	h := dockerTestHandlers(t)
	api, _ := newDockerAPI()
	for _, raw := range []string{"../../info", "web/../x", "", "WEB", "ddd"} {
		if _, err := h.resolveDockerID(context.Background(), api, raw); !errors.Is(err, errDockerNotFound) {
			t.Fatalf("%q resolved; want errDockerNotFound", raw)
		}
	}
	for _, raw := range []string{"web", strings.Repeat("d", 12), strings.Repeat("d", 64)} {
		got, err := h.resolveDockerID(context.Background(), api, raw)
		if err != nil || got.ID != strings.Repeat("d", 64) {
			t.Fatalf("%q -> %+v, %v", raw, got, err)
		}
	}
}

// TestDockerSelfIDFrom is a table test of the pure function: a 12-hex hostname
// is the id Docker gave the container; a non-hex hostname falls back to the
// cgroup line's 64-hex id; neither present means "" (no guard applies).
func TestDockerSelfIDFrom(t *testing.T) {
	hexHost := strings.Repeat("a", 12)
	cgroupLine := "0::/docker/" + strings.Repeat("e", 64) + "\n"

	cases := []struct {
		name     string
		hostname string
		cgroup   string
		want     string
	}{
		{"12-hex hostname wins", hexHost, "", hexHost},
		{"non-hex hostname falls back to cgroup", "not-hex", cgroupLine, strings.Repeat("e", 64)},
		{"neither present", "not-hex", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := dockerSelfIDFrom(tc.hostname, tc.cgroup); got != tc.want {
				t.Fatalf("dockerSelfIDFrom(%q, %q) = %q, want %q", tc.hostname, tc.cgroup, got, tc.want)
			}
		})
	}
}

func TestDockerSelfIDUsesOverrideForTests(t *testing.T) {
	old := dockerSelfOverride
	defer func() { dockerSelfOverride = old }()
	dockerSelfOverride = strings.Repeat("f", 64)
	if got := dockerSelfID(); got != strings.Repeat("f", 64) {
		t.Fatalf("dockerSelfID() = %q, want override", got)
	}
	dockerSelfOverride = ""
	if got := dockerSelfID(); got == strings.Repeat("f", 64) {
		t.Fatalf("dockerSelfID() = %q, override should be cleared", got)
	}
}

// Sanity check that dockerSelfIDFrom never claims a real host's hostname
// unless it truly looks like a Docker-assigned id.
func TestDockerSelfIDFromRealHostname(t *testing.T) {
	host, _ := os.Hostname()
	got := dockerSelfIDFrom(host, "")
	if got != "" && got != host {
		t.Fatalf("self = %q for host %q", got, host)
	}
}

func TestDockerDetailHidesEnvValues(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "img:1", ImageID: "sha256:1", State: "running",
		Env: []string{"PUID=99", "API_KEY=secret"}, RestartPolicy: "unless-stopped",
		Mounts:   []map[string]any{{"Type": "bind", "Source": "/mnt/user/tv", "Destination": "/tv", "RW": false}},
		Networks: map[string]map[string]any{"bridge": {"IPAddress": "172.17.0.5"}}})
	// The tag already points at a newer pull; the container still runs sha256:1.
	f.images["img:1"] = fakeImage{ID: "sha256:2", Labels: map[string]string{
		"org.opencontainers.image.version": "4.0.10", "org.opencontainers.image.source": "https://github.com/linuxserver/docker-sonarr"}}
	f.images["running"] = fakeImage{ID: "sha256:1", Labels: map[string]string{
		"org.opencontainers.image.version": "4.0.9", "org.opencontainers.image.source": "https://github.com/linuxserver/docker-sonarr"}}
	h := dockerTestHandlers(t)
	router := newDockerTestRouter(h)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/sonarr", nil))
	if strings.Contains(rec.Body.String(), "secret") {
		t.Fatal("detail must never carry env values")
	}
	var d dockerViewDetail
	json.NewDecoder(rec.Body).Decode(&d)
	if strings.Join(d.EnvNames, ",") != "API_KEY,PUID" || d.RestartPolicy != "unless-stopped" ||
		d.Version != "4.0.9" || len(d.Mounts) != 1 || !d.Mounts[0].ReadOnly || d.Networks[0].IP != "172.17.0.5" {
		t.Fatalf("detail = %+v", d)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/sonarr/env/API_KEY", nil))
	if !strings.Contains(rec.Body.String(), `"value":"secret"`) || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("env = %s, cache = %q", rec.Body.String(), rec.Header().Get("Cache-Control"))
	}
}

func TestDockerLogsClampTail(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "web", State: "running", Logs: []string{"a", "b"}})
	router := newDockerTestRouter(dockerTestHandlers(t))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/web/logs?tail=99999", nil))
	if !f.called("GET /containers/" + strings.Repeat("b", 64) + "/logs?stdout=1&stderr=1&tail=1000") {
		t.Fatalf("tail must clamp to 1000; calls = %v", f.calls)
	}
}

// The health route hands the drawer what the daemon keeps of the healthcheck:
// newest check first, five at most, each output capped, and the command as a
// person would type it.
func TestDockerHealthChecks(t *testing.T) {
	f := startFakeDocker(t)
	log := []map[string]any{}
	for i := 0; i < 6; i++ {
		out := fmt.Sprintf("check %d", i)
		if i == 5 {
			out = strings.Repeat("x", 5000)
		}
		log = append(log, map[string]any{"Start": fmt.Sprintf("2026-09-29T10:0%d:00Z", i), "End": fmt.Sprintf("2026-09-29T10:0%d:01Z", i),
			"ExitCode": i % 2, "Output": out})
	}
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running",
		Healthcheck: []string{"CMD-SHELL", "curl -f http://localhost/ || exit 1"},
		Health:      map[string]any{"Status": "unhealthy", "FailingStreak": 3, "Log": log}})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "plain", State: "running"})
	router := newDockerTestRouter(dockerTestHandlers(t))

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/web/health", nil))
	var got dockerHealthView
	json.NewDecoder(rec.Body).Decode(&got)
	if rec.Code != 200 || got.Status != "unhealthy" || got.FailingStreak != 3 || got.Command != "curl -f http://localhost/ || exit 1" {
		t.Fatalf("health = %d %+v", rec.Code, got)
	}
	if len(got.Checks) != 5 || got.Checks[0].Start != "2026-09-29T10:05:00Z" || got.Checks[4].Output != "check 1" ||
		got.Checks[0].ExitCode != 1 || len([]rune(got.Checks[0].Output)) != dockerHealthOutputMax {
		t.Fatalf("checks = %+v", got.Checks)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/plain/health", nil))
	got = dockerHealthView{}
	json.NewDecoder(rec.Body).Decode(&got)
	if rec.Code != 200 || got.Status != "" || got.Checks == nil || len(got.Checks) != 0 {
		t.Fatalf("no healthcheck = %d %s", rec.Code, rec.Body)
	}
}

func TestDockerHealthCommand(t *testing.T) {
	for _, tc := range []struct {
		test []string
		want string
	}{
		{[]string{"CMD", "curl", "-f", "http://localhost/"}, "curl -f http://localhost/"},
		{[]string{"CMD-SHELL", "pg_isready"}, "pg_isready"},
		{[]string{"NONE"}, ""},
		{nil, ""},
	} {
		if got := dockerHealthCommand(tc.test); got != tc.want {
			t.Errorf("%v = %q, want %q", tc.test, got, tc.want)
		}
	}
}

// Env values and logs carry secrets: with a write token set, reading them needs
// it, the same as revealing a health credential does.
func TestDockerSecretsNeedWriteToken(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running",
		Env: []string{"API_KEY=secret"}, Logs: []string{"token=abc"}})
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	router := newDockerTestRouter(dockerTestHandlers(t))
	for _, path := range []string{"/api/docker/containers/web/env/API_KEY", "/api/docker/containers/web/logs", "/api/docker/containers/web/health", "/api/docker/containers/web/logs/stream"} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != 401 || strings.Contains(rec.Body.String(), "secret") || strings.Contains(rec.Body.String(), "abc") {
			t.Fatalf("%s: code = %d body = %s", path, rec.Code, rec.Body)
		}
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("X-NextDash-Token", "tok")
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != 200 {
			t.Fatalf("%s with token: code = %d", path, rec.Code)
		}
	}
}

// A daemon that refuses nextDash's API version (Docker Engine 29.0 to 29.2
// took nothing older than 1.44) is spoken to at its own minimum, found once.
func TestDockerSpeaksTheDaemonsMinimumVersionWhenOursIsTooOld(t *testing.T) {
	f := startFakeDocker(t)
	f.minAPI = "1.44"
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", Image: "nginx:alpine", State: "running"})
	rec := httptest.NewRecorder()
	newDockerTestRouter(dockerTestHandlers(t)).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers", nil))
	if !strings.Contains(rec.Body.String(), `"name":"web"`) {
		t.Fatalf("list = %d %s", rec.Code, rec.Body)
	}
	if f.versions["/v1.41"] != 0 || f.versions["/v1.44"] == 0 {
		t.Fatalf("versions used = %v", f.versions)
	}
	if m := readDocker(); !m.Available || m.Total != 1 {
		t.Fatalf("widget read = %+v", m)
	}
}
