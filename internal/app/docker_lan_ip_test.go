package app

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// A container on a macvlan or ipvlan network (Unraid's br0) has an address of
// its own on the LAN, and that is where its web UI answers: the list hands it
// over as lanIP. A container on a bridge -- the default one or a compose
// network -- has only an internal address, reached through published ports,
// so it gets none.
func TestLanIPComesFromMacvlanNetworksOnly(t *testing.T) {
	f := startFakeDocker(t)
	f.networks = map[string]string{"br0": "macvlan", "ipv": "ipvlan", "app_default": "bridge", "bridge": "bridge"}
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "plex", State: "running", Status: "Up",
		NetworkMode: "br0", Networks: map[string]map[string]any{"br0": {"IPAddress": "192.168.1.50"}}})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "pihole", State: "running", Status: "Up",
		NetworkMode: "ipv", Networks: map[string]map[string]any{"ipv": {"IPAddress": "192.168.1.51"}}})
	f.add(fakeContainer{ID: strings.Repeat("c", 64), Name: "db", State: "running", Status: "Up",
		NetworkMode: "app_default", Networks: map[string]map[string]any{"app_default": {"IPAddress": "172.18.0.2"}}})
	f.add(fakeContainer{ID: strings.Repeat("d", 64), Name: "sonarr", State: "running", Status: "Up",
		NetworkMode: "bridge", Networks: map[string]map[string]any{"bridge": {"IPAddress": "172.17.0.3"}},
		Ports: []map[string]any{{"PrivatePort": 8989, "PublicPort": 8989, "Type": "tcp"}}})
	f.add(fakeContainer{ID: strings.Repeat("e", 64), Name: "stopped", State: "exited", Status: "Exited",
		NetworkMode: "br0", Networks: map[string]map[string]any{"br0": {"IPAddress": ""}}})
	h := dockerTestHandlers(t)

	rec := httptest.NewRecorder()
	h.DockerContainersHandler(rec, httptest.NewRequest("GET", "/api/docker/containers", nil))
	var body struct {
		Containers []dockerViewContainer `json:"containers"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	got := map[string]string{}
	for _, c := range body.Containers {
		got[c.Name] = c.LanIP
	}
	want := map[string]string{"plex": "192.168.1.50", "pihole": "192.168.1.51", "db": "", "sonarr": "", "stopped": ""}
	for name, ip := range want {
		if got[name] != ip {
			t.Errorf("%s lanIP = %q, want %q", name, got[name], ip)
		}
	}

	// The detail route reads the same.
	rec = httptest.NewRecorder()
	newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/plex", nil))
	var detail map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&detail)
	if detail["lanIP"] != "192.168.1.50" {
		t.Errorf("detail lanIP = %v", detail["lanIP"])
	}
}

// A daemon that will not list its networks costs the link its own address,
// not the list.
func TestLanIPWithoutNetworkListIsEmpty(t *testing.T) {
	f := startFakeDocker(t)
	f.failNetworks = true
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "plex", State: "running", Status: "Up",
		NetworkMode: "br0", Networks: map[string]map[string]any{"br0": {"IPAddress": "192.168.1.50"}}})
	h := dockerTestHandlers(t)
	rec := httptest.NewRecorder()
	h.DockerContainersHandler(rec, httptest.NewRequest("GET", "/api/docker/containers", nil))
	var body struct {
		Available  bool                  `json:"available"`
		Containers []dockerViewContainer `json:"containers"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if !body.Available || len(body.Containers) != 1 || body.Containers[0].LanIP != "" {
		t.Errorf("available=%v containers=%+v", body.Available, body.Containers)
	}
}

// The host address set on Config -> Containers is a bare host: a name or an
// IP, no scheme, port or path. Anything else is dropped rather than stored.
func TestDockerHostAddressIsNormalised(t *testing.T) {
	cases := map[string]string{
		"  192.168.1.10 ":        "192.168.1.10",
		"tower.local":            "tower.local",
		"[fd00::1]":              "[fd00::1]",
		"fd00::1":                "[fd00::1]",
		"http://tower.local":     "",
		"tower.local:8080":       "",
		"tower.local/path":       "",
		"two words":              "",
		"javascript:alert(1)":    "",
		strings.Repeat("a", 300): "",
		"":                       "",
	}
	for in, want := range cases {
		s := Settings{DockerHostAddress: in}
		normalizeDockerSettings(&s)
		if s.DockerHostAddress != want {
			t.Errorf("%q = %q, want %q", in, s.DockerHostAddress, want)
		}
	}
}
