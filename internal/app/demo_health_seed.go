package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

/*
The demo's health and feed picture: five monitored sites with thirty days of
history -- a few outages, one service that answers slowly -- a certificate a
week from expiry, a daily health trend, and feeds with new entries since the
last visit.

All of it is seeded, relative to the reset. The demo checks no site: the
monitor scheduler does not run, /api/ping answers from this cache, and Fresh
does not poll. It is a picture of what nextDash shows after a month, not a
recording of anything.
*/

type demoMonitor struct {
	url             string
	page            int
	pingLow, spread int
	outages         []demoOutage
}

type demoOutage struct {
	daysAgo float64 // when it started
	minutes int
	code    int // 0 for a network failure
}

var demoMonitors = []demoMonitor{
	{url: "https://github.com/", page: 1, pingLow: 38, spread: 30, outages: []demoOutage{{daysAgo: 12.4, minutes: 35, code: 503}}},
	{url: "https://news.ycombinator.com/", page: 1, pingLow: 170, spread: 90},
	{url: "https://www.home-assistant.io/", page: 2, pingLow: 85, spread: 60, outages: []demoOutage{{daysAgo: 5.2, minutes: 120, code: 0}, {daysAgo: 1.1, minutes: 20, code: 502}}},
	{url: "https://tailscale.com/", page: 2, pingLow: 28, spread: 25},
	{url: "https://jellyfin.org/", page: 3, pingLow: 120, spread: 70, outages: []demoOutage{{daysAgo: 18.6, minutes: 60, code: 0}}},
}

// demoFeeds are the bookmarks whose pages advertise a feed, with how many
// entries are new since the bookmark was last opened.
var demoFeeds = []struct {
	url, feed string
	fresh     int
}{
	{"https://news.ycombinator.com/", "https://news.ycombinator.com/rss", 9},
	{"https://lobste.rs/", "https://lobste.rs/rss", 4},
	{"https://dev.to/", "https://dev.to/feed", 6},
	{"https://changelog.com/", "https://changelog.com/feed", 1},
	{"https://selfh.st/", "https://selfh.st/rss/", 2},
	{"https://www.home-assistant.io/", "https://www.home-assistant.io/atom.xml", 1},
	{"https://nextdash.cc/", "https://nextdash.cc/feed.xml", 0},
}

// demoNoise is a small deterministic jitter, so the charts are not rulers and
// every reset draws the same picture.
func demoNoise(i, seed int) int {
	x := uint32(i*2654435761) ^ uint32(seed*40503)
	x ^= x >> 13
	x *= 0x5bd1e995
	return int(x>>16) % 1000
}

func (m demoMonitor) down(at time.Time, now time.Time) (bool, int) {
	for _, o := range m.outages {
		start := now.Add(-time.Duration(o.daysAgo * float64(24*time.Hour)))
		if !at.Before(start) && at.Before(start.Add(time.Duration(o.minutes)*time.Minute)) {
			return true, o.code
		}
	}
	return false, 0
}

/*
seedDemoHealth writes the monitors' flags, their history and current state,
the certificates, the trend and the feeds. The monitor flags go straight into
the page files: a store write in the demo keeps checking from being switched
on, and these are the ones it then keeps.
*/
func (h *Handlers) seedDemoHealth(now time.Time) error {
	fs, ok := h.store.(*FileStore)
	if !ok {
		return fmt.Errorf("the demo needs the file store")
	}

	// By page as well as address: Tailscale and Docker Hub are on two pages
	// on purpose, and only the copy named here is the monitor.
	monitored := map[string]bool{}
	for _, m := range demoMonitors {
		monitored[fmt.Sprintf("%d %s", m.page, canonicalBookmarkURLKey(m.url))] = true
	}
	for pageID := 1; pageID <= len(demoPages()); pageID++ {
		path := filepath.Join(fs.dataDir, fmt.Sprintf("bookmarks-%d.json", pageID))
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var page PageWithBookmarks
		if err := json.Unmarshal(data, &page); err != nil {
			return err
		}
		for i := range page.Bookmarks {
			if monitored[fmt.Sprintf("%d %s", pageID, canonicalBookmarkURLKey(page.Bookmarks[i].URL))] {
				page.Bookmarks[i].Monitor = true
				page.Bookmarks[i].MonitorIntervalMinutes = 30
				// The last half-hourly check, as the history below ends.
				page.Bookmarks[i].LastChecked = now.Truncate(30 * time.Minute).UnixMilli()
			}
		}
		if err := writeIndentJSONFile(path, page); err != nil {
			return err
		}
	}
	fs.InvalidateReadCache()

	// Thirty days, one check every half hour: 1440 samples a monitor, under
	// the per-URL cap, so the long windows need no day summaries.
	const step = 30 * time.Minute
	history := HealthHistoryFile{GeneratedAt: now.UnixMilli(), Samples: map[string][]HealthSample{}}
	cache := HealthScanCacheFile{GeneratedAt: now.UnixMilli(), Cache: map[string]HealthScanCache{}, Certificates: map[string]HostCertificate{}}
	for seed, m := range demoMonitors {
		key := canonicalBookmarkURLKey(m.url)
		start := now.Add(-30 * 24 * time.Hour).Truncate(step)
		samples := make([]HealthSample, 0, 1440)
		var last HealthSample
		for i, at := 0, start; !at.After(now); i, at = i+1, at.Add(step) {
			sample := HealthSample{T: at.UnixMilli(), Up: true, PingMs: m.pingLow + demoNoise(i, seed)*m.spread/1000, Code: 200}
			if down, code := m.down(at, now); down {
				sample = HealthSample{T: at.UnixMilli(), Up: false, Code: code}
			}
			samples = append(samples, sample)
			last = sample
		}
		history.Samples[key] = samples
		status := "online"
		if !last.Up {
			status = "offline"
		}
		cache.Cache[key] = HealthScanCache{URL: key, Status: status, PingMs: last.PingMs, LastScanned: last.T}
	}
	// The two links that broke, as the last check found them.
	cache.Cache[canonicalBookmarkURLKey("https://wiki.example.org/homelab")] = HealthScanCache{
		URL: "https://wiki.example.org/homelab", Status: "offline", LastScanned: now.Add(-2 * time.Hour).UnixMilli(), Error: "404 Not Found"}
	cache.Cache[canonicalBookmarkURLKey("https://podcast.example.net/feed")] = HealthScanCache{
		URL: "https://podcast.example.net/feed", Status: "offline", LastScanned: now.Add(-2 * time.Hour).UnixMilli(), Error: "DNS lookup failed"}
	// One certificate a week and a bit from expiry, and the others months out.
	for host, days := range map[string]int{"www.home-assistant.io": 9, "github.com": 71, "news.ycombinator.com": 54, "tailscale.com": 83, "jellyfin.org": 47} {
		cache.Certificates[host] = HostCertificate{Host: host, ExpiresAt: now.Add(time.Duration(days) * 24 * time.Hour).UnixMilli(), SeenAt: now.Add(-30 * time.Minute).UnixMilli()}
	}
	cache.LastAutoRecheck = now.Add(-3 * time.Hour).UnixMilli()
	if err := writeHealthHistoryFile(history); err != nil {
		return err
	}
	if err := writeHealthCacheFile(cache); err != nil {
		return err
	}

	// A month of daily health, the second broken link arriving ten days ago.
	total := 0
	for _, page := range demoPages() {
		total += len(page.links)
	}
	trend := HealthTrendFile{GeneratedAt: now.UnixMilli()}
	today := now.Truncate(24 * time.Hour)
	for day := 29; day >= 0; day-- {
		at := today.Add(-time.Duration(day) * 24 * time.Hour)
		broken := 1
		if day <= 10 {
			broken = 2
		}
		monDown := 0
		if day == 5 || day == 1 {
			monDown = 1
		}
		count := total - day/6
		trend.Points = append(trend.Points, HealthTrendPoint{
			T: at.UnixMilli(), Total: count, Healthy: count - broken - 2, Broken: broken, MonDown: monDown,
			Monitored: len(demoMonitors), Unchecked: count - len(demoMonitors), Duplicate: 2,
			Opens: 6 + demoNoise(day, 7)%9, Score: 94 - broken - monDown,
		})
	}
	if err := writeHealthTrendFile(trend); err != nil {
		return err
	}

	// Feeds, as the last poll twenty minutes ago left them: the newest entries
	// after the bookmark's last open, so the rows have a count.
	opened := map[string]int64{}
	for pageID := 1; pageID <= len(demoPages()); pageID++ {
		for _, b := range h.store.GetBookmarksByPage(pageID) {
			opened[canonicalBookmarkURLKey(b.URL)] = b.LastOpened
		}
	}
	state := FeedStateFile{Feeds: map[string]FeedState{}, LastPoll: now.Add(-20 * time.Minute).UnixMilli(), LastDiscovery: now.Add(-26 * time.Hour).UnixMilli()}
	for i, f := range demoFeeds {
		key := canonicalBookmarkURLKey(f.url)
		// A bookmark never opened counts everything its feed has, so it gets
		// only the new entries; an opened one also gets a few it has seen.
		since := opened[key]
		seen := 6
		if since == 0 {
			seen = 0
		}
		if since == 0 {
			since = now.Add(-3 * time.Hour).UnixMilli()
		}
		items := []int64{}
		for n := 0; n < f.fresh; n++ { // after the last open, newest first
			gap := (now.UnixMilli() - since) / int64(f.fresh+1)
			items = append(items, now.UnixMilli()-int64(n+1)*gap+int64(demoNoise(n, i))%max(gap/2, 1))
		}
		for n := 0; n < seen; n++ { // before it, already seen
			items = append(items, since-int64(n+1)*int64(5*time.Hour/time.Millisecond))
		}
		state.Feeds[key] = FeedState{FeedURL: f.feed, CheckedAt: state.LastPoll, TriedAt: state.LastPoll,
			RecentItems: items, DiscoveredAt: state.LastDiscovery}
		if len(items) > 0 {
			entry := state.Feeds[key]
			entry.LastItemAt = items[0]
			state.Feeds[key] = entry
		}
	}
	return writeFeedStateFile(state)
}
