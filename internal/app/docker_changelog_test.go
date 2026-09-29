package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

// resetChangelogCache clears the package-level cache between tests: it is a
// sync.Map shared by the whole test binary, so one test's fetch would
// otherwise answer the next test's request too.
func resetChangelogCache() {
	changelogCache.Range(func(k, _ any) bool {
		changelogCache.Delete(k)
		return true
	})
}

// newChangelogTestRouter mirrors newDockerTestRouter's one new route.
// docker_fake_test.go is owned by another task in this plan, so the route
// lives here until it is folded into main.go and that shared router.
func newChangelogTestRouter(h *Handlers) http.Handler {
	r := mux.NewRouter()
	r.HandleFunc("/api/docker/containers/{id}/changelog", h.DockerChangelogHandler).Methods("GET")
	return r
}

func TestGithubRepoFromSource(t *testing.T) {
	for in, want := range map[string]string{
		"https://github.com/linuxserver/docker-sonarr": "linuxserver/docker-sonarr",
		"https://github.com/jordibrouwer/nextDash.git": "jordibrouwer/nextDash",
		"git@github.com:owner/repo.git":                "",
		"https://gitlab.com/a/b":                       "",
	} {
		o, r, ok := githubRepoFromSource(in)
		if (want == "") == ok || (ok && o+"/"+r != want) {
			t.Fatalf("%q -> %s/%s %v", in, o, r, ok)
		}
	}
}

func TestReleasesBetween(t *testing.T) {
	all := []dockerGithubRelease{{Tag: "v4.0.11"}, {Tag: "v4.0.10"}, {Tag: "v4.0.9"}, {Tag: "v4.0.8"}}
	got := releasesBetween(all, "4.0.9")
	if len(got) != 2 || got[0].Tag != "v4.0.11" || got[1].Tag != "v4.0.10" {
		t.Fatalf("got %+v", got)
	}
	if got := releasesBetween(all, ""); len(got) != 3 {
		t.Fatalf("no version: want newest 3, got %d", len(got))
	}
	if got := releasesBetween(all, "unknown-build"); len(got) != 3 {
		t.Fatalf("unmatched version: want newest 3, got %d", len(got))
	}
}

func TestChangelogRouteFallsBackToLinksOnRateLimit(t *testing.T) {
	resetChangelogCache()
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.WriteHeader(403)
	}))
	defer gh.Close()
	old := dockerGitHubBase
	dockerGitHubBase = gh.URL
	t.Cleanup(func() { dockerGitHubBase = old })
	oldClient := dockerGitHubClient
	dockerGitHubClient = gh.Client()
	t.Cleanup(func() { dockerGitHubClient = oldClient })

	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "linuxserver/sonarr:latest",
		ImageID: "sha256:running", State: "running"})
	f.images["sha256:running"] = fakeImage{ID: "sha256:running", Labels: map[string]string{
		"org.opencontainers.image.source": "https://github.com/linuxserver/docker-sonarr"}}
	router := newChangelogTestRouter(dockerTestHandlers(t))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/sonarr/changelog", nil))
	var cl dockerChangelog
	json.NewDecoder(rec.Body).Decode(&cl)
	if cl.Reason != "rate-limited" || len(cl.Links) < 2 {
		t.Fatalf("changelog = %+v", cl)
	}
	if cl.Links[1].URL != "https://hub.docker.com/r/linuxserver/sonarr" {
		t.Fatalf("registry link = %q", cl.Links[1].URL)
	}
}

// TestChangelogRouteListsReleasesSinceRunningVersion anchors on the running
// container's image (id sha256:running, version 4.0.9), not the tag: the tag
// already points at whatever was last pulled, but "what's new" has to compare
// against what is actually running. It also proves the 24h cache: a second
// request must not hit the fake GitHub server again.
func TestChangelogRouteListsReleasesSinceRunningVersion(t *testing.T) {
	resetChangelogCache()
	var hits int
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[
			{"tag_name":"v4.0.11","name":"4.0.11","body":"eleven","html_url":"https://github.com/linuxserver/docker-sonarr/releases/tag/v4.0.11","published_at":"2026-09-20T00:00:00Z"},
			{"tag_name":"v4.0.10","name":"4.0.10","body":"ten","html_url":"https://github.com/linuxserver/docker-sonarr/releases/tag/v4.0.10","published_at":"2026-08-20T00:00:00Z"},
			{"tag_name":"v4.0.9","name":"4.0.9","body":"nine","html_url":"https://github.com/linuxserver/docker-sonarr/releases/tag/v4.0.9","published_at":"2026-07-20T00:00:00Z"},
			{"tag_name":"v4.0.8","name":"4.0.8","body":"eight","html_url":"https://github.com/linuxserver/docker-sonarr/releases/tag/v4.0.8","published_at":"2026-06-20T00:00:00Z"}
		]`))
	}))
	defer gh.Close()
	old := dockerGitHubBase
	dockerGitHubBase = gh.URL
	t.Cleanup(func() { dockerGitHubBase = old })
	oldClient := dockerGitHubClient
	dockerGitHubClient = gh.Client()
	t.Cleanup(func() { dockerGitHubClient = oldClient })

	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "linuxserver/sonarr:latest",
		ImageID: "sha256:running", State: "running"})
	f.images["sha256:running"] = fakeImage{ID: "sha256:running", Labels: map[string]string{
		"org.opencontainers.image.version": "4.0.9",
		"org.opencontainers.image.source":  "https://github.com/linuxserver/docker-sonarr"}}
	router := newChangelogTestRouter(dockerTestHandlers(t))

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/sonarr/changelog", nil))
	var cl dockerChangelog
	json.NewDecoder(rec.Body).Decode(&cl)
	if cl.Current != "4.0.9" || len(cl.Releases) != 2 || cl.Releases[0].Tag != "v4.0.11" || cl.Releases[1].Tag != "v4.0.10" {
		t.Fatalf("changelog = %+v", cl)
	}
	var hasSource, hasRegistry bool
	for _, l := range cl.Links {
		if l.Kind == "source" {
			hasSource = true
		}
		if l.Kind == "registry" {
			hasRegistry = true
		}
	}
	if !hasSource || !hasRegistry {
		t.Fatalf("links = %+v", cl.Links)
	}

	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, httptest.NewRequest("GET", "/api/docker/containers/sonarr/changelog", nil))
	var cl2 dockerChangelog
	json.NewDecoder(rec2.Body).Decode(&cl2)
	if len(cl2.Releases) != 2 {
		t.Fatalf("second call changelog = %+v", cl2)
	}
	if hits != 1 {
		t.Fatalf("github hit %d times, want 1 (cache)", hits)
	}
}

// changelogGitHub serves releases from body and counts the requests.
func changelogGitHub(t *testing.T, status int, headers map[string]string, body string) *int {
	t.Helper()
	resetChangelogCache()
	hits := 0
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		for k, v := range headers {
			w.Header().Set(k, v)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(gh.Close)
	old, oldClient := dockerGitHubBase, dockerGitHubClient
	dockerGitHubBase, dockerGitHubClient = gh.URL, gh.Client()
	t.Cleanup(func() { dockerGitHubBase, dockerGitHubClient = old, oldClient })
	return &hits
}

func changelogFor(t *testing.T, router http.Handler, name string) dockerChangelog {
	t.Helper()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/"+name+"/changelog", nil))
	var cl dockerChangelog
	_ = json.NewDecoder(rec.Body).Decode(&cl)
	return cl
}

// A 403 with requests left is GitHub turning the token down, not a limit.
func TestChangelogRouteNamesARefusedToken(t *testing.T) {
	changelogGitHub(t, 403, map[string]string{"X-RateLimit-Remaining": "4999"}, `{"message":"Bad credentials"}`)
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "linuxserver/sonarr:latest",
		ImageID: "sha256:running", State: "running"})
	f.images["sha256:running"] = fakeImage{ID: "sha256:running", Labels: map[string]string{
		"org.opencontainers.image.source": "https://github.com/linuxserver/docker-sonarr"}}
	if cl := changelogFor(t, newChangelogTestRouter(dockerTestHandlers(t)), "sonarr"); cl.Reason != "auth-failed" {
		t.Fatalf("reason = %q, want auth-failed", cl.Reason)
	}
}

// One repo, two containers: the one on a prerelease sees prereleases, the one
// on a stable version does not, whichever asked first. And a list fetched
// before the last update check is fetched again: the check may have found a
// release it does not have.
func TestChangelogCacheKeepsPrereleasesApartAndFollowsTheCheck(t *testing.T) {
	hits := changelogGitHub(t, 200, map[string]string{"Content-Type": "application/json"}, `[
		{"tag_name":"v5.0.0-beta2","prerelease":true},
		{"tag_name":"v5.0.0-beta1","prerelease":true},
		{"tag_name":"v4.0.10"},
		{"tag_name":"v4.0.9"}
	]`)
	f := startFakeDocker(t)
	src := "https://github.com/linuxserver/docker-sonarr"
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "stable", Image: "sonarr:latest", ImageID: "sha256:s", State: "running"})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "beta", Image: "sonarr:develop", ImageID: "sha256:b", State: "running"})
	f.images["sha256:s"] = fakeImage{ID: "sha256:s", Labels: map[string]string{
		"org.opencontainers.image.version": "4.0.9", "org.opencontainers.image.source": src}}
	f.images["sha256:b"] = fakeImage{ID: "sha256:b", Labels: map[string]string{
		"org.opencontainers.image.version": "5.0.0-beta1", "org.opencontainers.image.source": src}}
	router := newChangelogTestRouter(dockerTestHandlers(t))

	if cl := changelogFor(t, router, "stable"); len(cl.Releases) != 1 || cl.Releases[0].Tag != "v4.0.10" {
		t.Fatalf("stable = %+v", cl.Releases)
	}
	if cl := changelogFor(t, router, "beta"); len(cl.Releases) != 1 || cl.Releases[0].Tag != "v5.0.0-beta2" {
		t.Fatalf("beta = %+v", cl.Releases)
	}
	if *hits != 2 {
		t.Fatalf("github hit %d times, want 2", *hits)
	}
	changelogFor(t, router, "stable")
	if *hits != 2 {
		t.Fatalf("a fresh list was fetched again: %d", *hits)
	}
	if err := writeIndentJSONFile(dockerUpdatesFilePath(), dockerUpdateStore{CheckedAt: time.Now().Add(time.Second).UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	changelogFor(t, router, "stable")
	if *hits != 3 {
		t.Fatalf("a list older than the last check was served from the cache: %d hits", *hits)
	}
}

// Every error a docker route writes is JSON, and says so.
func TestDockerErrorsAreJSON(t *testing.T) {
	startFakeDocker(t)
	rec := httptest.NewRecorder()
	newDockerTestRouter(dockerTestHandlers(t)).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/nobody", nil))
	// Result: the headers as they were when the status went out.
	if got := rec.Result().Header.Get("Content-Type"); rec.Code != 404 || got != "application/json" {
		t.Fatalf("%d %q", rec.Code, got)
	}
}
