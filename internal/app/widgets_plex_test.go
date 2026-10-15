package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const plexTestKey = "tautulli-key-0123456789"

// fakePlex is a Tautulli: one /api/v2 that routes by cmd, wants the key in
// X-Api-Key, and wraps every answer in the response envelope.
type fakePlex struct {
	*httptest.Server
	mu        sync.Mutex
	libraries string
	recent    map[string]string // section_id -> JSON for data.recently_added
	activity  string
	info      string
	errorCmd  string // answered with result=error
	calls     []string
}

const plexTestInfo = `{"pms_name":"Living room Plex","pms_identifier":"abc123def","pms_version":"1.41.0.8992"}`

const plexTestLibraries = `[
 {"section_id":"1","section_name":"Films","section_type":"movie"},
 {"section_id":2,"section_name":"Series","section_type":"show"},
 {"section_id":"3","section_name":"Music","section_type":"artist"},
 {"section_id":"4","section_name":"Photos","section_type":"photo"}]`

func newFakePlex(t *testing.T) *fakePlex {
	t.Helper()
	fake := &fakePlex{libraries: plexTestLibraries, info: plexTestInfo, recent: map[string]string{}}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Header.Get("X-Api-Key") != plexTestKey {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"response":{"result":"error","message":"Invalid apikey","data":{}}}`))
			return
		}
		query := r.URL.Query()
		cmd := query.Get("cmd")
		fake.mu.Lock()
		fake.calls = append(fake.calls, r.URL.RawQuery)
		libraries, info, activity, errorCmd := fake.libraries, fake.info, fake.activity, fake.errorCmd
		recent := fake.recent[query.Get("section_id")]
		fake.mu.Unlock()

		reply := func(data string) {
			_, _ = w.Write([]byte(`{"response":{"result":"success","message":null,"data":` + data + `}}`))
		}
		if cmd == errorCmd {
			_, _ = w.Write([]byte(`{"response":{"result":"error","message":"Something broke","data":{}}}`))
			return
		}
		switch cmd {
		case "get_server_info":
			reply(info)
		case "get_library_names":
			reply(libraries)
		case "get_recently_added":
			if recent == "" {
				recent = "[]"
			}
			reply(`{"recently_added":` + recent + `,"recordsFiltered":1}`)
		case "get_activity":
			if activity == "" {
				activity = `{"sessions":[],"stream_count":"0"}`
			}
			reply(activity)
		case "pms_image_proxy":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(jellyfinTestPNG)
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(fake.Close)
	return fake
}

func (f *fakePlex) sawQuery(part string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.calls {
		if strings.Contains(c, part) {
			return true
		}
	}
	return false
}

func plexTestCredential(t *testing.T, h *Handlers) {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential("widget:w_plex00000001", HealthCredential{
		Label: "Tautulli", Headers: map[string]string{"X-Api-Key": plexTestKey},
	}); err != nil {
		t.Fatal(err)
	}
}

func plexTestSpec(t *testing.T, h *Handlers, fake *fakePlex, config map[string]any) plexSpec {
	t.Helper()
	plexTestCredential(t, h)
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_plex00000001"}
	for k, v := range config {
		full[k] = v
	}
	return plexSpecFrom(sanitizeWidgetConfig(WidgetTypePlex, full))
}

func plexPlayingTestSpec(t *testing.T, h *Handlers, fake *fakePlex, config map[string]any) plexPlayingSpec {
	t.Helper()
	plexTestCredential(t, h)
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_plex00000001"}
	for k, v := range config {
		full[k] = v
	}
	return plexPlayingSpecFrom(sanitizeWidgetConfig(WidgetTypePlexPlaying, full))
}

// Numbers arrive as strings, mostly, and now and then as numbers.
const plexTestFilms = `[
 {"rating_key":"501","media_type":"movie","title":"Dune: Part Two","year":"2024","added_at":"1760000300",
  "thumb":"/library/metadata/501/thumb/1760000300","section_id":"1","library_name":"Films",
  "genres":["Science Fiction","Adventure"],"summary":"Paul Atreides unites with the Fremen.","duration":"9960000"},
 {"rating_key":"502","media_type":"movie","title":"Heat","year":1995,"added_at":1760000100,
  "thumb":"/library/metadata/502/thumb/1760000100","section_id":"1","library_name":"Films","duration":10200000}]`

const plexTestShows = `[
 {"rating_key":"901","parent_rating_key":"800","grandparent_rating_key":"700","media_type":"episode",
  "title":"Who Is Alive?","parent_title":"Season 2","grandparent_title":"Severance","media_index":"3","parent_media_index":"2",
  "added_at":"1760000400","thumb":"/library/metadata/901/thumb/1","parent_thumb":"/library/metadata/800/thumb/1",
  "grandparent_thumb":"/library/metadata/700/thumb/55","section_id":"2","library_name":"Series"},
 {"rating_key":"911","parent_rating_key":"810","grandparent_rating_key":"710","media_type":"episode",
  "title":"Hello","parent_title":"Season 4","grandparent_title":"Slow Horses","media_index":1,"parent_media_index":4,
  "added_at":"1760000250","thumb":"/library/metadata/911/thumb/1",
  "grandparent_thumb":"/library/metadata/710/thumb/9","section_id":"2","library_name":"Series"},
 {"rating_key":"902","parent_rating_key":"800","grandparent_rating_key":"700","media_type":"episode",
  "title":"Hide and Seek","parent_title":"Season 2","grandparent_title":"Severance","media_index":"2","parent_media_index":"2",
  "added_at":1760000200,"thumb":"/library/metadata/902/thumb/1",
  "grandparent_thumb":"/library/metadata/700/thumb/55","section_id":"2","library_name":"Series"}]`

func TestPlexLatestMergesGroupsSortsAndCuts(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.recent["1"], fake.recent["2"] = plexTestFilms, plexTestShows
	spec := plexTestSpec(t, h, fake, map[string]any{"rows": 3})

	result, images, err := h.fetchPlexLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	// Severance (400, two episodes), Dune (300), Slow Horses (250); Heat (100)
	// is cut by rows.
	if len(result.Items) != 3 || result.Items[0].Title != "Severance" || result.Items[1].Title != "Dune: Part Two" ||
		result.Items[2].Title != "Slow Horses" {
		t.Fatalf("items: %+v", result.Items)
	}
	severance, dune, horses := result.Items[0], result.Items[1], result.Items[2]
	if severance.NewCount != 2 || severance.Subtitle != "" || severance.Kind != "episode" ||
		severance.Library != "Series" || severance.LibraryID != "2" || severance.AddedAt != 1760000400*1000 {
		t.Fatalf("severance: %+v", severance)
	}
	if severance.Poster != "/img//library/metadata/700/thumb/55/poster/700" {
		t.Fatalf("severance poster: %q", severance.Poster)
	}
	if !strings.HasSuffix(severance.OpenURL, "details?key=%2Flibrary%2Fmetadata%2F700") {
		t.Fatalf("severance link: %s", severance.OpenURL)
	}
	if dune.Kind != "movie" || dune.Year != 2024 || dune.RuntimeMinutes != 166 || dune.Library != "Films" ||
		len(dune.Genres) != 2 || dune.Overview == "" || dune.AddedAt != 1760000300*1000 || dune.NewCount != 0 {
		t.Fatalf("dune: %+v", dune)
	}
	if horses.NewCount != 0 || horses.Subtitle != "S04E01 · Hello" {
		t.Fatalf("a single episode keeps its label: %+v", horses)
	}
	if !images[mediaImageRef{Item: "/library/metadata/700/thumb/55", Kind: "poster", Tag: "700"}] {
		t.Fatalf("images: %v", images)
	}
	// Music and photos are not asked for; the libraries are the two a tile can show.
	if len(result.Libraries) != 2 || result.Libraries[0].Name != "Films" || result.Libraries[1].Name != "Series" ||
		fake.sawQuery("section_id=3") || fake.sawQuery("section_id=4") {
		t.Fatalf("libraries: %+v", result.Libraries)
	}
}

func TestPlexLatestAnswersOnlyChosenLibraries(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.recent["1"], fake.recent["2"] = plexTestFilms, plexTestShows
	spec := plexTestSpec(t, h, fake, map[string]any{"libraries": []any{"1"}})
	result, _, err := h.fetchPlexLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 || result.Items[0].Title != "Dune: Part Two" || fake.sawQuery("section_id=2") {
		t.Fatalf("items: %+v", result.Items)
	}
}

func TestPlexLatestWithoutServerInfoHasNoLink(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.recent["1"] = plexTestFilms
	fake.errorCmd = "get_server_info"
	spec := plexTestSpec(t, h, fake, map[string]any{"libraries": []any{"1"}})
	result, _, err := h.fetchPlexLatest(context.Background(), spec, testImageURL)
	if err != nil || len(result.Items) != 2 {
		t.Fatalf("err %v, items %+v", err, result.Items)
	}
	if result.Items[0].OpenURL != "" {
		t.Errorf("link without a server id: %q", result.Items[0].OpenURL)
	}
}

func TestPlexLatestOpenLink(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.recent["1"] = plexTestFilms
	spec := plexTestSpec(t, h, fake, map[string]any{"libraries": []any{"1"}})
	result, _, err := h.fetchPlexLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	want := "https://app.plex.tv/desktop/#!/server/abc123def/details?key=%2Flibrary%2Fmetadata%2F501"
	if result.Items[0].OpenURL != want {
		t.Fatalf("link = %q, want %q", result.Items[0].OpenURL, want)
	}
}

func TestPlexLatestRefusedKey(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	spec := plexTestSpec(t, h, fake, nil)
	if err := saveHealthCredential("widget:w_plex00000001", HealthCredential{
		Label: "Tautulli", Headers: map[string]string{"X-Api-Key": "wrong"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.fetchPlexLatest(context.Background(), spec, testImageURL); !errors.Is(err, errMediaRefused) {
		t.Fatalf("err = %v", err)
	}
}

func TestPlexLatestResultErrorIsRefused(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.errorCmd = "get_library_names"
	spec := plexTestSpec(t, h, fake, nil)
	if _, _, err := h.fetchPlexLatest(context.Background(), spec, testImageURL); !errors.Is(err, errMediaRefused) {
		t.Fatalf("err = %v", err)
	}
}

func TestPlexLatestUnreachable(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	spec := plexTestSpec(t, h, fake, nil)
	fake.Close()
	if _, _, err := h.fetchPlexLatest(context.Background(), spec, testImageURL); !errors.Is(err, errMediaUnreachable) {
		t.Fatalf("err = %v", err)
	}
}

func TestPlexLatestNotSetUp(t *testing.T) {
	h := newTestHandlers(t)
	if _, _, err := h.fetchPlexLatest(context.Background(), plexSpec{}, testImageURL); !errors.Is(err, errMediaNotSetUp) {
		t.Fatalf("err = %v", err)
	}
}

func TestPlexSpecDefaultsAndClamps(t *testing.T) {
	spec := plexSpecFrom(map[string]any{"server": "http://tautulli:8181/", "ttl": 99999, "rows": 4})
	if spec.Server != "http://tautulli:8181" || spec.TTL.Seconds() != 3600 || spec.Rows != 4 {
		t.Fatalf("spec = %+v", spec)
	}
	if def := plexSpecFrom(nil); def.Rows != jellyfinDefaultRows || def.TTL.Seconds() != 300 {
		t.Fatalf("defaults = %+v", def)
	}
	if p := plexPlayingSpecFrom(map[string]any{"ttl": 1}); p.TTL.Seconds() != 5 {
		t.Fatalf("playing ttl = %v", p.TTL)
	}
	if p := plexPlayingSpecFrom(nil); p.TTL.Seconds() != 10 || p.Rows != jellyfinDefaultRows {
		t.Fatalf("playing defaults = %+v", p)
	}
}

// A paused episode, a film transcoding, live tv, and a session that was
// started first but sorts last by name.
const plexTestActivity = `{"stream_count":"4","sessions":[
 {"session_key":"12","state":"paused","friendly_name":"kids","user":"kids_login","player":"Living room TV","product":"Plex for Android (TV)",
  "media_type":"episode","title":"Cold Harbor","grandparent_title":"Severance","parent_media_index":"2","media_index":"7",
  "rating_key":"921","grandparent_rating_key":"700","view_offset":"1200000","duration":"3600000","progress_percent":"33",
  "transcode_decision":"direct play","thumb":"/library/metadata/921/thumb/1","grandparent_thumb":"/library/metadata/700/thumb/55","live":"0"},
 {"session_key":"11","state":"playing","friendly_name":"jordi","user":"jordi","player":"","product":"Plex Web",
  "media_type":"movie","title":"Dune: Part Two","year":"2024","rating_key":"501","view_offset":3984000,"duration":9960000,
  "transcode_decision":"transcode","thumb":"/library/metadata/501/thumb/1760000300","grandparent_thumb":"","live":0},
 {"session_key":"14","state":"buffering","friendly_name":"guest","player":"Kitchen","product":"Plex Web",
  "media_type":"episode","title":"NPO 1","rating_key":"930","view_offset":"100","duration":"0",
  "transcode_decision":"copy","thumb":"/library/metadata/930/thumb/1","live":"1"}]}`

func TestPlexPlayingMapsSessions(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.activity = plexTestActivity
	result, images, err := h.fetchPlexPlaying(context.Background(), plexPlayingTestSpec(t, h, fake, nil), testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	// Playing before paused: buffering counts as playing. Then by name.
	if len(result.Items) != 3 || result.Items[0].ID != "14" || result.Items[1].ID != "11" || result.Items[2].ID != "12" {
		t.Fatalf("order: %+v", result.Items)
	}
	live, film, episode := result.Items[0], result.Items[1], result.Items[2]
	if film.Who != "jordi" || film.Device != "Plex Web" || film.Method != "transcode" || film.Paused ||
		film.Title != "Dune: Part Two" || film.Kind != "movie" {
		t.Fatalf("film line: %+v", film)
	}
	if film.Progress == nil || *film.Progress < 0.39 || *film.Progress > 0.41 || film.Remaining != 5976 {
		t.Fatalf("film progress: %v %d", film.Progress, film.Remaining)
	}
	if film.Poster != "/img//library/metadata/501/thumb/1760000300/poster/501" {
		t.Fatalf("film poster: %q", film.Poster)
	}
	if episode.Title != "Severance" || episode.Subtitle != "S02E07 · Cold Harbor" || !episode.Paused ||
		episode.Device != "Living room TV" || episode.Method != "direct" || episode.Who != "kids" ||
		episode.Poster != "/img//library/metadata/700/thumb/55/poster/921" || episode.Kind != "episode" {
		t.Fatalf("episode line: %+v", episode)
	}
	if episode.Progress == nil || *episode.Progress < 0.33 || *episode.Progress > 0.34 || episode.Remaining != 2400 {
		t.Fatalf("episode progress: %v %d", episode.Progress, episode.Remaining)
	}
	if live.Progress != nil || live.Remaining != 0 || live.Kind != "tv" || live.Method != "direct" || live.Who != "guest" {
		t.Fatalf("live tv line: %+v", live)
	}
	if !images[mediaImageRef{Item: "/library/metadata/501/thumb/1760000300", Kind: "poster", Tag: "501"}] {
		t.Fatalf("images: %v", images)
	}
	if !strings.HasSuffix(film.OpenURL, "details?key=%2Flibrary%2Fmetadata%2F501") ||
		!strings.Contains(film.OpenURL, "/server/abc123def/") {
		t.Fatalf("open url: %s", film.OpenURL)
	}
}

func TestPlexPlayingHideNames(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.activity = plexTestActivity
	result, _, err := h.fetchPlexPlaying(context.Background(), plexPlayingTestSpec(t, h, fake, map[string]any{"hideNames": true}), testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Items {
		if item.Who != "" {
			t.Errorf("name leaked: %+v", item)
		}
	}
	// The player is named after its owner, so only the app is said.
	if result.Items[2].Device != "Plex for Android (TV)" || result.Items[0].Device != "Plex Web" {
		t.Fatalf("devices: %q %q", result.Items[2].Device, result.Items[0].Device)
	}
}

func TestPlexPlayingOrderIsStable(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	// Same name twice: the session key breaks the tie, whatever the order sent.
	fake.activity = `{"sessions":[
	 {"session_key":"9","state":"playing","friendly_name":"Jordi","media_type":"movie","title":"B","rating_key":"2","duration":"100","view_offset":"10"},
	 {"session_key":"3","state":"playing","friendly_name":"jordi","media_type":"movie","title":"A","rating_key":"1","duration":"100","view_offset":"10"},
	 {"session_key":"5","state":"playing","friendly_name":"anna","media_type":"movie","title":"C","rating_key":"3","duration":"100","view_offset":"10"}]}`
	spec := plexPlayingTestSpec(t, h, fake, nil)
	for i := 0; i < 3; i++ {
		result, _, err := h.fetchPlexPlaying(context.Background(), spec, testImageURL)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Items) != 3 || result.Items[0].ID != "5" || result.Items[1].ID != "3" || result.Items[2].ID != "9" {
			t.Fatalf("order: %+v", result.Items)
		}
	}
}

func TestPlexPlayingRowsCut(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.activity = plexTestActivity
	result, _, err := h.fetchPlexPlaying(context.Background(), plexPlayingTestSpec(t, h, fake, map[string]any{"rows": 2}), testImageURL)
	if err != nil || len(result.Items) != 2 {
		t.Fatalf("err %v, items %d", err, len(result.Items))
	}
}

func TestPlexPlayingNobodyIsEmptyNotError(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	result, _, err := h.fetchPlexPlaying(context.Background(), plexPlayingTestSpec(t, h, fake, nil), testImageURL)
	if err != nil || result.Items == nil || len(result.Items) != 0 {
		t.Fatalf("err %v, items %#v", err, result.Items)
	}
}

func TestPlexPlayingResultErrorIsRefused(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.errorCmd = "get_activity"
	if _, _, err := h.fetchPlexPlaying(context.Background(), plexPlayingTestSpec(t, h, fake, nil), testImageURL); !errors.Is(err, errMediaRefused) {
		t.Fatalf("err = %v", err)
	}
}

func plexTestSetup(t *testing.T, h *Handlers, body string) (int, PlexSetupAnswer, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.PlexSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/plex/setup", strings.NewReader(body)))
	var answer PlexSetupAnswer
	_ = json.Unmarshal(rec.Body.Bytes(), &answer)
	return rec.Code, answer, rec.Body.String()
}

func TestPlexSetupNamesServerAndOffersMovieAndShowLibraries(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakePlex(t)
	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"X-Api-Key":"` + plexTestKey + `"}}}`

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	if code, _, _ := plexTestSetup(t, h, body); code != http.StatusUnauthorized || fake.sawQuery("get_server_info") {
		t.Fatalf("no token: %d", code)
	}
	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	code, answer, raw := plexTestSetup(t, h, body)
	if code != http.StatusOK || answer.Error != "" || answer.ServerName != "Living room Plex" || answer.Version != "1.41.0.8992" {
		t.Fatalf("answer: %d %s", code, raw)
	}
	if len(answer.Libraries) != 2 || answer.Libraries[0] != (MediaGroup{ID: "1", Name: "Films", CollectionType: "movie"}) ||
		answer.Libraries[1] != (MediaGroup{ID: "2", Name: "Series", CollectionType: "show"}) {
		t.Fatalf("libraries: %+v", answer.Libraries)
	}
	if strings.Contains(raw, plexTestKey) || strings.Contains(raw, `"users"`) {
		t.Errorf("setup answer: %s", raw)
	}
}

func TestPlexSetupBadKeyIsRefused(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakePlex(t)
	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"X-Api-Key":"nope"}}}`
	_, answer, raw := plexTestSetup(t, h, body)
	if answer.Error != "key refused" || len(answer.Libraries) != 0 {
		t.Fatalf("answer: %s", raw)
	}
}

func TestPlexSetupResultErrorIsRefused(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakePlex(t)
	fake.errorCmd = "get_server_info"
	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"X-Api-Key":"` + plexTestKey + `"}}}`
	_, answer, raw := plexTestSetup(t, h, body)
	if answer.Error != "key refused" {
		t.Fatalf("answer: %s", raw)
	}
}

func TestPlexSetupWithoutKeyIsNotSetUp(t *testing.T) {
	h := newTestHandlers(t)
	_, answer, raw := plexTestSetup(t, h, `{"server":"http://tautulli:8181"}`)
	if answer.Error != "not set up" {
		t.Fatalf("answer: %s", raw)
	}
}

func plexTestWidget(t *testing.T, h *Handlers, fake *fakePlex, wt WidgetType, config map[string]any) string {
	t.Helper()
	plexTestCredential(t, h)
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_plex00000001"}
	for k, v := range config {
		full[k] = v
	}
	widget := Widget{ID: "w_plex00000001", Type: wt, Title: "Plex", Config: full}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	return widget.ID
}

func TestPlexRoutesServeTheTileAndItsPosters(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.recent["1"], fake.recent["2"] = plexTestFilms, plexTestShows
	id := plexTestWidget(t, h, fake, WidgetTypePlex, nil)

	rec := httptest.NewRecorder()
	h.PlexHandler(rec, httptest.NewRequest(http.MethodGet, "/api/widgets/plex?pageId=1&id="+id, nil))
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), plexTestKey) {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var result MediaResult
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	if len(result.Items) == 0 || result.Error != "" || !strings.HasPrefix(result.Items[0].Poster, "/api/widgets/plex/image?") {
		t.Fatalf("result = %+v", result)
	}

	image := httptest.NewRecorder()
	h.PlexImageHandler(image, httptest.NewRequest(http.MethodGet, result.Items[0].Poster, nil))
	if image.Code != http.StatusOK || image.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("poster: %d %q", image.Code, image.Header().Get("Content-Type"))
	}
	if !fake.sawQuery("cmd=pms_image_proxy") || !fake.sawQuery("fallback=poster") {
		t.Errorf("calls: %v", fake.calls)
	}
	// Only what the answer named: another path on the server is a 404.
	refused := httptest.NewRecorder()
	h.PlexImageHandler(refused, httptest.NewRequest(http.MethodGet,
		"/api/widgets/plex/image?pageId=1&id="+id+"&item=%2Flibrary%2Fmetadata%2F1%2Fart%2F1&kind=poster&tag=1", nil))
	if refused.Code != http.StatusNotFound {
		t.Errorf("an unoffered picture answered %d", refused.Code)
	}
	// The playing route does not answer for a library widget.
	other := httptest.NewRecorder()
	h.PlexPlayingHandler(other, httptest.NewRequest(http.MethodGet, "/api/widgets/plex-playing?pageId=1&id="+id, nil))
	if other.Code != http.StatusNotFound {
		t.Errorf("playing route answered for a plex widget: %d", other.Code)
	}
}

func TestPlexPlayingRoutesServeTheTileAndItsPosters(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakePlex(t)
	fake.activity = plexTestActivity
	id := plexTestWidget(t, h, fake, WidgetTypePlexPlaying, nil)

	rec := httptest.NewRecorder()
	h.PlexPlayingHandler(rec, httptest.NewRequest(http.MethodGet, "/api/widgets/plex-playing?pageId=1&id="+id, nil))
	var result MediaResult
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	if rec.Code != http.StatusOK || len(result.Items) != 3 || strings.Contains(rec.Body.String(), plexTestKey) {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var poster string
	for _, item := range result.Items {
		if item.Poster != "" {
			poster = item.Poster
			break
		}
	}
	if !strings.HasPrefix(poster, "/api/widgets/plex-playing/image?") {
		t.Fatalf("poster = %q", poster)
	}
	image := httptest.NewRecorder()
	h.PlexPlayingImageHandler(image, httptest.NewRequest(http.MethodGet, poster, nil))
	if image.Code != http.StatusOK || image.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("poster: %d", image.Code)
	}
	// The library tile's picture route has not been offered this picture.
	cross := httptest.NewRecorder()
	h.PlexImageHandler(cross, httptest.NewRequest(http.MethodGet, strings.Replace(poster, "plex-playing", "plex", 1), nil))
	if cross.Code != http.StatusNotFound {
		t.Errorf("cross-service picture answered %d", cross.Code)
	}
}

func TestPlexStringNumbersAreRead(t *testing.T) {
	var n plexNumber
	for in, want := range map[string]int64{`"12"`: 12, `12`: 12, `12.0`: 12, `""`: 0, `null`: 0, `"x"`: 0} {
		n = 99
		if err := json.Unmarshal([]byte(in), &n); err != nil || int64(n) != want {
			t.Errorf("%s -> %d, %v (want %d)", in, n, err, want)
		}
	}
}
