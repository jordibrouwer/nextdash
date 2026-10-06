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
			categories: []Category{{ID: "code", Name: "Code"}, {ID: "docs", Name: "Docs"}, {ID: "tools", Name: "Tools"}, {ID: "news", Name: "News"}},
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
				{name: "DEV Community", url: "https://dev.to/", category: "news", tags: []string{"news", "blog"}},
				{name: "The Changelog", url: "https://changelog.com/", category: "news", tags: []string{"podcast", "open-source"}},
			},
			widgets: []Widget{
				{ID: "demo-health", Type: WidgetTypeHealth, Config: map[string]any{}},
				{ID: "demo-weather", Type: WidgetTypeWeather, Config: map[string]any{"forecastRange": "3day"}},
				{ID: "demo-notes", Type: WidgetTypeNotes, Config: map[string]any{"text": demoNotesText}},
			},
			order: []string{"demo-notes", "code", "docs", "demo-weather", "tools", "news", "demo-health"},
		},
		{
			name: "Homelab", icon: "⌂",
			categories: []Category{{ID: "platforms", Name: "Platforms"}, {ID: "network", Name: "Network"}, {ID: "home", Name: "Home"}, {ID: "community", Name: "Community"}},
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
			},
			widgets: []Widget{
				{ID: "demo-inbox", Type: WidgetTypeInbox, Config: map[string]any{}},
			},
			order: []string{"platforms", "network", "demo-inbox", "home", "community"},
		},
		{
			name: "Self-hosted", icon: "▣",
			categories: []Category{{ID: "discover", Name: "Discover"}, {ID: "apps", Name: "Apps"}, {ID: "infra", Name: "Infrastructure"}},
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
			},
			widgets: []Widget{
				{ID: "demo-duplicates", Type: WidgetTypeDuplicates, Config: map[string]any{}},
			},
			order: []string{"discover", "apps", "infra", "demo-duplicates"},
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

// demoOpenLog spreads n opens over the last three weeks, the latest first
// hours ago, so Recent and the usage bars have something to show.
func demoOpenLog(now time.Time, n, seed int) []int64 {
	log := make([]int64, 0, n)
	for i := n; i > 0; i-- {
		hours := (i*37 + seed*11) % (21 * 24)
		log = append(log, now.Add(-time.Duration(hours)*time.Hour-time.Duration(i)*time.Minute).UnixMilli())
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

	order := []int{}
	for index, page := range demoPages() {
		pageID := index + 1
		bookmarks := make([]Bookmark, 0, len(page.links))
		for i, link := range page.links {
			created := now.Add(-time.Duration(40-i) * 24 * time.Hour).UnixMilli()
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
prefetch a fresh install uses, and keeps them for every reset after.
*/
func (h *Handlers) fetchDemoIconsOnce() {
	if os.Getenv("NEXTDASH_DISABLE_PREFETCH") == "1" {
		return
	}
	go func() {
		// The one window in which the demo reaches outside: the app-icon sets
		// first, so the favicon round skips what they already draw, then the
		// favicons. Closed again as soon as both are done.
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
		for pageID := 1; pageID <= len(demoPages()); pageID++ {
			for _, bookmark := range h.store.GetBookmarksByPage(pageID) {
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
	}()
}
