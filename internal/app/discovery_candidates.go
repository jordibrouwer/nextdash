package app

import (
	"net"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

/*
Where a container's web page might live, worked out from what the container
itself says: labels and published ports. Nothing here talks to a proxy or to
another container -- the labels are read, the guesses are probed later.
*/

type discoverySource string

// In preference order: an address Jordi typed beats one a container claims,
// a container's own claim beats a proxy label, and a bare port is the last guess.
const (
	discoveryManual discoverySource = "manual"
	discoveryLabel  discoverySource = "label"
	discoveryProxy  discoverySource = "proxy"
	discoveryUnraid discoverySource = "unraid"
	discoveryPort   discoverySource = "port"
)

const discoveryMaxPortCandidates = 4

type discoveryCandidate struct {
	URL    string
	Source discoverySource
}

var (
	traefikRouterRule = regexp.MustCompile("^traefik\\.http\\.routers\\.([^.]+)\\.rule$")
	traefikHostCall   = regexp.MustCompile("Host\\(([^)]*)\\)")
	traefikPathCall   = regexp.MustCompile("PathPrefix\\(`([^`]*)`\\)")
	backtickQuoted    = regexp.MustCompile("`([^`]*)`")
	caddyLabelName    = regexp.MustCompile(`^caddy(_\d+)?$`)
)

// discoveryHTTPURL returns u when it is a usable http(s) address, else "".
func discoveryHTTPURL(u string) string {
	u = strings.TrimSpace(u)
	p, err := url.Parse(u)
	if err != nil || (p.Scheme != "http" && p.Scheme != "https") || p.Hostname() == "" {
		return ""
	}
	return u
}

func discoveryTraefik(labels map[string]string) []string {
	if strings.EqualFold(labels["traefik.enable"], "false") {
		return nil
	}
	var routers []string
	for k := range labels {
		if m := traefikRouterRule.FindStringSubmatch(k); m != nil {
			routers = append(routers, m[1])
		}
	}
	sort.Strings(routers)
	var out []string
	for _, r := range routers {
		prefix := "traefik.http.routers." + r + "."
		rule := labels[prefix+"rule"]
		scheme := "http"
		ep := strings.ToLower(labels[prefix+"entrypoints"])
		if strings.EqualFold(labels[prefix+"tls"], "true") || strings.Contains(ep, "secure") || strings.Contains(ep, "443") {
			scheme = "https"
		}
		path := ""
		if m := traefikPathCall.FindStringSubmatch(rule); m != nil {
			path = m[1]
		}
		for _, call := range traefikHostCall.FindAllStringSubmatch(rule, -1) {
			for _, h := range backtickQuoted.FindAllStringSubmatch(call[1], -1) {
				if h[1] != "" {
					out = append(out, scheme+"://"+h[1]+path)
				}
			}
		}
	}
	return out
}

func discoveryCaddy(labels map[string]string) []string {
	var names []string
	for k := range labels {
		if caddyLabelName.MatchString(k) {
			names = append(names, k)
		}
	}
	sort.Strings(names)
	var out []string
	for _, k := range names {
		for _, addr := range strings.Fields(labels[k]) {
			addr = strings.TrimRight(addr, ",")
			if !strings.Contains(addr, "://") {
				addr = "https://" + addr
			}
			out = append(out, addr)
		}
	}
	return out
}

// discoveryCandidates lists the addresses a container's page may answer on,
// best first and without repeats. host is the address port links use, lanIP
// the container's own LAN address when it has one, manualURL the address
// typed into Docker's WebUI settings (or "").
func discoveryCandidates(c dockerContainerSummary, host, lanIP, manualURL string) []discoveryCandidate {
	var out []discoveryCandidate
	seen := map[string]bool{}
	add := func(u string, src discoverySource) {
		if u = discoveryHTTPURL(u); u != "" && !seen[u] {
			seen[u] = true
			out = append(out, discoveryCandidate{URL: u, Source: src})
		}
	}
	add(manualURL, discoveryManual)
	add(c.Labels["nextdash.url"], discoveryLabel)
	for _, u := range discoveryTraefik(c.Labels) {
		add(u, discoveryProxy)
	}
	for _, u := range discoveryCaddy(c.Labels) {
		add(u, discoveryProxy)
	}
	if tpl := dockerWebUI(c); tpl != "" {
		ip := host
		if lanIP != "" {
			ip = lanIP
		}
		add(strings.ReplaceAll(tpl, "[IP]", ip), discoveryUnraid)
	}
	n := 0
	for _, p := range c.Ports {
		if n >= discoveryMaxPortCandidates {
			break
		}
		if p.PublicPort <= 0 || !strings.EqualFold(p.Type, "tcp") {
			continue
		}
		if ip := net.ParseIP(p.IP); ip != nil && ip.IsLoopback() {
			continue
		}
		u := "http://" + net.JoinHostPort(host, strconv.Itoa(p.PublicPort))
		if !seen[u] {
			n++
		}
		add(u, discoveryPort)
	}
	return out
}
