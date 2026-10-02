package app

import (
	"encoding/json"
	"testing"
)

// Counting and the last entry: what monitoring answers need and an index from
// the front cannot reach. Each path still names one value -- a count is one.
func TestCustomWidgetLookupCountsAndLast(t *testing.T) {
	var gatus, tailscale, kuma, object any
	must := func(raw string, into *any) {
		if err := json.Unmarshal([]byte(raw), into); err != nil {
			t.Fatal(err)
		}
	}
	// Gatus answers with a bare list, newest result first with pageSize=1.
	must(`[
		{"name":"blog","results":[{"success":true,"duration":41000000}]},
		{"name":"git","results":[{"success":false,"duration":0}]},
		{"name":"nas","results":[{"success":false,"duration":0}]}
	]`, &gatus)
	must(`{"devices":[{"hostname":"nas","os":"linux"},{"hostname":"phone","os":"iOS"},{"hostname":"mac","os":"macOS"}]}`, &tailscale)
	must(`{"heartbeats":[{"status":1,"ping":40},{"status":1,"ping":38},{"status":0,"ping":null}]}`, &kuma)
	must(`{"summary":{"0x5000a":{"temp":30},"0x5000b":{"temp":34}}}`, &object)

	cases := []struct {
		doc  any
		path string
		want any
		ok   bool
	}{
		{tailscale, "devices#", float64(3), true},
		{tailscale, "devices[os=linux]#", float64(1), true},
		{tailscale, "devices[os=windows]#", float64(0), true},
		{gatus, "[results.0.success=false]#", float64(2), true},
		{gatus, "#", float64(3), true},
		{gatus, "[results.0.success=false].name", "git", true},
		{gatus, "[results.-1.success=true].name", "blog", true},
		{kuma, "heartbeats[-1].status", float64(0), true},
		{kuma, "heartbeats[-2].ping", float64(38), true},
		{kuma, "heartbeats[-4].ping", nil, false},
		{object, "summary#", float64(2), true},
		// A count is the last step; anything after it names nothing.
		{tailscale, "devices#.hostname", nil, false},
		{tailscale, "devices[0]#", nil, false},
		// What already worked still works.
		{tailscale, "devices[1].hostname", "phone", true},
		{tailscale, "devices[hostname=mac].os", "macOS", true},
	}
	for _, c := range cases {
		got, ok := customWidgetLookup(c.doc, c.path)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("%s: got %v (%v), want %v (%v)", c.path, got, ok, c.want, c.ok)
		}
	}
}
