package app

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

/*
The two app-icon sets, read into one lookup.

dashboard-icons (homarr-labs, Apache-2.0) publishes metadata.json, an object of
name -> {base, aliases, colors}; selfh.st/icons (CC BY 4.0) publishes index.json,
an array of {Name, Reference, SVG, PNG, Light, Dark} with "Yes"/"No" flags.
Both name a variant for a dark background "-light" and one for a light
background "-dark".

dashboard-icons is read first and keeps every key it claims, so a name in both
sets is always dashboard-icons'. An entry's variants come from its own set and
are never mixed with the other's: a light Sonarr from one set beside a dark one
from the other would not be the same drawing.
*/

const (
	iconSetDashboard = "dashboard-icons"
	iconSetSelfhst   = "selfhst"
)

type iconSetEntry struct {
	Set   string
	Name  string // base file name, without extension
	Label string
	// Light and Dark are file names without extension, or empty when the set
	// has no such variant.
	Light   string
	Dark    string
	Ext     string // ".svg" or ".png"
	Aliases []string
}

type iconSetIndex struct {
	byKey map[string]*iconSetEntry
	// entries is what search walks: every entry that owns at least one key.
	entries []*iconSetEntry
	// all also keeps the entries whose every key the other set already owns,
	// so a suggestion can offer the same app from the other set.
	all   []*iconSetEntry
	files map[string]bool // "<set>/<file.ext>"
}

var iconKeyStrip = regexp.MustCompile(`[^a-z0-9]`)

// iconKey is what names are compared on: lowercase letters and digits only,
// so "Home Assistant", "home-assistant" and "homeassistant" meet.
func iconKey(s string) string { return iconKeyStrip.ReplaceAllString(strings.ToLower(s), "") }

// iconFileName keeps upstream names to what the cache route will serve.
var iconFileName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]*$`)

func parseDashboardIconsIndex(data []byte) ([]*iconSetEntry, error) {
	var raw map[string]struct {
		Base    string   `json:"base"`
		Aliases []string `json:"aliases"`
		Colors  *struct {
			Light string `json:"light"`
			Dark  string `json:"dark"`
		} `json:"colors"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	out := make([]*iconSetEntry, 0, len(raw))
	for name, v := range raw {
		if !iconFileName.MatchString(name) {
			continue
		}
		e := &iconSetEntry{Set: iconSetDashboard, Name: name, Label: iconLabelFromName(name), Ext: ".svg", Aliases: v.Aliases}
		if v.Base == "png" {
			e.Ext = ".png"
		}
		if v.Colors != nil {
			if iconFileName.MatchString(v.Colors.Light) {
				e.Light = v.Colors.Light
			}
			if iconFileName.MatchString(v.Colors.Dark) {
				e.Dark = v.Colors.Dark
			}
		}
		out = append(out, e)
	}
	// A map has no order; sorted, two loads of one file build the same index.
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func parseSelfhstIndex(data []byte) ([]*iconSetEntry, error) {
	var raw []struct {
		Name, Reference, SVG, PNG, Light, Dark string
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	out := make([]*iconSetEntry, 0, len(raw))
	for _, v := range raw {
		if !iconFileName.MatchString(v.Reference) || (v.SVG != "Yes" && v.PNG != "Yes") {
			continue
		}
		e := &iconSetEntry{Set: iconSetSelfhst, Name: v.Reference, Label: strings.TrimSpace(v.Name), Ext: ".png"}
		if e.Label == "" {
			e.Label = iconLabelFromName(v.Reference)
		}
		if v.SVG == "Yes" {
			e.Ext = ".svg"
		}
		if v.Light == "Yes" {
			e.Light = v.Reference + "-light"
		}
		if v.Dark == "Yes" {
			e.Dark = v.Reference + "-dark"
		}
		out = append(out, e)
	}
	return out, nil
}

// iconLabelFromName: dashboard-icons has no display names, only file names.
func iconLabelFromName(name string) string {
	parts := strings.Split(name, "-")
	for i, p := range parts {
		if p != "" {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, " ")
}

func buildIconSetIndex(di, sh []*iconSetEntry) *iconSetIndex {
	x := &iconSetIndex{byKey: map[string]*iconSetEntry{}, files: map[string]bool{}}
	sets := [][]*iconSetEntry{di, sh}
	for _, list := range sets {
		for _, e := range list {
			x.all = append(x.all, e)
			for _, f := range []string{e.Name, e.Light, e.Dark} {
				if f != "" {
					x.files[e.Set+"/"+f+e.Ext] = true
				}
			}
		}
	}
	/*
	 * Keys are handed out in rounds -- every name, then every display name,
	 * then every alias -- and within a round dashboard-icons first. An alias
	 * is a loose word ("sonarr" on mediathekarr, "dashy" on homarr): taken
	 * in the same round as the names it took 87 real apps' own names, and
	 * Sonarr showed another app's icon.
	 */
	owners := map[*iconSetEntry]bool{}
	claim := func(e *iconSetEntry, word string) {
		if k := iconKey(word); k != "" {
			if _, taken := x.byKey[k]; !taken {
				x.byKey[k] = e
				owners[e] = true
			}
		}
	}
	rounds := []func(e *iconSetEntry){
		func(e *iconSetEntry) { claim(e, e.Name) },
		func(e *iconSetEntry) { claim(e, e.Label) },
		func(e *iconSetEntry) {
			for _, a := range e.Aliases {
				claim(e, a)
			}
		},
	}
	for _, round := range rounds {
		for _, list := range sets {
			for _, e := range list {
				round(e)
			}
		}
	}
	for _, e := range x.all {
		if owners[e] {
			x.entries = append(x.entries, e)
		}
	}
	return x
}

func (x *iconSetIndex) lookup(candidate string) *iconSetEntry {
	if x == nil {
		return nil
	}
	return x.byKey[iconKey(candidate)]
}

func (x *iconSetIndex) hasFile(set, file string) bool {
	return x != nil && x.files[set+"/"+file]
}

// entry is the one entry with this set and name, whichever keys it owns.
func (x *iconSetIndex) entry(set, name string) *iconSetEntry {
	if x == nil {
		return nil
	}
	for _, e := range x.all {
		if e.Set == set && e.Name == name {
			return e
		}
	}
	return nil
}

// otherSet is the same app's entry in the set e is not from, if any.
func (x *iconSetIndex) otherSet(e *iconSetEntry) *iconSetEntry {
	if x == nil || e == nil {
		return nil
	}
	for _, o := range x.all {
		if o.Set != e.Set && o.Name == e.Name {
			return o
		}
	}
	return nil
}

// search ranks an exact name, then a name or label that starts with the
// query, then an alias that does, then one that contains it. Ties go to
// dashboard-icons, then to the name.
func (x *iconSetIndex) search(q string, limit int) []*iconSetEntry {
	k := iconKey(q)
	if x == nil || k == "" || limit <= 0 {
		return nil
	}
	type hit struct {
		e     *iconSetEntry
		score int
	}
	var hits []hit
	for _, e := range x.entries {
		n, l := iconKey(e.Name), iconKey(e.Label)
		score := -1
		switch {
		case n == k || l == k:
			score = 0
		case strings.HasPrefix(n, k) || strings.HasPrefix(l, k):
			score = 1
		default:
			for _, a := range e.Aliases {
				if strings.HasPrefix(iconKey(a), k) {
					score = 2
					break
				}
			}
			if score < 0 && (strings.Contains(n, k) || strings.Contains(l, k)) {
				score = 3
			}
		}
		if score >= 0 {
			hits = append(hits, hit{e, score})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score < hits[j].score
		}
		if hits[i].e.Set != hits[j].e.Set {
			return hits[i].e.Set == iconSetDashboard
		}
		return hits[i].e.Name < hits[j].e.Name
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	out := make([]*iconSetEntry, len(hits))
	for i, h := range hits {
		out[i] = h.e
	}
	return out
}
