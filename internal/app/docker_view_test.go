package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// dockerTestHandlers wraps newTestHandlers (auto_backup_test.go), which
// already points NEXTDASH_DATA_DIR at a temp dir -- no need to set it again.
func dockerTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	return newTestHandlers(t)
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

// Env values and logs carry secrets: with a write token set, reading them needs
// it, the same as revealing a health credential does.
func TestDockerSecretsNeedWriteToken(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running",
		Env: []string{"API_KEY=secret"}, Logs: []string{"token=abc"}})
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	router := newDockerTestRouter(dockerTestHandlers(t))
	for _, path := range []string{"/api/docker/containers/web/env/API_KEY", "/api/docker/containers/web/logs"} {
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
