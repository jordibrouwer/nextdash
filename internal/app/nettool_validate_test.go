package app

import (
	"errors"
	"strings"
	"testing"
)

func withNetTypes(t *testing.T, types ...string) {
	t.Helper()
	old := netTypesBuilt
	netTypesBuilt = map[string]bool{}
	for _, ty := range types {
		netTypesBuilt[ty] = true
	}
	t.Cleanup(func() { netTypesBuilt = old })
}

func netTestSettings() Settings { return Settings{NetToolsMaxChecks: 200} }

func TestNormalizeNetChecksTypeMustBeBuilt(t *testing.T) {
	bm := Bookmark{URL: "https://a.example/"}
	// Nothing is built: every type fails.
	withNetTypes(t)
	if _, err := normalizeNetChecks([]NetCheck{{Type: netTypeTCP}}, nil, bm, netTestSettings(), nil, 0); err == nil {
		t.Fatal("a type that is not built was accepted")
	}
	withNetTypes(t, netTypeTCP)
	out, err := normalizeNetChecks([]NetCheck{{Type: netTypeTCP, Port: 22}}, nil, bm, netTestSettings(), nil, 0)
	if err != nil || len(out) != 1 || len(out[0].ID) != 12 || out[0].Port != 22 {
		t.Fatalf("%+v %v", out, err)
	}
	if _, err := normalizeNetChecks([]NetCheck{{Type: netTypePing}}, nil, bm, netTestSettings(), nil, 0); err == nil {
		t.Fatal("ping accepted while only tcp is built")
	}
}

func TestNormalizeNetChecksMaxSix(t *testing.T) {
	withNetTypes(t, netTypeTCP)
	in := make([]NetCheck, 7)
	for i := range in {
		in[i] = NetCheck{Type: netTypeTCP}
	}
	bm := Bookmark{URL: "https://a.example/"}
	if _, err := normalizeNetChecks(in, nil, bm, netTestSettings(), nil, 0); err == nil {
		t.Fatal("seven checks accepted")
	}
	if _, err := normalizeNetChecks(in[:6], nil, bm, netTestSettings(), nil, 0); err != nil {
		t.Fatalf("six checks refused: %v", err)
	}
}

func TestNormalizeNetChecksIDs(t *testing.T) {
	withNetTypes(t, netTypeTCP)
	bm := Bookmark{URL: "https://a.example/"}
	stored := []NetCheck{{ID: "aaaaaaaaaaaa", Type: netTypeTCP, Baseline: "b", DriftDiff: "d", DriftAt: 5}}
	taken := map[string]bool{"bbbbbbbbbbbb": true}
	in := []NetCheck{
		{ID: "aaaaaaaaaaaa", Type: netTypeTCP, Baseline: "forged", DriftDiff: "forged", DriftAt: 99},
		{ID: "bbbbbbbbbbbb", Type: netTypeTCP}, // ID hijack: another bookmark's check
		{ID: "aaaaaaaaaaaa", Type: netTypeTCP}, // duplicate of the first
		{ID: "cccccccccccc", Type: netTypeTCP}, // unknown ID
	}
	out, err := normalizeNetChecks(in, stored, bm, netTestSettings(), taken, 0)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].ID != "aaaaaaaaaaaa" || out[0].Baseline != "b" || out[0].DriftDiff != "d" || out[0].DriftAt != 5 {
		t.Fatalf("own check lost its ID or server fields: %+v", out[0])
	}
	seen := map[string]bool{}
	for i, c := range out {
		if seen[c.ID] {
			t.Fatalf("duplicate ID %s", c.ID)
		}
		seen[c.ID] = true
		if i > 0 && (c.ID == "bbbbbbbbbbbb" || c.ID == "aaaaaaaaaaaa" || c.ID == "cccccccccccc") {
			t.Fatalf("check %d kept a foreign, duplicate or unknown ID: %s", i, c.ID)
		}
		if i > 0 && (c.Baseline != "" || c.DriftDiff != "" || c.DriftAt != 0) {
			t.Fatalf("check %d got server-owned fields: %+v", i, c)
		}
	}
}

func TestNormalizeNetChecksCap(t *testing.T) {
	withNetTypes(t, netTypeTCP)
	bm := Bookmark{URL: "https://a.example/"}
	s := Settings{NetToolsMaxChecks: 3}
	stored := []NetCheck{{ID: "aaaaaaaaaaaa", Type: netTypeTCP, Enabled: true}, {ID: "bbbbbbbbbbbb", Type: netTypeTCP, Enabled: true}}
	// Two enabled elsewhere, two own already stored: replacing own with two is fine (2+2 > 3 only if own counted twice).
	in := []NetCheck{{ID: "aaaaaaaaaaaa", Type: netTypeTCP, Enabled: true}}
	if _, err := normalizeNetChecks(in, stored, bm, s, nil, 2); err != nil {
		t.Fatalf("own old checks counted against the cap: %v", err)
	}
	in = append(in, NetCheck{Type: netTypeTCP, Enabled: true})
	if _, err := normalizeNetChecks(in, stored, bm, s, nil, 2); !errors.Is(err, errNetCheckCap) {
		t.Fatalf("over the cap: %v", err)
	}
	// Disabled checks do not count.
	in[1].Enabled = false
	if _, err := normalizeNetChecks(in, stored, bm, s, nil, 2); err != nil {
		t.Fatalf("a disabled check counted: %v", err)
	}
}

func TestNormalizeNetChecksFields(t *testing.T) {
	withNetTypes(t, netTypeTCP, netTypePing)
	bm := Bookmark{URL: "https://a.example/"}
	bad := []NetCheck{
		{Type: netTypeTCP, Host: "other.example"},          // custom host off
		{Type: netTypeTCP, Port: 70000},                    // port
		{Type: netTypeTCP, IntervalMinutes: 2},             // interval
		{Type: netTypeTCP, TimeoutSec: 11},                 // timeout
		{Type: netTypePing, Count: 11},                     // count
		{Type: netTypePing, MaxLossPct: 101},               // loss
		{Type: netTypeTCP, Label: strings.Repeat("x", 61)}, // label length
		{Type: netTypeTCP, Label: "a\x00b"},                // control char
	}
	for i, c := range bad {
		if _, err := normalizeNetChecks([]NetCheck{c}, nil, bm, netTestSettings(), nil, 0); err == nil {
			t.Errorf("case %d accepted: %+v", i, c)
		}
	}
	s := netTestSettings()
	s.NetToolsAllowCustomHost = true
	if _, err := normalizeNetChecks([]NetCheck{{Type: netTypeTCP, Host: "http://x"}}, nil, bm, s, nil, 0); err == nil {
		t.Error("an invalid custom host was accepted")
	}
	out, err := normalizeNetChecks([]NetCheck{{Type: netTypePing, Host: " Other.Example ", Port: 5, Label: " x "}}, nil, bm, s, nil, 0)
	if err != nil || out[0].Host != "other.example" || out[0].Port != 0 || out[0].Label != "x" {
		t.Fatalf("%+v %v", out, err)
	}
}
