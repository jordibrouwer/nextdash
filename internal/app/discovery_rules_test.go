package app

import (
	"slices"
	"testing"
)

func TestDiscoveryKind(t *testing.T) {
	cases := map[string]string{
		"lscr.io/linuxserver/jellyfin:latest": "Media",
		"plexinc/pms-docker":                  "Media",
		"ghcr.io/hotio/sonarr":                "Media management",
		"linuxserver/qbittorrent":             "Downloads",
		"louislam/uptime-kuma:2":              "Monitoring",
		"pihole/pihole":                       "Network",
		"homeassistant/home-assistant":        "Home",
		"ghcr.io/immich-app/immich-server":    "Documents & photos",
		"gitea/gitea":                         "Development",
		"some/unknown-thing":                  "Apps",
	}
	for image, want := range cases {
		if got := discoveryKind(image, "", nil); got != want {
			t.Errorf("%s: got %q, want %q", image, got, want)
		}
	}
	if got := discoveryKind("x/y", "", map[string]string{"nextdash.category": "Family"}); got != "Family" {
		t.Errorf("label: %q", got)
	}
	// A name can decide when the image does not: a renamed build of Sonarr.
	if got := discoveryKind("registry.lan/custom:1", "sonarr", nil); got != "Media management" {
		t.Errorf("by name: %q", got)
	}
	if got := discoveryKind("registry.lan/custom:1", "/sonarr", nil); got != "Media management" {
		t.Errorf("by slashed name: %q", got)
	}
}

func TestDiscoveryKindsAllNamed(t *testing.T) {
	for _, k := range discoveryKindMap {
		if !slices.Contains(discoveryKinds, k) {
			t.Errorf("kind %q is not in discoveryKinds", k)
		}
	}
}

func TestDiscoverySkipReasons(t *testing.T) {
	base := dockerContainerSummary{ID: "abc", Names: []string{"/app"}, Image: "x/app"}
	s := Settings{DiscoveryIgnored: []string{"ign"}, DockerHiddenContainers: []string{"hid"}}
	with := func(f func(*dockerContainerSummary)) dockerContainerSummary { c := base; f(&c); return c }
	cases := []struct {
		c    dockerContainerSummary
		want string
	}{
		{base, ""},
		{with(func(c *dockerContainerSummary) { c.Labels = map[string]string{"nextdash.hide": "true"} }), "hidden-label"},
		{with(func(c *dockerContainerSummary) { c.Names = []string{"/ign"} }), "ignored"},
		{with(func(c *dockerContainerSummary) { c.Names = []string{"/hid"} }), "hidden-view"},
		{with(func(c *dockerContainerSummary) { c.Image = "postgres:16" }), "denied-image"},
		{with(func(c *dockerContainerSummary) { c.Image = "redis:7-alpine" }), "denied-image"},
		{with(func(c *dockerContainerSummary) { c.Image = "tecnativa/docker-socket-proxy" }), "denied-image"},
	}
	for i, c := range cases {
		if got := discoverySkipReason(c.c, s, "self123"); got != c.want {
			t.Errorf("case %d: got %q, want %q", i, got, c.want)
		}
	}
}

func TestDiscoverySkipsSelf(t *testing.T) {
	c := dockerContainerSummary{ID: "self123fullid", Names: []string{"/nextdash"}, Image: "foobar1452/nextdash"}
	if got := discoverySkipReason(c, Settings{}, "self123"); got != "self" {
		t.Fatalf("got %q", got)
	}
}

func TestDiscoverySelfIDIsEmptyOutsideContainer(t *testing.T) {
	// No /proc on macOS, and no 64-hex id on a dev machine either way.
	if got := discoverySelfID(); len(got) != 0 && len(got) != 12 && len(got) != 64 {
		t.Fatalf("unexpected id %q", got)
	}
}
