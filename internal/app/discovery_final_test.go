package app

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func (r *discoveryRig) getApps() []discoveredApp {
	r.t.Helper()
	var got struct {
		Apps []discoveredApp `json:"apps"`
	}
	rec := r.call("GET", "/api/discovery", nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		r.t.Fatalf("get: %s", rec.Body.String())
	}
	return got.Apps
}

// The browser's host is where links point, not where the server probes: a
// name only the browser resolves must not stop discovery.
func TestDiscoveryProbesOnAReachableHost(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DockerHostAddress = ""; s.DockerHostSeen = "only-the-browser.invalid" })
	p1, _ := htmlPort(t)
	r.containers(fxContainer("sonarr", "id1", p1, r.now.Add(-time.Hour)))
	r.run()
	apps := r.getApps()
	want := fmt.Sprintf("http://only-the-browser.invalid:%d", p1)
	if len(apps) != 1 || apps[0].URL != want {
		t.Fatalf("apps = %+v, want %s", apps, want)
	}
}

// An app carried over from an earlier run follows the host as well.
func TestDiscoveryCarriedAppFollowsHost(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, _ := htmlPort(t)
	r.containers(fxContainer("sonarr", "id1", p1, r.now.Add(-time.Hour)))
	r.run() // probed on 127.0.0.1
	r.setSettings(func(s *Settings) { s.DockerHostAddress = "moved.invalid" })
	r.now = r.now.Add(5 * time.Minute)
	r.run() // not answering there: carried
	apps := r.getApps()
	want := fmt.Sprintf("http://moved.invalid:%d", p1)
	if len(apps) != 1 || apps[0].URL != want {
		t.Fatalf("apps = %+v, want %s", apps, want)
	}
}

// Remove on the ignored list lets the app be noticed anew.
func TestDiscoveryUnignoreLetsItReturn(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.run()
	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id2", p2, old))
	if res := r.run(); len(res.Added) != 1 {
		t.Fatalf("added = %v", res.Added)
	}
	if rec := r.call("POST", "/api/discovery/undo", map[string]string{"name": "radarr"}); rec.Code != 200 {
		t.Fatalf("undo: %d %s", rec.Code, rec.Body.String())
	}
	r.run()
	if rec := r.call("POST", "/api/discovery/unignore", map[string]string{"name": "radarr"}); rec.Code != 200 {
		t.Fatalf("unignore: %d", rec.Code)
	}
	if res := r.run(); len(res.Added) != 1 || res.Added[0] != "radarr" {
		t.Fatalf("after Remove the app is new again: %+v", res)
	}
}
