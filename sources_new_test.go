package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
Mastodon pages through a Link header, which is the one genuinely awkward part.

There is no page number and no offset: the next page's address arrives in a
header holding a comma-separated list of <url>; rel="name" pairs. Following the
wrong one loops -- rel="prev" points backwards -- and missing it entirely stops
the walk after forty posts without saying so.
*/
func TestMastodonNextPageReadsOnlyNext(t *testing.T) {
	header := `<https://m.example/api/v1/bookmarks?max_id=12>; rel="next", ` +
		`<https://m.example/api/v1/bookmarks?min_id=99>; rel="prev"`
	if got := mastodonNextPage(header); got != "https://m.example/api/v1/bookmarks?max_id=12" {
		t.Errorf("next = %q", got)
	}

	// Only prev: the walk is over. Following it would page backwards for ever.
	if got := mastodonNextPage(`<https://m.example/x?min_id=99>; rel="prev"`); got != "" {
		t.Errorf("followed a prev link: %q", got)
	}
	if got := mastodonNextPage(""); got != "" {
		t.Errorf("invented a page from an empty header: %q", got)
	}
}

// Readers paste an instance in three shapes, all meaning one server.
func TestMastodonInstanceURLAcceptsWhatPeopleType(t *testing.T) {
	for _, raw := range []string{
		"mastodon.social",
		"https://mastodon.social",
		"@me@mastodon.social",
		"https://mastodon.social/@me",
	} {
		got, err := mastodonInstanceURL(raw)
		if err != nil {
			t.Errorf("%q: %v", raw, err)
			continue
		}
		if got != "https://mastodon.social" {
			t.Errorf("%q -> %q", raw, got)
		}
	}

	// http would send the token in clear, so it is upgraded rather than used.
	if got, _ := mastodonInstanceURL("http://mastodon.social"); got != "https://mastodon.social" {
		t.Errorf("http instance = %q, want https", got)
	}
	if _, err := mastodonInstanceURL(""); err == nil {
		t.Error("accepted an empty instance")
	}
}

/*
A boost's bookmark belongs to the post that was boosted.

Bookmarking a boost and bookmarking the original are the same intent, and
storing the boost would give a bookmark pointing at somebody's repost rather
than at what they reposted.
*/
func TestMastodonBookmarksFollowTheBoostedPost(t *testing.T) {
	h := newTestHandlers(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{
				"id": "3", "url": "https://m.example/@booster/3", "content": "<p>boost wrapper</p>",
				"created_at": "2026-03-01T12:00:00Z",
				"account":    map[string]any{"acct": "booster", "display_name": "Booster"},
				"reblog": map[string]any{
					"id": "2", "url": "https://m.example/@author/2",
					"content":    "<p>The <em>original</em> post</p>",
					"created_at": "2026-02-01T12:00:00Z",
					"account":    map[string]any{"acct": "author", "display_name": "Author"},
				},
			},
		})
	}))
	defer server.Close()

	source := SourceState{
		Kind: "mastodon", Token: "tok",
		Handle: strings.TrimPrefix(server.URL, "http://"), TargetCategory: "Mastodon",
	}
	// The instance resolver forces https, so point it at the stub directly.
	result, err := h.fetchMastodonAt(context.Background(), server.URL, source)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(result.Bookmarks) != 1 {
		t.Fatalf("got %d bookmarks", len(result.Bookmarks))
	}
	row := result.Bookmarks[0]
	if row.URL != "https://m.example/@author/2" {
		t.Errorf("url = %q, want the boosted post", row.URL)
	}
	// A post has no title, so the name is who wrote it and what they said --
	// with the markup stripped, because a name is not HTML.
	if !strings.Contains(row.Name, "Author") || !strings.Contains(row.Name, "original") {
		t.Errorf("name = %q", row.Name)
	}
	if strings.Contains(row.Name, "<") || strings.Contains(row.Note, "<") {
		t.Errorf("markup survived: name=%q note=%q", row.Name, row.Note)
	}
}

/*
A feed becomes rows or a single bookmark, and the reader chooses.

A Hacker News favorite is something deliberately saved, so rows is the sensible
default there. A YouTube channel is a subscription whose feed is a rolling
window: as rows that means new bookmarks appearing for ever.
*/
func TestFeedSourcesHonourTheRowsSetting(t *testing.T) {
	h := newTestHandlers(t)

	single, err := h.FetchHackerNewsFavorites(context.Background(),
		SourceState{Handle: "someone", AsRows: false, TargetCategory: "HN"})
	if err != nil {
		t.Fatalf("single: %v", err)
	}
	if len(single.Bookmarks) != 1 {
		t.Fatalf("got %d bookmarks, want one for the source itself", len(single.Bookmarks))
	}
	if !strings.Contains(single.Bookmarks[0].URL, "news.ycombinator.com") {
		t.Errorf("the single bookmark points at %q, want the favorites page", single.Bookmarks[0].URL)
	}

	// No account is a setup problem, said as one.
	if _, err := h.FetchHackerNewsFavorites(context.Background(), SourceState{AsRows: true}); err == nil {
		t.Error("fetched with no username")
	}
	// A username is a username, not a path to somewhere else.
	if _, err := h.FetchHackerNewsFavorites(context.Background(),
		SourceState{Handle: "a/../b", AsRows: true}); err == nil {
		t.Error("accepted a path as a username")
	}
}

// RSS and Atom write a link differently, and both have to be read: encoding/xml
// refuses two fields claiming one tag, which go vet catches.
func TestFeedSourceReadsBothLinkShapes(t *testing.T) {
	h := newTestHandlers(t)

	rss := `<rss><channel><title>T</title><item>
		<title>An RSS item</title><link>https://example.com/rss</link>
		<pubDate>Mon, 02 Mar 2026 12:00:00 +0000</pubDate></item></channel></rss>`
	atom := `<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><entry>
		<title>An Atom entry</title><link rel="alternate" href="https://example.com/atom"/>
		<published>2026-03-02T12:00:00Z</published></entry></feed>`

	for name, body := range map[string]string{"rss": rss, "atom": atom} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, body)
		}))
		result, err := h.fetchFeedSource(context.Background(), server.URL, "", "Feeds")
		server.Close()
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if len(result.Bookmarks) != 1 {
			t.Errorf("%s: got %d bookmarks", name, len(result.Bookmarks))
			continue
		}
		if !strings.Contains(result.Bookmarks[0].URL, "example.com/"+name) {
			t.Errorf("%s: url = %q", name, result.Bookmarks[0].URL)
		}
		if result.Bookmarks[0].CreatedAt == 0 {
			t.Errorf("%s: no date, so Recently added would stamp it today", name)
		}
	}
}
