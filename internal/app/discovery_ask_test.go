package app

import (
	"encoding/json"
	"testing"
	"time"
)

func (r *discoveryRig) pendingNames() []string {
	r.t.Helper()
	var got struct {
		Pending []discoveredApp `json:"pending"`
	}
	rec := r.call("GET", "/api/discovery", nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		r.t.Fatalf("get: %s", rec.Body.String())
	}
	var names []string
	for _, a := range got.Pending {
		names = append(names, a.Name)
	}
	return names
}

// By default a new container is asked about first: nothing lands on a page
// until the reader says yes.
func TestDiscoveryNewContainerAskedFirst(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	r.setSettings(func(s *Settings) { s.DiscoveryNewApps = "" })
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("radarr", "id1", p1, old))
	r.run()
	before := len(r.h.store.GetAllBookmarks())
	r.containers(fxContainer("radarr", "id1", p1, old), fxContainer("sonarr", "id2", p2, old))
	res := r.run()
	if len(res.Added) != 0 || len(r.h.store.GetAllBookmarks()) != before || len(r.h.store.GetInboxItems()) != 0 {
		t.Fatalf("asking first placed something: %+v", res)
	}
	if got := r.pendingNames(); len(got) != 1 || got[0] != "sonarr" {
		t.Fatalf("pending = %v", got)
	}
	// Not answered yet: the next run keeps the one question, no second.
	r.now = r.now.Add(5 * time.Minute)
	r.run()
	if got := r.pendingNames(); len(got) != 1 {
		t.Fatalf("pending after another run = %v", got)
	}
}

// The answer: Add puts the ticked apps on the page with a notice, the rest
// are ignored.
func TestDiscoveryAcceptAddsAndIgnores(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	r.setSettings(func(s *Settings) { s.DiscoveryNewApps = "" })
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	p3, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("radarr", "id1", p1, old))
	r.run()
	r.containers(fxContainer("radarr", "id1", p1, old), fxContainer("sonarr", "id2", p2, old), fxContainer("lidarr", "id3", p3, old))
	r.run()

	rec := r.call("POST", "/api/discovery/accept", map[string]any{"add": []string{"sonarr"}, "ignore": []string{"lidarr"}})
	if rec.Code != 200 {
		t.Fatalf("accept: %d %s", rec.Code, rec.Body.String())
	}
	found := false
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "sonarr" && b.CheckStatus {
			found = true
		}
	}
	if !found {
		t.Fatal("sonarr was not added")
	}
	st := r.state()
	if len(st.RecentAdds) != 1 || st.RecentAdds[0].Name != "sonarr" {
		t.Fatalf("recent adds = %+v", st.RecentAdds)
	}
	s := r.h.store.GetSettings()
	if !containsString(s.DiscoveryIgnored, "lidarr") || s.DockerBookmarkLinks["sonarr"] == "" {
		t.Fatalf("ignored = %v, links = %v", s.DiscoveryIgnored, s.DockerBookmarkLinks)
	}
	if got := r.pendingNames(); len(got) != 0 {
		t.Fatalf("pending after the answer = %v", got)
	}
}
