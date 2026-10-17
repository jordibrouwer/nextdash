package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

func discoveryRouter(h *Handlers) *mux.Router {
	r := mux.NewRouter()
	registerDiscoveryRoutes(r, h)
	return r
}

func (r *discoveryRig) call(method, path string, body any, headers ...string) *httptest.ResponseRecorder {
	r.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			r.t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	discoveryRouter(r.h).ServeHTTP(rec, req)
	return rec
}

func (r *discoveryRig) ensurePage1() {
	r.t.Helper()
	if !r.h.pageExists(1) {
		if err := r.h.store.SavePage(Page{ID: 1, Name: "Home"}); err != nil {
			r.t.Fatal(err)
		}
	}
}

func (r *discoveryRig) seedApps(apps ...discoveredApp) {
	r.h.withDiscoveryState(func(st *discoveryState) { st.Apps = apps })
}

func TestDiscoveryAddCreatesBookmarksWithLinks(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	r.seedApps(discoveredApp{Name: "sonarr", URL: "http://127.0.0.1:8989", Kind: "Media management", Source: "port"})
	rec := r.call("POST", "/api/discovery/add", map[string]any{
		"pageId": 1,
		"apps":   []map[string]string{{"name": "sonarr", "category": "Media management"}},
	})
	if rec.Code != 200 {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}
	var made *Category
	for _, c := range r.h.store.GetCategoriesByPage(1) {
		if c.Name == "Media management" {
			c := c
			made = &c
		}
	}
	if made == nil {
		t.Fatalf("category not created: %+v", r.h.store.GetCategoriesByPage(1))
	}
	var bm *Bookmark
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "sonarr" {
			b := b
			bm = &b
		}
	}
	if bm == nil || bm.URL != "http://127.0.0.1:8989" || !bm.CheckStatus || bm.Category != made.ID {
		t.Fatalf("bookmark = %+v", bm)
	}
	s := r.h.store.GetSettings()
	if s.DockerBookmarkLinks["sonarr"] != "1::http://127.0.0.1:8989" {
		t.Fatalf("links = %v", s.DockerBookmarkLinks)
	}
	if !s.DiscoveryCardDone {
		t.Fatal("discoveryCardDone not set")
	}
	st := r.state()
	if st.PageID != 1 || st.KindCategory[1]["Media management"] != made.ID {
		t.Fatalf("state = %+v", st)
	}
	// The card's second click is answered, not duplicated.
	rec = r.call("POST", "/api/discovery/add", map[string]any{
		"pageId": 1,
		"apps":   []map[string]string{{"name": "sonarr", "category": "Media management"}},
	})
	if rec.Code != 200 {
		t.Fatalf("second add: %d", rec.Code)
	}
	n := 0
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "sonarr" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("%d sonarr bookmarks", n)
	}
}

func TestDiscoveryAddIgnoresNamesItNeverFound(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	r.seedApps()
	before := len(r.h.store.GetBookmarksByPage(1))
	rec := r.call("POST", "/api/discovery/add", map[string]any{
		"pageId": 1,
		"apps":   []map[string]string{{"name": "evil", "category": "X"}},
	})
	if rec.Code != 200 || len(r.h.store.GetBookmarksByPage(1)) != before {
		t.Fatalf("add of an unknown app: %d, bookmarks %d -> %d", rec.Code, before, len(r.h.store.GetBookmarksByPage(1)))
	}
	rec = r.call("POST", "/api/discovery/add", map[string]any{"pageId": 424242, "apps": []map[string]string{}})
	if rec.Code != 404 {
		t.Fatalf("unknown page: %d", rec.Code)
	}
}

func TestDiscoveryAddReusesCategoryByName(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	if err := r.h.store.SaveCategoriesByPage(1, []Category{{ID: "cat_m", Name: "media"}}); err != nil {
		t.Fatal(err)
	}
	r.seedApps(discoveredApp{Name: "jellyfin", URL: "http://127.0.0.1:8096", Kind: "Media"})
	rec := r.call("POST", "/api/discovery/add", map[string]any{
		"pageId": 1,
		"apps":   []map[string]string{{"name": "jellyfin", "category": "Media"}},
	})
	if rec.Code != 200 {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}
	cats := r.h.store.GetCategoriesByPage(1)
	if len(cats) != 1 || cats[0].ID != "cat_m" {
		t.Fatalf("categories = %+v", cats)
	}
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "jellyfin" && b.Category != "cat_m" {
			t.Fatalf("category = %q", b.Category)
		}
	}
	if r.state().KindCategory[1]["Media"] != "cat_m" {
		t.Fatalf("kindCategory = %+v", r.state().KindCategory)
	}
}

func TestDiscoveryIgnoreDropsInboxItem(t *testing.T) {
	r := newDiscoveryRig(t)
	if _, _, err := r.h.store.AddInboxLink(InboxLink{URL: "http://127.0.0.1:1111", Source: "discovery", ContainerName: "x"}, true, 0); err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.h.store.AddInboxLink(InboxLink{URL: "http://127.0.0.1:2222", Source: "discovery", ContainerName: "y"}, true, 0); err != nil {
		t.Fatal(err)
	}
	rec := r.call("POST", "/api/discovery/ignore", map[string]string{"name": "x"})
	if rec.Code != 200 {
		t.Fatalf("ignore: %d", rec.Code)
	}
	items := r.h.store.GetInboxItems()
	if len(items) != 1 || items[0].ContainerName != "y" {
		t.Fatalf("inbox = %+v", items)
	}
	if got := r.h.store.GetSettings().DiscoveryIgnored; len(got) != 1 || got[0] != "x" {
		t.Fatalf("ignored = %v", got)
	}
}

func TestDiscoveryUndoRemovesAndIgnores(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))
	r.run()
	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id2", p2, old))
	r.run()
	if len(r.state().RecentAdds) != 1 {
		t.Fatalf("recentAdds = %+v", r.state().RecentAdds)
	}

	rec := r.call("POST", "/api/discovery/undo", map[string]string{"name": "radarr"})
	if rec.Code != 200 {
		t.Fatalf("undo: %d %s", rec.Code, rec.Body.String())
	}
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "radarr" {
			t.Fatal("bookmark still on the page")
		}
	}
	inTrash := false
	for _, it := range r.h.store.GetTrashItems() {
		if it.Bookmark.Name == "radarr" {
			inTrash = true
		}
	}
	if !inTrash {
		t.Fatal("bookmark did not go to the trash")
	}
	s := r.h.store.GetSettings()
	if _, ok := s.DockerBookmarkLinks["radarr"]; ok {
		t.Fatal("link not cleared")
	}
	if len(s.DiscoveryIgnored) != 1 || s.DiscoveryIgnored[0] != "radarr" {
		t.Fatalf("ignored = %v", s.DiscoveryIgnored)
	}
	if len(r.state().RecentAdds) != 0 {
		t.Fatal("recentAdds not acknowledged")
	}
	// Even recreated, it is not added again.
	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id9", p2, r.now))
	res := r.run()
	if len(res.Added) != 0 {
		t.Fatalf("added again: %v", res.Added)
	}
	if rec := r.call("POST", "/api/discovery/undo", map[string]string{"name": "radarr"}); rec.Code != 404 {
		t.Fatalf("second undo: %d", rec.Code)
	}
}

func TestDiscoveryAckClearsRecentAdds(t *testing.T) {
	r := newDiscoveryRig(t)
	r.h.withDiscoveryState(func(st *discoveryState) {
		st.RecentAdds = []discoveryRecentAdd{{Name: "a", Key: "1::http://x:1"}, {Name: "b", Key: "1::http://x:2"}}
	})
	rec := r.call("GET", "/api/discovery", nil)
	var got struct {
		RecentAdds []discoveryRecentAdd `json:"recentAdds"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || len(got.RecentAdds) != 2 {
		t.Fatalf("get: %v %s", err, rec.Body.String())
	}
	if rec := r.call("POST", "/api/discovery/ack", map[string]any{"names": []string{"a"}}); rec.Code != 200 {
		t.Fatalf("ack: %d", rec.Code)
	}
	left := r.state().RecentAdds
	if len(left) != 1 || left[0].Name != "b" {
		t.Fatalf("recentAdds = %+v", left)
	}
}

func TestDiscoveryGetShape(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	// A bookmark made after the run: the answer leaves that app out.
	r.containers(fxContainer("sonarr", "id1", p1, old), fxContainer("radarr", "id2", p2, old))
	r.run()
	if err := r.h.store.AddBookmarkToPage(1, Bookmark{Name: "TV", URL: fmt.Sprintf("http://127.0.0.1:%d", p1)}); err != nil {
		t.Fatal(err)
	}
	rec := r.call("GET", "/api/discovery", nil)
	var got struct {
		Enabled      bool            `json:"enabled"`
		Docker       bool            `json:"docker"`
		Running      bool            `json:"running"`
		FirstRunDone bool            `json:"firstRunDone"`
		CardDone     bool            `json:"cardDone"`
		Apps         []discoveredApp `json:"apps"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &got) != nil {
		t.Fatalf("get: %d %s", rec.Code, rec.Body.String())
	}
	if !got.Enabled || !got.Docker || got.Running || !got.FirstRunDone || got.CardDone {
		t.Fatalf("flags = %+v", got)
	}
	if len(got.Apps) != 1 || got.Apps[0].Name != "radarr" {
		t.Fatalf("apps = %+v", got.Apps)
	}
	if rec := r.call("POST", "/api/discovery/close", nil); rec.Code != 200 || !r.h.store.GetSettings().DiscoveryCardDone {
		t.Fatalf("close: %d", rec.Code)
	}
}

func TestDiscoveryRunEndpointRunsNow(t *testing.T) {
	r := newDiscoveryRig(t)
	p1, _ := htmlPort(t)
	r.containers(fxContainer("sonarr", "id1", p1, time.Now().Add(-time.Hour)))
	rec := r.call("POST", "/api/discovery/run", nil)
	if rec.Code != 200 || len(r.appNames()) != 1 {
		t.Fatalf("run: %d %s apps=%v", rec.Code, rec.Body.String(), r.appNames())
	}
}

func TestDiscoveryWritesNeedToken(t *testing.T) {
	r := newDiscoveryRig(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "sesame")
	for _, path := range []string{"add", "undo", "ack", "run", "ignore", "close", "host-seen"} {
		rec := r.call("POST", "/api/discovery/"+path, map[string]any{"name": "x", "host": "nas.lan", "names": []string{}, "pageId": 1, "apps": []any{}})
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("POST %s without a token: %d", path, rec.Code)
		}
	}
	if rec := r.call("GET", "/api/discovery", nil); rec.Code != 200 {
		t.Errorf("GET: %d", rec.Code)
	}
	rec := r.call("POST", "/api/discovery/close", nil, "X-NextDash-Token", "sesame")
	if rec.Code != 200 {
		t.Errorf("close with the token: %d", rec.Code)
	}
}

func TestDiscoveryHostSeenUsedForPortLinks(t *testing.T) {
	r := newDiscoveryRig(t)
	r.setSettings(func(s *Settings) { s.DockerHostAddress = "" })
	p1, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("sonarr", "id1", p1, old))

	// The probe has to answer, so the host the browser reports is the
	// loopback address the test server listens on.
	rec := r.call("POST", "/api/discovery/host-seen", map[string]string{"host": "127.0.0.1"})
	if rec.Code != 200 {
		t.Fatalf("host-seen: %d", rec.Code)
	}
	if got := r.h.store.GetSettings().DockerHostSeen; got != "127.0.0.1" {
		t.Fatalf("dockerHostSeen = %q", got)
	}
	r.run()
	// Probed where the server reaches the port; offered on the host seen.
	apps := r.getApps()
	want := fmt.Sprintf("http://127.0.0.1:%d", p1)
	if len(apps) != 1 || apps[0].URL != want {
		t.Fatalf("apps = %+v, want %s", apps, want)
	}
	// A host with a path or a port is no host.
	if rec := r.call("POST", "/api/discovery/host-seen", map[string]string{"host": "evil.example/x"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad host: %d", rec.Code)
	}
	if strings.Contains(r.h.store.GetSettings().DockerHostSeen, "evil") {
		t.Fatal("a bad host was stored")
	}
}

func TestDiscoveryAddAdoptsSetIcon(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	useIconSetsFixture(t)
	r.seedApps(discoveredApp{Name: "sonarr", URL: "http://127.0.0.1:8989", Kind: "Media management", Icon: "dashboard-icons/sonarr"})
	rec := r.call("POST", "/api/discovery/add", map[string]any{
		"pageId": 1,
		"apps":   []map[string]string{{"name": "sonarr", "category": "Media management"}},
	})
	if rec.Code != 200 {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "sonarr" {
			if b.Icon != "sonarr.svg" {
				t.Fatalf("icon = %q", b.Icon)
			}
			return
		}
	}
	t.Fatal("no bookmark")
}

func TestDiscoveryGetGivesIconURL(t *testing.T) {
	r := newDiscoveryRig(t)
	useIconSetsFixture(t)
	r.seedApps(discoveredApp{Name: "sonarr", URL: "http://10.9.9.9:8989", Kind: "Media management", Icon: "dashboard-icons/sonarr"})
	var got struct {
		Apps []discoveredApp `json:"apps"`
	}
	rec := r.call("GET", "/api/discovery", nil)
	if json.Unmarshal(rec.Body.Bytes(), &got) != nil || len(got.Apps) != 1 {
		t.Fatalf("get: %s", rec.Body.String())
	}
	if !strings.HasPrefix(got.Apps[0].IconURL, "/data/icon-sets/dashboard-icons/") {
		t.Fatalf("iconUrl = %q", got.Apps[0].IconURL)
	}
}

func TestResetForgetsDiscovery(t *testing.T) {
	r := newDiscoveryRig(t)
	r.seedApps(discoveredApp{Name: "sonarr", URL: "http://10.9.9.9:8989"})
	r.h.withDiscoveryState(func(st *discoveryState) { st.FirstRunDone = true; st.Seen["sonarr"] = "id1" })
	req := httptest.NewRequest("POST", "/api/reset", strings.NewReader(`{"confirm":true}`))
	rec := httptest.NewRecorder()
	r.h.ResetAllData(rec, req)
	if rec.Code != 200 {
		t.Fatalf("reset: %d %s", rec.Code, rec.Body.String())
	}
	st := r.state()
	if st.FirstRunDone || len(st.Seen) != 0 || len(st.Apps) != 0 {
		t.Fatalf("a reset install still remembers its containers: %+v", st)
	}
}
