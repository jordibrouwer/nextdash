package app

import (
	"strings"
	"testing"
)

func TestDiscoveryCandidates(t *testing.T) {
	ports := []dockerPort{{IP: "0.0.0.0", PrivatePort: 8989, PublicPort: 8989, Type: "tcp"},
		{IP: "127.0.0.1", PrivatePort: 9000, PublicPort: 9000, Type: "tcp"},
		{IP: "0.0.0.0", PrivatePort: 53, PublicPort: 53, Type: "udp"}}
	cases := []struct {
		name   string
		labels map[string]string
		manual string
		want   []string // URLs in order
	}{
		{"ports only: tcp, not loopback, not udp", nil, "", []string{"http://10.0.0.5:8989"}},
		{"traefik host, tls", map[string]string{
			"traefik.http.routers.sonarr.rule": "Host(`sonarr.home.lan`)",
			"traefik.http.routers.sonarr.tls":  "true"}, "",
			[]string{"https://sonarr.home.lan", "http://10.0.0.5:8989"}},
		{"traefik entrypoint websecure, two hosts, path", map[string]string{
			"traefik.http.routers.a.rule":        "Host(`a.lan`) || Host(`b.lan`) && PathPrefix(`/app`)",
			"traefik.http.routers.a.entrypoints": "websecure"}, "",
			[]string{"https://a.lan/app", "https://b.lan/app", "http://10.0.0.5:8989"}},
		{"traefik host list", map[string]string{"traefik.http.routers.x.rule": "Host(`x.lan`,`y.lan`)"}, "",
			[]string{"http://x.lan", "http://y.lan", "http://10.0.0.5:8989"}},
		{"traefik disabled", map[string]string{"traefik.enable": "false",
			"traefik.http.routers.x.rule": "Host(`x.lan`)"}, "", []string{"http://10.0.0.5:8989"}},
		{"caddy bare host means https", map[string]string{"caddy": "sonarr.home.lan"}, "",
			[]string{"https://sonarr.home.lan", "http://10.0.0.5:8989"}},
		{"caddy_1 url", map[string]string{"caddy_1": "http://s.lan"}, "", []string{"http://s.lan", "http://10.0.0.5:8989"}},
		{"unraid webui", map[string]string{"net.unraid.docker.webui": "http://[IP]:[PORT:8989]/"}, "",
			[]string{"http://10.0.0.5:8989/", "http://10.0.0.5:8989"}},
		{"nextdash.url beats proxy", map[string]string{"nextdash.url": "https://my.lan",
			"caddy": "c.lan"}, "", []string{"https://my.lan", "https://c.lan", "http://10.0.0.5:8989"}},
		{"manual beats all", map[string]string{"nextdash.url": "https://my.lan"}, "https://hand.lan",
			[]string{"https://hand.lan", "https://my.lan", "http://10.0.0.5:8989"}},
		{"non-http label ignored", map[string]string{"nextdash.url": "javascript:alert(1)"}, "",
			[]string{"http://10.0.0.5:8989"}},
	}
	for _, c := range cases {
		got := discoveryCandidates(dockerContainerSummary{Names: []string{"/sonarr"}, Labels: c.labels, Ports: ports}, "10.0.0.5", "", c.manual)
		var urls []string
		for _, g := range got {
			urls = append(urls, g.URL)
		}
		if strings.Join(urls, " ") != strings.Join(c.want, " ") {
			t.Errorf("%s: got %v, want %v", c.name, urls, c.want)
		}
	}
}

func TestDiscoveryCandidateSources(t *testing.T) {
	ports := []dockerPort{{IP: "0.0.0.0", PrivatePort: 8989, PublicPort: 8989, Type: "tcp"}}
	got := discoveryCandidates(dockerContainerSummary{Names: []string{"/sonarr"},
		Labels: map[string]string{"nextdash.url": "https://my.lan"}, Ports: ports}, "10.0.0.5", "", "https://hand.lan")
	want := []discoverySource{discoveryManual, discoveryLabel, discoveryPort}
	if len(got) != len(want) {
		t.Fatalf("got %v, want sources %v", got, want)
	}
	for i := range want {
		if got[i].Source != want[i] {
			t.Errorf("candidate %d: source %q, want %q", i, got[i].Source, want[i])
		}
	}
}

func TestDiscoveryCandidatesPortCap(t *testing.T) {
	var ports []dockerPort
	for p := 8001; p <= 8008; p++ {
		ports = append(ports, dockerPort{IP: "0.0.0.0", PrivatePort: p, PublicPort: p, Type: "tcp"})
	}
	got := discoveryCandidates(dockerContainerSummary{Names: []string{"/x"}, Ports: ports}, "h", "", "")
	if len(got) != 4 {
		t.Errorf("got %d port candidates, want 4", len(got))
	}
}
