package app

import (
	"os"
	"testing"
)

// loadFixtureIndex reads testdata/icon-sets: real entries from both sets,
// copied unchanged in shape, for every app the match tests name.
func loadFixtureIndex(t *testing.T) *iconSetIndex {
	t.Helper()
	di, err := os.ReadFile("testdata/icon-sets/index-dashboard-icons.json")
	if err != nil {
		t.Fatal(err)
	}
	sh, err := os.ReadFile("testdata/icon-sets/index-selfhst.json")
	if err != nil {
		t.Fatal(err)
	}
	a, err := parseDashboardIconsIndex(di)
	if err != nil {
		t.Fatal(err)
	}
	b, err := parseSelfhstIndex(sh)
	if err != nil {
		t.Fatal(err)
	}
	return buildIconSetIndex(a, b)
}

func TestIconSetIndexLookup(t *testing.T) {
	x := loadFixtureIndex(t)
	cases := []struct{ in, set, name, light, dark string }{
		{"sonarr", iconSetDashboard, "sonarr", "sonarr", "sonarr-dark"},
		{"Home Assistant", iconSetDashboard, "home-assistant", "", ""},
		{"homeassistant", iconSetDashboard, "home-assistant", "", ""},
		{"degoog", iconSetSelfhst, "degoog", "degoog-light", "degoog-dark"},
		{"plex", iconSetDashboard, "plex", "plex-light", "plex"},
	}
	for _, c := range cases {
		e := x.lookup(c.in)
		if e == nil {
			t.Fatalf("%s: no entry", c.in)
		}
		if e.Set != c.set || e.Name != c.name || e.Light != c.light || e.Dark != c.dark {
			t.Errorf("%s: got %+v", c.in, *e)
		}
	}
	if x.lookup("spotweb") != nil {
		t.Error("spotweb is in neither set")
	}
	if !x.hasFile(iconSetDashboard, "sonarr-dark.svg") || x.hasFile(iconSetDashboard, "nope.svg") {
		t.Error("hasFile")
	}
}

// An alias never takes a name another entry has: mediathekarr lists
// "sonarr" among its aliases and sorts first, homarr lists "dashy".
func TestIconSetIndexNamesBeatAliases(t *testing.T) {
	x := loadFixtureIndex(t)
	for _, name := range []string{"sonarr", "radarr", "dashy"} {
		if e := x.lookup(name); e == nil || e.Name != name {
			t.Errorf("%s: got %+v", name, e)
		}
	}
	if e := x.lookup("mediathek"); e == nil || e.Name != "mediathekarr" {
		t.Errorf("an alias nobody else has still matches: %+v", e)
	}
}

func TestIconSetIndexNeverMixesVariants(t *testing.T) {
	x := loadFixtureIndex(t)
	// In both sets: dashboard-icons wins and keeps its own variants.
	e := x.lookup("sonarr")
	if e.Set != iconSetDashboard || e.Dark != "sonarr-dark" {
		t.Fatalf("%+v", *e)
	}
	o := x.otherSet(e)
	if o == nil || o.Set != iconSetSelfhst || o.Dark != "sonarr-dark" {
		t.Fatalf("other set: %+v", o)
	}
}

func TestIconSetSearchRanking(t *testing.T) {
	x := loadFixtureIndex(t)
	got := x.search("jelly", 10)
	if len(got) < 3 || got[0].Name != "jellyfin" || got[1].Name != "jellyseerr" {
		names := []string{}
		for _, e := range got {
			names = append(names, e.Name)
		}
		t.Fatalf("%v", names)
	}
	if r := x.search("", 10); len(r) != 0 {
		t.Fatal("an empty query returns nothing")
	}
	if r := x.search("e", 2); len(r) != 2 {
		t.Fatalf("limit: %d", len(r))
	}
}
