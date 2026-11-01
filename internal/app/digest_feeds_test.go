package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// recentItems makes n entries published daysAgo days before digestNow.
func recentItems(prefix string, n int, daysAgo float64) []FeedItem {
	at := digestNow.Add(-time.Duration(daysAgo * float64(24*time.Hour))).UnixMilli()
	out := make([]FeedItem, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, FeedItem{ID: fmt.Sprintf("%s-%d", prefix, i), Title: "t", PublishedAt: at})
	}
	return out
}

func feedsOn() Settings {
	s := allOn()
	s.DigestFeeds = true
	return s
}

func TestDigestFeedsLine(t *testing.T) {
	muted := FeedWatch{BookmarkKey: "b", FeedURL: "https://b.example/feed", Title: "B", Muted: true, Recent: recentItems("b", 6, 2)}
	foundOnly := recentItems("c", 3, 0)
	for i := range foundOnly {
		foundOnly[i].PublishedAt = 0
		foundOnly[i].FoundAt = digestNow.Add(-time.Hour).UnixMilli()
	}
	in := digestInput{Now: digestNow, Settings: feedsOn(), Feeds: []FeedWatch{
		{BookmarkKey: "a", FeedURL: "https://a.example/feed", Title: "A", Recent: append(recentItems("a", 9, 1), recentItems("old", 4, 10)...)},
		muted,
		{BookmarkKey: "c", FeedURL: "https://c.example/feed", Title: "C", Recent: foundOnly},
		{BookmarkKey: "d", FeedURL: "https://d.example/feed", Title: "D", Recent: recentItems("d", 2, 3)},
		{BookmarkKey: "e", FeedURL: "https://e.example/feed", Title: "E", Recent: recentItems("e", 3, 3)},
		{BookmarkKey: "f", FeedURL: "https://f.example/feed", Title: "F", Recent: recentItems("f", 2, 8)},
	}}
	d := buildDigest(in)
	if d.Feeds == nil || d.Feeds.Items != 23 || d.Feeds.Sites != 5 || d.Feeds.AtLeast {
		t.Fatalf("feeds %+v", d.Feeds)
	}
	if d.empty() {
		t.Fatal("feeds alone are a digest")
	}
	n := digestNotice(d)
	want := "Watched feeds published 23 items on 5 sites this week: A (9), B (6) and 3 more."
	if !strings.Contains(n.Error, want) {
		t.Fatalf("body %q", n.Error)
	}
}

func TestDigestFeedsAtLeastWhenAFeedIsFull(t *testing.T) {
	in := digestInput{Now: digestNow, Settings: feedsOn(), Feeds: []FeedWatch{
		{BookmarkKey: "a", FeedURL: "https://a.example/feed", Title: "A", Recent: recentItems("a", feedWatchRecent, 1)},
		{BookmarkKey: "b", FeedURL: "https://b.example/feed", Title: "B", Recent: recentItems("b", 2, 1)},
	}}
	d := buildDigest(in)
	if d.Feeds == nil || !d.Feeds.AtLeast {
		t.Fatalf("feeds %+v", d.Feeds)
	}
	if got := digestFeedsLine(d.Feeds); got != fmt.Sprintf("Watched feeds published at least %d items on 2 sites this week: A (%d) and B (2).", feedWatchRecent+2, feedWatchRecent) {
		t.Fatalf("line %q", got)
	}
}

func TestDigestFeedsOmittedWhenNothingPublished(t *testing.T) {
	if buildDigest(digestInput{Now: digestNow, Settings: feedsOn()}).Feeds != nil {
		t.Fatal("no feed is watched, no line")
	}
	in := digestInput{Now: digestNow, Settings: feedsOn(), Feeds: []FeedWatch{
		{BookmarkKey: "a", FeedURL: "https://a.example/feed", Recent: recentItems("a", 4, 9)},
	}}
	d := buildDigest(in)
	if d.Feeds != nil || !d.empty() {
		t.Fatalf("an old week gives no line: %+v", d.Feeds)
	}
}

func TestDigestFeedsOffWhenSettingOff(t *testing.T) {
	in := digestInput{Now: digestNow, Settings: allOn(), Feeds: []FeedWatch{
		{BookmarkKey: "a", FeedURL: "https://a.example/feed", Title: "A", Recent: recentItems("a", 4, 1)},
	}}
	if buildDigest(in).Feeds != nil {
		t.Fatal("digestFeeds off but the line is there")
	}
	in.Settings.DigestFeeds = true
	if buildDigest(in).Feeds == nil {
		t.Fatal("digestFeeds on but no line")
	}
}

func TestDigestFeedsDefaultsOn(t *testing.T) {
	dir := t.TempDir()
	settingsFile := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsFile, []byte(`{"digestNews":false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	store := &FileStore{settingsFile: settingsFile, dataDir: dir}
	if s := store.GetSettings(); !s.DigestFeeds || s.DigestNews {
		t.Fatalf("absent key should be on, stored false kept: feeds=%v news=%v", s.DigestFeeds, s.DigestNews)
	}
	if err := os.WriteFile(settingsFile, []byte(`{"digestFeeds":false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	store = &FileStore{settingsFile: settingsFile, dataDir: dir}
	if store.GetSettings().DigestFeeds {
		t.Fatal("a stored false is a choice")
	}
}

// The tick reads feed-watches.json itself: a muted feed is in the digest.
func TestDigestTickReadsTheWatchFile(t *testing.T) {
	h, sent := digestTestHandlers(t, `,"digestNews":false`)
	now := time.Date(2026, 10, 12, 8, 5, 0, 0, time.UTC)
	at := now.Add(-24 * time.Hour).UnixMilli()
	file := FeedWatchFile{Watches: []FeedWatch{{BookmarkKey: "k", FeedURL: "https://blog.example/feed", Title: "Blog", Muted: true,
		Recent: []FeedItem{{ID: "1", Title: "x", PublishedAt: at}, {ID: "2", Title: "y", PublishedAt: at}}}}}
	data, _ := json.Marshal(file)
	if err := os.WriteFile(feedWatchFilePath(), data, 0o644); err != nil {
		t.Fatal(err)
	}
	h.digestTick(context.Background(), now)
	if len(*sent) != 1 || !strings.Contains((*sent)[0].Error, "Watched feeds published 2 items on 1 site this week: Blog (2).") {
		t.Fatalf("sent %+v", *sent)
	}
}
