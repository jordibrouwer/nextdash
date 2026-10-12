package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const arrTestKey = "arr-key-0123456789"

type fakeArr struct {
	*httptest.Server
	mu        sync.Mutex
	calendar  string
	queue     string
	failQueue bool
	status    int
	paths     []string
}

func newFakeArr(t *testing.T) *fakeArr {
	t.Helper()
	fake := &fakeArr{}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.mu.Lock()
		fake.paths = append(fake.paths, r.URL.Path+"?"+r.URL.RawQuery)
		forced, calendar, queue, failQueue := fake.status, fake.calendar, fake.queue, fake.failQueue
		fake.mu.Unlock()
		if forced != 0 {
			w.WriteHeader(forced)
			return
		}
		if r.Header.Get("X-Api-Key") != arrTestKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.Path == "/api/v3/system/status":
			_, _ = w.Write([]byte(`{"appName":"Sonarr","version":"4.0.9"}`))
		case r.URL.Path == "/api/v3/calendar":
			_, _ = w.Write([]byte(calendar))
		case r.URL.Path == "/api/v3/queue":
			if failQueue {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			_, _ = w.Write([]byte(queue))
		case strings.HasPrefix(r.URL.Path, "/MediaCover/"):
			// What Sonarr does: the UI path answers the web page to an API key.
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<!doctype html>"))
		case strings.HasPrefix(r.URL.Path, "/api/v3/mediacover/"):
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(jellyfinTestPNG)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(fake.Close)
	return fake
}

func (f *fakeArr) saw(part string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.paths {
		if strings.Contains(p, part) {
			return true
		}
	}
	return false
}

var arrNow = time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)

func arrDay(days int) string { return arrNow.AddDate(0, 0, days).Format(time.RFC3339) }

func sonarrCalendar() string {
	return fmt.Sprintf(`[{"id":11,"seriesId":7,"seasonNumber":1,"episodeNumber":2,"title":"Pilot","airDateUtc":%q,
		"series":{"title":"Severance","titleSlug":"severance","year":2022,"overview":"Work and life, split.",
		"images":[{"coverType":"poster","url":"/MediaCover/7/poster.jpg?lastWrite=1"},{"coverType":"fanart","url":"/MediaCover/7/fanart.jpg?lastWrite=1"}]}}]`,
		arrDay(1))
}

const sonarrQueue = `{"records":[{"id":3,"title":"Severance.S01E03","size":1000,"sizeleft":250,"timeleft":"00:10:00",
	"series":{"title":"Severance","titleSlug":"severance","images":[{"coverType":"poster","url":"/MediaCover/7/poster.jpg?lastWrite=1"}]},
	"episode":{"seasonNumber":1,"episodeNumber":3,"title":"In Perpetuity"}}]}`

func arrTestSpec(t *testing.T, h *Handlers, fake *fakeArr, config map[string]any) arrSpec {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential("widget:w_arr000000001", HealthCredential{
		Label: "Sonarr", Headers: map[string]string{"X-Api-Key": arrTestKey},
	}); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_arr000000001"}
	for k, v := range config {
		full[k] = v
	}
	return arrSpecFrom(sanitizeWidgetConfig(WidgetTypeSonarr, full))
}

func TestArrSonarrCalendarAndQueue(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeArr(t)
	fake.calendar, fake.queue = sonarrCalendar(), sonarrQueue
	spec := arrTestSpec(t, h, fake, nil)

	result, images, err := h.fetchArr(context.Background(), arrSonarr, spec, arrNow, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Libraries) != 2 || result.Libraries[0].ID != "upcoming" || result.Libraries[1].ID != "queue" {
		t.Fatalf("groups = %+v", result.Libraries)
	}
	if len(result.Items) != 2 {
		t.Fatalf("items = %+v", result.Items)
	}
	upcoming, queued := result.Items[0], result.Items[1]
	if upcoming.LibraryID != "upcoming" {
		upcoming, queued = queued, upcoming
	}
	if upcoming.Title != "Severance" || upcoming.Subtitle != "S01E02 · Pilot" || upcoming.When != arrNow.AddDate(0, 0, 1).UnixMilli() {
		t.Errorf("upcoming = %+v", upcoming)
	}
	if upcoming.Poster != "/img/7/poster/1" || upcoming.Backdrop != "/img/7/backdrop/1" {
		t.Errorf("pictures = %q %q", upcoming.Poster, upcoming.Backdrop)
	}
	if upcoming.OpenURL != fake.URL+"/series/severance" {
		t.Errorf("openUrl = %q", upcoming.OpenURL)
	}
	if queued.Progress == nil || *queued.Progress != 0.75 || queued.Left != "00:10:00" || queued.Subtitle != "S01E03 · In Perpetuity" {
		t.Errorf("queued = %+v", queued)
	}
	if !images[mediaImageRef{Item: "7", Kind: "poster", Tag: "1"}] {
		t.Error("the poster was not offered to the proxy")
	}
	if !fake.saw("includeSeries=true") || !fake.saw("includeEpisode=true") {
		t.Error("series and episode were not asked for")
	}
}

// What a real Sonarr v4 calendar sends: the series' pictures carry only a
// remoteUrl (TVDB), no local /MediaCover address. The poster still comes
// from Sonarr's own MediaCover by series id -- never from the remote host.
func TestArrCalendarWithOnlyRemotePictures(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeArr(t)
	fake.calendar = fmt.Sprintf(`[{"id":21,"seriesId":9,"seasonNumber":2,"episodeNumber":2,"title":"Two","airDateUtc":%q,
		"series":{"id":9,"title":"CIA","titleSlug":"cia","images":[
			{"coverType":"poster","remoteUrl":"https://artworks.thetvdb.com/p/1.jpg"},
			{"coverType":"fanart","remoteUrl":"https://artworks.thetvdb.com/f/1.jpg"}]}}]`, arrDay(1))
	fake.queue = `{"records":[{"id":5,"seriesId":9,"size":10,"sizeleft":5,
		"series":{"id":9,"title":"CIA","titleSlug":"cia","images":[{"coverType":"poster","remoteUrl":"https://artworks.thetvdb.com/p/1.jpg"}]}}]}`
	spec := arrTestSpec(t, h, fake, nil)

	result, images, err := h.fetchArr(context.Background(), arrSonarr, spec, arrNow, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Items {
		if !strings.HasPrefix(item.Poster, "/img/9/poster/") {
			t.Errorf("%s: poster = %q", item.ID, item.Poster)
		}
		if strings.Contains(item.Poster, "thetvdb") {
			t.Errorf("%s: the remote address leaked into the proxy URL", item.ID)
		}
	}
	if len(images) == 0 {
		t.Fatal("no picture offered to the proxy")
	}
	var poster mediaImageRef
	for ref := range images {
		if ref.Kind == "poster" {
			poster = ref
		}
	}
	data, err := h.fetchArrImage(context.Background(), fake.URL, HealthCredential{Headers: map[string]string{"X-Api-Key": arrTestKey}}, poster)
	if err != nil || len(data) == 0 {
		t.Fatalf("poster from Sonarr: %v", err)
	}
	if !fake.saw("/api/v3/mediacover/9/poster-500.jpg") {
		t.Error("the poster was not asked of the API cover route")
	}
}

func TestArrRadarrSkipsMoviesOutsideTheWindow(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeArr(t)
	fake.calendar = fmt.Sprintf(`[
		{"id":1,"title":"Old","titleSlug":"old","year":2020,"inCinemas":"2020-01-01T00:00:00Z","images":[]},
		{"id":2,"title":"Soon","titleSlug":"soon","year":2026,"inCinemas":"2026-01-01T00:00:00Z","digitalRelease":%q,"images":[]}]`,
		arrDay(2))
	fake.queue = `{"records":[]}`
	spec := arrTestSpec(t, h, fake, map[string]any{"show": "upcoming"})

	result, _, err := h.fetchArr(context.Background(), arrRadarr, spec, arrNow, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].Title != "Soon" || result.Items[0].When != arrNow.AddDate(0, 0, 2).UnixMilli() {
		t.Fatalf("items = %+v", result.Items)
	}
	if result.Items[0].OpenURL != fake.URL+"/movie/soon" {
		t.Errorf("openUrl = %q", result.Items[0].OpenURL)
	}
	if fake.saw("/api/v3/queue") {
		t.Error("the queue was asked for although only upcoming is shown")
	}
}

func TestArrQueueWithUnknownSizeHasNoProgress(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeArr(t)
	fake.queue = `{"records":[{"id":4,"title":"x","size":0,"sizeleft":0,"movie":{"title":"Mystery","titleSlug":"mystery","images":[]}}]}`
	spec := arrTestSpec(t, h, fake, map[string]any{"show": "queue"})

	result, _, err := h.fetchArr(context.Background(), arrRadarr, spec, arrNow, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].Progress == nil || *result.Items[0].Progress != 0 {
		t.Fatalf("items = %+v", result.Items)
	}
	if _, err := json.Marshal(result); err != nil {
		t.Fatalf("the answer does not encode: %v", err)
	}
}

func TestArrPosterRefFollowsLastWrite(t *testing.T) {
	first, ok := arrPosterRef([]arrImage{{CoverType: "poster", URL: "/MediaCover/7/poster.jpg?lastWrite=1"}}, "poster")
	if !ok || first != (mediaImageRef{Item: "7", Kind: "poster", Tag: "1"}) {
		t.Fatalf("ref = %+v", first)
	}
	second, _ := arrPosterRef([]arrImage{{CoverType: "poster", URL: "/MediaCover/7/poster.jpg?lastWrite=2"}}, "poster")
	if second == first {
		t.Error("a new picture kept the old address")
	}
	if _, ok := arrPosterRef([]arrImage{{CoverType: "poster", URL: "https://elsewhere.example/MediaCover/7/poster.jpg"}}, "poster"); ok {
		t.Error("an address outside MediaCover was accepted")
	}
}

func TestArrHalfAnswerWhenQueueFails(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeArr(t)
	fake.calendar, fake.failQueue = sonarrCalendar(), true
	spec := arrTestSpec(t, h, fake, nil)

	result, _, err := h.fetchArr(context.Background(), arrSonarr, spec, arrNow, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Partial || len(result.Items) != 1 || result.Items[0].LibraryID != "upcoming" {
		t.Fatalf("result = %+v", result)
	}
}

func TestArrRefusedKey(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeArr(t)
	fake.status = http.StatusUnauthorized
	spec := arrTestSpec(t, h, fake, nil)

	_, _, err := h.fetchArr(context.Background(), arrSonarr, spec, arrNow, testImageURL)
	if mediaErrorCode(err) != "key refused" {
		t.Fatalf("code = %q (%v)", mediaErrorCode(err), err)
	}
}
