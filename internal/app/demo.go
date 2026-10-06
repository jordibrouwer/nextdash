package app

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

/*
Demo mode: NEXTDASH_DEMO=1 turns an instance into the public demo.

Anyone may click, drag, add and change things, and it all really works. On a
fixed round (NEXTDASH_DEMO_RESET_MINUTES, default 30), and as soon as nobody
has written for NEXTDASH_DEMO_IDLE_MINUTES (default 10), the server puts the
data back to the start: the data directory emptied, a fresh install written,
and the three bundled templates seeded on top. Seeding again rather than
restoring a snapshot keeps the demo's dates relative to the reset, so it reads
"added 2 hours ago" and never "in October 2026".

The demo needs a data directory of its own. It is emptied on every start and
every reset, so the server refuses to run on one that holds data without the
demo's marker file: a wrongly set variable must never wipe a real install.
*/

// demoNotAvailable is what a refused action says in the demo.
const demoNotAvailable = "Not available in the demo"

const (
	demoMarkerFile          = ".nextdash-demo"
	demoDefaultResetMinutes = 30
	demoDefaultIdleMinutes  = 10
)

func demoMode() bool {
	return strings.TrimSpace(os.Getenv("NEXTDASH_DEMO")) == "1"
}

func demoMinutes(name string, fallback int) time.Duration {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name))); err == nil && n > 0 {
		return time.Duration(n) * time.Minute
	}
	return time.Duration(fallback) * time.Minute
}

func demoResetEvery() time.Duration {
	return demoMinutes("NEXTDASH_DEMO_RESET_MINUTES", demoDefaultResetMinutes)
}

func demoIdleAfter() time.Duration {
	return demoMinutes("NEXTDASH_DEMO_IDLE_MINUTES", demoDefaultIdleMinutes)
}

// demoState is the reset's bookkeeping, shared by the write gate, the
// scheduler and /api/demo.
type demoState struct {
	mu        sync.Mutex   // one reset at a time
	resetting atomic.Bool  // writes wait it out with a 503
	lastReset atomic.Int64 // unix ms
	lastWrite atomic.Int64 // unix ms; 0 means nothing written since the reset
}

var demo demoState

/*
prepareDemoDataDir empties the demo's data directory before the store opens
it. An empty or missing directory becomes a demo one; a directory with the
marker is emptied; anything else is refused.
*/
func prepareDemoDataDir() error {
	if strings.TrimSpace(os.Getenv("NEXTDASH_DATA_DIR")) == "" {
		return fmt.Errorf("NEXTDASH_DEMO=1 needs NEXTDASH_DATA_DIR set to a directory of its own: the demo empties it on every reset")
	}
	dir := ResolveDataDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("the demo data directory %s could not be made: %w", dir, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("the demo data directory %s could not be read: %w", dir, err)
	}
	marked := false
	for _, entry := range entries {
		if entry.Name() == demoMarkerFile {
			marked = true
		}
	}
	if len(entries) > 0 && !marked {
		return fmt.Errorf("NEXTDASH_DEMO=1 refuses %s: it holds data and is not a demo directory (no %s). Point NEXTDASH_DATA_DIR at an empty directory", dir, demoMarkerFile)
	}
	if err := emptyDemoDir(dir); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, demoMarkerFile), []byte("This directory is emptied by nextDash's demo mode.\n"), 0o644)
}

// emptyDemoDir removes everything in dir except the marker.
func emptyDemoDir(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == demoMarkerFile {
			continue
		}
		if err := os.RemoveAll(filepath.Join(dir, entry.Name())); err != nil {
			return fmt.Errorf("the demo could not clear %s: %w", entry.Name(), err)
		}
	}
	return nil
}

// demoResetAt is when the next reset happens: the fixed round, or the idle
// one if somebody wrote and then stopped, whichever comes first.
func demoResetAt() int64 {
	next := demo.lastReset.Load() + demoResetEvery().Milliseconds()
	if last := demo.lastWrite.Load(); last > 0 {
		if idle := last + demoIdleAfter().Milliseconds(); idle < next {
			next = idle
		}
	}
	return next
}

/*
seedDemo writes the demo's data on top of a fresh install: three pages of
public sites (demo_seed.go), a few links waiting in the inbox, the ? searches,
the weather for New York, and the first-run cards answered so a visitor lands
on a working dashboard rather than on the template card.
*/
func (h *Handlers) seedDemo(now time.Time) error {
	if err := h.writeDemoPages(now); err != nil {
		return err
	}
	if err := h.store.SaveFinders(demoFinders); err != nil {
		return err
	}
	if err := h.seedDemoHealth(now); err != nil {
		return err
	}

	inbox := []InboxLink{
		{URL: "https://github.com/awesome-selfhosted/awesome-selfhosted", Title: "Awesome self-hosted", AddedAt: now.Add(-26 * time.Hour).UnixMilli()},
		{URL: "https://www.home-assistant.io/blog/", Title: "Home Assistant blog", AddedAt: now.Add(-5 * time.Hour).UnixMilli()},
		{URL: "https://jellyfin.org/docs/", Title: "Jellyfin documentation", AddedAt: now.Add(-3 * time.Hour).UnixMilli()},
		{URL: "https://docs.docker.com/compose/", Title: "Docker Compose", AddedAt: now.Add(-90 * time.Minute).UnixMilli(), Tags: []string{"docker"}},
		{URL: "https://tailscale.com/kb/", Title: "Tailscale knowledge base", AddedAt: now.Add(-20 * time.Minute).UnixMilli()},
	}
	for _, link := range inbox {
		link.Domain = hostnameFromURL(link.URL)
		if _, _, err := h.store.AddInboxLink(link, true, 0); err != nil {
			return err
		}
	}

	// Kept: links taken out of the inbox to sort later, on the hidden
	// Unsorted page, so the inbox's Keep and the Kept count show something.
	if _, err := h.store.EnsureUnsortedPage(); err != nil {
		return err
	}
	kept := []Bookmark{
		{Name: "Homelab networking guide", PreviewTitle: "Networking - ServeTheHome", PreviewDesc: "Switches, NICs and network gear for the homelab, reviewed.", URL: "https://www.servethehome.com/category/networking/", Tags: []string{"network"}, CreatedAt: now.Add(-50 * time.Hour).UnixMilli()},
		{Name: "Docker security cheat sheet", PreviewTitle: "Docker Security - OWASP Cheat Sheet Series", PreviewDesc: "Rules for running containers safely: users, capabilities, secrets and the socket.", URL: "https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html", Tags: []string{"docker", "security"}, CreatedAt: now.Add(-30 * time.Hour).UnixMilli()},
		{Name: "Self-hosted photo apps compared", PreviewTitle: "Photos - selfh.st apps", PreviewDesc: "Self-hosted photo libraries side by side.", URL: "https://selfh.st/apps/?tag=photos", Tags: []string{"photos"}, CreatedAt: now.Add(-8 * time.Hour).UnixMilli()},
	}
	if err := h.store.SaveBookmarksByPage(unsortedPageID, kept); err != nil {
		return err
	}

	// One Unraid server, answered from the embedded fixture. Its key lives in
	// the data directory, so it is written again after every reset.
	if err := saveUnraidAPIKey(demoUnraidServerID, "demo"); err != nil {
		return err
	}

	settings := h.store.GetSettings()
	settings.UnraidServers = []UnraidServer{{ID: demoUnraidServerID, Name: "Tower", BaseURL: "http://tower.local", Enabled: true}}
	settings.OnboardingCompleted = true
	settings.CurrentPage = 1
	settings.QuickStart.Dismissed = true
	settings.QuickStart.TemplatePicked = "keep"
	// The demo measures nothing, so it does not ask.
	settings.QuickStart.AnalyticsChoiceMade = true
	settings.AnalyticsOptIn = false
	settings.ShowWeatherWithDate = true
	settings.WeatherSource = "manual"
	settings.WeatherLocation = "New York"
	settings.WeatherUnit = "fahrenheit"
	// The action bar as its column on the right, kept in view rather than
	// sliding into the edge after two seconds: a first-time visitor should
	// see what it offers.
	settings.ActionBarEnabled = true
	settings.ActionBarPosition = actionBarRight
	settings.ActionBarAutoHideSeconds = 0
	// New bookmarks start unchecked: the demo checks no site.
	settings.NewBookmarkCheckMode = "off"
	// Fresh shows the seeded feeds; the demo does not poll them.
	settings.FeedsEnabled = true
	return h.store.SaveSettings(settings)
}

// hostnameFromURL is the host of an address, or "".
func hostnameFromURL(raw string) string {
	raw = strings.TrimPrefix(strings.TrimPrefix(raw, "https://"), "http://")
	if at := strings.IndexAny(raw, "/?#"); at >= 0 {
		raw = raw[:at]
	}
	return strings.TrimPrefix(raw, "www.")
}

/*
resetDemo puts the demo back to the start. Writes are refused for the moment
it takes; open tabs notice the new data revision and reload themselves, the
way they follow a change made on another device.
*/
func (h *Handlers) resetDemo() error {
	demo.mu.Lock()
	defer demo.mu.Unlock()
	demo.resetting.Store(true)
	defer demo.resetting.Store(false)

	fs, ok := h.store.(*FileStore)
	if !ok {
		return fmt.Errorf("the demo needs the file store")
	}
	if err := fs.emptyForDemo(); err != nil {
		return err
	}
	fs.initializeDefaultFiles()
	// The starter links are gone again in a moment; their favicons are not
	// worth fetching, and the demo fetches nothing from outside anyway.
	fs.TakeDefaultBookmarkIconPrefetch()
	if err := h.seedDemo(time.Now()); err != nil {
		return err
	}
	demoDockerEngine.reset(time.Now())
	h.invalidateHealthReportCache()
	applyRuntimeSettings(h.store.GetSettings())
	demo.lastWrite.Store(0)
	demo.lastReset.Store(time.Now().UnixMilli())
	return nil
}

// emptyForDemo clears the data directory under the store's lock and drops
// every cached read of it.
func (fs *FileStore) emptyForDemo() error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if err := emptyDemoDir(fs.dataDir); err != nil {
		return err
	}
	fs.readCache = newStoreReadCache()
	fs.noteDataMutation(0)
	return nil
}

// demoResetDue says whether the scheduler should reset now: the fixed round
// has come, or somebody wrote and then nobody did for the idle time.
func demoResetDue(now int64) bool {
	if now >= demo.lastReset.Load()+demoResetEvery().Milliseconds() {
		return true
	}
	last := demo.lastWrite.Load()
	return last > 0 && now >= last+demoIdleAfter().Milliseconds()
}

// StartDemoResetScheduler checks every 15 seconds whether a reset is due.
func (h *Handlers) StartDemoResetScheduler(stop <-chan struct{}) {
	if !demoMode() {
		return
	}
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if !demoResetDue(time.Now().UnixMilli()) {
					continue
				}
				if err := h.resetDemo(); err != nil {
					logWarn(logComponentServer, "the demo could not be reset (%v); it will be tried again", err)
				} else {
					logInfo(logComponentServer, "demo reset")
				}
			}
		}
	}()
}

// DemoStatus answers GET /api/demo for the demo bar.
func (h *Handlers) DemoStatus(w http.ResponseWriter, r *http.Request) {
	if !demoMode() {
		writeJSON(w, map[string]any{"demo": false})
		return
	}
	writeJSON(w, map[string]any{"demo": true, "resetAt": demoResetAt()})
}
