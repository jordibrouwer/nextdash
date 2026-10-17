package app

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

// A container recreated by an update is not new, also when it is still
// booting the first time it is probed under its new id.
func TestDiscoveryBootingRecreateIsNotNew(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	p1, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.run() // first run: sonarr is an app

	// Put on a page through a bookmark, which is later deleted again.
	url := fmt.Sprintf("http://127.0.0.1:%d", p1)
	if err := r.h.store.AddBookmarkToPage(1, Bookmark{Name: "sonarr", URL: url}); err != nil {
		t.Fatal(err)
	}
	r.run()
	if err := r.h.store.DeleteBookmarkFromPage(1, Bookmark{Name: "sonarr", URL: url}); err != nil {
		t.Fatal(err)
	}

	// Recreated with a new id, and not answering yet.
	late := newLateServer(t)
	r.now = r.now.Add(10 * time.Minute)
	r.containers(fxContainer("sonarr", "id2", late.port, r.now.Add(-time.Minute)))
	r.run()
	late.open()
	r.now = r.now.Add(5 * time.Minute)
	res := r.run()
	if len(res.Added) != 0 || len(res.Proposed) != 0 {
		t.Fatalf("a recreated container came back as new: %+v", res)
	}
}

// A container that is gone for one run (compose down, then up) is not new
// when it comes back.
func TestDiscoveryAbsentForARunIsNotNew(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.run()
	r.containers()
	r.now = r.now.Add(6 * time.Minute)
	r.run()
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.now = r.now.Add(6 * time.Minute)
	if res := r.run(); len(res.Added) != 0 || len(res.Proposed) != 0 {
		t.Fatalf("a container back from one absent run counted as new: %+v", res)
	}
}

// A container stopped when it is first seen is probed once it runs.
func TestDiscoveryStoppedContainerIsFoundOnceStarted(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	stopped := func(name, id string) dockerContainerSummary {
		c := fxContainer(name, id, 0, old)
		c.State = "exited"
		return c
	}
	r.containers(stopped("jellyfin", "id1"))
	r.run() // first run

	// A new container, created stopped, started long after its creation.
	r.containers(stopped("jellyfin", "id1"), stopped("bazarr", "id2"))
	r.now = r.now.Add(5 * time.Minute)
	r.run()

	r.containers(fxContainer("jellyfin", "id1", p1, old), fxContainer("bazarr", "id2", p2, old))
	r.now = r.now.Add(5 * time.Minute)
	res := r.run()
	names := r.appNames()
	if len(names) != 2 {
		t.Fatalf("started containers were not probed: apps = %v", names)
	}
	if len(res.Added) != 1 || res.Added[0] != "bazarr" {
		t.Fatalf("the new container is added once it runs, the one seen at the first run is not: %+v", res)
	}
}

// A port link found before any browser reported its host follows the host
// the dashboard is opened on.
func TestDiscoveryPortAppFollowsHostSeen(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	p1, _ := htmlPort(t)
	r.containers(fxContainer("sonarr", "id1", p1, r.now.Add(-time.Hour)))
	r.run() // probed on 127.0.0.1, standing in for the gateway

	r.setSettings(func(s *Settings) { s.DockerHostAddress = ""; s.DockerHostSeen = "nas.lan" })
	want := fmt.Sprintf("http://nas.lan:%d", p1)
	var got struct {
		Apps []discoveredApp `json:"apps"`
	}
	rec := r.call("GET", "/api/discovery", nil)
	if json.Unmarshal(rec.Body.Bytes(), &got) != nil || len(got.Apps) != 1 || got.Apps[0].URL != want {
		t.Fatalf("GET apps = %s, want %s", rec.Body.String(), want)
	}
	if rec := r.call("POST", "/api/discovery/add", map[string]any{
		"pageId": 1, "apps": []map[string]string{{"name": "sonarr", "category": "Media management"}},
	}); rec.Code != 200 {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "sonarr" {
			if b.URL != want && b.URL != want+"/" {
				t.Fatalf("bookmark url = %q, want %s", b.URL, want)
			}
			return
		}
	}
	t.Fatal("no bookmark")
}

// A reset during a run is not undone by that run's save.
func TestDiscoveryResetDuringRunStaysReset(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, _ := htmlPort(t)
	r.containers(fxContainer("sonarr", "id1", p1, r.now.Add(-time.Hour)))
	discoveryBeforeSaveHook = func() { r.h.resetDiscovery() }
	t.Cleanup(func() { discoveryBeforeSaveHook = nil })
	r.run()
	if st := r.state(); st.FirstRunDone || len(st.Apps) != 0 {
		t.Fatalf("the run wrote its result over the reset: %+v", st)
	}
}

// Config's Remove on the ignored list has a route of its own: the settings
// save does not carry the list, so a page loaded earlier cannot undo an Ignore.
func TestDiscoveryUnignoreRemovesName(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DiscoveryIgnored = []string{"sonarr", "radarr"} })
	t.Setenv("NEXTDASH_WRITE_TOKEN", "sesame")
	if rec := r.call("POST", "/api/discovery/unignore", map[string]string{"name": "sonarr"}); rec.Code != 401 {
		t.Fatalf("without the token: %d", rec.Code)
	}
	if rec := r.call("POST", "/api/discovery/unignore", map[string]string{"name": "sonarr"}, "X-NextDash-Token", "sesame"); rec.Code != 200 {
		t.Fatalf("unignore: %d %s", rec.Code, rec.Body.String())
	}
	if got := r.h.store.GetSettings().DiscoveryIgnored; len(got) != 1 || got[0] != "radarr" {
		t.Fatalf("ignored = %v", got)
	}
}
