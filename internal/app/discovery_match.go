package app

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

/*
Which bookmark a container already has, worked out the way the browser does it
(bookmarkFor in static/js/dashboard/docker-search-index.js): the same steps in
the same order, so the server and the Containers view never disagree about
whether an app is already on a page. tests/container-bookmark-match.test.cjs
runs the browser's function over the same fixture as the Go test.
*/

// discoveryContainer is the browser's container shape, reduced to what
// matching reads. Ports are the published, non-UDP ones.
type discoveryContainer struct {
	Name  string `json:"name"`
	WebUI string `json:"webui"`
	LanIP string `json:"lanIP"`
	Ports []int  `json:"ports"`
}

var (
	matchLooseRe = regexp.MustCompile(`[^a-z0-9]`)
	matchHTTPRe  = regexp.MustCompile(`(?i)^https?://`)
)

// looseMatchName: "Sonarr-4K", "sonarr_4k" and "sonarr 4k" are one name.
func looseMatchName(v string) string {
	return matchLooseRe.ReplaceAllString(strings.ToLower(v), "")
}

type matchURL struct{ host, port string }

func parseMatchURL(raw string) (matchURL, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return matchURL{}, false
	}
	port := u.Port()
	if port == "" {
		port = "80"
		if u.Scheme == "https" {
			port = "443"
		}
	}
	return matchURL{host: strings.ToLower(u.Hostname()), port: port}, true
}

func matchBookmarkKey(b Bookmark) string {
	return strconv.Itoa(b.PageID) + "::" + strings.TrimSpace(b.URL)
}

// oneMatchAddress keeps one bookmark per address: the same link on two pages
// is one candidate.
func oneMatchAddress(list []Bookmark) []Bookmark {
	seen := map[string]bool{}
	var out []Bookmark
	for _, b := range list {
		u := strings.TrimSpace(b.URL)
		if !seen[u] {
			seen[u] = true
			out = append(out, b)
		}
	}
	return out
}

// matchContainerBookmark returns the key (pageId::url) of the container's
// bookmark and why: "manual", else "port", else "subdomain", else "title". The
// first step that finds exactly one address wins; two at one step is no guess.
// hosts holds the names this server goes by; hosts[0] is the host address that
// fills [IP] in a web UI address.
func matchContainerBookmark(c discoveryContainer, bookmarks []Bookmark, links map[string]string, hosts []string) (key string, via string, ok bool) {
	var all []Bookmark
	for _, b := range bookmarks {
		if b.URL != "" {
			all = append(all, b)
		}
	}
	manual := links[c.Name]
	if manual == "-" {
		return "", "", false
	}
	if manual != "" {
		for _, b := range all {
			if matchBookmarkKey(b) == manual {
				return manual, "manual", true
			}
		}
	}

	hostSet := map[string]bool{}
	addHost := func(h string) {
		h = strings.TrimSuffix(strings.TrimPrefix(strings.ToLower(h), "["), "]")
		if h != "" {
			hostSet[h] = true
		}
	}
	for _, h := range hosts {
		addHost(h)
	}
	addHost(c.LanIP)
	addHost("localhost")
	addHost("127.0.0.1")

	portSet := map[string]bool{}
	hostAddr := ""
	if len(hosts) > 0 {
		hostAddr = hosts[0]
	}
	if web, found := parseMatchURL(matchWebuiHref(c.WebUI, c.LanIP, hostAddr)); found {
		hostSet[web.host] = true
		portSet[web.port] = true
	}
	for _, p := range c.Ports {
		if p > 0 {
			portSet[strconv.Itoa(p)] = true
		}
	}

	name := looseMatchName(c.Name)
	steps := []struct {
		via  string
		test func(u matchURL, b Bookmark) bool
	}{
		{"port", func(u matchURL, _ Bookmark) bool { return portSet[u.port] && hostSet[u.host] }},
		{"subdomain", func(u matchURL, _ Bookmark) bool {
			return name != "" && strings.Contains(u.host, ".") && looseMatchName(strings.SplitN(u.host, ".", 2)[0]) == name
		}},
		{"title", func(_ matchURL, b Bookmark) bool { return name != "" && looseMatchName(b.Name) == name }},
	}
	for _, step := range steps {
		var hit []Bookmark
		for _, b := range all {
			if u, found := parseMatchURL(b.URL); found && step.test(u, b) {
				hit = append(hit, b)
			}
		}
		hit = oneMatchAddress(hit)
		if len(hit) == 1 {
			return matchBookmarkKey(hit[0]), step.via, true
		}
		if len(hit) > 1 {
			return "", "", false
		}
	}
	return "", "", false
}

// matchWebuiHref is webuiHref in the browser: [IP] becomes the container's own
// LAN address, else the host address; anything but http(s) is no link.
func matchWebuiHref(raw, lanIP, hostAddr string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	ip := lanIP
	if ip == "" {
		ip = hostAddr
	}
	href := strings.Replace(value, "[IP]", ip, 1)
	if matchHTTPRe.MatchString(href) {
		return href
	}
	return ""
}
