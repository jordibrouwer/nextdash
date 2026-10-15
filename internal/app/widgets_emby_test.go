package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Emby is the Jellyfin client under /emby, with the user in the path.

func newFakeEmby(t *testing.T) *fakeJellyfin {
	t.Helper()
	fake := newFakeJellyfin(t)
	fake.emby = true
	return fake
}

// embyTestSpec files the key and returns an Emby spec pointing at the fake.
func embyTestSpec(t *testing.T, h *Handlers, fake *fakeJellyfin, config map[string]any) jellyfinSpec {
	t.Helper()
	jellyfinTestSpec(t, h, fake, nil) // files the key and allows local addresses
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_jf0000000001", "userId": "u1"}
	for k, v := range config {
		full[k] = v
	}
	return jellyfinSpecFromFlavor(sanitizeWidgetConfig(WidgetTypeEmby, full), jellyfinFlavorEmby)
}

func TestEmbyLatestWithUserUsesEmbyPaths(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeEmby(t)
	spec := embyTestSpec(t, h, fake, nil)

	result, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, item := range result.Items {
		ids = append(ids, item.ID)
	}
	if got := strings.Join(ids, ","); got != "m1,e1,s2,m2" {
		t.Fatalf("order = %s, want m1,e1,s2,m2", got)
	}
	if !fake.sawQuery("/emby/Users/u1/Views") || !fake.sawQuery("/emby/Users/u1/Items/Latest?") {
		t.Errorf("Emby paths were not used: %v", fake.queries)
	}
	if fake.sawQuery("userId=") {
		t.Error("Emby takes the user in the path, not as userId")
	}
	if fake.sawQuery("/UserViews") {
		t.Error("the Jellyfin-only /UserViews was asked")
	}
}

func TestEmbyLatestWithoutUser(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeEmby(t)
	spec := embyTestSpec(t, h, fake, map[string]any{"userId": ""})

	result, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, item := range result.Items {
		ids = append(ids, item.ID)
	}
	if got := strings.Join(ids, ","); got != "m1,e1,f3,m2,h1" {
		t.Fatalf("order = %s", got)
	}
	if !fake.sawQuery("/emby/Library/VirtualFolders") || !fake.sawQuery("/emby/Items?") {
		t.Errorf("Emby paths were not used: %v", fake.queries)
	}
}

func TestEmbyOpenURLUsesTheEmbyLink(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeEmby(t)
	spec := embyTestSpec(t, h, fake, nil)

	result, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Items {
		if item.ID == "m1" {
			want := fake.URL + "/web/index.html#!/item?id=m1&serverId=srv1"
			if item.OpenURL != want {
				t.Fatalf("openUrl = %q, want %q", item.OpenURL, want)
			}
			return
		}
	}
	t.Fatal("m1 missing")
}

func TestJellyfinOpenURLIsUnchanged(t *testing.T) {
	item, _ := mapJellyfinItem(jellyfinRawItem{ID: "m1", ServerID: "srv1", Type: "Movie"},
		JellyfinLibrary{}, "http://x", jellyfinFlavorJellyfin, testImageURL)
	if item.OpenURL != "http://x/web/#/details?id=m1&serverId=srv1" {
		t.Fatalf("openUrl = %q", item.OpenURL)
	}
}

func TestEmbyPlayingMapsSessions(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeEmby(t)
	fake.sessions = jellyfinTestSessions
	jellyfinTestSpec(t, h, fake, nil)
	spec := jellyfinPlayingSpecFromFlavor(sanitizeWidgetConfig(WidgetTypeEmbyPlaying,
		map[string]any{"server": fake.URL, "credentialId": "widget:w_jf0000000001"}), jellyfinFlavorEmby)

	result, _, err := h.fetchJellyfinPlaying(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 3 {
		t.Fatalf("items = %+v", result.Items)
	}
	if !fake.sawQuery("/emby/Sessions") {
		t.Errorf("/emby/Sessions not asked: %v", fake.queries)
	}
	want := fake.URL + "/web/index.html#!/item?id=m1&serverId=srv1"
	found := false
	for _, item := range result.Items {
		found = found || item.OpenURL == want
	}
	if !found {
		t.Errorf("no item opens at %q: %+v", want, result.Items)
	}
}

func TestEmbySetupWorksUnderEmby(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeEmby(t)

	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"X-Emby-Token":"` + jellyfinTestKey + `"}}}`
	rec := httptest.NewRecorder()
	h.EmbySetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/emby/setup", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var answer JellyfinSetupAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Error != "" || answer.ServerName != "Home" || len(answer.Users) != 2 || len(answer.Libraries) != 3 {
		t.Fatalf("answer = %+v", answer)
	}
	if !fake.sawQuery("/emby/System/Info") || !fake.sawQuery("/emby/Users?") && !fake.sawQuery("/emby/Users") {
		t.Errorf("setup did not go under /emby: %v", fake.queries)
	}
}

func TestEmbyHandlersAnswerWithEmbyImageURLs(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeEmby(t)
	fake.sessions = jellyfinTestSessions
	jellyfinTestSpec(t, h, fake, nil)
	cfg := map[string]any{"server": fake.URL, "credentialId": "widget:w_jf0000000001", "userId": "u1"}
	latest := Widget{ID: "w_em0000000001", Type: WidgetTypeEmby, Title: "Emby", Config: cfg}
	playing := Widget{ID: "w_em0000000002", Type: WidgetTypeEmbyPlaying, Title: "Now playing",
		Config: map[string]any{"server": fake.URL, "credentialId": "widget:w_jf0000000001"}}
	if err := h.store.SavePageBlocks(1, []Widget{latest, playing}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()

	ask := func(handler http.HandlerFunc, path string) MediaResult {
		rec := httptest.NewRecorder()
		handler(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d: %s", path, rec.Code, rec.Body.String())
		}
		var result MediaResult
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	got := ask(h.EmbyHandler, "/api/widgets/emby?pageId=1&id="+latest.ID)
	if len(got.Items) != 4 || !strings.HasPrefix(got.Items[0].Poster, "/api/widgets/emby/image?") {
		t.Fatalf("latest answer: %+v", got)
	}
	img := httptest.NewRecorder()
	h.EmbyImageHandler(img, httptest.NewRequest(http.MethodGet, got.Items[0].Poster, nil))
	if img.Code != http.StatusOK {
		t.Fatalf("image status %d", img.Code)
	}
	if !fake.sawQuery("/emby/Items/") {
		t.Errorf("the picture was not fetched under /emby: %v", fake.queries)
	}

	now := ask(h.EmbyPlayingHandler, "/api/widgets/emby-playing?pageId=1&id="+playing.ID)
	if len(now.Items) != 3 || !strings.HasPrefix(now.Items[1].Poster, "/api/widgets/emby-playing/image?") {
		t.Fatalf("playing answer: %+v", now)
	}
	img = httptest.NewRecorder()
	h.EmbyPlayingImageHandler(img, httptest.NewRequest(http.MethodGet, now.Items[1].Poster, nil))
	if img.Code != http.StatusOK {
		t.Fatalf("playing image status %d", img.Code)
	}
}

// The same id and settings on a Jellyfin tile and an Emby tile are two tiles
// to the cache.
func TestEmbyAndJellyfinDoNotShareACacheEntry(t *testing.T) {
	h := newTestHandlers(t)
	jf := newFakeJellyfin(t)
	em := newFakeEmby(t)
	jellyfinTestSpec(t, h, jf, nil)
	cfg := func(url string) map[string]any {
		return map[string]any{"server": url, "credentialId": "widget:w_jf0000000001", "userId": "u1"}
	}
	same := "w_same0000001"
	if err := h.store.SavePageBlocks(1, []Widget{
		{ID: same, Type: WidgetTypeJellyfin, Config: cfg(jf.URL)},
	}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	first := h.jellyfinAnswer(context.Background(), 1, Widget{ID: same, Type: WidgetTypeJellyfin, Config: cfg(jf.URL)}, false)
	second := h.embyAnswer(context.Background(), 1, Widget{ID: same, Type: WidgetTypeEmby, Config: cfg(em.URL)}, false)
	if first.Error != "" || second.Error != "" {
		t.Fatalf("answers: %q / %q", first.Error, second.Error)
	}
	if !strings.HasPrefix(second.Items[0].Poster, "/api/widgets/emby/image?") {
		t.Errorf("emby poster = %q", second.Items[0].Poster)
	}
	if !strings.HasPrefix(first.Items[0].Poster, "/api/widgets/jellyfin/image?") {
		t.Errorf("jellyfin poster = %q", first.Items[0].Poster)
	}
	if !em.sawQuery("/emby/Users/u1/Views") {
		t.Error("the Emby tile was served from the Jellyfin tile's cache entry")
	}
}
