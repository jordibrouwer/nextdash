package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

/*
What the demo holds: three pages of real, public sites for programmers,
homelabbers and self-hosters, with tags, a few shortcuts and pins, usage that
fills the smart collections, and a handful of widgets that cost the server
nothing -- weather and notes run in the browser, health, inbox and duplicates
count the demo's own data. No widget reads the host or fetches from outside.
*/

type demoLink struct {
	name, url, category, shortcut string
	tags                          []string
	pinned                        bool
	opens                         int    // times opened, spread over the last weeks
	lastError                     string // a link that reads as broken in Health
}

type demoPage struct {
	name, icon string
	categories []Category
	links      []demoLink
	widgets    []Widget
	order      []string
}

const demoNotesText = "# Welcome to the nextDash demo\n\n" +
	"Everything works, and everything you change is shared with other visitors until the next reset.\n\n" +
	"## Try this\n\n" +
	"- [ ] Type anything to search your bookmarks, Enter opens the top result\n" +
	"- [ ] Type `gh` to open GitHub by its shortcut\n" +
	"- [ ] Type `:` for commands, `?` to search GitHub, MDN or Docker Hub\n" +
	"- [ ] Press `!` for every keyboard shortcut\n" +
	"- [ ] Drag a bookmark to another category\n" +
	"- [ ] Open Config and try a different theme\n"

func demoPages() []demoPage {
	return []demoPage{
		{
			name: "Dev", icon: "</>",
			categories: []Category{{ID: "code", Name: "Code"}, {ID: "docs", Name: "Docs"}, {ID: "tools", Name: "Tools"}, {ID: "news", Name: "News"}, {ID: "sec", Name: "Security"}, {ID: "linux", Name: "Linux"}, {ID: "play", Name: "Play"}},
			links: []demoLink{
				{name: "GitHub", url: "https://github.com/", category: "code", shortcut: "GH", tags: []string{"git", "code"}, pinned: true, opens: 42},
				{name: "GitLab", url: "https://gitlab.com/", category: "code", tags: []string{"git", "code"}, opens: 3},
				{name: "Codeberg", url: "https://codeberg.org/", category: "code", tags: []string{"git", "code", "open-source"}},
				{name: "Stack Overflow", url: "https://stackoverflow.com/", category: "code", shortcut: "SO", tags: []string{"q&a"}, opens: 18},
				{name: "MDN Web Docs", url: "https://developer.mozilla.org/", category: "docs", shortcut: "MDN", tags: []string{"web", "javascript", "css"}, pinned: true, opens: 25},
				{name: "Go documentation", url: "https://go.dev/doc/", category: "docs", shortcut: "GO", tags: []string{"go"}, opens: 11},
				{name: "The Rust Book", url: "https://doc.rust-lang.org/book/", category: "docs", tags: []string{"rust"}, opens: 4},
				{name: "Python docs", url: "https://docs.python.org/3/", category: "docs", shortcut: "PY", tags: []string{"python"}, opens: 7},
				{name: "Node.js docs", url: "https://nodejs.org/docs/latest/api/", category: "docs", tags: []string{"javascript", "node"}},
				{name: "DevDocs", url: "https://devdocs.io/", category: "docs", tags: []string{"docs"}, opens: 5},
				{name: "regex101", url: "https://regex101.com/", category: "tools", shortcut: "RX", tags: []string{"regex"}, opens: 9},
				{name: "Can I use", url: "https://caniuse.com/", category: "tools", tags: []string{"web", "css"}, opens: 6},
				{name: "crontab guru", url: "https://crontab.guru/", category: "tools", tags: []string{"cron", "linux"}, opens: 2},
				{name: "Excalidraw", url: "https://excalidraw.com/", category: "tools", tags: []string{"diagrams"}},
				{name: "JWT debugger", url: "https://jwt.io/", category: "tools", tags: []string{"auth"}},
				{name: "Hacker News", url: "https://news.ycombinator.com/", category: "news", shortcut: "HN", tags: []string{"news"}, pinned: true, opens: 37},
				{name: "Lobsters", url: "https://lobste.rs/", category: "news", tags: []string{"news"}, opens: 8},
				// Gone: the second link Health shows as broken.
				{name: "Old dev podcast", url: "https://podcast.example.net/feed", category: "news", tags: []string{"podcast"}, lastError: "DNS lookup failed"},
				{name: "DEV Community", url: "https://dev.to/", category: "news", tags: []string{"news", "blog"}},
				{name: "The Changelog", url: "https://changelog.com/", category: "news", tags: []string{"podcast", "open-source"}},
				{name: "Exploit-DB", url: "https://www.exploit-db.com/", category: "sec", shortcut: "EDB", tags: []string{"security", "exploits"}, opens: 6},
				{name: "Hack The Box", url: "https://www.hackthebox.com/", category: "sec", shortcut: "HTB", tags: []string{"security", "ctf"}, pinned: true, opens: 15},
				{name: "TryHackMe", url: "https://tryhackme.com/", category: "sec", tags: []string{"security", "ctf"}, opens: 9},
				{name: "OWASP", url: "https://owasp.org/", category: "sec", tags: []string{"security", "web"}, opens: 4},
				{name: "PortSwigger Academy", url: "https://portswigger.net/web-security", category: "sec", tags: []string{"security", "web"}, opens: 3},
				{name: "CyberChef", url: "https://gchq.github.io/CyberChef/", category: "sec", shortcut: "CC", tags: []string{"security", "tools"}, opens: 8},
				{name: "Shodan", url: "https://www.shodan.io/", category: "sec", tags: []string{"security", "search"}, opens: 2},
				{name: "Have I Been Pwned", url: "https://haveibeenpwned.com/", category: "sec", tags: []string{"security", "passwords"}},
				{name: "CVE", url: "https://www.cve.org/", category: "sec", tags: []string{"security", "news"}},
				{name: "Nmap", url: "https://nmap.org/", category: "sec", tags: []string{"security", "network"}, opens: 5},
				{name: "Wireshark", url: "https://www.wireshark.org/", category: "sec", tags: []string{"security", "network"}, opens: 3},
				{name: "Kali Linux", url: "https://www.kali.org/", category: "sec", tags: []string{"security", "linux"}, opens: 2},
				{name: "Arch Wiki", url: "https://wiki.archlinux.org/", category: "linux", shortcut: "AW", tags: []string{"linux", "docs"}, pinned: true, opens: 20},
				{name: "kernel.org", url: "https://www.kernel.org/", category: "linux", tags: []string{"linux", "kernel"}},
				{name: "explainshell", url: "https://explainshell.com/", category: "linux", tags: []string{"linux", "shell"}, opens: 7},
				{name: "tldr pages", url: "https://tldr.sh/", category: "linux", tags: []string{"linux", "shell"}, opens: 10},
				{name: "NixOS packages", url: "https://search.nixos.org/packages", category: "linux", tags: []string{"linux", "nix"}, opens: 4},
				{name: "LWN.net", url: "https://lwn.net/", category: "linux", tags: []string{"linux", "news"}, opens: 5},
				{name: "Phoronix", url: "https://www.phoronix.com/", category: "linux", tags: []string{"linux", "news", "hardware"}},
				{name: "Debian", url: "https://www.debian.org/", category: "linux", tags: []string{"linux"}},
				{name: "Linux From Scratch", url: "https://www.linuxfromscratch.org/", category: "linux", tags: []string{"linux", "docs"}},
				{name: "ShellCheck", url: "https://www.shellcheck.net/", category: "linux", tags: []string{"shell", "tools"}, opens: 6},
				{name: "Advent of Code", url: "https://adventofcode.com/", category: "play", shortcut: "AOC", tags: []string{"puzzles", "code"}, opens: 12},
				{name: "Project Euler", url: "https://projecteuler.net/", category: "play", tags: []string{"puzzles", "math"}},
				{name: "Exercism", url: "https://exercism.org/", category: "play", tags: []string{"puzzles", "code"}, opens: 3},
				{name: "Compiler Explorer", url: "https://godbolt.org/", category: "play", shortcut: "CE", tags: []string{"code", "tools"}, opens: 8},
				{name: "Shadertoy", url: "https://www.shadertoy.com/", category: "play", tags: []string{"graphics", "code"}},
				{name: "xkcd", url: "https://xkcd.com/", category: "play", tags: []string{"humour"}, opens: 11},
				{name: "picoCTF", url: "https://picoctf.org/", category: "play", tags: []string{"security", "ctf"}},
				{name: "CTFtime", url: "https://ctftime.org/", category: "play", tags: []string{"security", "ctf"}},
			},
			widgets: []Widget{
				{ID: "demo-health", Type: WidgetTypeHealth, Config: map[string]any{}},
				{ID: "demo-weather", Type: WidgetTypeWeather, Config: map[string]any{"forecastRange": "3day"}},
				{ID: "demo-notes", Type: WidgetTypeNotes, Config: map[string]any{"text": demoNotesText}},
			},
			order: []string{"demo-notes", "code", "docs", "demo-weather", "tools", "news", "sec", "linux", "play", "demo-health"},
		},
		{
			name: "Homelab", icon: "⌂",
			categories: []Category{{ID: "platforms", Name: "Platforms"}, {ID: "network", Name: "Network"}, {ID: "home", Name: "Home"}, {ID: "community", Name: "Community"}, {ID: "makers", Name: "Makers"}},
			links: []demoLink{
				{name: "Proxmox VE docs", url: "https://pve.proxmox.com/wiki/Main_Page", category: "platforms", shortcut: "PX", tags: []string{"virtualization", "docs"}, opens: 14},
				{name: "TrueNAS docs", url: "https://www.truenas.com/docs/", category: "platforms", tags: []string{"storage", "docs"}, opens: 3},
				{name: "Unraid docs", url: "https://docs.unraid.net/", category: "platforms", tags: []string{"storage", "docs"}, opens: 5},
				{name: "Docker docs", url: "https://docs.docker.com/", category: "platforms", shortcut: "DD", tags: []string{"docker", "docs"}, opens: 12},
				{name: "Docker Hub", url: "https://hub.docker.com/", category: "platforms", tags: []string{"docker", "images"}, opens: 6},
				{name: "OPNsense docs", url: "https://docs.opnsense.org/", category: "network", tags: []string{"firewall", "docs"}},
				{name: "Tailscale", url: "https://tailscale.com/", category: "network", shortcut: "TS", tags: []string{"vpn", "network"}, opens: 9},
				{name: "WireGuard", url: "https://www.wireguard.com/", category: "network", tags: []string{"vpn"}},
				{name: "Pi-hole docs", url: "https://docs.pi-hole.net/", category: "network", tags: []string{"dns", "docs"}, opens: 2},
				{name: "Home Assistant", url: "https://www.home-assistant.io/", category: "home", shortcut: "HA", tags: []string{"smart-home"}, pinned: true, opens: 21},
				{name: "ESPHome", url: "https://esphome.io/", category: "home", tags: []string{"smart-home", "iot"}},
				{name: "Zigbee2MQTT", url: "https://www.zigbee2mqtt.io/", category: "home", tags: []string{"smart-home", "iot"}},
				{name: "ServeTheHome", url: "https://www.servethehome.com/", category: "community", tags: []string{"hardware", "news"}, opens: 4},
				{name: "r/homelab", url: "https://www.reddit.com/r/homelab/", category: "community", tags: []string{"community"}, opens: 7},
				// Moved years ago: the one Health shows as broken.
				{name: "Old homelab wiki", url: "https://wiki.example.org/homelab", category: "community", tags: []string{"docs"}, lastError: "404 Not Found"},
				{name: "Raspberry Pi", url: "https://www.raspberrypi.com/", category: "makers", shortcut: "RPI", tags: []string{"hardware", "iot"}, opens: 8},
				{name: "Adafruit", url: "https://www.adafruit.com/", category: "makers", tags: []string{"hardware", "shop"}, opens: 3},
				{name: "SparkFun", url: "https://www.sparkfun.com/", category: "makers", tags: []string{"hardware", "shop"}},
				{name: "Wokwi", url: "https://wokwi.com/", category: "makers", tags: []string{"hardware", "simulator"}, opens: 4},
				{name: "Flipper Zero", url: "https://flipperzero.one/", category: "makers", tags: []string{"hardware", "security"}, opens: 2},
				{name: "Hackaday", url: "https://hackaday.com/", category: "makers", shortcut: "HD", tags: []string{"hardware", "news"}, pinned: true, opens: 17},
				{name: "Hackster.io", url: "https://www.hackster.io/", category: "makers", tags: []string{"hardware", "projects"}},
				{name: "Pine64", url: "https://pine64.org/", category: "makers", tags: []string{"hardware", "linux"}},
				{name: "Framework", url: "https://frame.work/", category: "makers", tags: []string{"hardware"}},
				{name: "OpenWrt", url: "https://openwrt.org/", category: "makers", tags: []string{"network", "linux"}, opens: 5},
			},
			widgets: []Widget{
				{ID: "demo-inbox", Type: WidgetTypeInbox, Config: map[string]any{}},
			},
			order: []string{"platforms", "network", "demo-inbox", "home", "community", "makers"},
		},
		{
			name: "Self-hosted", icon: "▣",
			categories: []Category{{ID: "discover", Name: "Discover"}, {ID: "apps", Name: "Apps"}, {ID: "infra", Name: "Infrastructure"}, {ID: "privacy", Name: "Privacy"}},
			links: []demoLink{
				{name: "awesome-selfhosted", url: "https://awesome-selfhosted.net/", category: "discover", shortcut: "AS", tags: []string{"self-hosted", "lists"}, opens: 10},
				{name: "selfh.st", url: "https://selfh.st/", category: "discover", tags: []string{"self-hosted", "news"}, opens: 6},
				{name: "r/selfhosted", url: "https://www.reddit.com/r/selfhosted/", category: "discover", tags: []string{"community"}, opens: 5},
				{name: "LinuxServer.io", url: "https://www.linuxserver.io/", category: "discover", tags: []string{"docker", "images"}, opens: 3},
				{name: "nextDash", url: "https://nextdash.cc/", category: "discover", shortcut: "N", tags: []string{"self-hosted", "bookmarks"}},
				{name: "Jellyfin", url: "https://jellyfin.org/", category: "apps", shortcut: "J", tags: []string{"media"}, opens: 8},
				{name: "Immich", url: "https://immich.app/", category: "apps", tags: []string{"photos"}, opens: 4},
				{name: "Nextcloud", url: "https://nextcloud.com/", category: "apps", tags: []string{"files", "office"}},
				{name: "Vaultwarden", url: "https://github.com/dani-garcia/vaultwarden", category: "apps", tags: []string{"passwords", "security"}, opens: 2},
				{name: "Paperless-ngx", url: "https://docs.paperless-ngx.com/", category: "apps", tags: []string{"documents"}},
				{name: "Uptime Kuma", url: "https://github.com/louislam/uptime-kuma", category: "apps", tags: []string{"monitoring"}},
				{name: "Traefik docs", url: "https://doc.traefik.io/traefik/", category: "infra", tags: []string{"proxy", "docs"}, opens: 5},
				{name: "Caddy", url: "https://caddyserver.com/docs/", category: "infra", tags: []string{"proxy", "docs"}, opens: 3},
				{name: "Let's Encrypt", url: "https://letsencrypt.org/docs/", category: "infra", tags: []string{"tls", "docs"}},
				// The same two as on Homelab, on purpose: the Duplicates widget has
				// something to show.
				{name: "Docker Hub", url: "https://hub.docker.com/", category: "infra", tags: []string{"docker"}},
				{name: "Tailscale", url: "https://tailscale.com/", category: "infra", tags: []string{"vpn"}},
				{name: "Privacy Guides", url: "https://www.privacyguides.org/", category: "privacy", shortcut: "PG", tags: []string{"privacy", "guides"}, opens: 6},
				{name: "EFF", url: "https://www.eff.org/", category: "privacy", tags: []string{"privacy", "news"}, opens: 3},
				{name: "Signal", url: "https://signal.org/", category: "privacy", tags: []string{"privacy", "chat"}, opens: 4},
				{name: "Tor Project", url: "https://www.torproject.org/", category: "privacy", tags: []string{"privacy", "network"}},
				{name: "Mullvad", url: "https://mullvad.net/", category: "privacy", tags: []string{"privacy", "vpn"}},
				{name: "Bitwarden", url: "https://bitwarden.com/", category: "privacy", tags: []string{"passwords", "security"}, opens: 5},
				{name: "Yubico", url: "https://www.yubico.com/", category: "privacy", tags: []string{"security", "hardware"}},
				{name: "CryptPad", url: "https://cryptpad.org/", category: "privacy", tags: []string{"privacy", "office"}},
				{name: "Krebs on Security", url: "https://krebsonsecurity.com/", category: "privacy", tags: []string{"security", "news"}, opens: 7},
				{name: "Schneier on Security", url: "https://www.schneier.com/", category: "privacy", tags: []string{"security", "news"}},
			},
			widgets: []Widget{
				{ID: "demo-duplicates", Type: WidgetTypeDuplicates, Config: map[string]any{}},
			},
			order: []string{"discover", "apps", "infra", "privacy", "demo-duplicates"},
		},
	}
}

// demoFinders are the ? searches: every one a redirect in the browser.
var demoFinders = []Finder{
	{Name: "DuckDuckGo", SearchUrl: "https://duckduckgo.com/?q=%s", Shortcut: "du"},
	{Name: "GitHub", SearchUrl: "https://github.com/search?q=%s", Shortcut: "gh"},
	{Name: "MDN", SearchUrl: "https://developer.mozilla.org/en-US/search?q=%s", Shortcut: "mdn"},
	{Name: "Docker Hub", SearchUrl: "https://hub.docker.com/search?q=%s", Shortcut: "dh"},
	{Name: "selfh.st apps", SearchUrl: "https://selfh.st/apps/?search=%s", Shortcut: "st"},
}

/*
demoIconCache keeps the favicons fetched at the first start, so a reset puts
them back without asking 50 sites again: after that one round the demo
fetches nothing from outside.
*/
var demoIconCache struct {
	sync.Mutex
	ready bool
	files map[string][]byte // icon file name -> bytes
	byURL map[string]string // canonical URL -> icon file name
}

// demoOpenHours are the hours of the day the opens fall in: a morning, the
// afternoon, and an evening, so the heatmap has a shape.
var demoOpenHours = []int{7, 8, 8, 9, 9, 9, 10, 10, 11, 12, 12, 13, 13, 14, 14, 15, 16, 16, 17, 19, 20, 20, 21, 22}

// demoOpenLog spreads n opens over the last ninety days, more of them lately,
// fewer on weekends, mostly in working hours, so Recent, the usage bars and the
// heatmap show a collection that has been in use for a while.
func demoOpenLog(now time.Time, n, seed int) []int64 {
	log := make([]int64, 0, n)
	for k := 0; k < n; k++ {
		u := float64(demoNoise(k, seed*7+1)) / 1000
		daysAgo := int(88 * u * u)
		at := now.AddDate(0, 0, -daysAgo)
		// Weekends: half of them move to the day before.
		if wd := at.Weekday(); (wd == time.Saturday || wd == time.Sunday) && demoNoise(k, seed*3+5)%2 == 0 {
			at = at.AddDate(0, 0, -int(wd+1)%7-1)
		}
		hour := demoOpenHours[demoNoise(k, seed*13+2)%len(demoOpenHours)]
		minute := demoNoise(k, seed*17+3) % 60
		at = time.Date(at.Year(), at.Month(), at.Day(), hour, minute, 0, 0, at.Location())
		if at.After(now) {
			at = at.AddDate(0, 0, -1)
		}
		log = append(log, at.UnixMilli())
	}
	// Ascending, as the server appends them.
	sortInt64s(log)
	return log
}

func sortInt64s(values []int64) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j-1] > values[j]; j-- {
			values[j-1], values[j] = values[j], values[j-1]
		}
	}
}

// writeDemoPages writes the three pages over a fresh install: the first in
// main's place, the others after it.
func (h *Handlers) writeDemoPages(now time.Time) error {
	demoIconCache.Lock()
	icons := demoIconCache.byURL
	files := demoIconCache.files
	ready := demoIconCache.ready
	demoIconCache.Unlock()
	if ready {
		dir := filepath.Join(ResolveDataDir(), "icons")
		_ = os.MkdirAll(dir, 0o755)
		for name, data := range files {
			_ = writeFileAtomic(filepath.Join(dir, name), data, 0o644)
		}
	}

	h.writeDemoPreviewCache(now)

	order := []int{}
	for index, page := range demoPages() {
		pageID := index + 1
		bookmarks := make([]Bookmark, 0, len(page.links))
		for i, link := range page.links {
			created := now.Add(-time.Duration(1+(i*53+index*17)%110) * 24 * time.Hour).UnixMilli()
			bookmark := Bookmark{
				Name: link.name, URL: link.url, Category: link.category, Shortcut: link.shortcut,
				Tags: link.tags, Pinned: link.pinned, CreatedAt: created,
			}
			if link.opens > 0 {
				bookmark.OpenLog = demoOpenLog(now, link.opens, i+index*20)
				bookmark.OpenCount = link.opens
				bookmark.LastOpened = bookmark.OpenLog[len(bookmark.OpenLog)-1]
			}
			if link.lastError != "" {
				bookmark.LastError = link.lastError
				bookmark.LastChecked = now.Add(-2 * time.Hour).UnixMilli()
			}
			if ready {
				bookmark.Icon = icons[canonicalBookmarkURLKey(link.url)]
			}
			if preview, ok := demoPreviews[link.url]; ok {
				bookmark.PreviewTitle, bookmark.PreviewDesc = preview[0], preview[1]
			}
			bookmarks = append(bookmarks, bookmark)
		}
		meta := Page{ID: pageID, Name: page.name, Icon: page.icon}
		if err := h.store.SavePage(meta); err != nil {
			return err
		}
		if err := h.store.SaveCategoriesByPage(pageID, page.categories); err != nil {
			return err
		}
		if err := h.store.SaveBookmarksByPage(pageID, bookmarks); err != nil {
			return err
		}
		if err := h.store.SavePageBlocks(pageID, page.widgets, page.order); err != nil {
			return err
		}
		order = append(order, pageID)
	}
	return h.store.SavePageOrder(order)
}

/*
fetchDemoIconsOnce fetches the favicons at the first start, through the same
prefetch a fresh install uses, then the link previews, and keeps both for
every reset after.
*/
func (h *Handlers) fetchDemoIconsOnce() {
	if os.Getenv("NEXTDASH_DISABLE_PREFETCH") == "1" {
		return
	}
	go func() {
		// The one window in which the demo reaches outside: the app-icon sets
		// first, so the favicon round skips what they already draw, then the
		// favicons, then the link previews. Closed again once all are done.
		demoOutboundOpen.Store(true)
		defer demoOutboundOpen.Store(false)
		if !iconSetsDisabled() && iconSetsFixtureDir() == "" {
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			if err := refreshIconSets(ctx); err != nil {
				logDebug("icon-sets", "demo refresh: %v", err)
			}
			cancel()
		}
		h.prefetchMu.Lock()
		defer h.prefetchMu.Unlock()
		for pageID := 1; pageID <= len(demoPages()); pageID++ {
			for offset := 0; offset < 100; offset += 8 {
				if result := h.prefetchBookmarkIconsBatch(pageID, 8, false, true, offset); result.Done {
					break
				}
			}
		}
		files := map[string][]byte{}
		byURL := map[string]string{}
		dir := filepath.Join(ResolveDataDir(), "icons")
		// Only the seed's own links: a visitor may already have added,
		// changed or removed bookmarks on these pages, and what is kept here
		// comes back with every reset.
		seeded := map[string]bool{}
		for _, page := range demoPages() {
			for _, link := range page.links {
				seeded[canonicalBookmarkURLKey(link.url)] = true
			}
		}
		for pageID := 1; pageID <= len(demoPages()); pageID++ {
			for _, bookmark := range h.store.GetBookmarksByPage(pageID) {
				if !seeded[canonicalBookmarkURLKey(bookmark.URL)] {
					continue
				}
				name := strings.TrimSpace(bookmark.Icon)
				if name == "" || strings.ContainsAny(name, "/\\") {
					continue
				}
				data, err := os.ReadFile(filepath.Join(dir, name))
				if err != nil {
					continue
				}
				files[name] = data
				byURL[canonicalBookmarkURLKey(bookmark.URL)] = name
			}
		}
		demoIconCache.Lock()
		demoIconCache.files, demoIconCache.byURL, demoIconCache.ready = files, byURL, true
		demoIconCache.Unlock()
		logInfo(logComponentServer, "demo: kept %s for every reset", plural(len(byURL), "favicon", "favicons"))
		h.fetchDemoPreviews()
	}()
}
