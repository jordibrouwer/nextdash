package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Shaped like a real /Sessions answer: an episode paused on a TV, a film
// transcoding in a browser, a session with nothing playing, and live tv,
// which has no runtime.
var jellyfinTestSessions = `[
 {"Id":"sB","UserName":"kids","DeviceName":"Living room TV","Client":"Android TV",
  "PlayState":{"PositionTicks":12000000000,"IsPaused":true,"PlayMethod":"DirectPlay"},
  "NowPlayingItem":{"Id":"e1","Name":"Cold Harbor","Type":"Episode","ServerId":"srv1","SeriesName":"Severance",
   "SeriesId":"s1","SeriesPrimaryImageTag":"spt1","ParentIndexNumber":2,"IndexNumber":7,"RunTimeTicks":36000000000}},
 {"Id":"sA","UserName":"jordi","DeviceName":"","Client":"Jellyfin Web",
  "PlayState":{"PositionTicks":39840000000,"IsPaused":false,"PlayMethod":"Transcode"},
  "NowPlayingItem":{"Id":"m1","Name":"Dune: Part Two","Type":"Movie","ServerId":"srv1",
   "RunTimeTicks":99600000000,"ImageTags":{"Primary":"pt1"},"BackdropImageTags":["bt1"]}},
 {"Id":"sC","UserName":"jordi","DeviceName":"Phone","Client":"Jellyfin iOS","PlayState":{}},
 {"Id":"sD","UserName":"guest","DeviceName":"Kitchen","Client":"Jellyfin Web",
  "PlayState":{"PositionTicks":100,"IsPaused":false,"PlayMethod":"DirectStream"},
  "NowPlayingItem":{"Id":"tv1","Name":"NPO 1","Type":"TvChannel","ServerId":"srv1"}}]`

func playingTestSpec(t *testing.T, h *Handlers, fake *fakeJellyfin, config map[string]any) jellyfinPlayingSpec {
	t.Helper()
	jellyfinTestSpec(t, h, fake, nil) // files the key and allows local addresses
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_jf0000000001"}
	for k, v := range config {
		full[k] = v
	}
	return jellyfinPlayingSpecFrom(sanitizeWidgetConfig(WidgetTypeJellyfinPlaying, full))
}

func TestFetchJellyfinPlayingMapsSessions(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	fake.sessions = jellyfinTestSessions
	result, images, err := h.fetchJellyfinPlaying(context.Background(), playingTestSpec(t, h, fake, nil), testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if !fake.sawQuery("/Sessions?activeWithinSeconds=120") {
		t.Fatal("did not ask /Sessions with activeWithinSeconds=120")
	}
	// sC plays nothing and is dropped. Playing before paused, then by name.
	if len(result.Items) != 3 || result.Items[0].ID != "sD" || result.Items[1].ID != "sA" || result.Items[2].ID != "sB" {
		t.Fatalf("order: %+v", result.Items)
	}
	live, film, episode := result.Items[0], result.Items[1], result.Items[2]
	if film.Who != "jordi" || film.Device != "Jellyfin Web" || film.Method != "transcode" || film.Paused {
		t.Fatalf("film line: %+v", film)
	}
	if film.Progress == nil || *film.Progress < 0.39 || *film.Progress > 0.41 || film.Remaining != 5976 {
		t.Fatalf("film progress: %v %d", film.Progress, film.Remaining)
	}
	if episode.Title != "Severance" || episode.Subtitle != "S02E07 · Cold Harbor" || !episode.Paused ||
		episode.Device != "Living room TV" || episode.Method != "direct" || episode.Poster != "/img/s1/poster/spt1" {
		t.Fatalf("episode line: %+v", episode)
	}
	if live.Progress != nil || live.Remaining != 0 || live.Method != "direct" || live.Who != "guest" {
		t.Fatalf("live tv line: %+v", live)
	}
	if !images[mediaImageRef{"m1", "poster", "pt1"}] || !images[mediaImageRef{"s1", "poster", "spt1"}] {
		t.Fatalf("images: %v", images)
	}
	if !strings.HasSuffix(film.OpenURL, "/web/#/details?id=m1&serverId=srv1") {
		t.Fatalf("open url: %s", film.OpenURL)
	}
}

func TestFetchJellyfinPlayingRowsCut(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	fake.sessions = jellyfinTestSessions
	result, _, err := h.fetchJellyfinPlaying(context.Background(), playingTestSpec(t, h, fake, map[string]any{"rows": 2}), testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 {
		t.Fatalf("rows: %d", len(result.Items))
	}
}

func TestFetchJellyfinPlayingHidesNames(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	fake.sessions = jellyfinTestSessions
	spec := playingTestSpec(t, h, fake, map[string]any{"hideNames": true})
	result, _, err := h.fetchJellyfinPlaying(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	for _, name := range []string{"jordi", "kids", "guest"} {
		if strings.Contains(string(raw), name) {
			t.Fatalf("%q leaked: %s", name, raw)
		}
	}
	if spec.fingerprint() == playingTestSpec(t, h, fake, nil).fingerprint() {
		t.Fatal("hideNames does not change the fingerprint")
	}
}

func TestFetchJellyfinPlayingOrderIsStable(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	spec := playingTestSpec(t, h, fake, nil)
	ids := func() string {
		r, _, err := h.fetchJellyfinPlaying(context.Background(), spec, testImageURL)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, item := range r.Items {
			out = append(out, item.ID)
		}
		return strings.Join(out, ",")
	}
	fake.sessions = jellyfinTestSessions
	first := ids()
	var reversed []json.RawMessage
	if err := json.Unmarshal([]byte(jellyfinTestSessions), &reversed); err != nil {
		t.Fatal(err)
	}
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	raw, _ := json.Marshal(reversed)
	fake.sessions = string(raw)
	if second := ids(); second != first {
		t.Fatalf("order moved: %s then %s", first, second)
	}
}

func TestFetchJellyfinPlayingNobodyIsNotAnError(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	result, _, err := h.fetchJellyfinPlaying(context.Background(), playingTestSpec(t, h, fake, nil), testImageURL)
	if err != nil || result.Items == nil || len(result.Items) != 0 {
		t.Fatalf("empty: %v %+v", err, result)
	}
}

func TestFetchJellyfinPlayingErrors(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	if _, _, err := h.fetchJellyfinPlaying(context.Background(), jellyfinPlayingSpec{}, testImageURL); !errors.Is(err, errMediaNotSetUp) {
		t.Fatalf("not set up: %v", err)
	}
	spec := playingTestSpec(t, h, fake, nil)
	fake.setStatus(http.StatusUnauthorized)
	if _, _, err := h.fetchJellyfinPlaying(context.Background(), spec, testImageURL); !errors.Is(err, errMediaRefused) {
		t.Fatalf("refused: %v", err)
	}
}

func TestJellyfinPlayingConfig(t *testing.T) {
	cfg := sanitizeWidgetConfig(WidgetTypeJellyfinPlaying, map[string]any{
		"server": "http://x", "credentialId": "widget:w_jf0000000001", "hideNames": true,
		"ttl": 1, "rows": 99, "click": "detail", "userId": "u1"})
	if cfg["hideNames"] != true || cfg["userId"] != nil || cfg["click"] != "detail" {
		t.Fatalf("config: %v", cfg)
	}
	if spec := jellyfinPlayingSpecFrom(cfg); spec.TTL != 5*time.Second {
		t.Fatalf("ttl floor: %v", spec.TTL)
	}
	if !strings.Contains(strings.Join(widgetTypeNames(), ","), "jellyfin,jellyfin-playing") {
		t.Fatal("not listed after jellyfin")
	}
}

func TestJellyfinPlayingHandlerAnswersWithProxiedPosters(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	fake.sessions = jellyfinTestSessions
	jellyfinTestSpec(t, h, fake, nil)
	widget := Widget{ID: "w_jp0000000001", Type: WidgetTypeJellyfinPlaying, Title: "Now playing",
		Config: map[string]any{"server": fake.URL, "credentialId": "widget:w_jf0000000001"}}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	req := httptest.NewRequest(http.MethodGet, "/api/widgets/jellyfin-playing?pageId=1&id="+widget.ID, nil)
	rec := httptest.NewRecorder()
	h.JellyfinPlayingHandler(rec, req)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), jellyfinTestKey) {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var result MediaResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 3 || !strings.HasPrefix(result.Items[1].Poster, "/api/widgets/jellyfin-playing/image?") {
		t.Fatalf("answer: %+v", result)
	}
	img := httptest.NewRecorder()
	h.JellyfinPlayingImageHandler(img, httptest.NewRequest(http.MethodGet, result.Items[1].Poster, nil))
	if img.Code != http.StatusOK {
		t.Fatalf("image status %d", img.Code)
	}
}

// The phone apps report the phone's own name ("Jordi's iPhone"); hidden names
// must hide that too.
func TestFetchJellyfinPlayingHidesNamesInDeviceNames(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	fake.sessions = `[{"Id":"sE","UserName":"jordi","DeviceName":"Jordi's iPhone","Client":"Jellyfin iOS",
	  "PlayState":{"PositionTicks":0,"PlayMethod":"DirectPlay"},
	  "NowPlayingItem":{"Id":"m1","Name":"Arrival","Type":"Movie","ServerId":"srv1","RunTimeTicks":600000000}}]`
	result, _, err := h.fetchJellyfinPlaying(context.Background(), playingTestSpec(t, h, fake, map[string]any{"hideNames": true}), testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(strings.ToLower(string(raw)), "jordi") {
		t.Fatalf("a name leaked through the device: %s", raw)
	}
	if len(result.Items) != 1 || result.Items[0].Device != "Jellyfin iOS" {
		t.Fatalf("device under hideNames: %+v", result.Items)
	}
}

// The tile asks every TTL; the server's answer must be stale by then, or a
// beat that lands a moment early gets the old one and the tile skips a beat.
func TestJellyfinPlayingServerCacheEndsBeforeTheNextBeat(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	fake.sessions = jellyfinTestSessions
	jellyfinTestSpec(t, h, fake, nil)
	widget := Widget{ID: "w_jp0000000002", Type: WidgetTypeJellyfinPlaying,
		Config: map[string]any{"server": fake.URL, "credentialId": "widget:w_jf0000000001", "ttl": 5}}
	mediaForgetAll()
	h.jellyfinPlayingAnswer(context.Background(), 1, widget, false)
	before := len(fake.queries)
	time.Sleep(4500 * time.Millisecond)
	h.jellyfinPlayingAnswer(context.Background(), 1, widget, false)
	if len(fake.queries) == before {
		t.Fatal("an ask half a second before the beat was answered from the cache")
	}
}
