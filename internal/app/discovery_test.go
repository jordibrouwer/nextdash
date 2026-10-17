package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// discoveryRig is a Handlers whose "Docker" is a fixture file and whose
// containers' web UIs are httptest servers on 127.0.0.1.
type discoveryRig struct {
	t       *testing.T
	h       *Handlers
	fixture string
	now     time.Time
}

func newDiscoveryRig(t *testing.T) *discoveryRig {
	t.Helper()
	h := newTestHandlers(t)
	dockerSelfOverride = ""
	fixture := filepath.Join(t.TempDir(), "containers.json")
	t.Setenv("NEXTDASH_DISCOVERY_FIXTURE", fixture)
	r := &discoveryRig{t: t, h: h, fixture: fixture, now: time.Now()}
	r.setSettings(func(s *Settings) {
		s.DiscoverApps = true
		s.DockerHostAddress = "127.0.0.1"
		// Most tests here are about adding straight away; asking first is
		// the default, and discovery_ask_test.go covers it.
		s.DiscoveryNewApps = "add"
	})
	r.containers()
	return r
}

func (r *discoveryRig) setSettings(mutate func(*Settings)) {
	r.t.Helper()
	s := r.h.store.GetSettings()
	mutate(&s)
	if err := r.h.store.SaveSettings(s); err != nil {
		r.t.Fatal(err)
	}
}

func (r *discoveryRig) containers(list ...dockerContainerSummary) {
	r.t.Helper()
	if list == nil {
		list = []dockerContainerSummary{}
	}
	data, err := json.Marshal(list)
	if err != nil {
		r.t.Fatal(err)
	}
	if err := os.WriteFile(r.fixture, data, 0o644); err != nil {
		r.t.Fatal(err)
	}
}

func (r *discoveryRig) run() discoveryRunResult {
	r.t.Helper()
	res, err := r.h.runDiscovery(context.Background(), r.now)
	if err != nil {
		r.t.Fatalf("runDiscovery: %v", err)
	}
	return res
}

func (r *discoveryRig) state() discoveryState {
	r.t.Helper()
	var out discoveryState
	r.h.withDiscoveryState(func(st *discoveryState) { out = *st })
	return out
}

func (r *discoveryRig) appNames() []string {
	var names []string
	for _, a := range r.state().Apps {
		names = append(names, a.Name)
	}
	return names
}

// fxContainer is a running container publishing one port.
func fxContainer(name, id string, port int, created time.Time) dockerContainerSummary {
	c := dockerContainerSummary{
		ID:      id,
		Names:   []string{"/" + name},
		Image:   "lscr.io/linuxserver/" + name,
		State:   "running",
		Created: created.Unix(),
	}
	if port > 0 {
		c.Ports = []dockerPort{{IP: "0.0.0.0", PrivatePort: 80, PublicPort: port, Type: "tcp"}}
	}
	return c
}

// htmlPort starts a web UI that answers with a page and returns its port and a
// counter of the requests it got.
func htmlPort(t *testing.T) (int, *atomic.Int32) {
	t.Helper()
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><head><title>App</title></head></html>"))
	}))
	t.Cleanup(srv.Close)
	return mustPort(t, srv.Listener.Addr()), &hits
}

func mustPort(t *testing.T, a net.Addr) int {
	t.Helper()
	_, p, err := net.SplitHostPort(a.String())
	if err != nil {
		t.Fatal(err)
	}
	n, _ := strconv.Atoi(p)
	return n
}

// closedPort is a port nothing listens on, until startOn is called.
type lateServer struct {
	t    *testing.T
	port int
	srv  *httptest.Server
}

func newLateServer(t *testing.T) *lateServer {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := mustPort(t, l.Addr())
	l.Close()
	return &lateServer{t: t, port: port}
}

func (s *lateServer) open() {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", s.port))
	if err != nil {
		s.t.Fatal(err)
	}
	s.srv = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><title>Late</title></html>"))
	}))
	s.srv.Listener.Close()
	s.srv.Listener = l
	s.srv.Start()
	s.t.Cleanup(s.srv.Close)
}

func inboxByContainer(h *Handlers) []InboxLink {
	return h.store.GetInboxItems()
}

func TestDiscoveryFirstRunProposesNothing(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id2", p2, old))
	bookmarksBefore := len(r.h.store.GetAllBookmarks())

	res := r.run()
	if !res.Docker {
		t.Fatalf("docker should answer: %+v", res)
	}
	if got := r.appNames(); len(got) != 2 || got[0] != "sonarr" || got[1] != "radarr" {
		t.Fatalf("apps = %v", got)
	}
	if n := len(inboxByContainer(r.h)); n != 0 {
		t.Fatalf("inbox has %d items after the first run", n)
	}
	if n := len(r.h.store.GetAllBookmarks()); n != bookmarksBefore {
		t.Fatalf("the first run placed bookmarks: %d -> %d", bookmarksBefore, n)
	}
	st := r.state()
	if !st.FirstRunDone || len(st.RecentAdds) != 0 {
		t.Fatalf("state = %+v", st)
	}
}

func TestDiscoveryNewContainerAddedDirectly(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.run()

	// The user's own category for the kind, remembered from the card.
	if err := r.h.store.SaveCategoriesByPage(1, []Category{{ID: "cat_mine", Name: "Mijn media"}}); err != nil {
		t.Fatal(err)
	}
	r.h.withDiscoveryState(func(st *discoveryState) {
		st.KindCategory = map[int]map[string]string{1: {"Media management": "cat_mine"}}
	})

	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id2", p2, old))
	res := r.run()
	if len(res.Added) != 1 || res.Added[0] != "radarr" {
		t.Fatalf("added = %v", res.Added)
	}
	var found *Bookmark
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "radarr" {
			b := b
			found = &b
		}
	}
	if found == nil {
		t.Fatal("no bookmark for radarr on page 1")
	}
	wantURL := fmt.Sprintf("http://127.0.0.1:%d", p2)
	if found.URL != wantURL || found.Category != "cat_mine" || !found.CheckStatus {
		t.Fatalf("bookmark = %+v", *found)
	}
	if link := r.h.store.GetSettings().DockerBookmarkLinks["radarr"]; link != "1::"+wantURL {
		t.Fatalf("link = %q", link)
	}
	st := r.state()
	if len(st.RecentAdds) != 1 || st.RecentAdds[0].Name != "radarr" || st.RecentAdds[0].Key != "1::"+wantURL {
		t.Fatalf("recentAdds = %+v", st.RecentAdds)
	}
	if n := len(inboxByContainer(r.h)); n != 0 {
		t.Fatalf("a direct add also queued %d inbox items", n)
	}
}

func TestDiscoveryDirectAddFallsBackToEnglishKind(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	p3, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("jellyfin", "id0", p1, old))
	r.run()
	if err := r.h.store.SaveCategoriesByPage(1, []Category{{ID: "cat_mm", Name: "media MANAGEMENT"}}); err != nil {
		t.Fatal(err)
	}

	r.containers(fxContainer("jellyfin", "id0", p1, old), fxContainer("sonarr", "id1", p2, old), fxContainer("radarr", "id2", p3, old))
	r.run()
	cats := r.h.store.GetCategoriesByPage(1)
	if len(cats) != 1 {
		t.Fatalf("a second category was made: %+v", cats)
	}
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if (b.Name == "sonarr" || b.Name == "radarr") && b.Category != "cat_mm" {
			t.Fatalf("%s is in %q", b.Name, b.Category)
		}
	}

	// And with none to reuse, the English kind name is created.
	p4, _ := htmlPort(t)
	r.containers(fxContainer("jellyfin", "id0", p1, old), fxContainer("sonarr", "id1", p2, old), fxContainer("radarr", "id2", p3, old), fxContainer("qbittorrent", "id3", p4, old))
	r.run()
	var made *Category
	for _, c := range r.h.store.GetCategoriesByPage(1) {
		if c.Name == "Downloads" {
			c := c
			made = &c
		}
	}
	if made == nil {
		t.Fatalf("no Downloads category: %+v", r.h.store.GetCategoriesByPage(1))
	}
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "qbittorrent" && b.Category != made.ID {
			t.Fatalf("qbittorrent is in %q, want %q", b.Category, made.ID)
		}
	}
}

func TestDiscoveryNewContainerGoesToInbox(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DiscoveryNewApps = "inbox" })
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.run()
	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id2", p2, old))
	before := len(r.h.store.GetAllBookmarks())
	res := r.run()
	if len(res.Proposed) != 1 || res.Proposed[0] != "radarr" {
		t.Fatalf("proposed = %v", res.Proposed)
	}
	items := inboxByContainer(r.h)
	if len(items) != 1 {
		t.Fatalf("inbox = %+v", items)
	}
	it := items[0]
	if it.Source != "discovery" || it.ContainerName != "radarr" || it.AppKind != "Media management" ||
		it.URL != fmt.Sprintf("http://127.0.0.1:%d", p2) {
		t.Fatalf("item = %+v", it)
	}
	if n := len(r.h.store.GetAllBookmarks()); n != before {
		t.Fatalf("a proposal placed a bookmark")
	}
	if n := len(r.state().RecentAdds); n != 0 {
		t.Fatalf("recentAdds = %d", n)
	}
	// Once proposed, a later run does not propose it again.
	r.run()
	if n := len(inboxByContainer(r.h)); n != 1 {
		t.Fatalf("inbox grew to %d", n)
	}
}

func TestDiscoveryRecreatedContainerIsNotNew(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DiscoveryNewApps = "inbox" })
	p1, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.run()
	// An update recreates it: same name, new id, a fresh Created.
	r.containers(fxContainer("sonarr", "id9", p1, r.now.Add(-time.Minute)))
	r.run()
	if items := inboxByContainer(r.h); len(items) != 0 {
		t.Fatalf("a recreated container was proposed: %+v", items)
	}
	if got := r.appNames(); len(got) != 1 || got[0] != "sonarr" {
		t.Fatalf("apps = %v", got)
	}
}

func TestDiscoveryIgnoredNeverProposed(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) {
		s.DiscoveryNewApps = "inbox"
		s.DiscoveryIgnored = []string{"radarr"}
	})
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.run()
	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id2", p2, old))
	r.run()
	if items := inboxByContainer(r.h); len(items) != 0 {
		t.Fatalf("an ignored container was proposed: %+v", items)
	}
	for _, n := range r.appNames() {
		if n == "radarr" {
			t.Fatal("ignored container is in apps")
		}
	}
}

func TestDiscoverySkipsMatchedBookmark(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	if err := r.h.store.SaveCategoriesByPage(1, []Category{{ID: "cat_x", Name: "X"}}); err != nil {
		t.Fatal(err)
	}
	if err := r.h.store.AddBookmarkToPage(1, Bookmark{Name: "My TV", URL: fmt.Sprintf("http://127.0.0.1:%d", p1), Category: "cat_x"}); err != nil {
		t.Fatal(err)
	}
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id2", p2, old))
	r.run()
	got := r.appNames()
	if len(got) != 1 || got[0] != "radarr" {
		t.Fatalf("apps = %v, want only radarr", got)
	}
}

func TestDiscoveryOneProposalPerAddress(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DiscoveryNewApps = "inbox" })
	port, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	other, _ := htmlPort(t)
	r.containers(fxContainer("jellyfin", "id0", other, old))
	r.run()
	// qBittorrent runs in gluetun's network: both are listed with the port,
	// and Docker lists gluetun first.
	r.containers(
		fxContainer("jellyfin", "id0", other, old),
		fxContainer("gluetun", "id1", port, old),
		fxContainer("qbittorrent", "id2", port, old),
	)
	r.run()
	items := inboxByContainer(r.h)
	if len(items) != 1 || items[0].ContainerName != "gluetun" {
		t.Fatalf("inbox = %+v", items)
	}
	apps := r.state().Apps
	n := 0
	for _, a := range apps {
		if a.URL == fmt.Sprintf("http://127.0.0.1:%d", port) {
			n++
			if a.Name != "gluetun" {
				t.Fatalf("named %q", a.Name)
			}
		}
	}
	if n != 1 {
		t.Fatalf("%d apps on one address: %+v", n, apps)
	}
}

func TestDiscoveryRetriesWhileStarting(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DiscoveryNewApps = "inbox" })
	okPort, _ := htmlPort(t)
	r.containers(fxContainer("jellyfin", "id0", okPort, r.now.Add(-time.Hour)))
	r.run()

	late := newLateServer(t)
	booting := fxContainer("slowapp", "id5", late.port, r.now.Add(-2*time.Minute))
	r.containers(fxContainer("jellyfin", "id0", okPort, r.now.Add(-time.Hour)), booting)
	r.run()
	if got := r.appNames(); len(got) != 1 {
		t.Fatalf("apps = %v", got)
	}
	if _, ok := r.state().Retry["slowapp"]; !ok {
		t.Fatalf("not in retry: %+v", r.state().Retry)
	}
	if n := len(inboxByContainer(r.h)); n != 0 {
		t.Fatalf("proposed while not answering")
	}

	// It finishes starting: accepted now, and new even though its name was seen.
	late.open()
	r.now = r.now.Add(time.Minute)
	res := r.run()
	items := inboxByContainer(r.h)
	if len(items) != 1 || items[0].ContainerName != "slowapp" || len(res.Proposed) != 1 {
		t.Fatalf("inbox = %+v, result %+v", items, res)
	}
	if _, ok := r.state().Retry["slowapp"]; ok {
		t.Fatal("still in retry after being accepted")
	}
}

func TestDiscoveryRetryEndsAfterFifteenMinutes(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DiscoveryNewApps = "inbox" })
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		http.Error(w, "nope", http.StatusNotFound)
	}))
	defer srv.Close()
	port := mustPort(t, srv.Listener.Addr())

	r.containers()
	r.run()
	created := r.now.Add(-2 * time.Minute)
	r.containers(fxContainer("api", "id7", port, created))
	r.run()
	if _, ok := r.state().Retry["api"]; !ok {
		t.Fatal("not in retry")
	}
	// Past the window and still failing: dropped from retry.
	r.now = created.Add(20 * time.Minute)
	r.run()
	if _, ok := r.state().Retry["api"]; ok {
		t.Fatal("still in retry after 15 minutes")
	}
	seen := hits.Load()
	// And not probed again until recreated.
	r.now = r.now.Add(5 * time.Minute)
	r.run()
	if hits.Load() != seen {
		t.Fatalf("probed again: %d -> %d", seen, hits.Load())
	}
	// A recreated container (new id) is probed again.
	r.containers(fxContainer("api", "id8", port, r.now.Add(-time.Minute)))
	r.run()
	if hits.Load() == seen {
		t.Fatal("a recreated container was not probed")
	}
	if n := len(inboxByContainer(r.h)); n != 0 {
		t.Fatalf("inbox = %d", n)
	}
}

func TestDiscoveryOffAndOnIsSilent(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DiscoveryNewApps = "inbox" })
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.run()
	if !r.state().FirstRunDone {
		t.Fatal("first run not done")
	}
	r.setSettings(func(s *Settings) { s.DiscoverApps = false })
	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id2", p2, old))
	res := r.run()
	if res.Docker || res.Ran {
		t.Fatalf("a run while off did something: %+v", res)
	}
	if r.state().FirstRunDone {
		t.Fatal("firstRunDone survived being switched off")
	}
	r.setSettings(func(s *Settings) { s.DiscoverApps = true })
	r.run()
	if items := inboxByContainer(r.h); len(items) != 0 {
		t.Fatalf("switching on proposed %+v", items)
	}
	if len(r.appNames()) != 2 {
		t.Fatalf("apps = %v", r.appNames())
	}
}

func TestDiscoverAppsDefaultsOnForExistingInstalls(t *testing.T) {
	h := newTestHandlers(t)
	// A settings file from before the setting: no discoverApps key at all.
	raw := `{"theme":"dark","dockerViewEnabled":true}`
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	h.store.InvalidateReadCache()
	if !h.store.GetSettings().DiscoverApps {
		t.Fatal("discoverApps reads as off on an existing install")
	}
	// A stored false stays false.
	raw = `{"theme":"dark","discoverApps":false}`
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	h.store.InvalidateReadCache()
	if h.store.GetSettings().DiscoverApps {
		t.Fatal("a stored false was turned on")
	}
}

func TestDiscoveryOffInDemo(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, hits := htmlPort(t)
	r.containers(fxContainer("sonarr", "id1", p1, r.now.Add(-time.Hour)))
	t.Setenv("NEXTDASH_DEMO", "1")
	res := r.run()
	if res.Docker || res.Ran || hits.Load() != 0 || len(r.appNames()) != 0 {
		t.Fatalf("discovery ran in the demo: %+v", res)
	}
	// And without the socket or fixture the run reports no Docker, quietly.
	t.Setenv("NEXTDASH_DEMO", "")
	t.Setenv("NEXTDASH_DISCOVERY_FIXTURE", "")
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	res = r.run()
	if res.Docker {
		t.Fatalf("docker answered without a socket: %+v", res)
	}
}

func TestDiscoveryUsesDefaultGatewayHostFallback(t *testing.T) {
	// The host order: DockerHostAddress, DockerHostSeen, then the rest.
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DockerHostAddress = ""; s.DockerHostSeen = "nas.lan" })
	if got := r.h.discoveryHost(r.h.store.GetSettings()); got != "nas.lan" {
		t.Fatalf("host = %q", got)
	}
	r.setSettings(func(s *Settings) { s.DockerHostAddress = "10.0.0.2" })
	if got := r.h.discoveryHost(r.h.store.GetSettings()); got != "10.0.0.2" {
		t.Fatalf("host = %q", got)
	}
	r.setSettings(func(s *Settings) { s.DockerHostAddress = ""; s.DockerHostSeen = "" })
	if got := r.h.discoveryHost(r.h.store.GetSettings()); got == "" || strings.Contains(got, "/") {
		t.Fatalf("host = %q", got)
	}
}
