package app

import (
	"encoding/json"
	"testing"
)

// New categories from the card go to the top of the page.
func TestDiscoveryAddPutsNewCategoriesFirst(t *testing.T) {
	r := newDiscoveryRig(t)
	if err := r.h.store.ResetAllData(); err != nil {
		t.Fatal(err)
	}
	r.seedApps(discoveredApp{Name: "sonarr", URL: "http://127.0.0.1:8989", Kind: "Media management"})
	if rec := r.call("POST", "/api/discovery/add", map[string]any{
		"pageId": 1, "apps": []map[string]string{{"name": "sonarr", "category": "Media management"}},
	}); rec.Code != 200 {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}
	cats := r.h.store.GetCategoriesByPage(1)
	if len(cats) < 2 || cats[0].Name != "Media management" {
		t.Fatalf("first category = %+v", cats)
	}
}

// Replace the starter links: only on an untouched main page, and Undo puts
// the starter page back.
func TestDiscoveryAddReplacesStarterAndUndoRestores(t *testing.T) {
	r := newDiscoveryRig(t)
	if err := r.h.store.ResetAllData(); err != nil {
		t.Fatal(err)
	}
	starter := len(r.h.store.GetBookmarksByPage(1))
	var got struct {
		ReplacesStarter bool `json:"replacesStarter"`
	}
	_ = json.Unmarshal(r.call("GET", "/api/discovery", nil).Body.Bytes(), &got)
	if !got.ReplacesStarter {
		t.Fatal("an untouched main page offers to replace its starter links")
	}
	r.seedApps(discoveredApp{Name: "sonarr", URL: "http://127.0.0.1:8989", Kind: "Media management"})
	if rec := r.call("POST", "/api/discovery/add", map[string]any{
		"pageId": 1, "replaceStarter": true,
		"apps": []map[string]string{{"name": "sonarr", "category": "Media management"}},
	}); rec.Code != 200 {
		t.Fatalf("add: %d %s", rec.Code, rec.Body.String())
	}
	marks := r.h.store.GetBookmarksByPage(1)
	if len(marks) != 1 || marks[0].Name != "sonarr" {
		t.Fatalf("after replacing, main holds %+v", marks)
	}
	if rec := r.call("POST", "/api/discovery/undo-add", nil); rec.Code != 200 {
		t.Fatalf("undo-add: %d %s", rec.Code, rec.Body.String())
	}
	if n := len(r.h.store.GetBookmarksByPage(1)); n != starter {
		t.Fatalf("after Undo main holds %d links, want the %d starter links", n, starter)
	}
	s := r.h.store.GetSettings()
	if _, linked := s.DockerBookmarkLinks["sonarr"]; linked || containsString(s.DiscoveryIgnored, "sonarr") {
		t.Fatalf("Undo of the card unlinks but does not ignore: links=%v ignored=%v", s.DockerBookmarkLinks, s.DiscoveryIgnored)
	}
}

// Without the box ticked, or on a changed main page, the starter links stay.
func TestDiscoveryAddKeepsStarterUnlessAsked(t *testing.T) {
	r := newDiscoveryRig(t)
	if err := r.h.store.ResetAllData(); err != nil {
		t.Fatal(err)
	}
	starter := len(r.h.store.GetBookmarksByPage(1))
	r.seedApps(discoveredApp{Name: "sonarr", URL: "http://127.0.0.1:8989", Kind: "Media management"})
	r.call("POST", "/api/discovery/add", map[string]any{
		"pageId": 1, "apps": []map[string]string{{"name": "sonarr", "category": "Media management"}},
	})
	if n := len(r.h.store.GetBookmarksByPage(1)); n != starter+1 {
		t.Fatalf("main holds %d links, want %d", n, starter+1)
	}
}
