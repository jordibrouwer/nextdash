package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestResetRetiredFeedsTouchesOnlyRetiredOnes(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	state := FeedStateFile{Feeds: map[string]FeedState{
		"a": {FeedURL: "https://a.example/feed", Failures: feedMaxFailures, TriedAt: 123},
		"b": {FeedURL: "https://b.example/feed", Failures: feedMaxFailures, TriedAt: 456},
		"c": {FeedURL: "https://c.example/feed", Failures: 2, TriedAt: 789},
	}}
	if err := writeFeedStateFile(state); err != nil {
		t.Fatalf("write: %v", err)
	}

	if got := len(resetRetiredFeeds("https://a.example/feed")); got != 1 {
		t.Fatalf("reset %d feeds, want 1", got)
	}
	after := readFeedStateFile()
	if a := after.Feeds["a"]; a.Failures != 0 || a.TriedAt != 0 {
		t.Errorf("a was not given another life: %+v", a)
	}
	if b := after.Feeds["b"]; b.Failures != feedMaxFailures || b.TriedAt != 456 {
		t.Errorf("b was touched though it was not asked for: %+v", b)
	}
	if c := after.Feeds["c"]; c.Failures != 2 || c.TriedAt != 789 {
		t.Errorf("c is not retired and must stay as it was: %+v", c)
	}

	if got := len(resetRetiredFeeds("")); got != 1 {
		t.Fatalf("an empty address reset %d feeds, want the one left (b)", got)
	}
}

// Retry on one feed polls that feed only, and does not stand in for the
// scheduled round.
func TestRetryFeedPollsOnlyTheResetFeed(t *testing.T) {
	hits := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits[r.URL.Path]++
		_, _ = w.Write([]byte(`<rss><channel><item><pubDate>Mon, 02 Jun 2025 10:00:00 +0000</pubDate></item></channel></rss>`))
	}))
	defer server.Close()

	h, _ := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	if err := h.store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "A", URL: "https://a.example/blog"},
		{Name: "B", URL: "https://b.example/blog"},
	}); err != nil {
		t.Fatal(err)
	}
	keyA := canonicalBookmarkURLKey("https://a.example/blog")
	keyB := canonicalBookmarkURLKey("https://b.example/blog")
	if err := writeFeedStateFile(FeedStateFile{LastPoll: 42, Feeds: map[string]FeedState{
		keyA: {FeedURL: server.URL + "/a", Failures: feedMaxFailures, TriedAt: time.Now().UnixMilli()},
		keyB: {FeedURL: server.URL + "/b"},
	}}); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/feeds/retry", strings.NewReader(`{"feedUrl":"`+server.URL+`/a"}`))
	h.RetryFeed(httptest.NewRecorder(), req)

	if hits["/a"] != 1 || hits["/b"] != 0 {
		t.Fatalf("hits = %v, want only /a polled", hits)
	}
	if got := readFeedStateFile().LastPoll; got != 42 {
		t.Fatalf("LastPoll = %d, a retry moved the scheduled round", got)
	}
}
