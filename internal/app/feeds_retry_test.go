package app

import "testing"

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

	if got := resetRetiredFeeds("https://a.example/feed"); got != 1 {
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

	if got := resetRetiredFeeds(""); got != 1 {
		t.Fatalf("an empty address reset %d feeds, want the one left (b)", got)
	}
}
