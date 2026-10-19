package app

import "os"

/*
What a fresh install starts with.

Two pages of links a self-hoster would keep anyway: main for the homelab,
Docker, Unraid and development, and news for tech, security and a few general
news sites. Around a hundred links is enough for search, tags, Today, health
and the page tabs to show what they do on the first load; every row is
deletable like any other.

The e2e suite resets to this seed before every spec file and was written
against the small one-page seed, so its server runs with NEXTDASH_SEED=minimal
and keeps that one (minimalMainPage).
*/

// defaultTrendWidgetID is the trend widget on main, beside health and notes.
// Fixed for the same reason as defaultHealthWidgetID.
const defaultTrendWidgetID = "w_000000000003"

// defaultNewsPageID is the second starter page.
const defaultNewsPageID = 2

// minimalSeed says whether this install seeds the small one-page starter set
// instead of the demo set.
func minimalSeed() bool {
	return os.Getenv("NEXTDASH_SEED") == "minimal"
}

// defaultSeedPages is every page a fresh install writes, main first.
func defaultSeedPages() []PageWithBookmarks {
	if minimalSeed() {
		return []PageWithBookmarks{minimalMainPage()}
	}
	return []PageWithBookmarks{defaultMainPage(), defaultNewsPage()}
}

// defaultSeedPageIDs is the page order a fresh install writes.
func defaultSeedPageIDs() []int {
	pages := defaultSeedPages()
	ids := make([]int, 0, len(pages))
	for _, page := range pages {
		ids = append(ids, page.Page.ID)
	}
	return ids
}

// seedLink is one starter bookmark, its status check off: a hundred pings to
// sites the reader did not pick is not a fair first start. A handful turn it
// on with checked, so health has something to report.
func seedLink(name, url, shortcut, category string, tags ...string) Bookmark {
	return Bookmark{Name: name, URL: url, Shortcut: shortcut, Category: category, Tags: tags}
}

// checked turns the status check on for a starter bookmark.
func checked(b Bookmark) Bookmark {
	b.CheckStatus = true
	return b
}

// defaultMainPage is the page a fresh install starts on. The first-start
// card reads it too: main still equal to it means nobody has touched it, and
// a template may take its place (isUntouchedMainPage).
func defaultMainPage() PageWithBookmarks {
	if minimalSeed() {
		return minimalMainPage()
	}
	return PageWithBookmarks{
		Page: Page{
			ID:   1,
			Name: "main",
		},
		Categories: []Category{
			{ID: "development", Name: "Development"},
			{ID: "docker", Name: "Docker"},
			{ID: "unraid", Name: "Unraid"},
			{ID: "selfhosted", Name: "Self-hosted"},
			{ID: "tools", Name: "Tools"},
			{ID: "daily", Name: "Daily"},
		},
		/*
		 * Health is the one widget that reads correctly on an install with
		 * no history, counting what the header badge has already fetched.
		 * Trend beside it starts empty and fills in as the checks run, which
		 * is the point of it. Both sit below the links, which are what a
		 * dashboard is opened for. Notes takes the top right, with the example
		 * note: columns fill round-robin and Today, which is not in this
		 * order, leads, so the second block here is the first row's last
		 * column. It shows what the widget does and is one Edit away from
		 * yours. Empty configs mean every default.
		 */
		Widgets: []Widget{
			{ID: defaultHealthWidgetID, Type: WidgetTypeHealth, Config: map[string]any{}},
			{ID: defaultTrendWidgetID, Type: WidgetTypeTrend, Config: map[string]any{}},
			{ID: defaultNotesWidgetID, Type: WidgetTypeNotes, Config: notesStarterConfig()},
		},
		BlockOrder: []string{
			"development",
			defaultNotesWidgetID,
			"docker", "unraid", "selfhosted", "tools", "daily",
			defaultHealthWidgetID,
			defaultTrendWidgetID,
		},
		Bookmarks: []Bookmark{
			// The project itself, twice: the site is where a new install
			// finds out what changed and publishes a feed so Fresh has
			// something to count on day one; the repository is where issues
			// and releases live.
			checked(seedLink("nextDash", "https://nextdash.cc/", "N", "development", "dev", "bookmarks", "self-hosted")),
			seedLink("nextDash on GitHub", "https://github.com/jordibrouwer/nextdash", "NG", "development", "dev", "github", "self-hosted"),
			checked(seedLink("GitHub", "https://github.com", "G", "development", "dev", "code")),
			seedLink("GitLab", "https://gitlab.com", "", "development", "dev", "code"),
			seedLink("Stack Overflow", "https://stackoverflow.com", "SO", "development", "dev", "q&a"),
			seedLink("MDN Web Docs", "https://developer.mozilla.org", "MDN", "development", "dev", "docs", "web"),
			seedLink("Go", "https://go.dev", "", "development", "dev", "golang", "docs"),
			seedLink("DevDocs", "https://devdocs.io", "", "development", "dev", "docs"),
			seedLink("regex101", "https://regex101.com", "", "development", "dev", "regex"),
			seedLink("Can I use", "https://caniuse.com", "", "development", "dev", "web"),

			checked(seedLink("Docker Hub", "https://hub.docker.com", "D", "docker", "docker", "containers")),
			seedLink("Docker Docs", "https://docs.docker.com", "DD", "docker", "docker", "docs"),
			seedLink("Compose file reference", "https://docs.docker.com/reference/compose-file/", "", "docker", "docker", "compose", "docs"),
			seedLink("LinuxServer.io", "https://www.linuxserver.io", "LS", "docker", "docker", "containers"),
			seedLink("Portainer Docs", "https://docs.portainer.io", "", "docker", "docker", "docs"),
			seedLink("Dozzle", "https://dozzle.dev", "", "docker", "docker", "logs"),
			seedLink("Traefik Docs", "https://doc.traefik.io/traefik/", "", "docker", "docker", "reverse-proxy"),
			seedLink("Awesome Self-Hosted", "https://github.com/awesome-selfhosted/awesome-selfhosted", "", "docker", "self-hosted", "list"),
			seedLink("TRaSH Guides", "https://trash-guides.info", "", "docker", "media", "guides"),

			checked(seedLink("Unraid", "https://unraid.net", "U", "unraid", "unraid", "nas")),
			seedLink("Unraid Docs", "https://docs.unraid.net", "UD", "unraid", "unraid", "docs"),
			seedLink("Unraid Forums", "https://forums.unraid.net", "UF", "unraid", "unraid", "forum"),
			seedLink("Unraid Blog", "https://unraid.net/blog", "", "unraid", "unraid", "news"),
			seedLink("r/unRAID", "https://www.reddit.com/r/unRAID/", "", "unraid", "unraid", "reddit"),
			seedLink("Community Apps", "https://ca.unraid.net", "", "unraid", "unraid", "apps"),
			seedLink("Spaceinvader One", "https://www.youtube.com/@SpaceinvaderOne", "", "unraid", "unraid", "video"),
			seedLink("Ibracorp Docs", "https://docs.ibracorp.io", "", "unraid", "unraid", "guides"),
			seedLink("Unraid Connect", "https://connect.myunraid.net", "", "unraid", "unraid", "remote"),

			seedLink("r/selfhosted", "https://www.reddit.com/r/selfhosted/", "", "selfhosted", "self-hosted", "reddit"),
			seedLink("r/homelab", "https://www.reddit.com/r/homelab/", "", "selfhosted", "homelab", "reddit"),
			seedLink("selfh.st", "https://selfh.st", "", "selfhosted", "self-hosted", "news"),
			seedLink("Tailscale", "https://login.tailscale.com/admin", "TS", "selfhosted", "vpn", "network"),
			seedLink("Cloudflare", "https://dash.cloudflare.com", "CF", "selfhosted", "dns", "network"),
			seedLink("Proxmox", "https://www.proxmox.com", "", "selfhosted", "homelab", "virtualization"),
			seedLink("Home Assistant", "https://www.home-assistant.io", "HA", "selfhosted", "smart-home", "self-hosted"),
			seedLink("Jellyfin", "https://jellyfin.org", "", "selfhosted", "media", "self-hosted"),

			seedLink("IT-Tools", "https://it-tools.tech", "IT", "tools", "tools", "dev"),
			seedLink("CyberChef", "https://gchq.github.io/CyberChef/", "", "tools", "tools", "security"),
			seedLink("crontab guru", "https://crontab.guru", "", "tools", "tools", "cron"),
			seedLink("explainshell", "https://explainshell.com", "", "tools", "tools", "shell"),
			seedLink("JSON Crack", "https://jsoncrack.com/editor", "", "tools", "tools", "json"),
			seedLink("Excalidraw", "https://excalidraw.com", "", "tools", "tools", "diagrams"),
			seedLink("DNS Checker", "https://dnschecker.org", "", "tools", "tools", "dns"),
			seedLink("SSL Labs", "https://www.ssllabs.com/ssltest/", "", "tools", "tools", "security"),
			seedLink("Cloudflare Speed Test", "https://speed.cloudflare.com", "", "tools", "tools", "network"),

			seedLink("YouTube", "https://youtube.com", "Y", "daily", "video", "entertainment"),
			seedLink("Gmail", "https://mail.google.com", "M", "daily", "mail"),
			seedLink("Google Calendar", "https://calendar.google.com", "C", "daily", "calendar"),
			seedLink("Spotify", "https://open.spotify.com", "", "daily", "music"),
			seedLink("Bluesky", "https://bsky.app", "B", "daily", "social"),
			seedLink("Mastodon", "https://mastodon.social", "", "daily", "social", "fediverse"),
			seedLink("Google Maps", "https://maps.google.com", "", "daily", "maps"),
		},
	}
}

// defaultNewsPage is the second starter page: reading rather than running.
func defaultNewsPage() PageWithBookmarks {
	return PageWithBookmarks{
		Page: Page{
			ID:   defaultNewsPageID,
			Name: "news",
		},
		Categories: []Category{
			{ID: "technews", Name: "Tech news"},
			{ID: "devnews", Name: "Dev & blogs"},
			{ID: "security", Name: "Security"},
			{ID: "communities", Name: "Communities"},
			{ID: "videos", Name: "Videos"},
			{ID: "worldnews", Name: "News"},
		},
		Bookmarks: []Bookmark{
			seedLink("Hacker News", "https://news.ycombinator.com", "H", "technews", "news", "tech"),
			seedLink("Ars Technica", "https://arstechnica.com", "A", "technews", "news", "tech"),
			seedLink("The Verge", "https://www.theverge.com", "V", "technews", "news", "tech"),
			seedLink("ServeTheHome", "https://www.servethehome.com", "", "technews", "news", "homelab", "hardware"),
			seedLink("Phoronix", "https://www.phoronix.com", "", "technews", "news", "linux"),
			seedLink("Tom's Hardware", "https://www.tomshardware.com", "", "technews", "news", "hardware"),
			seedLink("The Register", "https://www.theregister.com", "", "technews", "news", "tech"),
			seedLink("Lobsters", "https://lobste.rs", "", "technews", "news", "dev"),
			seedLink("Slashdot", "https://slashdot.org", "", "technews", "news", "tech"),
			seedLink("Wired", "https://www.wired.com", "", "technews", "news", "tech"),
			seedLink("9to5Linux", "https://9to5linux.com", "", "technews", "news", "linux"),

			seedLink("GitHub Blog", "https://github.blog", "", "devnews", "dev", "github", "blog"),
			seedLink("The Go Blog", "https://go.dev/blog/", "", "devnews", "dev", "golang", "blog"),
			seedLink("Docker Blog", "https://www.docker.com/blog/", "", "devnews", "docker", "blog"),
			seedLink("Cloudflare Blog", "https://blog.cloudflare.com", "", "devnews", "network", "blog"),
			seedLink("Stack Overflow Blog", "https://stackoverflow.blog", "", "devnews", "dev", "blog"),
			seedLink("web.dev", "https://web.dev", "", "devnews", "dev", "web"),
			seedLink("Smashing Magazine", "https://www.smashingmagazine.com", "", "devnews", "dev", "web"),
			seedLink("DEV Community", "https://dev.to", "", "devnews", "dev", "community"),
			seedLink("InfoQ", "https://www.infoq.com", "", "devnews", "dev", "architecture"),
			seedLink("Changelog", "https://changelog.com", "", "devnews", "dev", "podcast"),

			seedLink("Krebs on Security", "https://krebsonsecurity.com", "", "security", "security", "news"),
			seedLink("BleepingComputer", "https://www.bleepingcomputer.com", "BC", "security", "security", "news"),
			seedLink("The Hacker News", "https://thehackernews.com", "", "security", "security", "news"),
			seedLink("Schneier on Security", "https://www.schneier.com", "", "security", "security", "blog"),
			seedLink("Have I Been Pwned", "https://haveibeenpwned.com", "", "security", "security", "privacy"),
			seedLink("CISA KEV Catalog", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", "", "security", "security", "cve"),
			seedLink("NVD", "https://nvd.nist.gov", "", "security", "security", "cve"),

			seedLink("r/programming", "https://www.reddit.com/r/programming/", "", "communities", "dev", "reddit"),
			seedLink("r/docker", "https://www.reddit.com/r/docker/", "", "communities", "docker", "reddit"),
			seedLink("r/linux", "https://www.reddit.com/r/linux/", "", "communities", "linux", "reddit"),
			seedLink("r/sysadmin", "https://www.reddit.com/r/sysadmin/", "", "communities", "sysadmin", "reddit"),
			seedLink("LWN.net", "https://lwn.net", "", "communities", "linux", "news"),
			seedLink("Tildes", "https://tildes.net", "", "communities", "community", "news"),

			seedLink("Jeff Geerling", "https://www.youtube.com/@JeffGeerling", "", "videos", "video", "homelab"),
			seedLink("Techno Tim", "https://www.youtube.com/@TechnoTim", "", "videos", "video", "homelab"),
			seedLink("Lawrence Systems", "https://www.youtube.com/@LAWRENCESYSTEMS", "", "videos", "video", "network"),
			seedLink("NetworkChuck", "https://www.youtube.com/@NetworkChuck", "", "videos", "video", "network"),
			seedLink("Level1Techs", "https://www.youtube.com/@Level1Techs", "", "videos", "video", "hardware"),
			seedLink("Linus Tech Tips", "https://www.youtube.com/@LinusTechTips", "", "videos", "video", "hardware"),

			seedLink("BBC News", "https://www.bbc.com/news", "", "worldnews", "news", "world"),
			seedLink("Reuters", "https://www.reuters.com", "", "worldnews", "news", "world"),
			seedLink("AP News", "https://apnews.com", "", "worldnews", "news", "world"),
			seedLink("The Guardian", "https://www.theguardian.com", "", "worldnews", "news", "world"),
			seedLink("NPR", "https://www.npr.org", "", "worldnews", "news", "world"),
			seedLink("DW", "https://www.dw.com/en/", "", "worldnews", "news", "world"),
		},
	}
}

// minimalMainPage is the one-page starter set the e2e suite runs against
// (NEXTDASH_SEED=minimal), as it was before the demo set.
func minimalMainPage() PageWithBookmarks {
	return PageWithBookmarks{
		Page: Page{
			ID:   1,
			Name: "main",
		},
		Categories: []Category{
			{ID: "development", Name: "Development"},
			{ID: "media", Name: "Media"},
			{ID: "social", Name: "Social"},
			{ID: "search", Name: "Search"},
			{ID: "utilities", Name: "Utilities"},
		},
		/*
		 * A health widget, on the page from the first load.
		 *
		 * A page can hold something other than links, and nothing on a
		 * fresh install said so: widgets were a config section you had to
		 * go looking for, which is a poor way to learn that the thing
		 * exists. One block, at the top, reporting the collection it sits
		 * above.
		 *
		 * Health rather than any of the other twelve because it is the only
		 * one that reads correctly on an install with no history: it counts
		 * what the header badge has already fetched, so it says something
		 * true on the first paint rather than "nothing recorded yet". An
		 * inbox tile would be empty, uptime and trend have no samples, and
		 * sources and feeds have nothing registered.
		 *
		 * Empty config on purpose: `show` absent means every figure, which
		 * is what a reader who has not chosen wants. Deletable like any
		 * other seeded row.
		 */
		Widgets: []Widget{
			{ID: defaultHealthWidgetID, Type: WidgetTypeHealth, Config: map[string]any{}},
			// Notes after the links it sits beside, with the example note:
			// it shows what the widget does and is one Edit away from yours.
			{ID: defaultNotesWidgetID, Type: WidgetTypeNotes, Config: notesStarterConfig()},
		},
		// The widget leads, then the categories in the order above. Without
		// an explicit order the widget would fall wherever resolveBlockOrder
		// put it, which is after every category it is meant to summarise.
		BlockOrder: []string{
			defaultHealthWidgetID,
			"development", "media", "social", "search", "utilities",
			defaultNotesWidgetID,
		},
		Bookmarks: []Bookmark{
			// The project's own site, in the seed rather than only behind the
			// "follow it from your own dashboard" button in About: it is the
			// place a new install finds out what changed, it publishes a feed
			// so Fresh has something to count on day one, and a bookmark
			// dashboard whose own site is not on the dashboard is an odd
			// advertisement for itself. Deletable like any other starter row.
			{Name: "nextDash", URL: "https://nextdash.cc/", Shortcut: "N", Category: "development", CheckStatus: false, Tags: []string{"dev", "bookmarks", "self-hosted"}},
			{Name: "GitHub", URL: "https://github.com", Shortcut: "G", Category: "development", CheckStatus: true, Tags: []string{"dev", "code"}},
			{Name: "GitHub Issues", URL: "https://github.com/issues", Shortcut: "GI", Category: "development", CheckStatus: false, Tags: []string{"dev", "github"}},
			{Name: "GitHub Pull Requests", URL: "https://github.com/pulls", Shortcut: "GP", Category: "development", CheckStatus: false, Tags: []string{"dev", "github"}},
			{Name: "YouTube", URL: "https://youtube.com", Shortcut: "Y", Category: "media", CheckStatus: false, Tags: []string{"video", "entertainment"}},
			{Name: "YouTube Studio", URL: "https://studio.youtube.com", Shortcut: "YS", Category: "media", CheckStatus: false, Tags: []string{"video", "creator"}},
			{Name: "Bluesky", URL: "https://bsky.app", Shortcut: "B", Category: "social", CheckStatus: false, Tags: []string{"social"}},
			{Name: "Google", URL: "https://google.com", Shortcut: "", Category: "search", CheckStatus: false, Tags: []string{"search"}},
		},
	}
}

// hasAnyPageFile says whether the data directory already holds a page.
func (fs *FileStore) hasAnyPageFile() bool {
	entries, err := os.ReadDir(fs.dataDir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if _, ok := parseBookmarkPageIDFromFilename(entry.Name()); ok {
			return true
		}
	}
	return false
}

// defaultSmartTodayPageIDs keeps Today on main: on the news page it would
// only repeat the links main already offers. Empty means every page, which
// is right for the one-page minimal seed and for the demo, which writes
// its own pages over these.
func defaultSmartTodayPageIDs() []int {
	if minimalSeed() || demoMode() {
		return []int{}
	}
	return []int{1}
}
