package app

import (
	"os"
	"strings"
	"testing"
)

func TestNormalizeStatusPageTrimsAndFillsIDs(t *testing.T) {
	in := StatusPageConfig{
		Title:  "  Home services  ",
		Notice: "  Guest wifi  ",
		Groups: []StatusGroup{{
			Name: "  Media ",
			Services: []StatusService{
				{Name: " Jellyfin ", MonitorURL: " https://jf.lan ", Container: " jellyfin "},
				{Name: "Nothing"}, // neither source: dropped
			},
		}},
	}
	out := normalizeStatusPage(in)
	if out.Title != "Home services" || out.Notice != "Guest wifi" {
		t.Fatalf("title/notice not trimmed: %q %q", out.Title, out.Notice)
	}
	if len(out.Groups) != 1 || out.Groups[0].ID == "" || out.Groups[0].Name != "Media" {
		t.Fatalf("group not normalised: %+v", out.Groups)
	}
	svcs := out.Groups[0].Services
	if len(svcs) != 1 {
		t.Fatalf("service without a source kept: %+v", svcs)
	}
	if svcs[0].ID == "" || svcs[0].Name != "Jellyfin" || svcs[0].MonitorURL != "https://jf.lan" || svcs[0].Container != "jellyfin" {
		t.Fatalf("service not normalised: %+v", svcs[0])
	}
}

func TestNormalizeStatusPageDefaultsServiceName(t *testing.T) {
	out := normalizeStatusPage(StatusPageConfig{Groups: []StatusGroup{{Name: "G", Services: []StatusService{
		{Container: "immich-server"},
	}}}})
	if got := out.Groups[0].Services[0].Name; got != "immich-server" {
		t.Fatalf("empty name should default to the container name, got %q", got)
	}
}

func TestNormalizeStatusPageCaps(t *testing.T) {
	var c StatusPageConfig
	for i := 0; i < 25; i++ {
		g := StatusGroup{Name: "g"}
		for j := 0; j < 60; j++ {
			g.Services = append(g.Services, StatusService{Container: "c"})
		}
		c.Groups = append(c.Groups, g)
	}
	out := normalizeStatusPage(c)
	if len(out.Groups) != statusPageMaxGroups {
		t.Fatalf("groups = %d, want %d", len(out.Groups), statusPageMaxGroups)
	}
	if len(out.Groups[0].Services) != statusPageMaxServices {
		t.Fatalf("services = %d, want %d", len(out.Groups[0].Services), statusPageMaxServices)
	}
}

func TestNormalizeStatusPageKeepsUniqueIDs(t *testing.T) {
	out := normalizeStatusPage(StatusPageConfig{Groups: []StatusGroup{
		{ID: "same", Name: "a"}, {ID: "same", Name: "b"},
	}})
	if out.Groups[0].ID != "same" || out.Groups[0].ID == out.Groups[1].ID {
		t.Fatalf("first id must stay, duplicate must change: %q %q", out.Groups[0].ID, out.Groups[1].ID)
	}
}

func TestStatusPageRoundTrip(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if c, err := readStatusPage(); err != nil || c.Enabled || len(c.Groups) != 0 {
		t.Fatalf("missing file should read as empty config, got %+v %v", c, err)
	}
	want := StatusPageConfig{Enabled: true, Title: "Home", Groups: []StatusGroup{{Name: "Media", Services: []StatusService{{MonitorURL: "https://jf.lan", ShowLink: true}}}}}
	if err := writeStatusPage(want); err != nil {
		t.Fatal(err)
	}
	got, err := readStatusPage()
	if err != nil || !got.Enabled || got.Title != "Home" || got.Groups[0].Services[0].MonitorURL != "https://jf.lan" || !got.Groups[0].Services[0].ShowLink {
		t.Fatalf("round trip lost data: %+v %v", got, err)
	}
}

func TestStatusPageInvalidFileIsAnError(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.WriteFile(statusPageFilePath(), []byte("{not json"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := readStatusPage(); err == nil {
		t.Fatal("invalid JSON must be reported, not read as an empty page")
	}
}

func TestStatusPageFilesHaveBackupPolicy(t *testing.T) {
	if p, ok := dataFiles["status-page.json"]; !ok || p != dataKeep {
		t.Errorf("status-page.json must be dataKeep")
	}
	if p, ok := dataFiles["status-page-secrets.json"]; !ok || p != dataNever {
		t.Errorf("status-page-secrets.json must be dataNever: a restored backup must not revive an old link")
	}
}

func TestNewStatusIDIsURLSafe(t *testing.T) {
	id := newStatusID()
	if len(id) < 8 || strings.ContainsAny(id, "+/=") {
		t.Fatalf("id %q is not a short URL-safe id", id)
	}
}
