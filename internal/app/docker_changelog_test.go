package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(403) }))
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
