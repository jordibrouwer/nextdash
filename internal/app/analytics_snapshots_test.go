package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// The three feature snapshots count what is there and set up how, and nothing
// that names anything: a hidden container, a custom address, a host or a note
// is at most a count or a yes/no.
func TestAnalyticsSnapshotsCountWithoutNaming(t *testing.T) {
	h := newTestHandlers(t)
	invalidateAnalyticsContentCache()
	t.Cleanup(invalidateAnalyticsContentCache)
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "/var/run/docker.sock")
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")

	fs := h.store.(*FileStore)
	pageID := h.store.GetPages()[0].ID
	if err := fs.SavePageBlocks(pageID, []Widget{
		{ID: "w-a", Type: WidgetTypeHealth, Title: "Private title"},
		{ID: "w-b", Type: WidgetTypeHealth},
		{ID: "w-c", Type: WidgetTypeContainers},
	}, nil); err != nil {
		t.Fatalf("save widgets: %v", err)
	}

	settings := h.store.GetSettings()
	settings.DockerHiddenContainers = []string{"secret-box"}
	settings.DockerWebUIs = map[string]string{"sonarr": "https://sonarr.home.lan"}
	settings.DockerHostAddress = "tower.lan"
	settings.BmViewColumns = []string{"tags", "opens"}
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	if err := writeIndentJSONFile(healthCacheFilePath(), HealthScanCacheFile{
		Cache: map[string]HealthScanCache{
			"https://a.lan/": {URL: "https://a.lan/", Status: "online", LastScanned: now.Add(-2 * time.Hour).UnixMilli()},
			"https://b.lan/": {URL: "https://b.lan/", Status: "offline", LastScanned: now.Add(-3 * time.Hour).UnixMilli()},
		},
		Certificates: map[string]HostCertificate{
			"a.lan": {Host: "a.lan", ExpiresAt: now.AddDate(0, 0, 5).UnixMilli()},
			"b.lan": {Host: "b.lan", ExpiresAt: now.AddDate(0, 0, -1).UnixMilli()},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fs.AddInboxLink(InboxLink{URL: "https://c.lan/", Note: "private note", Source: "extension"}, false, 100); err != nil {
		t.Fatal(err)
	}

	snap := h.collectAnalyticsSnapshots()

	widgets := snap.Widgets
	byType := widgets["byType"].(map[string]int)
	if widgets["total"] != 3 || widgets["pages"] != 1 || byType["health"] != 2 || byType["containers"] != 1 {
		t.Errorf("widgets = %v", widgets)
	}
	if len(byType) != len(knownWidgetTypes) || byType["rss"] != 0 {
		t.Errorf("every known type, and only those, is present: %v", byType)
	}

	c := snap.Containers
	if c["socketSet"] != true || c["control"] != true || c["hidden"] != 1 || c["customWebUIs"] != 1 || c["hostAddressSet"] != true {
		t.Errorf("containers = %v", c)
	}

	v := snap.Views
	if v["healthChecked"] != 2 || v["healthDown"] != 1 || v["certsDue"] != 1 || v["certsExpired"] != 1 || v["lastCheckHours"] != 2 {
		t.Errorf("health = %v", v)
	}
	if v["inboxUnread"] != 1 || v["inboxNoted"] != 1 || v["bmColumns"] != 2 {
		t.Errorf("inbox/bookmarks = %v", v)
	}

	encoded, _ := json.Marshal(snap)
	for _, private := range []string{"secret-box", "sonarr", "tower.lan", "Private title", "private note", "a.lan", "c.lan"} {
		if strings.Contains(string(encoded), private) {
			t.Errorf("snapshot carries %q: %s", private, encoded)
		}
	}
}

// Off means not collected: a Handlers with no store would panic on any read.
func TestAnalyticsSnapshotsNotCollectedWhenDisabled(t *testing.T) {
	invalidateAnalyticsContentCache()
	if got := (&Handlers{}).analyticsSnapshotsJSON(false); got != "" {
		t.Fatalf("expected nothing while analytics is off, got %q", got)
	}
}
