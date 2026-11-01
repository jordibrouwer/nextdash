package app

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const tinyPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

// imageFeedServer serves a feed with one entry whose picture is /hero.<ext>.
func imageFeedServer(t *testing.T, imagePath, contentType string, body []byte) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == imagePath {
			w.Header().Set("Content-Type", contentType)
			w.Write(body)
			return
		}
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprintf(w, `<rss version="2.0"><channel><title>Pics</title>
<item><title>Old</title><guid>old</guid><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate></item>
<item><title>With picture</title><link>%s/p</link><guid>p</guid><pubDate>Tue, 02 Jan 2024 10:00:00 GMT</pubDate><description><![CDATA[<img src="%s%s">]]></description></item>
</channel></rss>`, srv.URL, srv.URL, imagePath)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// watchWithOldBaseline returns a handler and a watch whose baseline predates
// the picture entry, so the next poll finds it as news.
func watchWithOldBaseline(t *testing.T, srv *httptest.Server) (*Handlers, FeedWatch) {
	t.Helper()
	h, _ := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	key := canonicalBookmarkURLKey("https://pics.example/")
	if err := h.store.SaveBookmarksByPage(1, []Bookmark{{Name: "Pics", URL: "https://pics.example/"}}); err != nil {
		t.Fatal(err)
	}
	w := FeedWatch{BookmarkKey: key, FeedURL: srv.URL, IntervalMinutes: 60, SeenIDs: []string{"old"},
		NewestAt: time.Date(2024, 1, 1, 10, 0, 0, 0, time.UTC).UnixMilli(), TriedAt: 1, CheckedAt: 1}
	if err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{w}}); err != nil {
		t.Fatal(err)
	}
	return h, w
}

func TestWatchImagesAreStoredLocally(t *testing.T) {
	png, _ := base64.StdEncoding.DecodeString(tinyPNG)
	srv := imageFeedServer(t, "/hero.png", "image/png", png)
	h, _ := watchWithOldBaseline(t, srv)
	if n, news := h.pollWatches(context.Background(), true); n != 1 || len(news) != 1 {
		t.Fatalf("n=%d news=%d", n, len(news))
	}
	items := readFeedWatchFile().Watches[0].Items
	if len(items) != 1 || !strings.HasPrefix(items[0].Image, "/data/preview-images/pi-") {
		t.Fatalf("items: %+v", items)
	}
	name := strings.TrimPrefix(items[0].Image, "/data/preview-images/")
	if _, err := os.Stat(filepath.Join(previewImageDir(), name)); err != nil {
		t.Fatalf("image file missing: %v", err)
	}

	rec := httptest.NewRecorder()
	h.GetFeedWatchItems(rec, httptest.NewRequest(http.MethodGet, "/api/feeds/watch/items", nil))
	body := rec.Body.String()
	if strings.Contains(body, srv.URL+"/hero.png") || strings.Contains(body, "imageSource") {
		t.Fatalf("the remote image URL must not reach the client: %s", body)
	}
	if !strings.Contains(body, `"image":"/data/preview-images/pi-`) {
		t.Fatalf("local image missing from items: %s", body)
	}
}

func TestWatchImageRefusedSVG(t *testing.T) {
	srv := imageFeedServer(t, "/hero.svg", "image/svg+xml", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`))
	h, _ := watchWithOldBaseline(t, srv)
	h.pollWatches(context.Background(), true)
	items := readFeedWatchFile().Watches[0].Items
	if len(items) != 1 || items[0].Image != "" {
		t.Fatalf("an SVG must not be stored: %+v", items)
	}
}

func TestPruneKeepsWatchImages(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	dir := previewImageDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"pi-kept.png", "pi-orphan.png"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{{BookmarkKey: "k", FeedURL: "https://f/", IntervalMinutes: 60,
		Items: []FeedItem{{ID: "1", Title: "t", Image: "/data/preview-images/pi-kept.png"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	h.pruneOrphanPreviewImages()
	if _, err := os.Stat(filepath.Join(dir, "pi-kept.png")); err != nil {
		t.Fatal("a watched item's picture was pruned")
	}
	if _, err := os.Stat(filepath.Join(dir, "pi-orphan.png")); err == nil {
		t.Fatal("an unreferenced picture should be pruned")
	}
}
