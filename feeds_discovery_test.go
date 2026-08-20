package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Fresh has to find its own feeds.
//
// Discovery used to happen only as a side effect of fetching a link preview, so
// an install with link previews switched off never fetched a page, never
// learned where any feed lived, and answered "nothing new" forever — which is
// exactly what a reader with Fresh switched on saw. Asking for itself is the
// whole point of these tests: a page that advertises a feed is found without a
// preview ever being fetched, and one that does not is remembered as such so it
// is not fetched again on the next round.
func newDiscoveryHandlers(t *testing.T, bookmarks []Bookmark) *Handlers {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	store := &FileStore{
		settingsFile: filepath.Join(dir, "settings.json"),
		dataDir:      dir,
		readCache:    newStoreReadCache(),
	}
	store.initializeDefaultFiles()

	settings := store.GetSettings()
	settings.FeedsEnabled = true
	// The test servers live on 127.0.0.1, which the outbound guard refuses
	// unless an install has said local addresses are legitimate targets.
	settings.AllowLocalBookmarks = true
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	pages := store.GetPages()
	if len(pages) == 0 {
		t.Fatal("expected the default install to seed a page")
	}
	if err := store.SaveBookmarksByPage(pages[0].ID, bookmarks); err != nil {
		t.Fatal(err)
	}
	return &Handlers{store: store}
}

func readFeeds(t *testing.T) FeedStateFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(ResolveDataDir(), "feeds.json"))
	if err != nil {
		t.Fatalf("no feeds.json: %v", err)
	}
	var state FeedStateFile
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestDiscoverFeedsFindsAFeedWithoutAPreview(t *testing.T) {
	var hits int
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, `<html><head><title>Blog</title>`+
			`<link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>hi</body></html>`)
	}))
	defer site.Close()

	h := newDiscoveryHandlers(t, []Bookmark{{Name: "Blog", URL: site.URL}})

	checked, found := h.DiscoverFeeds(context.Background())
	if checked != 1 || found != 1 {
		t.Fatalf("checked=%d found=%d, want 1/1 — the page advertises a feed", checked, found)
	}
	if hits == 0 {
		t.Fatal("the page was never fetched, so nothing could have been discovered")
	}

	state := readFeeds(t)
	entry, ok := state.Feeds[canonicalBookmarkURLKey(site.URL)]
	if !ok || entry.FeedURL != site.URL+"/feed.xml" {
		t.Fatalf("recorded %#v, want the absolute feed address", entry)
	}
	if entry.DiscoveredAt == 0 || state.LastDiscovery == 0 {
		t.Fatal("the round was not stamped, so the next one cannot tell what it has already asked")
	}
}

func TestDiscoverFeedsRemembersAPageWithNoFeed(t *testing.T) {
	var hits int
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, `<html><head><title>Plain</title></head><body>nothing here</body></html>`)
	}))
	defer site.Close()

	h := newDiscoveryHandlers(t, []Bookmark{{Name: "Plain", URL: site.URL}})

	checked, found := h.DiscoverFeeds(context.Background())
	if checked != 1 || found != 0 {
		t.Fatalf("checked=%d found=%d, want 1/0", checked, found)
	}
	entry := readFeeds(t).Feeds[canonicalBookmarkURLKey(site.URL)]
	if entry.FeedURL != "" || entry.DiscoveredAt == 0 {
		t.Fatalf("recorded %#v, want an empty feed with a stamp — asked, and this page has none", entry)
	}

	// Most pages have no feed. Asking all of them again on every round would be
	// a burst of outbound requests that can never find anything new.
	checked, _ = h.DiscoverFeeds(context.Background())
	if checked != 0 {
		t.Fatalf("second round checked %d, want 0 — a page just asked is left alone", checked)
	}
	if hits != 1 {
		t.Fatalf("the page was fetched %d times, want once", hits)
	}
}

func TestDiscoverFeedsRetriesAfterTheRetryWindow(t *testing.T) {
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><head><title>Plain</title></head><body>x</body></html>`)
	}))
	defer site.Close()

	h := newDiscoveryHandlers(t, []Bookmark{{Name: "Plain", URL: site.URL}})
	h.DiscoverFeeds(context.Background())

	// A site rebuilt with a feed should be noticed eventually, so the "no feed"
	// answer expires rather than being final.
	state := readFeeds(t)
	key := canonicalBookmarkURLKey(site.URL)
	entry := state.Feeds[key]
	entry.DiscoveredAt = time.Now().Add(-feedDiscoverRetryAfter - time.Hour).UnixMilli()
	state.Feeds[key] = entry
	if err := writeFeedStateFile(state); err != nil {
		t.Fatal(err)
	}

	if checked, _ := h.DiscoverFeeds(context.Background()); checked != 1 {
		t.Fatalf("checked=%d, want 1 — a stale answer is asked again", checked)
	}
}

// The panel has to be able to say "7 bookmarks, 7 asked, 0 with a feed", which
// is the difference between "nothing new" and "nothing to look at".
func TestFeedCoverageCountsAskedAndFound(t *testing.T) {
	bookmarks := []Bookmark{
		{URL: "https://blog.example"},
		{URL: "https://plain.example"},
		{URL: "https://never-asked.example"},
	}
	state := FeedStateFile{Feeds: map[string]FeedState{
		canonicalBookmarkURLKey("https://blog.example"):  {FeedURL: "https://blog.example/feed", DiscoveredAt: 1},
		canonicalBookmarkURLKey("https://plain.example"): {DiscoveredAt: 1},
	}}

	checked, withFeed := feedCoverage(state, bookmarks)
	if checked != 2 || withFeed != 1 {
		t.Fatalf("checked=%d withFeed=%d, want 2/1", checked, withFeed)
	}
}
