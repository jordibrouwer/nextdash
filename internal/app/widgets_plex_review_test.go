package app

import (
	"context"
	"strings"
	"testing"
	"time"
)

// A whole season added at once comes as one season row, next to loose
// episodes of the same show. They make one line, and a season is more than
// one new thing, so the line does not pretend to count it.
const plexTestSeasonAndEpisode = `[
 {"rating_key":"1300","parent_rating_key":"1219","media_type":"season","title":"Season 1",
  "parent_title":"Mr. Robot","added_at":"1760000500","thumb":"/library/metadata/1300/thumb/1",
  "parent_thumb":"/library/metadata/1219/thumb/7","section_id":"2","library_name":"Series"},
 {"rating_key":"1401","parent_rating_key":"1400","grandparent_rating_key":"1219","media_type":"episode",
  "title":"eps2.0","grandparent_title":"Mr. Robot","media_index":"1","parent_media_index":"2",
  "added_at":"1760000450","grandparent_thumb":"/library/metadata/1219/thumb/7","section_id":"2","library_name":"Series"}]`

func TestPlexLatestGroupsASeasonWithItsEpisodes(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.recent["2"] = plexTestSeasonAndEpisode
	result, _, err := h.fetchPlexLatest(context.Background(), plexTestSpec(t, h, fake, nil), testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 {
		t.Fatalf("items = %+v", result.Items)
	}
	item := result.Items[0]
	if item.Title != "Mr. Robot" || item.ID != "1219" || !strings.Contains(item.OpenURL, "1219") {
		t.Fatalf("line = %+v", item)
	}
	if item.NewCount != 0 {
		t.Fatalf("a season counted as one new thing: NewCount = %d", item.NewCount)
	}
}

func TestPlexLatestASeasonAloneNamesTheShow(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.recent["2"] = `[` + strings.SplitN(strings.TrimPrefix(plexTestSeasonAndEpisode, "["), "},", 2)[0] + `}]`
	result, _, err := h.fetchPlexLatest(context.Background(), plexTestSpec(t, h, fake, nil), testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].Title != "Mr. Robot" || result.Items[0].Subtitle != "Season 1" {
		t.Fatalf("items = %+v", result.Items)
	}
}

func TestPlexPlayingHideNamesChangesTheFingerprint(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	if plexPlayingTestSpec(t, h, fake, map[string]any{"hideNames": true}).fingerprint() ==
		plexPlayingTestSpec(t, h, fake, nil).fingerprint() {
		t.Fatal("hideNames does not change the fingerprint")
	}
}

// The tile asks every TTL; the server's answer must be stale by then.
func TestPlexPlayingServerCacheEndsBeforeTheNextBeat(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.activity = plexTestActivity
	plexTestCredential(t, h)
	widget := Widget{ID: "w_pp0000000002", Type: WidgetTypePlexPlaying,
		Config: map[string]any{"server": fake.URL, "credentialId": "widget:w_plex00000001", "ttl": 5}}
	mediaForgetAll()
	h.plexPlayingAnswer(context.Background(), 1, widget, false)
	fake.mu.Lock()
	before := len(fake.calls)
	fake.mu.Unlock()
	time.Sleep(4500 * time.Millisecond)
	h.plexPlayingAnswer(context.Background(), 1, widget, false)
	fake.mu.Lock()
	after := len(fake.calls)
	fake.mu.Unlock()
	if after == before {
		t.Fatal("an ask half a second before the beat was answered from the cache")
	}
}

// The server id never changes, so a tile that asks every few seconds does not
// ask for it every time.
func TestPlexServerIDIsNotAskedEveryBeat(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.activity = plexTestActivity
	spec := plexPlayingTestSpec(t, h, fake, nil)
	for i := 0; i < 3; i++ {
		if _, _, err := h.fetchPlexPlaying(context.Background(), spec, testImageURL); err != nil {
			t.Fatal(err)
		}
	}
	asked := 0
	fake.mu.Lock()
	for _, c := range fake.calls {
		if strings.Contains(c, "cmd=get_server_info") {
			asked++
		}
	}
	fake.mu.Unlock()
	if asked != 1 {
		t.Fatalf("get_server_info asked %d times, want 1", asked)
	}
}
