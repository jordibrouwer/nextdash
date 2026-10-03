package app

import (
	"net"
	"net/url"
	"regexp"
	"strings"
)

/*
Which app a container or a bookmark is, by name.

Candidates are tried in order of certainty and the first one the index knows
wins:

 1. the image's repository name, without registry, owner, tag or digest;
 2. the container's own name;
 3. both again with packaging words taken off (binhex-, -docker, vpn, ...);
 4. the same with trailing digits taken off (postgresql17 -> postgresql);
 5. shorter and shorter prefixes, one segment at a time
    (jellyfin-newsletter -> jellyfin).

A container whose tag moved on reports a bare image ID; that has no name to
read, so its container name carries it.

Bookmarks match on a host label only where that label is likely to be an app:
the leftmost of three or more (sonarr.example.ts.net) or a single-label host
(http://sonarr:8989). A public two-label domain like github.com keeps its own
favicon, and an IP address has no name at all.
*/

var (
	imageIDPattern   = regexp.MustCompile(`^(sha256:)?[0-9a-f]{12,64}$`)
	trailingDigits   = regexp.MustCompile(`[0-9]+$`)
	iconNamePrefixes = []string{"docker-", "docker_", "arch-", "arch_", "binhex-", "binhex_"}
	iconNameSuffixes = []string{"-docker", "_docker", "-official", "-unbound", "-supervised", "vpn", "-quickstart", "-agent", "-server", "-app"}
	hostLabelStop    = map[string]bool{"www": true, "app": true, "web": true, "my": true, "home": true, "portal": true, "dashboard": true}
)

// imageRepoName: lscr.io/linuxserver/sonarr:latest@sha256:... -> sonarr.
func imageRepoName(image string) string {
	image = strings.ToLower(strings.TrimSpace(image))
	if i := strings.Index(image, "@"); i >= 0 {
		image = image[:i]
	}
	if imageIDPattern.MatchString(image) {
		return ""
	}
	if i := strings.LastIndex(image, "/"); i >= 0 {
		image = image[i+1:]
	}
	if i := strings.Index(image, ":"); i >= 0 {
		image = image[:i]
	}
	return image
}

func normalizeIconName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	for _, p := range iconNamePrefixes {
		s = strings.TrimPrefix(s, p)
	}
	for _, suf := range iconNameSuffixes {
		s = strings.TrimSuffix(s, suf)
	}
	return s
}

func prefixCandidates(s string) []string {
	parts := strings.FieldsFunc(s, func(r rune) bool { return r == '-' || r == '_' || r == '.' })
	var out []string
	for n := len(parts) - 1; n >= 1; n-- {
		out = append(out, strings.Join(parts[:n], "-"))
	}
	return out
}

// iconCandidates runs steps 1-5 over the bases in order; a candidate shorter
// than three letters or digits says too little to match on.
func iconCandidates(bases []string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(s string) {
		k := iconKey(s)
		if len(k) < 3 || seen[k] {
			return
		}
		seen[k] = true
		out = append(out, s)
	}
	for _, b := range bases {
		add(b)
	}
	for _, b := range bases {
		add(normalizeIconName(b))
	}
	for _, b := range bases {
		add(trailingDigits.ReplaceAllString(normalizeIconName(b), ""))
	}
	for _, b := range bases {
		for _, p := range prefixCandidates(normalizeIconName(b)) {
			add(p)
		}
	}
	return out
}

func containerIconCandidates(image, name string) []string {
	var bases []string
	if repo := imageRepoName(image); repo != "" {
		bases = append(bases, repo)
	}
	if n := strings.TrimPrefix(strings.TrimSpace(name), "/"); n != "" {
		bases = append(bases, n)
	}
	return iconCandidates(bases)
}

func bookmarkHostCandidates(rawURL string) []string {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || net.ParseIP(host) != nil {
		return nil
	}
	labels := strings.Split(host, ".")
	switch {
	case len(labels) == 1:
		return iconCandidates([]string{labels[0]})
	case len(labels) >= 3 && !hostLabelStop[labels[0]]:
		return iconCandidates([]string{labels[0]})
	}
	return nil
}

func (x *iconSetIndex) firstMatch(cands []string) *iconSetEntry {
	for _, c := range cands {
		if e := x.lookup(c); e != nil {
			return e
		}
	}
	return nil
}

func (x *iconSetIndex) matchContainer(image, name string) *iconSetEntry {
	return x.firstMatch(containerIconCandidates(image, name))
}

func (x *iconSetIndex) matchBookmarkHost(rawURL string) *iconSetEntry {
	return x.firstMatch(bookmarkHostCandidates(rawURL))
}

// suggestionsFor offers each candidate's entry followed by the same app from
// the other set, without repeats, at most limit.
func (x *iconSetIndex) suggestionsFor(cands []string, limit int) []*iconSetEntry {
	var out []*iconSetEntry
	seen := map[*iconSetEntry]bool{}
	push := func(e *iconSetEntry) {
		if e != nil && !seen[e] && len(out) < limit {
			seen[e] = true
			out = append(out, e)
		}
	}
	for _, c := range cands {
		e := x.lookup(c)
		push(e)
		push(x.otherSet(e))
	}
	return out
}
