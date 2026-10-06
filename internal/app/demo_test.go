package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// newDemoHandlers is a demo instance on its own data directory, seeded.
func newDemoHandlers(t *testing.T) *Handlers {
	t.Helper()
	t.Setenv("NEXTDASH_DEMO", "1")
	t.Setenv("NEXTDASH_DISABLE_PREFETCH", "1")
	// As main.go does it: the directory is prepared before the store opens it.
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := prepareDemoDataDir(); err != nil {
		t.Fatal(err)
	}
	globalOutboundLimiter.reset()
	h := &Handlers{store: NewStore()}
	h.registerHandlerSources()
	demo.lastReset.Store(0)
	demo.lastWrite.Store(0)
	if err := h.resetDemo(); err != nil {
		t.Fatal(err)
	}
	return h
}

func TestDemoRefusesADirectoryWithARealInstall(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "bookmarks-1.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := prepareDemoDataDir()
	if err == nil || !strings.Contains(err.Error(), "not a demo directory") {
		t.Fatalf("got %v, want a refusal", err)
	}
	if _, statErr := os.Stat(filepath.Join(ResolveDataDir(), "bookmarks-1.json")); statErr != nil {
		t.Error("the refused directory was emptied anyway")
	}
}

func TestDemoNeedsItsOwnDataDirectory(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", "")
	if err := prepareDemoDataDir(); err == nil {
		t.Fatal("the demo started on the default data directory")
	}
}

func TestDemoEmptiesItsOwnDirectory(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	dir := ResolveDataDir()
	_ = os.WriteFile(filepath.Join(dir, demoMarkerFile), nil, 0o644)
	_ = os.MkdirAll(filepath.Join(dir, "icons"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "icons", "x.png"), []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "bookmarks-9.json"), []byte("{}"), 0o644)
	if err := prepareDemoDataDir(); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 || entries[0].Name() != demoMarkerFile {
		t.Errorf("left behind: %v", entries)
	}
}

// The seed: three pages of public sites, light widgets only, the weather for
// New York, and the first-run cards answered.
func TestDemoSeedsThreePagesOfPublicSites(t *testing.T) {
	h := newDemoHandlers(t)
	pages := h.store.GetPages()
	names := []string{}
	total := 0
	tagged := 0
	for _, page := range pages {
		if page.Hidden {
			continue // Unsorted, holding the kept links
		}
		names = append(names, page.Name)
		for _, bookmark := range h.store.GetBookmarksByPage(page.ID) {
			total++
			if len(bookmark.Tags) > 0 {
				tagged++
			}
			if !strings.HasPrefix(bookmark.URL, "https://") {
				t.Errorf("%s: %s is not a public https address", page.Name, bookmark.URL)
			}
		}
		// Only widgets that read the demo's own data or run in the browser:
		// nothing that reads the host or fetches from outside on the server.
		widgets, _ := h.store.GetPageBlocks(page.ID)
		for _, widget := range widgets {
			switch widget.Type {
			case WidgetTypeHealth, WidgetTypeWeather, WidgetTypeNotes, WidgetTypeInbox, WidgetTypeDuplicates:
			default:
				t.Errorf("%s: widget %s is not one the demo may carry", page.Name, widget.Type)
			}
		}
	}
	if strings.Join(names, ",") != "Dev,Homelab,Self-hosted" {
		t.Fatalf("pages: %v", names)
	}
	if total < 45 || total > 55 || tagged != total {
		t.Errorf("%d bookmarks, %d tagged; want about 50, all tagged", total, tagged)
	}
	settings := h.store.GetSettings()
	if !settings.ActionBarEnabled || settings.ActionBarPosition != actionBarRight || settings.ActionBarAutoHideSeconds != 0 {
		t.Errorf("action bar: enabled %v, at %q, hides after %ds; want the right column, in view",
			settings.ActionBarEnabled, settings.ActionBarPosition, settings.ActionBarAutoHideSeconds)
	}
	if settings.WeatherLocation != "New York" || !settings.ShowWeatherWithDate {
		t.Errorf("weather: %q, shown %v", settings.WeatherLocation, settings.ShowWeatherWithDate)
	}
	if !settings.OnboardingCompleted || settings.QuickStart.TemplatePicked == "" || !settings.QuickStart.Dismissed {
		t.Errorf("first-run cards not answered: %+v", settings.QuickStart)
	}
	if len(h.store.GetInboxItems()) == 0 {
		t.Error("the inbox is empty")
	}
	if kept := h.store.GetBookmarksByPage(unsortedPageID); len(kept) != 3 {
		t.Errorf("%d kept links, want 3", len(kept))
	}
	history := readHealthHistoryFile()
	if len(history.Samples) != len(demoMonitors) {
		t.Errorf("history for %d monitors, want %d", len(history.Samples), len(demoMonitors))
	}
	for key, samples := range history.Samples {
		down := 0
		for _, sample := range samples {
			if !sample.Up {
				down++
			}
		}
		if len(samples) < 1400 || len(samples) > maxHealthSamplesPerURL {
			t.Errorf("%s: %d samples", key, len(samples))
		}
		if key == canonicalBookmarkURLKey("https://www.home-assistant.io/") && down == 0 {
			t.Error("Home Assistant's outages are missing")
		}
	}
	soon := false
	for _, cert := range readHealthCacheFile().Certificates {
		soon = soon || cert.ExpiresAt < time.Now().Add(14*24*time.Hour).UnixMilli()
	}
	if !soon {
		t.Error("no certificate close to expiry")
	}
	if points := readHealthTrendFile().Points; len(points) != 30 {
		t.Errorf("%d trend points, want 30", len(points))
	}
	fresh := freshnessForBookmarks(readFeedStateFile(), h.store.GetBookmarksByPage(1))
	all := []Bookmark{}
	for pageID := 1; pageID <= len(demoPages()); pageID++ {
		all = append(all, h.store.GetBookmarksByPage(pageID)...)
	}
	fresh = freshnessForBookmarks(readFeedStateFile(), all)
	for _, f := range demoFeeds {
		if got := fresh[canonicalBookmarkURLKey(f.url)].NewCount; got != f.fresh {
			t.Errorf("%s: %d new, want %d", f.url, got, f.fresh)
		}
	}
	if len(h.store.GetFinders()) < 4 {
		t.Errorf("%d finders", len(h.store.GetFinders()))
	}
}

func TestDemoResetPutsAChangedPageBack(t *testing.T) {
	h := newDemoHandlers(t)
	before := h.store.GetDataRevision()
	bookmarks := append(h.store.GetBookmarksByPage(1), Bookmark{Name: "Visitor", URL: "https://example.com/"})
	if err := h.store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SavePage(Page{ID: 7, Name: "Visitor page"}); err != nil {
		t.Fatal(err)
	}
	changed := h.store.GetDataRevision()
	if err := h.resetDemo(); err != nil {
		t.Fatal(err)
	}
	if _, ok := bookmarkURLsByName(h.store.GetBookmarksByPage(1))["Visitor"]; ok {
		t.Error("the visitor's link survived the reset")
	}
	for _, page := range h.store.GetPages() {
		if page.Name == "Visitor page" {
			t.Error("the visitor's page survived the reset")
		}
	}
	if after := h.store.GetDataRevision(); after == changed || before == changed {
		t.Errorf("revision did not move: %s -> %s -> %s", before, changed, after)
	}
	if demo.lastWrite.Load() != 0 {
		t.Error("the reset left the idle clock running")
	}
}

func TestDemoRefusesWritesDuringAReset(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "1")
	demo.resetting.Store(true)
	defer demo.resetting.Store(false)
	reached := false
	guard := demoGuard(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	rec := httptest.NewRecorder()
	guard.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/bookmarks/add", nil))
	if reached || rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("write let through during a reset: %d", rec.Code)
	}
}

func TestDemoResetsOnTheRoundAndWhenIdle(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO_RESET_MINUTES", "30")
	t.Setenv("NEXTDASH_DEMO_IDLE_MINUTES", "10")
	now := time.Now().UnixMilli()
	minute := time.Minute.Milliseconds()
	demo.lastReset.Store(now)
	demo.lastWrite.Store(0)
	if demoResetDue(now + 15*minute) {
		t.Error("reset with nothing written and the round not yet come")
	}
	if !demoResetDue(now + 30*minute) {
		t.Error("no reset when the round came")
	}
	demo.lastWrite.Store(now + 2*minute)
	if demoResetDue(now + 11*minute) {
		t.Error("reset before ten quiet minutes")
	}
	if !demoResetDue(now + 12*minute) {
		t.Error("no reset after ten quiet minutes")
	}
	if got := demoResetAt(); got != now+12*minute {
		t.Errorf("resetAt %d, want the idle one %d", got, now+12*minute)
	}
	demo.lastWrite.Store(0)
}

func TestDemoStatusOutsideTheDemo(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "")
	h := newTestHandlers(t)
	rec := httptest.NewRecorder()
	h.DemoStatus(rec, httptest.NewRequest(http.MethodGet, "/api/demo", nil))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out["demo"] != false || out["resetAt"] != nil {
		t.Errorf("%v", out)
	}
}

// The demo checks no site, whichever way it is asked: the check itself, the
// ping route, a bookmark that asks to be checked, and a re-check of all.
func TestDemoPollsNoSite(t *testing.T) {
	hits := 0
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer site.Close()
	h := newDemoHandlers(t)

	if result := h.pingURLDetailed(context.Background(), site.URL); result.ErrorDetail != demoNotAvailable {
		t.Errorf("check answered %+v", result)
	}

	// A seeded monitor's dot reads the seeded status; anything else is refused.
	rec := httptest.NewRecorder()
	h.PingURL(rec, httptest.NewRequest(http.MethodGet, "/api/ping?url=https://github.com/", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"online"`) {
		t.Errorf("/api/ping for a seeded monitor answered %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	h.PingURL(rec, httptest.NewRequest(http.MethodGet, "/api/ping?url=https://gitlab.com/", nil))
	if rec.Code != http.StatusForbidden {
		t.Errorf("/api/ping for an unseeded link answered %d", rec.Code)
	}

	// Checking cannot be switched on; the seeded monitors keep theirs.
	bookmarks := h.store.GetBookmarksByPage(1)
	for i := range bookmarks {
		bookmarks[i].CheckStatus = true
		bookmarks[i].Monitor = true
	}
	bookmarks = append(bookmarks, Bookmark{Name: "Local", URL: site.URL, CheckStatus: true})
	if err := h.store.SaveBookmarksByPage(1, bookmarks); err != nil {
		t.Fatal(err)
	}
	for _, bookmark := range h.store.GetBookmarksByPage(1) {
		seeded := bookmark.Name == "GitHub" || bookmark.Name == "Hacker News"
		if bookmark.CheckStatus || bookmark.Monitor != seeded {
			t.Errorf("%s: periodic %v, monitor %v; only the seeded monitors may stay on", bookmark.Name, bookmark.CheckStatus, bookmark.Monitor)
		}
	}

	if _, err := h.runHealthRetest(context.Background(), true, "test"); err != nil {
		t.Fatal(err)
	}
	broken := ""
	for _, bookmark := range h.store.GetBookmarksByPage(2) {
		if bookmark.LastError != "" {
			broken = bookmark.LastError
		}
	}
	if broken != "404 Not Found" {
		t.Errorf("a re-check wrote over the seeded result: %q", broken)
	}
	if n := h.pollFeeds(context.Background(), nil); n != 0 {
		t.Errorf("polled %d feeds", n)
	}
	// Not even in the start-up window, when the favicons are fetched.
	demoOutboundOpen.Store(true)
	checked, _ := h.DiscoverFeeds(context.Background())
	demoOutboundOpen.Store(false)
	if checked != 0 {
		t.Errorf("looked for feeds on %d pages", checked)
	}
	if hits != 0 {
		t.Errorf("the site was asked %d times", hits)
	}
}
