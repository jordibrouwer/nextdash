package app

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// A custom address wins wherever the web UI is read; without one, the
// template's address stands. Both are handed back so the drawer can show the
// default beside the field.
func TestCustomWebUIReplacesTheDefault(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", State: "running", Status: "Up 2 hours",
		Labels: map[string]string{"net.unraid.docker.webui": "http://[IP]:[PORT:8989]/"},
		Ports:  []map[string]any{{"PrivatePort": 8989, "PublicPort": 18989, "Type": "tcp"}}})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "plain", State: "running", Status: "Up 2 hours"})
	h := dockerTestHandlers(t)
	settings := h.store.GetSettings()
	settings.DockerWebUIs = map[string]string{"sonarr": "https://sonarr.home.lan", "plain": "http://[IP]:9000/"}
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	h.DockerContainersHandler(rec, httptest.NewRequest("GET", "/api/docker/containers", nil))
	var body struct {
		Containers []dockerViewContainer `json:"containers"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	byName := map[string]dockerViewContainer{}
	for _, c := range body.Containers {
		byName[c.Name] = c
	}
	s := byName["sonarr"]
	if s.WebUI != "https://sonarr.home.lan" || s.WebUIDefault != "http://[IP]:18989/" || s.WebUICustom != "https://sonarr.home.lan" {
		t.Errorf("sonarr = %q / %q / %q", s.WebUI, s.WebUIDefault, s.WebUICustom)
	}
	// A container with no template can still be given one.
	if p := byName["plain"]; p.WebUI != "http://[IP]:9000/" || p.WebUIDefault != "" {
		t.Errorf("plain = %q / %q", p.WebUI, p.WebUIDefault)
	}

	// The detail route reads the same.
	rec = httptest.NewRecorder()
	newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/sonarr", nil))
	var detail map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&detail)
	if detail["webui"] != "https://sonarr.home.lan" || detail["webuiDefault"] != "http://[IP]:18989/" {
		t.Errorf("detail = %v / %v", detail["webui"], detail["webuiDefault"])
	}

	// Cleared, the default is back.
	settings.DockerWebUIs = nil
	_ = h.store.SaveSettings(settings)
	rec = httptest.NewRecorder()
	h.DockerContainersHandler(rec, httptest.NewRequest("GET", "/api/docker/containers", nil))
	body.Containers = nil
	_ = json.NewDecoder(rec.Body).Decode(&body)
	for _, c := range body.Containers {
		if c.Name == "sonarr" && (c.WebUI != "http://[IP]:18989/" || c.WebUICustom != "") {
			t.Errorf("after clearing = %q / %q", c.WebUI, c.WebUICustom)
		}
	}
}

// Only a web address is kept: a script, a bare word or a monster is dropped
// rather than stored and later opened.
func TestCustomWebUIsAreNormalised(t *testing.T) {
	s := Settings{DockerWebUIs: map[string]string{
		"ok":       "  https://app.lan/path  ",
		"ip":       "http://[IP]:8080",
		"script":   "javascript:alert(1)",
		"bare":     "sonarr",
		"empty":    "",
		"/slashed": "http://x.lan",
		"long":     "https://x.lan/" + strings.Repeat("a", 3000),
	}}
	normalizeDockerSettings(&s)
	want := map[string]string{"ok": "https://app.lan/path", "ip": "http://[IP]:8080", "slashed": "http://x.lan"}
	if len(s.DockerWebUIs) != len(want) {
		t.Fatalf("kept %v", s.DockerWebUIs)
	}
	for k, v := range want {
		if s.DockerWebUIs[k] != v {
			t.Errorf("%s = %q, want %q", k, s.DockerWebUIs[k], v)
		}
	}
}
