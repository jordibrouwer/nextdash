package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const seerrTestKey = "seerr-key-0123456789"

// fakeSeerr answers from testdata/seerr: shapes recorded from a real server.
type fakeSeerr struct {
	*httptest.Server
	mu          sync.Mutex
	paths       []string
	inFlight    int
	maxInFlight int
	missing     map[string]bool // detail paths that answer 404
}

func readSeerrFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "seerr", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func newFakeSeerr(t *testing.T) *fakeSeerr {
	t.Helper()
	requests := readSeerrFixture(t, "request.json")
	movie := readSeerrFixture(t, "movie.json")
	tv := readSeerrFixture(t, "tv.json")
	users := readSeerrFixture(t, "user.json")
	status := readSeerrFixture(t, "status.json")
	public := readSeerrFixture(t, "settings-public.json")
	fake := &fakeSeerr{missing: map[string]bool{}}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.mu.Lock()
		fake.paths = append(fake.paths, r.URL.Path+"?"+r.URL.RawQuery)
		missing := fake.missing[r.URL.Path]
		fake.mu.Unlock()
		if r.URL.Path != "/api/v1/settings/public" && r.Header.Get("X-Api-Key") != seerrTestKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.Path == "/api/v1/request":
			_, _ = w.Write(requests)
		case r.URL.Path == "/api/v1/status":
			_, _ = w.Write(status)
		case r.URL.Path == "/api/v1/settings/public":
			_, _ = w.Write(public)
		case r.URL.Path == "/api/v1/user":
			_, _ = w.Write(users)
		case strings.HasPrefix(r.URL.Path, "/api/v1/movie/"), strings.HasPrefix(r.URL.Path, "/api/v1/tv/"):
			fake.mu.Lock()
			fake.inFlight++
			if fake.inFlight > fake.maxInFlight {
				fake.maxInFlight = fake.inFlight
			}
			fake.mu.Unlock()
			time.Sleep(20 * time.Millisecond)
			fake.mu.Lock()
			fake.inFlight--
			fake.mu.Unlock()
			if missing {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/v1/movie/") {
				_, _ = w.Write(movie)
			} else {
				_, _ = w.Write(tv)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(fake.Close)
	return fake
}

func (f *fakeSeerr) saw(part string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.paths {
		if strings.Contains(p, part) {
			return true
		}
	}
	return false
}

// seerrFixtureRequests is the recorded request list, read the way the client
// reads it, so tests can name what they expect without repeating the file.
func seerrFixtureRequests(t *testing.T) []seerrRequest {
	t.Helper()
	var page struct {
		Results []seerrRequest `json:"results"`
	}
	if err := json.Unmarshal(readSeerrFixture(t, "request.json"), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Results) < 3 {
		t.Fatalf("the fixture needs at least three requests, has %d", len(page.Results))
	}
	return page.Results
}

func seerrTestSpec(t *testing.T, h *Handlers, fake *fakeSeerr, config map[string]any) seerrSpec {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential("widget:w_seerr0000001", HealthCredential{
		Label: "Seerr", Headers: map[string]string{"X-Api-Key": seerrTestKey},
	}); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_seerr0000001", "rows": float64(20)}
	for k, v := range config {
		full[k] = v
	}
	return seerrSpecFrom(sanitizeWidgetConfig(WidgetTypeSeerr, full))
}

func TestSeerrListsRequestsWithDetails(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSeerr(t)
	spec := seerrTestSpec(t, h, fake, nil)
	want := seerrFixtureRequests(t)

	result, images, err := h.fetchSeerr(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != len(want) {
		t.Fatalf("%d items, fixture has %d requests", len(result.Items), len(want))
	}
	first := result.Items[0]
	if first.ID != "r"+seerrItoa(want[0].ID) || first.Title == "" || !strings.HasPrefix(first.Subtitle, "requested by ") {
		t.Errorf("first = %+v", first)
	}
	if !strings.HasPrefix(first.Poster, "/img/") || strings.Contains(first.Poster, "tmdb") {
		t.Errorf("poster = %q", first.Poster)
	}
	if !strings.Contains(first.OpenURL, fake.URL+"/"+want[0].Type+"/") {
		t.Errorf("openUrl = %q", first.OpenURL)
	}
	if len(images) == 0 {
		t.Error("no poster was offered to the proxy")
	}
	groups := map[string]bool{}
	for _, g := range result.Libraries {
		groups[g.ID] = true
	}
	if !groups["pending"] || !groups["approved"] || !groups["available"] {
		t.Errorf("groups = %+v", result.Libraries)
	}
}

func TestSeerrFiltersByTypeAndRequester(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSeerr(t)
	want := seerrFixtureRequests(t)

	spec := seerrTestSpec(t, h, fake, map[string]any{"mediaType": "movie"})
	result, _, err := h.fetchSeerr(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Items {
		if item.Kind != "movie" {
			t.Errorf("%s is %s with mediaType movie", item.ID, item.Kind)
		}
	}

	requester := seerrItoa(want[0].RequestedBy.ID)
	spec = seerrTestSpec(t, h, fake, map[string]any{"requestedBy": requester})
	result, _, _ = h.fetchSeerr(context.Background(), spec, testImageURL)
	for _, item := range result.Items {
		if !strings.Contains(item.Subtitle, want[0].RequestedBy.DisplayName) {
			t.Errorf("%s is someone else's request: %q", item.ID, item.Subtitle)
		}
	}
	if len(result.Items) == 0 {
		t.Error("the requester's own requests were filtered away")
	}

	spec = seerrTestSpec(t, h, fake, map[string]any{"status": "pending"})
	_, _, _ = h.fetchSeerr(context.Background(), spec, testImageURL)
	if !fake.saw("filter=pending") {
		t.Error("the status filter was not passed to Seerr")
	}
}

// With every status shown, each tab gets its own rows: the newest requests
// being all available must not leave the Approved tab empty while approved
// requests exist.
func TestSeerrGivesEveryStatusItsRows(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSeerr(t)
	spec := seerrTestSpec(t, h, fake, map[string]any{"rows": float64(1)})

	result, _, err := h.fetchSeerr(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]int{}
	for _, item := range result.Items {
		seen[item.LibraryID]++
	}
	if seen["approved"] != 1 || seen["available"] != 1 {
		t.Fatalf("per tab: %v (the recorded data holds approved and available requests)", seen)
	}
}

func TestSeerrKeepsARequestWhoseDetailsFail(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSeerr(t)
	want := seerrFixtureRequests(t)
	fake.missing["/api/v1/"+want[0].Type+"/"+seerrItoa(want[0].Media.TmdbID)] = true
	spec := seerrTestSpec(t, h, fake, nil)

	result, _, err := h.fetchSeerr(context.Background(), spec, testImageURL)
	if err != nil {
		t.Fatal(err)
	}
	var found *MediaItem
	for i := range result.Items {
		if result.Items[i].ID == "r"+seerrItoa(want[0].ID) {
			found = &result.Items[i]
		}
	}
	if found == nil || found.Title != "Request #"+seerrItoa(want[0].ID) || found.Poster != "" {
		t.Fatalf("the request without details: %+v", found)
	}
}

func TestSeerrAsksForDetailsFourAtATime(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSeerr(t)
	spec := seerrTestSpec(t, h, fake, nil)
	if _, _, err := h.fetchSeerr(context.Background(), spec, testImageURL); err != nil {
		t.Fatal(err)
	}
	if fake.maxInFlight > 4 {
		t.Errorf("%d detail requests at once", fake.maxInFlight)
	}
}

func TestTMDBImageRefRefusesAnythingButAFileName(t *testing.T) {
	if ref, ok := tmdbImageRef("/kqjL17yufvn9OVLyXYpvtyrFfak.jpg", "poster"); !ok || ref.Item != "kqjL17yufvn9OVLyXYpvtyrFfak.jpg" {
		t.Fatalf("a TMDB path was refused: %+v", ref)
	}
	for _, bad := range []string{"", "/../x.jpg", "https://evil.example/x.jpg", "/a/b.jpg", "/x.svg", "x.jpg?y=1"} {
		if _, ok := tmdbImageRef(bad, "poster"); ok {
			t.Errorf("%q was accepted", bad)
		}
	}
}

func TestSeerrPostersComeFromTMDBWithoutTheKey(t *testing.T) {
	var sawKey bool
	var sawPath string
	tmdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawKey = r.Header.Get("X-Api-Key") != "" || r.Header.Get("Authorization") != ""
		sawPath = r.URL.Path
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(jellyfinTestPNG)
	}))
	defer tmdb.Close()
	old := tmdbImageBase
	tmdbImageBase = tmdb.URL
	defer func() { tmdbImageBase = old }()

	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	data, err := h.fetchTMDBImage(context.Background(), "http://seerr.lan", HealthCredential{Headers: map[string]string{"X-Api-Key": seerrTestKey}},
		mediaImageRef{Item: "abc.jpg", Kind: "poster", Tag: "abc.jpg"})
	if err != nil || len(data) == 0 {
		t.Fatalf("poster: %v", err)
	}
	if sawKey {
		t.Error("the Seerr key went to TMDB")
	}
	if sawPath != "/t/p/w342/abc.jpg" {
		t.Errorf("path = %q", sawPath)
	}
}

func TestSeerrSetupNamesTheServerAndItsUsers(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeSeerr(t)
	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"X-Api-Key":"` + seerrTestKey + `"}}}`

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	rec := httptest.NewRecorder()
	h.seerrSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/seerr/setup", strings.NewReader(body)))
	if rec.Code != http.StatusUnauthorized || fake.saw("/api/v1/status") {
		t.Fatalf("no token: %d", rec.Code)
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	rec = httptest.NewRecorder()
	h.seerrSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/seerr/setup", strings.NewReader(body)))
	var answer struct {
		ServerName string         `json:"serverName"`
		Version    string         `json:"version"`
		Users      []JellyfinUser `json:"users"`
		Error      string         `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &answer)
	if answer.Error != "" || answer.ServerName == "" || answer.Version == "" || len(answer.Users) == 0 {
		t.Fatalf("answer = %+v (%s)", answer, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), seerrTestKey) {
		t.Error("the key came back")
	}
}

func TestSeerrRoutes(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSeerr(t)
	seerrTestSpec(t, h, fake, nil)
	widget := Widget{ID: "w_seerr0000001", Type: WidgetTypeSeerr, Config: map[string]any{
		"server": fake.URL, "credentialId": "widget:w_seerr0000001"}}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()

	rec := httptest.NewRecorder()
	h.seerrWidgetHandler(rec, httptest.NewRequest(http.MethodGet, "/api/widgets/seerr?pageId=1&id="+widget.ID, nil))
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), seerrTestKey) || strings.Contains(rec.Body.String(), "image.tmdb.org") {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var result MediaResult
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	if len(result.Items) == 0 || !strings.HasPrefix(result.Items[0].Poster, "/api/widgets/seerr/image?") {
		t.Fatalf("result = %+v", result)
	}
	bad := httptest.NewRecorder()
	h.seerrImageHandler(bad, httptest.NewRequest(http.MethodGet, "/api/widgets/seerr/image?pageId=1&id="+widget.ID+"&item=other.jpg&kind=poster&tag=other.jpg", nil))
	if bad.Code != http.StatusNotFound {
		t.Errorf("an unoffered poster answered %d", bad.Code)
	}
}

func seerrItoa(n int) string { return strconv.Itoa(n) }
