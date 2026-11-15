package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const immichTestKey = "immich-key-0123456789"

// immichPicture is a real one-pixel picture, so the image proxy has something it accepts.
var immichPicture, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

// fakeImmich answers from testdata/immich: shapes recorded from a real
// Immich 3.4 server, with every name, id and path replaced.
type fakeImmich struct {
	*httptest.Server
	mu     sync.Mutex
	paths  []string
	bodies []map[string]any
	// deny makes a path answer 403, as a key without admin rights is told.
	deny map[string]bool
	// random replaces the random search's answer when set.
	random []byte
	// broken makes a path answer 500, as a server that is struggling does.
	broken map[string]bool
	// release is what version-check says is out.
	release string
}

func readImmichFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "immich", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func newFakeImmich(t *testing.T) *fakeImmich {
	t.Helper()
	fixtures := map[string][]byte{}
	for path, file := range map[string]string{
		"/api/server/about": "about.json", "/api/server/statistics": "statistics.json",
		"/api/server/storage": "storage.json", "/api/albums": "albums.json", "/api/people": "people.json",
		"/api/memories": "memories.json", "/api/jobs": "jobs.json", "/api/users/me": "users-me.json",
		"/api/duplicates": "duplicates.json",
	} {
		fixtures[path] = readImmichFixture(t, file)
	}
	fake := &fakeImmich{deny: map[string]bool{}, broken: map[string]bool{}, release: "v3.4.1"}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if r.Method == http.MethodPost {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		fake.mu.Lock()
		fake.paths = append(fake.paths, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
		if body != nil {
			fake.bodies = append(fake.bodies, body)
		}
		denied := fake.deny[r.URL.Path]
		broken := fake.broken[r.URL.Path]
		release := fake.release
		fake.mu.Unlock()
		if r.Header.Get("X-Api-Key") != immichTestKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if denied {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if broken {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		switch {
		case r.URL.Path == "/api/server/version-check":
			_, _ = w.Write([]byte(`{"checkedAt":"2026-11-15T17:49:19.192Z","releaseVersion":"` + release + `"}`))
		case r.URL.Path == "/api/timeline/buckets":
			_, _ = w.Write(readImmichFixture(t, "timeline-buckets.json"))
		case r.URL.Path == "/api/timeline/bucket":
			if r.URL.Query().Get("timeBucket") == "2025-06-01" {
				_, _ = w.Write(readImmichFixture(t, "timeline-bucket-june.json"))
			} else {
				_, _ = w.Write(readImmichFixture(t, "timeline-bucket-july.json"))
			}
		case r.URL.Path == "/api/search/random":
			fake.mu.Lock()
			custom := fake.random
			fake.mu.Unlock()
			if custom != nil {
				_, _ = w.Write(custom)
			} else {
				_, _ = w.Write(readImmichFixture(t, "search-random.json"))
			}
		case r.URL.Path == "/api/search/metadata":
			_, _ = w.Write(readImmichFixture(t, "search-metadata.json"))
		case strings.HasSuffix(r.URL.Path, "/thumbnail"):
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(immichPicture)
		case fixtures[r.URL.Path] != nil:
			_, _ = w.Write(fixtures[r.URL.Path])
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(fake.Close)
	return fake
}

func (f *fakeImmich) saw(part string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.paths {
		if strings.Contains(p, part) {
			return true
		}
	}
	return false
}

func (f *fakeImmich) lastBody() map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.bodies) == 0 {
		return nil
	}
	return f.bodies[len(f.bodies)-1]
}

func immichTestSpec(t *testing.T, h *Handlers, fake *fakeImmich, service WidgetType, config map[string]any) immichSpec {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential("widget:w_immich000001", HealthCredential{
		Label: "Immich", Headers: map[string]string{"X-Api-Key": immichTestKey},
	}); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_immich000001"}
	for k, v := range config {
		full[k] = v
	}
	return immichSpecFrom(service, sanitizeWidgetConfig(service, full))
}

func TestImmichPhotosFromTheWholeLibrary(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	spec := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{"rows": float64(3)})

	result, images, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 3 || len(images) != 6 {
		t.Fatalf("%d items, %d pictures offered", len(result.Items), len(images))
	}
	first := result.Items[0]
	if first.Kind != "photo" || first.When == 0 || first.Year == 0 || !strings.HasPrefix(first.OpenURL, fake.URL+"/photos/") {
		t.Errorf("first = %+v", first)
	}
	// A photo has a small picture and a large one, and a name for each.
	if !strings.Contains(first.Poster, "/poster/") || !strings.Contains(first.Backdrop, "/backdrop/") {
		t.Errorf("pictures = %q, %q", first.Poster, first.Backdrop)
	}
	body := fake.lastBody()
	if body["type"] != "IMAGE" || body["size"] != float64(3) || body["visibility"] != "timeline" {
		t.Errorf("asked %+v", body)
	}
	if !fake.saw("POST /api/search/random") {
		t.Error("a random library was not read through the random search")
	}
}

func TestImmichSourcesAskForTheirOwnFilter(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	cases := []struct {
		name   string
		config map[string]any
		key    string
		want   any
	}{
		{"favorites", map[string]any{"source": "favorites"}, "isFavorite", true},
		{"person", map[string]any{"source": "person", "personId": "per-1"}, "personIds", []any{"per-1"}},
	}
	for _, c := range cases {
		spec := immichTestSpec(t, h, fake, WidgetTypeImmich, c.config)
		if _, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		got := fake.lastBody()[c.key]
		if gotJSON, _ := json.Marshal(got); string(gotJSON) != immichJSON(c.want) {
			t.Errorf("%s: %s = %v, want %v", c.name, c.key, got, c.want)
		}
	}
}

func immichJSON(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}

func TestImmichOrderChoosesTheSearch(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	for order, want := range map[string]string{"newest": "desc", "oldest": "asc"} {
		spec := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{"order": order})
		if _, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL); err != nil {
			t.Fatal(err)
		}
		body := fake.lastBody()
		if body["order"] != want {
			t.Errorf("%s asked order %v", order, body["order"])
		}
	}
	if !fake.saw("POST /api/search/metadata") {
		t.Error("a dated order was not read through the metadata search")
	}
}

func TestImmichAnAlbumOrPersonNotChosenIsNotAnEmptyLibrary(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	for _, source := range []string{"album", "person"} {
		spec := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{"source": source})
		_, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL)
		if !errors.Is(err, errMediaNoLibraries) {
			t.Errorf("%s: %v", source, err)
		}
	}
	if fake.saw("/api/search") {
		t.Error("a library was searched with nothing chosen")
	}
}

func TestImmichVideosAreAskedForAndShownAsStills(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	spec := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{"videos": true})
	if _, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL); err != nil {
		t.Fatal(err)
	}
	if _, has := fake.lastBody()["type"]; has {
		t.Errorf("videos were asked for with a type filter: %+v", fake.lastBody())
	}
	// A video in an answer carries its length, milliseconds read as seconds.
	asset := immichAsset{ID: "v1", Type: "VIDEO", UpdatedAt: "2026-01-01T00:00:00Z"}
	asset.Duration = 2235
	item := immichPhotoItem(spec, asset, testImageURL, map[mediaImageRef]bool{})
	if item.Kind != "video" || item.Seconds != 2 {
		t.Errorf("video = %+v", item)
	}
}

func TestImmichOnThisDayKeepsTheOldestFirstAndSaysSo(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	spec := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{"source": "memories", "rows": float64(20)})
	result, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 3 {
		t.Fatalf("%d items", len(result.Items))
	}
	for i, item := range result.Items {
		if item.LibraryID != "memories" || item.Library != "On this day" {
			t.Errorf("item %d: %+v", i, item)
		}
		if i > 0 && item.When < result.Items[i-1].When {
			t.Error("not oldest first")
		}
	}
	if !fake.saw("GET /api/memories?for=" + time.Now().Format("2006-01-02")) {
		t.Errorf("paths %v", fake.paths)
	}
}

func TestImmichPhotoOfTheDayIsOnePhotoAllDay(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	spec := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{"source": "day", "rows": float64(9)})
	if spec.Rows != 1 {
		t.Fatalf("rows = %d", spec.Rows)
	}
	first, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL)
	if err != nil || len(first.Items) != 1 {
		t.Fatalf("%v %+v", err, first)
	}
	searches := 0
	count := func() int {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		n := 0
		for _, p := range fake.paths {
			if strings.HasPrefix(p, "POST /api/search") {
				n++
			}
		}
		return n
	}
	searches = count()
	again, _, _ := h.fetchImmichPhotos(context.Background(), spec, testImageURL)
	if again.Items[0].ID != first.Items[0].ID || count() != searches {
		t.Errorf("a second read searched again (%d -> %d) or chose another photo", searches, count())
	}
	// Yesterday's pick is not today's.
	immichDayPicks.Lock()
	for key, pick := range immichDayPicks.at {
		pick.day = "2000-01-01"
		immichDayPicks.at[key] = pick
	}
	immichDayPicks.Unlock()
	_, _, _ = h.fetchImmichPhotos(context.Background(), spec, testImageURL)
	if count() == searches {
		t.Error("an old day's photo was kept")
	}
}

func TestImmichRefusedKeyAndUnreachable(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	spec := immichTestSpec(t, h, fake, WidgetTypeImmich, nil)
	if err := saveHealthCredential("widget:w_immich000001", HealthCredential{
		Label: "Immich", Headers: map[string]string{"X-Api-Key": "wrong"},
	}); err != nil {
		t.Fatal(err)
	}
	_, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL)
	if !errors.Is(err, errMediaRefused) {
		t.Errorf("a wrong key: %v", err)
	}
	spec.Server = ""
	if _, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL); !errors.Is(err, errMediaNotSetUp) {
		t.Errorf("no address: %v", err)
	}
}

func TestImmichAlbumsScopeSortAndWho(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	run := func(config map[string]any) MediaResult {
		spec := immichTestSpec(t, h, fake, WidgetTypeImmichAlbums, config)
		result, _, err := h.fetchImmichAlbums(context.Background(), spec, testImageURL)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	titles := func(result MediaResult) string {
		var names []string
		for _, item := range result.Items {
			names = append(names, item.Title)
		}
		return strings.Join(names, ",")
	}

	all := run(map[string]any{"sort": "name"})
	if titles(all) != "Birthday party,Shared with us,Summer trip" {
		t.Errorf("all by name: %s", titles(all))
	}
	// Mine and not shared is not "shared"; someone else's shared album is.
	if got := titles(run(map[string]any{"scope": "shared", "sort": "name"})); got != "Shared with us,Summer trip" {
		t.Errorf("shared: %s", got)
	}
	if got := titles(run(map[string]any{"scope": "mine", "sort": "name"})); got != "Birthday party,Summer trip" {
		t.Errorf("mine: %s", got)
	}
	for _, item := range all.Items {
		switch item.Title {
		case "Shared with us":
			if item.Who != "Anna" {
				t.Errorf("who = %q", item.Who)
			}
		default:
			if item.Who != "" {
				t.Errorf("%s names %q as its owner", item.Title, item.Who)
			}
		}
		if item.Kind != "album" || item.Count == 0 || !strings.HasPrefix(item.OpenURL, fake.URL+"/albums/") {
			t.Errorf("album = %+v", item)
		}
	}
	// An album with no cover is drawn by its initials, not by a missing picture.
	for _, item := range all.Items {
		if item.Title == "Birthday party" && (item.Poster != "" || item.Count != 38) {
			t.Errorf("empty-cover album = %+v", item)
		}
	}
	if got := run(map[string]any{"sort": "count"}).Items[0].Count; got < 100 {
		t.Errorf("most photos first, got %d", got)
	}
}

func TestImmichPeopleAreTheNamedOnes(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	spec := immichTestSpec(t, h, fake, WidgetTypeImmichPeople, map[string]any{"rows": float64(20)})
	result, images, err := h.fetchImmichPeople(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, item := range result.Items {
		names = append(names, item.Title)
		if item.Kind != "person" || item.Poster == "" || !strings.HasPrefix(item.OpenURL, fake.URL+"/people/") {
			t.Errorf("person = %+v", item)
		}
	}
	if strings.Join(names, ",") != "Anna,Ben,Carol,Dave" || len(images) != 4 {
		t.Errorf("names %v, %d pictures (a nameless and a hidden face must not show)", names, len(images))
	}
	spec = immichTestSpec(t, h, fake, WidgetTypeImmichPeople, map[string]any{"favorites": true})
	result, _, _ = h.fetchImmichPeople(context.Background(), spec, testImageURL)
	if len(result.Items) != 1 || result.Items[0].Title != "Ben" {
		t.Errorf("favorites: %+v", result.Items)
	}
}

func TestImmichStatusReadsEveryTopicAndLeavesOutWhatFailed(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	statusSpec := func(topics ...any) immichStatusSpec {
		immichTestSpec(t, h, fake, WidgetTypeImmichStatus, nil)
		config := map[string]any{"server": fake.URL, "credentialId": "widget:w_immich000001"}
		if topics != nil {
			config["topics"] = topics
		}
		return immichStatusSpecFrom(sanitizeWidgetConfig(WidgetTypeImmichStatus, config))
	}

	result, _, err := h.fetchImmichStatus(context.Background(), statusSpec("library", "storage", "jobs", "duplicates"))
	if err != nil {
		t.Fatal(err)
	}
	s := result.Immich
	if s == nil || s.Version != "v3.4.1" || s.Update != "" {
		t.Fatalf("status = %+v", s)
	}
	if s.Photos == nil || *s.Photos != 32571 || s.Videos == nil || s.Usage == nil || s.Disk == nil || s.Disk.Pct != 45.02 {
		t.Errorf("library and storage = %+v", s)
	}
	if !s.JobsRead || s.Failed != 3 || s.Duplicates == nil || *s.Duplicates != 4 {
		t.Errorf("jobs and duplicates = %+v", s)
	}
	// Failed first, then what is busy, then the paused one.
	if len(s.Queues) != 3 || s.Queues[0].Name != "metadataExtraction" || s.Queues[1].Name != "thumbnailGeneration" || !s.Queues[2].Paused {
		t.Errorf("queues = %+v", s.Queues)
	}

	// A key that is not an administrator's is not told the totals: they are
	// left out, not shown as nought, and the rest still draws.
	fake.mu.Lock()
	fake.deny["/api/server/statistics"] = true
	fake.mu.Unlock()
	result, _, err = h.fetchImmichStatus(context.Background(), statusSpec("library", "storage"))
	if err != nil {
		t.Fatal(err)
	}
	if result.Immich.Photos != nil || result.Immich.Disk == nil || !result.Immich.NeedsAdmin || result.Partial || result.Immich.Partial {
		t.Errorf("a key that is refused the totals = %+v (partial %v)", result.Immich, result.Partial)
	}

	// A topic that could not be read at all is a half answer, asked for again soon.
	fake.mu.Lock()
	fake.broken["/api/server/storage"] = true
	fake.mu.Unlock()
	result, _, err = h.fetchImmichStatus(context.Background(), statusSpec("library", "storage", "jobs"))
	if err != nil || !result.Partial || result.Immich.Disk != nil || !result.Immich.JobsRead {
		t.Errorf("a half answer = %+v (%v)", result.Immich, err)
	}
	fake.mu.Lock()
	delete(fake.broken, "/api/server/storage")
	fake.mu.Unlock()

	// Everything failing is an error, worded as a refused key.
	fake.mu.Lock()
	for _, path := range []string{"/api/server/about", "/api/server/storage", "/api/jobs"} {
		fake.deny[path] = true
	}
	fake.mu.Unlock()
	if _, _, err = h.fetchImmichStatus(context.Background(), statusSpec("library", "storage", "jobs")); !errors.Is(err, errMediaRefused) {
		t.Errorf("all refused: %v", err)
	}
}

func TestImmichStatusSaysWhenAnUpdateIsOut(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	immichTestSpec(t, h, fake, WidgetTypeImmichStatus, nil)
	spec := immichStatusSpecFrom(map[string]any{"server": fake.URL, "credentialId": "widget:w_immich000001"})
	fake.mu.Lock()
	fake.release = "v3.5.0"
	fake.mu.Unlock()
	result, _, err := h.fetchImmichStatus(context.Background(), spec)
	if err != nil || result.Immich.Update != "v3.5.0" {
		t.Fatalf("%v %+v", err, result.Immich)
	}
	for release, installed := range map[string]string{"v3.4.1": "v3.4.1", "v3.4.0": "v3.4.1", "": "v3.4.1", "latest": "v3.4.1"} {
		if immichNewer(release, installed) {
			t.Errorf("%q is not newer than %q", release, installed)
		}
	}
	if !immichNewer("v3.10.0", "v3.9.9") || !immichNewer("v4.0.0", "v3.99.99") || !immichNewer("v3.4.2-rc1", "v3.4.1") {
		t.Error("a later version is not newer")
	}
}

func TestImmichPicturesComeFromTheirOwnEndpoints(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	spec := immichTestSpec(t, h, fake, WidgetTypeImmich, nil)
	credential, _ := lookupHealthCredential(spec.CredentialID)
	ctx := context.Background()

	if _, err := h.fetchImmichAssetImage(ctx, fake.URL, credential, mediaImageRef{Item: "a1", Kind: "poster", Tag: "t"}); err != nil {
		t.Fatal(err)
	}
	if !fake.saw("/api/assets/a1/thumbnail?size=thumbnail") {
		t.Errorf("poster: %v", fake.paths)
	}
	if _, err := h.fetchImmichAssetImage(ctx, fake.URL, credential, mediaImageRef{Item: "a1", Kind: "backdrop", Tag: "t"}); err != nil {
		t.Fatal(err)
	}
	if !fake.saw("/api/assets/a1/thumbnail?size=preview") {
		t.Errorf("backdrop: %v", fake.paths)
	}
	if _, err := h.fetchImmichPersonImage(ctx, fake.URL, credential, mediaImageRef{Item: "p1", Kind: "poster", Tag: "t"}); err != nil {
		t.Fatal(err)
	}
	if !fake.saw("/api/people/p1/thumbnail") {
		t.Errorf("person: %v", fake.paths)
	}
	// A path is escaped, not followed.
	if _, err := h.fetchImmichAssetImage(ctx, fake.URL, credential, mediaImageRef{Item: "../server/about", Kind: "poster", Tag: "t"}); err == nil && fake.saw("GET /api/server/about?size") {
		t.Error("an item named a path and Immich was asked for it")
	}
}

func TestImmichRoutesServeTheAnswerAndOnlyItsPictures(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	immichTestSpec(t, h, fake, WidgetTypeImmich, nil)
	widget := Widget{ID: "w_immich000001", Type: WidgetTypeImmich, Config: map[string]any{
		"server": fake.URL, "credentialId": "widget:w_immich000001", "rows": float64(2)}}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()

	rec := httptest.NewRecorder()
	h.immichWidgetHandler(WidgetTypeImmich)(rec, httptest.NewRequest(http.MethodGet, "/api/widgets/immich?pageId=1&id="+widget.ID, nil))
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), immichTestKey) {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var result MediaResult
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	if len(result.Items) != 2 || !strings.HasPrefix(result.Items[0].Poster, "/api/widgets/immich/image?") {
		t.Fatalf("result = %+v", result)
	}

	// An offered picture is served and cached; another id is not Immich's to give.
	img := httptest.NewRecorder()
	h.immichImageHandler(WidgetTypeImmich)(img, httptest.NewRequest(http.MethodGet, result.Items[0].Poster, nil))
	if img.Code != http.StatusOK || !strings.HasPrefix(img.Header().Get("Content-Type"), "image/") {
		t.Errorf("offered picture: %d %s", img.Code, img.Header().Get("Content-Type"))
	}
	bad := httptest.NewRecorder()
	h.immichImageHandler(WidgetTypeImmich)(bad, httptest.NewRequest(http.MethodGet,
		"/api/widgets/immich/image?pageId=1&id="+widget.ID+"&item=someone-elses-photo&kind=backdrop&tag=x", nil))
	if bad.Code != http.StatusNotFound {
		t.Errorf("an unoffered picture answered %d", bad.Code)
	}
	// The slideshow keeps its own pictures, apart from the photos tile.
	other := httptest.NewRecorder()
	h.immichImageHandler(WidgetTypeImmichSlideshow)(other, httptest.NewRequest(http.MethodGet, result.Items[0].Poster, nil))
	if other.Code != http.StatusNotFound {
		t.Errorf("another type's picture answered %d", other.Code)
	}
}

func TestImmichSetupListsAlbumsAndPeopleAndNamesTheVersion(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeImmich(t)
	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"X-Api-Key":"` + immichTestKey + `"}}}`

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	rec := httptest.NewRecorder()
	h.immichSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/immich/setup", strings.NewReader(body)))
	if rec.Code != http.StatusUnauthorized || fake.saw("/api/users/me") {
		t.Fatalf("no token: %d", rec.Code)
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	rec = httptest.NewRecorder()
	h.immichSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/immich/setup", strings.NewReader(body)))
	var answer struct {
		ServerName string                      `json:"serverName"`
		Version    string                      `json:"version"`
		Admin      *bool                       `json:"admin"`
		Albums     []struct{ ID, Name string } `json:"albums"`
		People     []struct{ ID, Name string } `json:"people"`
		Error      string                      `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &answer)
	if answer.Error != "" || answer.Version != "v3.4.1" || answer.Admin == nil || !*answer.Admin || len(answer.Albums) != 3 || len(answer.People) != 4 {
		t.Fatalf("answer = %+v (%s)", answer, rec.Body.String())
	}
	if answer.Albums[0].Name != "Birthday party" {
		t.Errorf("albums are not sorted by name: %+v", answer.Albums)
	}
	if strings.Contains(rec.Body.String(), immichTestKey) {
		t.Error("the key came back")
	}

	// A wrong key is a refused key, not "unreachable".
	wrong := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"X-Api-Key":"nope"}}}`
	rec = httptest.NewRecorder()
	h.immichSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/immich/setup", strings.NewReader(wrong)))
	if !strings.Contains(rec.Body.String(), `"error":"key refused"`) {
		t.Errorf("wrong key: %s", rec.Body.String())
	}
}

func TestImmichWidgetConfig(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeImmich, map[string]any{
		"server": "http://immich.lan:2283", "credentialId": "widget:w_000000000009",
		"source": "album", "albumId": "alb", "order": "sideways", "layout": "slides", "caption": "date", "rows": float64(99),
	})
	if clean["source"] != "album" || clean["albumId"] != "alb" || clean["caption"] != "date" {
		t.Errorf("kept: %#v", clean)
	}
	// The slideshow is a widget of its own, not a layout of this one.
	if clean["layout"] != nil || clean["order"] != nil || clean["rows"] != widgetMaxRows {
		t.Errorf("narrowed: %#v", clean)
	}
	slides := sanitizeWidgetConfig(WidgetTypeImmichSlideshow, map[string]any{
		"interval": float64(1), "transition": "fade", "autoplay": false, "layout": "grid"})
	if slides["interval"] != 3 || slides["transition"] != "fade" || slides["autoplay"] != false || slides["layout"] != nil {
		t.Errorf("slideshow: %#v", slides)
	}
	for _, widget := range []WidgetType{WidgetTypeImmich, WidgetTypeImmichSlideshow, WidgetTypeImmichAlbums, WidgetTypeImmichPeople, WidgetTypeImmichStatus} {
		for _, key := range []string{"server", "credentialId"} {
			if !withheldWidgetKeys[widget][key] {
				t.Errorf("%s hands %s to a tokenless reader", widget, key)
			}
		}
	}
	for _, key := range []string{"albumId", "personId"} {
		if !withheldWidgetKeys[WidgetTypeImmich][key] || !withheldWidgetKeys[WidgetTypeImmichSlideshow][key] {
			t.Errorf("%s is handed to a tokenless reader", key)
		}
	}
}

func TestImmichSpecDefaultsFollowTheLayout(t *testing.T) {
	rows := func(service WidgetType, config map[string]any) int {
		return immichSpecFrom(service, config).Rows
	}
	if rows(WidgetTypeImmich, map[string]any{"layout": "frame", "rows": 9}) != 1 {
		t.Error("a frame shows one photo, whatever rows says")
	}
	if rows(WidgetTypeImmich, nil) != 6 || rows(WidgetTypeImmichSlideshow, nil) != 12 || rows(WidgetTypeImmichPeople, nil) != 8 {
		t.Error("defaults")
	}
	if rows(WidgetTypeImmichSlideshow, map[string]any{"rows": 20}) != 20 {
		t.Error("a slideshow takes rows")
	}
	if immichSpecFrom(WidgetTypeImmichSlideshow, nil).Layout != "slides" {
		t.Error("the slideshow draws slides")
	}
}

// A page template carries the address as a variable and leaves the album and
// the person at home: their ids name nothing on another server.
func TestImmichWidgetTravelsWithoutItsAlbum(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.store.SavePage(Page{ID: 7, Name: "Photos"}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SavePageOrder(append(h.store.GetPageOrder(), 7)); err != nil {
		t.Fatal(err)
	}
	widget := Widget{ID: "w_eeeeeeeeeeee", Type: WidgetTypeImmich, Title: "Photos", Config: map[string]any{
		"server": "http://192.168.1.50:2283", "credentialId": "widget:w_eeeeeeeeeeee",
		"source": "album", "albumId": "6f0c3a1e-aaaa-4bbb-8ccc-123456789abc", "layout": "frame"}}
	if err := h.store.SavePageBlocks(7, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	_, raw := exportTemplate(t, h, 7, TemplateExportOptions{})
	text := string(raw)
	for _, leak := range []string{"192.168.1.50", "6f0c3a1e", "widget:w_eeeeeeeeeeee"} {
		if strings.Contains(text, leak) {
			t.Errorf("the template carries %q", leak)
		}
	}
	if !strings.Contains(text, `"layout": "frame"`) {
		t.Errorf("the template lost the layout:\n%s", text)
	}
}

// An album is read through the timeline: the search looks only at the caller's
// own photos, so an album someone else shared would come back empty.
func TestImmichAnAlbumIsReadThroughTheTimeline(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	spec := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{
		"source": "album", "albumId": "alb-1", "order": "newest", "rows": float64(20)})
	result, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if fake.saw("/api/search") || !fake.saw("/api/timeline/buckets?albumId=alb-1") {
		t.Fatalf("paths %v", fake.paths)
	}
	// Videos are left out unless asked for; the newest month comes first.
	if len(result.Items) != 5 || result.Items[0].Kind != "photo" {
		t.Fatalf("%d items: %+v", len(result.Items), result.Items)
	}
	for i, item := range result.Items {
		if july := strings.Contains(item.ID, "00000000070"); july != (i < 3) {
			t.Errorf("the newest month first: item %d is %s", i, item.ID)
		}
	}
	// The picture's name follows the thumbnail (its hash); the day is the
	// photo's own wall-clock day, the offset applied.
	first := result.Items[0]
	if !strings.HasSuffix(first.Poster, "/th700") || time.UnixMilli(first.When).UTC().Format("2006-01-02T15:04") != "2025-07-10T23:40" {
		t.Errorf("first = %+v", first)
	}

	oldest := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{
		"source": "album", "albumId": "alb-1", "order": "oldest", "videos": true, "rows": float64(20)})
	result, _, _ = h.fetchImmichPhotos(context.Background(), oldest, testImageURL)
	if len(result.Items) != 6 || result.Items[0].Year != 2025 || time.UnixMilli(result.Items[0].When).UTC().Month() != time.June {
		t.Errorf("oldest first: %+v", result.Items)
	}
	var video MediaItem
	for _, item := range result.Items {
		if item.Kind == "video" {
			video = item
		}
	}
	if video.Seconds != 2 {
		t.Errorf("a video from the timeline carries its length: %+v", video)
	}
	// Only as many months as needed are read.
	few := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{
		"source": "album", "albumId": "alb-1", "order": "newest", "rows": float64(2)})
	before := len(fake.paths)
	result, _, _ = h.fetchImmichPhotos(context.Background(), few, testImageURL)
	months := 0
	for _, p := range fake.paths[before:] {
		if strings.Contains(p, "/api/timeline/bucket?") {
			months++
		}
	}
	if len(result.Items) != 2 || months != 1 {
		t.Errorf("%d items from %d months", len(result.Items), months)
	}
}

func TestImmichDurationIsReadHoweverImmichWordsIt(t *testing.T) {
	for raw, want := range map[string]float64{
		`2235`: 2235, `"0:00:02.235000"`: 2235, `"1:02:03.5"`: 3_723_500, `null`: 0, `""`: 0, `"soon"`: 0, `-4`: 0, `"1:2"`: 0,
	} {
		var asset immichAsset
		if err := json.Unmarshal([]byte(`{"id":"a","duration":`+raw+`}`), &asset); err != nil {
			t.Errorf("%s: %v", raw, err)
		}
		if float64(asset.Duration) != want {
			t.Errorf("%s = %v, want %v", raw, asset.Duration, want)
		}
	}
	// A string in the search answer used to fail every photo tile.
	var answer immichSearchAnswer
	if err := json.Unmarshal([]byte(`{"assets":{"items":[{"id":"a","type":"IMAGE","duration":"0:00:00.000000"}]}}`), &answer); err != nil || len(answer.Assets.Items) != 1 {
		t.Errorf("%v %+v", err, answer)
	}
}

func TestImmichArchivedAndHiddenPhotosAreLeftOut(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	// An old server ignores the visibility filter of the search and sends
	// these anyway.
	fake.mu.Lock()
	fake.random = []byte(`[
		{"id":"keep","type":"IMAGE","visibility":"timeline","updatedAt":"x"},
		{"id":"archived","type":"IMAGE","isArchived":true,"updatedAt":"x"},
		{"id":"locked","type":"IMAGE","visibility":"locked","updatedAt":"x"},
		{"id":"trashed","type":"IMAGE","isTrashed":true,"updatedAt":"x"},
		{"id":"old","type":"IMAGE","updatedAt":"x"}]`)
	fake.mu.Unlock()
	spec := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{"rows": float64(20)})
	result, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, item := range result.Items {
		ids = append(ids, item.ID)
	}
	// An old server sends no visibility at all, which is not a reason to drop a photo.
	if strings.Join(ids, ",") != "keep,old" {
		t.Errorf("kept %v", ids)
	}
}

func TestImmichAlbumOwnerFallsBackToTheOlderShape(t *testing.T) {
	var album immichAlbum
	if err := json.Unmarshal([]byte(`{"id":"a","ownerId":"u1","owner":{"id":"u1","name":"Anna"},"albumUsers":[{"user":{"id":"u2","name":"Ben"},"role":"editor"}]}`), &album); err != nil {
		t.Fatal(err)
	}
	if id, name := album.owner(); id != "u1" || name != "Anna" {
		t.Errorf("owner = %q %q", id, name)
	}
	if err := json.Unmarshal([]byte(`{"id":"a","ownerId":"u1"}`), &album); err != nil {
		t.Fatal(err)
	}
	if id, _ := (immichAlbum{OwnerID: "u9"}).owner(); id != "u9" {
		t.Errorf("only an id: %q", id)
	}
}

func TestImmichSetupAcceptsAKeyThatMayNotReadItsOwnUser(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeImmich(t)
	fake.mu.Lock()
	fake.deny["/api/users/me"] = true
	fake.mu.Unlock()
	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"X-Api-Key":"` + immichTestKey + `"}}}`
	rec := httptest.NewRecorder()
	h.immichSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/immich/setup", strings.NewReader(body)))
	text := rec.Body.String()
	if strings.Contains(text, `"error"`) || !strings.Contains(text, `"version":"v3.4.1"`) || strings.Contains(text, `"admin"`) {
		t.Errorf("a scoped key: %s", text)
	}
	// Refused everywhere is still a refused key.
	fake.mu.Lock()
	fake.deny["/api/albums"] = true
	fake.mu.Unlock()
	rec = httptest.NewRecorder()
	h.immichSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/immich/setup", strings.NewReader(body)))
	if !strings.Contains(rec.Body.String(), `"error":"key refused"`) {
		t.Errorf("refused: %s", rec.Body.String())
	}
}

func TestImmichDuplicatesAreCountedNotKept(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	spec := immichTestSpec(t, h, fake, WidgetTypeImmichStatus, nil)
	credential, _ := lookupHealthCredential(spec.CredentialID)
	count, err := h.immichCount(context.Background(), fake.URL, credential, "/duplicates")
	if err != nil || count != 4 {
		t.Errorf("%d %v", count, err)
	}
	// Not a list is not a count of nought.
	if _, err := h.immichCount(context.Background(), fake.URL, credential, "/server/about"); err == nil {
		t.Error("an object was counted as a list")
	}
}

// The pictures of the answer before stay offered for one more answer, so a
// tab that holds the older list is not refused pictures that were on it.
func TestMediaAnswerKeepsTheLastListsPicturesForOneMoreAnswer(t *testing.T) {
	h := newTestHandlers(t)
	mediaForgetAll()
	spec := mediaSpec{Service: "immich", Server: "http://x", CredentialID: "c", Fingerprint: "f", TTL: time.Hour}
	list := func(name string) mediaFetch {
		return func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
			return MediaResult{}, map[mediaImageRef]bool{{Item: name, Kind: "poster", Tag: "t"}: true}, nil
		}
	}
	allowed := func(name string) bool {
		_, _, ok := mediaAllowedImage(mediaCacheKey("immich", 1, "w1"), mediaImageRef{Item: name, Kind: "poster", Tag: "t"})
		return ok
	}
	h.mediaAnswer(context.Background(), 1, "w1", spec, list("one"), false)
	h.mediaAnswer(context.Background(), 1, "w1", spec, list("two"), true)
	if !allowed("two") || !allowed("one") {
		t.Error("the answer before was refused as soon as it was replaced")
	}
	h.mediaAnswer(context.Background(), 1, "w1", spec, list("three"), true)
	if !allowed("three") || !allowed("two") || allowed("one") {
		t.Errorf("one more answer only: one=%v two=%v three=%v", allowed("one"), allowed("two"), allowed("three"))
	}
	// A changed setting forgets them: they answered a different question.
	changed := spec
	changed.Fingerprint = "g"
	h.mediaAnswer(context.Background(), 1, "w1", changed, list("four"), true)
	if allowed("three") || !allowed("four") {
		t.Error("a pictures list outlived the setting it answered")
	}
}

func TestImmichPicturesAreNotPublic(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	immichTestSpec(t, h, fake, WidgetTypeImmich, nil)
	widget := Widget{ID: "w_immich000002", Type: WidgetTypeImmich, Config: map[string]any{
		"server": fake.URL, "credentialId": "widget:w_immich000001", "rows": float64(1)}}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	rec := httptest.NewRecorder()
	h.immichWidgetHandler(WidgetTypeImmich)(rec, httptest.NewRequest(http.MethodGet, "/api/widgets/immich?pageId=1&id="+widget.ID, nil))
	var result MediaResult
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	img := httptest.NewRecorder()
	h.immichImageHandler(WidgetTypeImmich)(img, httptest.NewRequest(http.MethodGet, result.Items[0].Poster, nil))
	if cache := img.Header().Get("Cache-Control"); !strings.HasPrefix(cache, "private,") {
		t.Errorf("a photo is cacheable by anyone: %q", cache)
	}
}

func TestImmichDayPicksAreDroppedWhenTheirDayIsOver(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeImmich(t)
	immichDayPicks.Lock()
	immichDayPicks.at = map[string]immichDayPick{"old|key": {day: "2000-01-01"}}
	immichDayPicks.Unlock()
	spec := immichTestSpec(t, h, fake, WidgetTypeImmich, map[string]any{"source": "day"})
	if _, _, err := h.fetchImmichPhotos(context.Background(), spec, testImageURL); err != nil {
		t.Fatal(err)
	}
	immichDayPicks.Lock()
	defer immichDayPicks.Unlock()
	if len(immichDayPicks.at) != 1 {
		t.Errorf("picks = %v", immichDayPicks.at)
	}
}
