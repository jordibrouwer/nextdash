package app

import (
	"fmt"
	"testing"
	"time"
)

// An Inbox proposal carries the app's set icon as a file the row can show.
func TestDiscoveryInboxProposalHasIcon(t *testing.T) {
	r := newDiscoveryRig(t)
	useIconSetsFixture(t)
	r.setSettings(func(s *Settings) { s.DiscoveryNewApps = "inbox" })
	p1, _ := htmlPort(t)
	p2, _ := htmlPort(t)
	old := r.now.Add(-time.Hour)
	r.containers(fxContainer("radarr", "id1", p1, old))
	r.run()
	r.containers(fxContainer("radarr", "id1", p1, old), fxContainer("sonarr", "id2", p2, old))
	r.run()
	items := r.h.store.GetInboxItems()
	if len(items) != 1 || items[0].ContainerName != "sonarr" {
		t.Fatalf("inbox = %+v", items)
	}
	if items[0].Icon != "sonarr.svg" || items[0].AppIcon == "" {
		t.Fatalf("icon = %q, appIcon = %q", items[0].Icon, items[0].AppIcon)
	}
}

// After Promote saves the bookmark, the container is linked to it.
func TestDiscoveryLinkSetsContainerLink(t *testing.T) {
	r := newDiscoveryRig(t)
	r.ensurePage1()
	url := "http://127.0.0.1:8989"
	if err := r.h.store.AddBookmarkToPage(1, Bookmark{Name: "Sonarr", URL: url}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NEXTDASH_WRITE_TOKEN", "sesame")
	body := map[string]any{"name": "sonarr", "pageId": 1, "url": url + "/"}
	if rec := r.call("POST", "/api/discovery/link", body); rec.Code != 401 {
		t.Fatalf("without the token: %d", rec.Code)
	}
	if rec := r.call("POST", "/api/discovery/link", body, "X-NextDash-Token", "sesame"); rec.Code != 200 {
		t.Fatalf("link: %d %s", rec.Code, rec.Body.String())
	}
	var stored string
	for _, b := range r.h.store.GetBookmarksByPage(1) {
		if b.Name == "Sonarr" {
			stored = b.URL
		}
	}
	if got := r.h.store.GetSettings().DockerBookmarkLinks["sonarr"]; got != fmt.Sprintf("1::%s", stored) {
		t.Fatalf("link = %q, want 1::%s", got, stored)
	}
	// No bookmark at that address: nothing to link.
	if rec := r.call("POST", "/api/discovery/link", map[string]any{"name": "x", "pageId": 1, "url": "http://nowhere.lan"}, "X-NextDash-Token", "sesame"); rec.Code != 404 {
		t.Fatalf("missing bookmark: %d", rec.Code)
	}
}
