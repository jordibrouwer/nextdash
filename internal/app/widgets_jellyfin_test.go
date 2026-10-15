package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

const jellyfinTestKey = "secret-key-0123456789"

// A PNG header, so the proxy has real image bytes to sniff.
var jellyfinTestPNG = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
	0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52}

var jellyfinTestLatest = map[string]string{
	"lib-movies": `[
		{"Id":"m1","Name":"Dune: Part Two","Type":"Movie","ServerId":"srv1","ProductionYear":2024,
		 "Genres":["Science Fiction","Adventure"],"RunTimeTicks":99600000000,"Overview":"Paul joins the Fremen.",
		 "DateCreated":"2026-10-12T09:00:00.1234567Z","ImageTags":{"Primary":"pt1"},"BackdropImageTags":["bt1"],
		 "UserData":{"Played":false}},
		{"Id":"m2","Name":"Arrival","Type":"Movie","ServerId":"srv1","ProductionYear":2016,
		 "DateCreated":"2026-10-10T09:00:00Z","ImageTags":{"Primary":"pt2"},"UserData":{"Played":true}}]`,
	"lib-tv": `[
		{"Id":"e1","Name":"Cold Harbor","Type":"Episode","ServerId":"srv1","SeriesName":"Severance","SeriesId":"s1",
		 "SeriesPrimaryImageTag":"spt1","ParentIndexNumber":2,"IndexNumber":7,"DateCreated":"2026-10-11T20:00:00Z",
		 "ImageTags":{"Primary":"ept1"},"ParentBackdropItemId":"s1","ParentBackdropImageTags":["sbt1"],
		 "UserData":{"Played":false}}]`,
	"lib-anime": `[
		{"Id":"s2","Name":"Frieren","Type":"Series","ServerId":"srv1","ChildCount":4,
		 "DateCreated":"2026-10-11T08:00:00Z","ImageTags":{"Primary":"pt3"},"UserData":{"Played":false}}]`,
}

// What /Items answers without a user: newest first, every episode on its own.
var jellyfinTestRecent = map[string]string{
	"lib-movies": `[
		{"Id":"m1","Name":"Dune: Part Two","Type":"Movie","ServerId":"srv1","ProductionYear":2024,
		 "DateCreated":"2026-10-12T09:00:00Z","ImageTags":{"Primary":"pt1"}},
		{"Id":"m2","Name":"Arrival","Type":"Movie","ServerId":"srv1","ProductionYear":2016,
		 "DateCreated":"2026-10-10T09:00:00Z","ImageTags":{"Primary":"pt2"}}]`,
	"lib-tv": `[
		{"Id":"e1","Name":"Cold Harbor","Type":"Episode","ServerId":"srv1","SeriesName":"Severance","SeriesId":"s1",
		 "SeriesPrimaryImageTag":"spt1","ParentIndexNumber":2,"IndexNumber":7,"DateCreated":"2026-10-11T20:00:00Z"},
		{"Id":"e0","Name":"Hello Ms. Cobel","Type":"Episode","ServerId":"srv1","SeriesName":"Severance","SeriesId":"s1",
		 "SeriesPrimaryImageTag":"spt1","ParentIndexNumber":2,"IndexNumber":6,"DateCreated":"2026-10-11T19:00:00Z"},
		{"Id":"h1","Name":"Hello","Type":"Episode","ServerId":"srv1","SeriesName":"Slow Horses","SeriesId":"s7",
		 "SeriesPrimaryImageTag":"spt7","ParentIndexNumber":4,"IndexNumber":1,"DateCreated":"2026-10-09T20:00:00Z"}]`,
	"lib-anime": `[
		{"Id":"f3","Name":"Three","Type":"Episode","ServerId":"srv1","SeriesName":"Frieren","SeriesId":"s2",
		 "SeriesPrimaryImageTag":"spt2","ParentIndexNumber":1,"IndexNumber":3,"DateCreated":"2026-10-11T08:00:00Z"},
		{"Id":"f2","Name":"Two","Type":"Episode","ServerId":"srv1","SeriesName":"Frieren","SeriesId":"s2",
		 "SeriesPrimaryImageTag":"spt2","ParentIndexNumber":1,"IndexNumber":2,"DateCreated":"2026-10-11T07:00:00Z"},
		{"Id":"f1","Name":"One","Type":"Episode","ServerId":"srv1","SeriesName":"Frieren","SeriesId":"s2",
		 "SeriesPrimaryImageTag":"spt2","ParentIndexNumber":1,"IndexNumber":1,"DateCreated":"2026-10-11T06:00:00Z"}]`,
}

type fakeJellyfin struct {
	*httptest.Server
	mu        sync.Mutex
	status    int // forced on every route when non-zero
	queries   []string
	imageHits int
	imageWait time.Duration
	// modernOnly refuses the X-Emby-Token header, as Jellyfin 10.11 does.
	modernOnly bool
	// failParent makes the item lists of one library answer 500.
	failParent string
	// sessions is what /Sessions answers; empty is nobody watching.
	sessions string
	// emby answers as Emby does: under /emby, with the user in the path.
	emby bool
}

func newFakeJellyfin(t *testing.T) *fakeJellyfin {
	t.Helper()
	fake := &fakeJellyfin{}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.mu.Lock()
		forced := fake.status
		fake.queries = append(fake.queries, r.URL.Path+"?"+r.URL.RawQuery)
		fake.mu.Unlock()
		path := r.URL.Path
		if fake.emby {
			// Emby serves everything under /emby, and has no /UserViews or
			// /Items/Latest: the user is in the path instead.
			if !strings.HasPrefix(path, "/emby/") {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			path = strings.TrimPrefix(path, "/emby")
			// Emby documents the full "Emby Client=..., Token=..." form; a
			// token-only MediaBrowser header is not a promise it keeps, so the
			// fake refuses it and the client must not send one.
			if r.Header.Get("Authorization") != "" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if path == "/UserViews" || path == "/Items/Latest" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if strings.HasPrefix(path, "/Users/u1/") && strings.HasSuffix(path, "/Views") {
				path = "/UserViews"
			} else if strings.HasPrefix(path, "/Users/u1/Items/Latest") {
				path = "/Items/Latest"
			}
		}
		if forced != 0 {
			w.WriteHeader(forced)
			return
		}
		token := r.Header.Get("X-Emby-Token")
		if fake.modernOnly {
			// Newer Jellyfin: only the Authorization scheme is read.
			token = ""
		}
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, `MediaBrowser Token="`) {
			token = strings.TrimSuffix(strings.TrimPrefix(auth, `MediaBrowser Token="`), `"`)
		}
		if token != jellyfinTestKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case path == "/System/Info":
			_, _ = w.Write([]byte(`{"ServerName":"Home","Id":"srv1","Version":"10.10.3"}`))
		case path == "/Users":
			_, _ = w.Write([]byte(`[{"Name":"jordi","Id":"u1"},{"Name":"kids","Id":"u2"}]`))
		case path == "/Library/VirtualFolders":
			_, _ = w.Write([]byte(`[{"Name":"Films","ItemId":"lib-movies","CollectionType":"movies"},
				{"Name":"Series","ItemId":"lib-tv","CollectionType":"tvshows"},
				{"Name":"Anime","ItemId":"lib-anime","CollectionType":"tvshows"},
				{"Name":"Music","ItemId":"lib-music","CollectionType":"music"}]`))
		case path == "/Sessions":
			fake.mu.Lock()
			body := fake.sessions
			fake.mu.Unlock()
			if body == "" {
				body = "[]"
			}
			_, _ = w.Write([]byte(body))
		case path == "/UserViews":
			_, _ = w.Write([]byte(`{"Items":[{"Id":"lib-movies","Name":"Films","CollectionType":"movies"},
				{"Id":"lib-tv","Name":"Series","CollectionType":"tvshows"},
				{"Id":"lib-anime","Name":"Anime","CollectionType":"tvshows"},
				{"Id":"lib-music","Name":"Music","CollectionType":"music"}]}`))
		case (path == "/Items" || path == "/Items/Latest") &&
			fake.failParent != "" && r.URL.Query().Get("parentId") == fake.failParent:
			w.WriteHeader(http.StatusInternalServerError)
		case path == "/Items":
			// No user: the newest items of a library, episodes ungrouped.
			body := jellyfinTestRecent[r.URL.Query().Get("parentId")]
			if body == "" {
				body = "[]"
			}
			_, _ = w.Write([]byte(`{"Items":` + body + `}`))
		case path == "/Items/Latest":
			body := jellyfinTestLatest[r.URL.Query().Get("parentId")]
			if r.URL.Query().Get("isPlayed") == "false" {
				var items []map[string]any
				_ = json.Unmarshal([]byte(body), &items)
				kept := items[:0]
				for _, item := range items {
					if played, _ := item["UserData"].(map[string]any)["Played"].(bool); !played {
						kept = append(kept, item)
					}
				}
				raw, _ := json.Marshal(kept)
				body = string(raw)
			}
			if body == "" {
				body = "[]"
			}
			_, _ = w.Write([]byte(body))
		case strings.HasPrefix(path, "/Items/") && strings.Contains(path, "/Images/"):
			fake.mu.Lock()
			fake.imageHits++
			wait := fake.imageWait
			fake.mu.Unlock()
			time.Sleep(wait)
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(jellyfinTestPNG)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(fake.Close)
	return fake
}

func (f *fakeJellyfin) setStatus(code int) { f.mu.Lock(); f.status = code; f.mu.Unlock() }

func (f *fakeJellyfin) sawQuery(part string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, q := range f.queries {
		if strings.Contains(q, part) {
			return true
		}
	}
	return false
}

// jellyfinTestSpec files the key and returns a spec pointing at the fake.
func jellyfinTestSpec(t *testing.T, h *Handlers, fake *fakeJellyfin, config map[string]any) jellyfinSpec {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential("widget:w_jf0000000001", HealthCredential{
		Label: "Jellyfin", Headers: map[string]string{"X-Emby-Token": jellyfinTestKey},
	}); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_jf0000000001", "userId": "u1"}
	for k, v := range config {
		full[k] = v
	}
	return jellyfinSpecFrom(sanitizeWidgetConfig(WidgetTypeJellyfin, full))
}

func testImageURL(ref mediaImageRef) string {
	return "/img/" + ref.Item + "/" + ref.Kind + "/" + ref.Tag
}

func TestFetchJellyfinLatestMergesNewestFirst(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	spec := jellyfinTestSpec(t, h, fake, nil)

	result, images, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
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
	var names []string
	for _, lib := range result.Libraries {
		names = append(names, lib.Name)
	}
	if got := strings.Join(names, ","); got != "Films,Series,Anime" {
		t.Errorf("libraries = %s; music must not be offered", got)
	}
	if len(images) == 0 {
		t.Error("no image was recorded for the proxy")
	}
}

func TestFetchJellyfinLatestMapsEachKind(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	spec := jellyfinTestSpec(t, h, fake, nil)

	result, images, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]MediaItem{}
	for _, item := range result.Items {
		byID[item.ID] = item
	}

	movie := byID["m1"]
	if movie.Year != 2024 || movie.RuntimeMinutes != 166 || movie.Library != "Films" || movie.Kind != "movie" {
		t.Errorf("movie mapped wrong: %+v", movie)
	}
	if movie.Poster != "/img/m1/poster/pt1" || movie.Backdrop != "/img/m1/backdrop/bt1" {
		t.Errorf("movie pictures: %q %q", movie.Poster, movie.Backdrop)
	}
	if movie.OpenURL != fake.URL+"/web/#/details?id=m1&serverId=srv1" {
		t.Errorf("openUrl = %q", movie.OpenURL)
	}
	if movie.AddedAt != time.Date(2026, 10, 12, 9, 0, 0, 123456700, time.UTC).UnixMilli() {
		t.Errorf("addedAt = %d", movie.AddedAt)
	}

	// An episode carries its series' poster, not its own 16:9 still.
	episode := byID["e1"]
	if episode.Title != "Severance" || episode.Subtitle != "S02E07 · Cold Harbor" {
		t.Errorf("episode title: %q / %q", episode.Title, episode.Subtitle)
	}
	if episode.Poster != "/img/s1/poster/spt1" || episode.Backdrop != "/img/s1/backdrop/sbt1" {
		t.Errorf("episode pictures: %q %q", episode.Poster, episode.Backdrop)
	}
	if images[mediaImageRef{Item: "e1", Kind: "poster", Tag: "ept1"}] {
		t.Error("the episode still was offered as a poster")
	}

	if series := byID["s2"]; series.NewCount != 4 || series.Library != "Anime" {
		t.Errorf("grouped series: %+v", series)
	}
	if !byID["m2"].Played {
		t.Error("played flag lost")
	}
}

// A Jellyfin that only reads the Authorization scheme still accepts the key a
// reader filed as X-Emby-Token: that is what the panel stores and what older
// servers read, so the request carries both.
func TestJellyfinKeyIsAlsoSentTheCurrentWay(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	fake.modernOnly = true
	spec := jellyfinTestSpec(t, h, fake, nil)

	if _, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL); err != nil {
		t.Fatalf("a server that reads only Authorization refused the key: %v", err)
	}
	answer := askJellyfinSetup(t, h, `{"server":"`+fake.URL+`","credentialId":"widget:w_jf0000000001"}`)
	if answer.Error != "" || len(answer.Users) == 0 {
		t.Fatalf("setup against the same server: %+v", answer)
	}
}

// The key alone is enough: with no user chosen the newest items of every
// library come back, and episodes of one series are folded into one line.
func TestFetchJellyfinWithoutAUser(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	spec := jellyfinTestSpec(t, h, fake, map[string]any{"userId": ""})
	if spec.UserID != "" {
		t.Fatalf("the spec still has a user: %q", spec.UserID)
	}

	result, images, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	byID := map[string]MediaItem{}
	for _, item := range result.Items {
		ids = append(ids, item.ID)
		byID[item.ID] = item
	}
	// Severance's newest episode, Frieren's newest, and one Slow Horses line.
	if got := strings.Join(ids, ","); got != "m1,e1,f3,m2,h1" {
		t.Fatalf("order = %s", got)
	}
	var names []string
	for _, lib := range result.Libraries {
		names = append(names, lib.Name)
	}
	if strings.Join(names, ",") != "Films,Series,Anime" {
		t.Errorf("libraries = %v", names)
	}
	if sev := byID["e1"]; sev.Title != "Severance" || sev.NewCount != 2 || sev.Subtitle != "" {
		t.Errorf("two episodes of one series: %+v", sev)
	}
	if one := byID["h1"]; one.NewCount != 0 || one.Subtitle != "S04E01 · Hello" {
		t.Errorf("a single episode keeps its name: %+v", one)
	}
	if fr := byID["f3"]; fr.NewCount != 3 || fr.Poster != "/img/s2/poster/spt2" {
		t.Errorf("grouped anime: %+v", fr)
	}
	if byID["m1"].Played {
		t.Error("a watched flag was invented without a user")
	}
	if len(images) == 0 {
		t.Error("no image was recorded for the proxy")
	}
	if fake.sawQuery("userId=") {
		t.Error("a user was sent although none is chosen")
	}
}

func TestFetchJellyfinLatestHidesWatched(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	spec := jellyfinTestSpec(t, h, fake, map[string]any{"hideWatched": true})

	result, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Items {
		if item.Played {
			t.Errorf("%s is watched and still shown", item.ID)
		}
	}
	if !fake.sawQuery("isPlayed=false") {
		t.Error("Jellyfin was not asked to leave watched items out")
	}
}

func TestFetchJellyfinLatestOnlyChosenLibraries(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	spec := jellyfinTestSpec(t, h, fake, map[string]any{"libraries": []any{"lib-anime", "lib-gone"}})

	result, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Libraries) != 1 || result.Libraries[0].ID != "lib-anime" {
		t.Fatalf("libraries = %+v", result.Libraries)
	}
	if len(result.Items) != 1 || result.Items[0].ID != "s2" {
		t.Fatalf("items = %+v", result.Items)
	}
}

func TestFetchJellyfinLatestReportsWhatWentWrong(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)

	t.Run("deleted libraries", func(t *testing.T) {
		spec := jellyfinTestSpec(t, h, fake, map[string]any{"libraries": []any{"lib-gone"}})
		_, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
		if mediaErrorCode(err) != "no libraries" {
			t.Errorf("code = %q (%v)", mediaErrorCode(err), err)
		}
	})
	t.Run("refused key", func(t *testing.T) {
		spec := jellyfinTestSpec(t, h, fake, nil)
		fake.setStatus(http.StatusUnauthorized)
		defer fake.setStatus(0)
		_, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
		if mediaErrorCode(err) != "key refused" {
			t.Errorf("code = %q (%v)", mediaErrorCode(err), err)
		}
	})
	t.Run("server error", func(t *testing.T) {
		spec := jellyfinTestSpec(t, h, fake, nil)
		fake.setStatus(http.StatusBadGateway)
		defer fake.setStatus(0)
		_, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
		if mediaErrorCode(err) != "unreachable" {
			t.Errorf("code = %q (%v)", mediaErrorCode(err), err)
		}
	})
	t.Run("local address not allowed", func(t *testing.T) {
		spec := jellyfinTestSpec(t, h, fake, nil)
		allowLocalForTest(t, h, false)
		_, _, err := h.fetchJellyfinLatest(context.Background(), spec, testImageURL)
		if mediaErrorCode(err) != "address not allowed" {
			t.Errorf("code = %q (%v)", mediaErrorCode(err), err)
		}
	})
	t.Run("nothing set up", func(t *testing.T) {
		_, _, err := h.fetchJellyfinLatest(context.Background(), jellyfinSpecFrom(map[string]any{}), testImageURL)
		if !errors.Is(err, errMediaNotSetUp) {
			t.Errorf("err = %v", err)
		}
	})
}

// jellyfinTestWidget stores a Jellyfin widget on page 1 and returns its id.
func jellyfinTestWidget(t *testing.T, h *Handlers, fake *fakeJellyfin, config map[string]any) string {
	t.Helper()
	jellyfinTestSpec(t, h, fake, nil) // files the key, allows local addresses
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_jf0000000001", "userId": "u1"}
	for k, v := range config {
		full[k] = v
	}
	widget := Widget{ID: "w_jf0000000001", Type: WidgetTypeJellyfin, Title: "Jellyfin", Config: full}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	return widget.ID
}

func askJellyfinWidget(t *testing.T, h *Handlers, id string) MediaResult {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/widgets/jellyfin?pageId=1&id="+url.QueryEscape(id), nil)
	rec := httptest.NewRecorder()
	h.JellyfinWidgetHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), jellyfinTestKey) {
		t.Fatal("the API key is in the answer")
	}
	var result MediaResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestJellyfinWidgetHandlerAnswersAndCaches(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	id := jellyfinTestWidget(t, h, fake, nil)

	first := askJellyfinWidget(t, h, id)
	if len(first.Items) != 4 || first.Error != "" {
		t.Fatalf("first answer: %+v", first)
	}
	if !strings.HasPrefix(first.Items[0].Poster, "/api/widgets/jellyfin/image?") {
		t.Errorf("poster is not a proxy address: %q", first.Items[0].Poster)
	}
	before := len(fake.queries)
	askJellyfinWidget(t, h, id)
	if len(fake.queries) != before {
		t.Error("a second read inside the TTL went to Jellyfin again")
	}
}

func TestJellyfinWidgetHandlerKeepsTheLastGoodAnswer(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	id := jellyfinTestWidget(t, h, fake, nil)

	good := askJellyfinWidget(t, h, id)
	mediaExpireAll()
	fake.setStatus(http.StatusBadGateway)

	stale := askJellyfinWidget(t, h, id)
	if !stale.Stale || stale.Error != "unreachable" {
		t.Fatalf("expected a stale answer, got %+v", stale)
	}
	if len(stale.Items) != len(good.Items) || stale.FetchedAt != good.FetchedAt {
		t.Error("the stale answer is not the last good one")
	}
}

// One library failing is a gap, and a gap is not an answer to keep for the
// whole TTL: the tile says so and the next read tries again soon.
func TestJellyfinWidgetHandlerDoesNotKeepAHalfAnswerForLong(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	fake.failParent = "lib-anime"
	id := jellyfinTestWidget(t, h, fake, nil)

	partial := askJellyfinWidget(t, h, id)
	if !partial.Partial || len(partial.Items) != 3 {
		t.Fatalf("expected the other libraries and a partial flag, got %+v", partial)
	}
	mediaWidgetCache.Lock()
	entry := mediaWidgetCache.at[mediaCacheKey("jellyfin", 1, id)]
	wait := time.Until(entry.expires)
	mediaWidgetCache.Unlock()
	if wait > time.Minute {
		t.Fatalf("a partial answer is kept for %v", wait)
	}

	fake.failParent = ""
	mediaExpireAll()
	full := askJellyfinWidget(t, h, id)
	if full.Partial || len(full.Items) != 4 {
		t.Fatalf("the retry did not complete the answer: %+v", full)
	}
}

// A browser that gives up on the request (a reload, a closed tab) must not
// leave the cache holding what had arrived by then.
func TestJellyfinAnswerSurvivesACancelledRequest(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	id := jellyfinTestWidget(t, h, fake, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	answer := h.jellyfinAnswer(ctx, 1, Widget{ID: id, Type: WidgetTypeJellyfin, Config: map[string]any{
		"server": fake.URL, "credentialId": "widget:w_jf0000000001", "userId": "u1"}}, false)
	if answer.Error != "" || len(answer.Items) != 4 {
		t.Fatalf("a cancelled request left a broken answer: %+v", answer)
	}
}

func TestJellyfinWidgetHandlerNoticesAChangedChoice(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	id := jellyfinTestWidget(t, h, fake, nil)
	askJellyfinWidget(t, h, id)

	widget := Widget{ID: id, Type: WidgetTypeJellyfin, Config: map[string]any{
		"server": fake.URL, "credentialId": "widget:w_jf0000000001", "userId": "u1",
		"libraries": []any{"lib-anime"},
	}}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	after := askJellyfinWidget(t, h, id)
	if len(after.Libraries) != 1 || after.Libraries[0].ID != "lib-anime" {
		t.Fatalf("the cached answer outlived the new library choice: %+v", after.Libraries)
	}
}

func TestJellyfinWidgetHandlerSaysWhenNotSetUp(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.store.SavePageBlocks(1, []Widget{{ID: "w_jf0000000002", Type: WidgetTypeJellyfin}}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	if got := askJellyfinWidget(t, h, "w_jf0000000002"); got.Error != "not set up" {
		t.Fatalf("error = %q", got.Error)
	}
}

func askJellyfinSetup(t *testing.T, h *Handlers, body string) JellyfinSetupAnswer {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/widgets/jellyfin/setup", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.JellyfinSetupHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), jellyfinTestKey) {
		t.Fatal("the key came back")
	}
	var answer JellyfinSetupAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	return answer
}

func TestJellyfinSetupWithATypedKey(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeJellyfin(t)

	answer := askJellyfinSetup(t, h, `{"server":"`+fake.URL+`/","draftCredential":{"headers":{"X-Emby-Token":"`+jellyfinTestKey+`"}}}`)
	if answer.Error != "" || answer.ServerName != "Home" || answer.Version != "10.10.3" {
		t.Fatalf("answer = %+v", answer)
	}
	if len(answer.Users) != 2 || answer.Users[0].ID != "u1" {
		t.Errorf("users = %+v", answer.Users)
	}
	var names []string
	for _, lib := range answer.Libraries {
		names = append(names, lib.Name)
	}
	if strings.Join(names, ",") != "Films,Series,Anime" {
		t.Errorf("libraries = %v", names)
	}
}

func TestJellyfinSetupNeedsTheWriteToken(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	jellyfinTestSpec(t, h, fake, nil)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")

	rec := httptest.NewRecorder()
	h.JellyfinSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/jellyfin/setup",
		strings.NewReader(`{"server":"`+fake.URL+`","credentialId":"widget:w_jf0000000001"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token: %d", rec.Code)
	}
	if fake.sawQuery("/System/Info") {
		t.Error("an unauthenticated caller made the server reach out")
	}
}

func TestJellyfinSetupWithAStoredKeyAndAWrongOne(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	jellyfinTestSpec(t, h, fake, nil) // files widget:w_jf0000000001

	if got := askJellyfinSetup(t, h, `{"server":"`+fake.URL+`","credentialId":"widget:w_jf0000000001"}`); got.Error != "" {
		t.Errorf("stored key: %+v", got)
	}
	if got := askJellyfinSetup(t, h, `{"server":"`+fake.URL+`","draftCredential":{"headers":{"X-Emby-Token":"wrong"}}}`); got.Error != "key refused" {
		t.Errorf("wrong key: %+v", got)
	}
	if got := askJellyfinSetup(t, h, `{"server":"`+fake.URL+`"}`); got.Error != "not set up" {
		t.Errorf("no key: %+v", got)
	}
}
