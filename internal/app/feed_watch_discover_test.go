package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

const multiFeedHead = `<html><head>
<link rel="alternate" type="application/rss+xml" title="Posts" href="/feed/">
<link rel="stylesheet" href="/s.css">
<link rel="alternate" type="application/atom+xml" title="Comments" href="/comments/feed/">
<link rel="alternate" type="application/rss+xml" title="Posts again" href="/feed/">
</head><body>x</body></html>`

func TestExtractFeedsFromHTMLReturnsAll(t *testing.T) {
	got := extractFeedsFromHTML(multiFeedHead)
	want := []feedLink{
		{URL: "/feed/", Title: "Posts", Type: "application/rss+xml"},
		{URL: "/comments/feed/", Title: "Comments", Type: "application/atom+xml"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("feed %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestDiscoverFeedsForURLResolvesAndAcceptsAFeedURL(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, multiFeedHead)
	})
	mux.HandleFunc("/feed/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprint(w, rssItemsFixture)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	h := newDiscoveryHandlers(t, nil)
	links := h.discoverFeedsForURL(context.Background(), srv.URL+"/")
	if len(links) != 2 || links[0].URL != srv.URL+"/feed/" || links[1].URL != srv.URL+"/comments/feed/" {
		t.Fatalf("page: %+v", links)
	}

	links = h.discoverFeedsForURL(context.Background(), srv.URL+"/feed/")
	if len(links) != 1 || links[0].URL != srv.URL+"/feed/" || links[0].Title != "Blog" {
		t.Fatalf("feed url: %+v", links)
	}
}

// Some sites send the first visit to a consent page that carries no feed link
// (nu.nl and tweakers.net both do), though the feed itself is open.
func TestProbeCommonFeedsFindsAnOpenFeedBehindAConsentWall(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><head><title>Please accept</title></head><body>consent</body></html>`)
	})
	mux.HandleFunc("/rss", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		fmt.Fprint(w, rssItemsFixture)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	h := newDiscoveryHandlers(t, nil)
	if got := h.discoverFeedsForURL(context.Background(), srv.URL+"/"); len(got) != 0 {
		t.Fatalf("the page itself advertises nothing, got %+v", got)
	}
	links := h.probeCommonFeeds(context.Background(), srv.URL+"/some/section")
	if len(links) != 1 || links[0].URL != srv.URL+"/rss" || links[0].Title != "Blog" {
		t.Fatalf("probe: %+v", links)
	}
}

func TestProbeCommonFeedsIgnoresPagesThatAreNotFeeds(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<html>not a feed</html>")
	}))
	defer srv.Close()
	h := newDiscoveryHandlers(t, nil)
	if links := h.probeCommonFeeds(context.Background(), srv.URL+"/"); len(links) != 0 {
		t.Fatalf("got %+v", links)
	}
}
