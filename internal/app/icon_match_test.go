package app

import "testing"

// The containers on a real Unraid server (Tower, 2 October 2026), image and
// name as `docker ps` printed them. Bare hex images are containers whose tag
// moved on after an update.
func TestMatchContainerTower(t *testing.T) {
	x := loadFixtureIndex(t)
	cases := []struct{ image, name, want string }{
		{"searxng/searxng", "SearXNG", "searxng"},
		{"ghcr.io/jordibrouwer/nextdash:latest", "NextDash", ""},
		{"nextcloud:latest", "Nextcloud", "nextcloud"},
		{"lscr.io/linuxserver/nzbhydra2", "nzbhydra2", "nzbhydra2"},
		{"ghcr.io/hotio/whisparr:latest", "whisparr", "whisparr"},
		{"ghcr.io/connorgallopo/tracearr:supervised", "tracearr-supervised", "tracearr"},
		{"jgeusebroek/spotweb", "spotweb", ""},
		{"ghcr.io/calibrain/shelfmark:latest", "shelfmark", "shelfmark"},
		{"ghcr.io/seerr-team/seerr:latest", "Seerr", "seerr"},
		{"lscr.io/linuxserver/sabnzbd", "sabnzbd", "sabnzbd"},
		{"redis", "Redis", "redis"},
		{"ghcr.io/jessielw/reclaimerr:latest", "Reclaimerr", "reclaimerr"},
		{"postgres:17", "postgresql17", "postgres"},
		{"ghcr.io/fscorrupt/posterizarr:latest", "posterizarr", "posterizarr"},
		{"lscr.io/linuxserver/mylar3:nightly", "mylar3", "mylar-3"},
		{"lscr.io/linuxserver/mariadb", "mariadb", "mariadb"},
		{"lscr.io/linuxserver/lazylibrarian", "lazylibrarian", "lazylibrarian"},
		{"ghcr.io/seaweedbraincy/jellyfin-newsletter:latest", "Jellyfin-Newsletter", "jellyfin"},
		{"ghcr.io/imagegenius/immich:latest", "immich", "immich"},
		{"lscr.io/linuxserver/homeassistant", "homeassistant", "home-assistant"},
		{"lscr.io/linuxserver/duplicati", "duplicati", "duplicati"},
		{"ghcr.io/cenodude/crosswatch:latest", "CrossWatch", "crosswatch"},
		{"cloudflare/cloudflared:latest", "CloudflaredTunnel", "cloudflared"},
		{"crocodilestick/calibre-web-automated:latest", "calibre-web-automated", "calibre-web"},
		{"lscr.io/linuxserver/nginx", "nginx", "nginx"},
		{"lscr.io/linuxserver/bazarr", "bazarr", "bazarr"},
		{"luuul/4get:latest", "4get", ""},
		{"ghcr.io/themepark-dev/theme.park", "theme-park", "themepark"},
		{"lscr.io/linuxserver/prowlarr", "prowlarr", "prowlarr"},
		{"photoprism/photoprism", "PhotoPrism", "photoprism"},
		{"ghcr.io/av1155/houndarr:latest", "houndarr", "houndarr"},
		{"henrygd/beszel-agent:latest", "beszel-agent", "beszel"},
		{"henrygd/beszel:latest", "beszel", "beszel"},
		{"ghcr.io/mainfrezzer/adguardhome", "AdGuard-Home-Unbound", "adguard-home"},
		{"ciuse99/suggestarr:latest", "SuggestArr", "suggest-arr"},
		{"jellyfin/jellyfin:latest", "Jellyfin", "jellyfin"},
		{"ghcr.io/ghomashudson/jellyfin-auto-collections:latest", "Jellyfin-Auto-Collections", "jellyfin"},
		{"cyfershepard/jellystat:latest", "Jellystat", "jellystat"},
		{"ghcr.io/chrizzo84/adguard-buddy:latest", "AdGuardBuddy", ""},
		{"ghcr.io/fccview/degoog:latest", "degoog", "degoog"},
		{"ghcr.io/m3sserstudi0s/swiparr:latest", "Swiparr", "swiparr"},
		{"oznu/cloudflare-ddns", "Cloudflare-DDNS", "cloudflare"},
		{"corentinth/it-tools:latest", "it-tools", "it-tools"},
		{"cloudflare/cloudflared:2021.8.2", "cloudflared", "cloudflared"},
		// The API reports a moved-on image as its full ID; `docker ps` shortens it.
		{"sha256:5a29acd9cee5d1f0a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819", "radarr", "radarr"},
		{"4874781c27d8", "sonarr", "sonarr"},
		{"a5180aa61e47", "phpmyadmin", "phpmyadmin"},
		{"3333b264411e", "calibre", "calibre"},
		{"e3f9fd85ccab", "Nginx-Proxy-Manager-Official", "nginx-proxy-manager"},
		{"binhex/arch-qbittorrentvpn:5.1.2-1-05", "binhex-qbittorrentvpn", "qbittorrent"},
		{"6ab4385127e6", "unpackerr", "unpackerr"},
		{"tensorchord/pgvecto-rs:pg16-v0.3.0", "PostgreSQL_Immich", "postgresql"},
		{"spaceinvaderone/vm_custom_icons", "vm_custom_icons", ""},
		{"stonith404/pingvin-share", "pingvin-share", "pingvin-share"},
		{"21fae0936d67", "Posterizarr", "posterizarr"},
		{"d23166ef0f9f", "kometa", "kometa"},
		{"d060ea4008cb", "Jellyfin-auto-collections", "jellyfin"},
		{"d9640d23bfe3", "speedtest-tracker", "speedtest-tracker"},
		{"ccf535db99ca", "Tailscale-Docker", "tailscale"},
		{"corentinth/it-tools", "IT-Tools", "it-tools"},
		{"820f8f018984", "Kometa-Quickstart", "kometa"},
		{"e78b074bb573", "Komga", "komga"},
	}
	for _, c := range cases {
		got := ""
		if e := x.matchContainer(c.image, c.name); e != nil {
			got = e.Name
		}
		if got != c.want {
			t.Errorf("%s / %s: got %q, want %q (candidates %v)", c.image, c.name, got, c.want, containerIconCandidates(c.image, c.name))
		}
	}
}

func TestMatchBookmarkHost(t *testing.T) {
	x := loadFixtureIndex(t)
	cases := []struct{ url, want string }{
		{"https://sonarr.tailae75e.ts.net", "sonarr"},
		{"https://qbittorrent.lintgras.cc/", "qbittorrent"},
		{"https://calibre-web-automated.tailae75e.ts.net", "calibre-web"},
		{"http://sonarr:8989", "sonarr"},
		{"https://github.com/foo", ""},
		{"http://192.168.0.3", ""},
		{"http://[::1]:8080", ""},
		{"https://www.example.com", ""},
		{"https://dashboard.example.com", ""},
		{"ftp://sonarr.example.com", ""},
		{"not a url", ""},
	}
	for _, c := range cases {
		got := ""
		if e := x.matchBookmarkHost(c.url); e != nil {
			got = e.Name
		}
		if got != c.want {
			t.Errorf("%s: got %q want %q", c.url, got, c.want)
		}
	}
}

func TestSuggestionsOfferTheOtherSet(t *testing.T) {
	x := loadFixtureIndex(t)
	got := x.suggestionsFor(bookmarkHostCandidates("https://sonarr.example.ts.net"), 3)
	if len(got) != 2 || got[0].Set != iconSetDashboard || got[1].Set != iconSetSelfhst || got[1].Name != "sonarr" {
		t.Fatalf("%+v", got)
	}
}

// An alias is a loose word: "maps" on Apple Maps gave maps.google.com the
// Apple Maps icon, and the container "app" got Miro. A match reads names
// only; a suggestion still offers the alias.
func TestAnAliasIsNotAnAutomaticMatch(t *testing.T) {
	di := []byte(`{"apple-maps":{"aliases":["maps"],"base":"svg"},"miro":{"aliases":["app"],"base":"svg"}}`)
	a, err := parseDashboardIconsIndex(di)
	if err != nil {
		t.Fatal(err)
	}
	x := buildIconSetIndex(a, nil)
	if e := x.matchBookmarkHost("https://maps.google.com/"); e != nil {
		t.Fatalf("maps.google.com matched %q", e.Name)
	}
	if e := x.matchContainer("ghcr.io/me/app:latest", "app"); e != nil {
		t.Fatalf("container app matched %q", e.Name)
	}
	if got := x.suggestionsFor([]string{"maps"}, 3); len(got) != 1 || got[0].Name != "apple-maps" {
		t.Fatalf("suggestion lost the alias: %+v", got)
	}
	if e := x.matchBookmarkHost("https://apple-maps.lan.example/"); e == nil || e.Name != "apple-maps" {
		t.Fatalf("the name itself no longer matched: %+v", e)
	}
}
