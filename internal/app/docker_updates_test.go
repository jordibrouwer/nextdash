package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func withTestRegistry(t *testing.T, handler http.HandlerFunc) string {
	t.Helper()
	reg := httptest.NewServer(handler)
	t.Cleanup(reg.Close)
	old := dockerRegistry
	dockerRegistry = &registryLookup{client: reg.Client(), scheme: "http"}
	t.Cleanup(func() { dockerRegistry = old })
	return strings.TrimPrefix(reg.URL, "http://")
}

func TestDockerUpdateCheckMarksAvailableAndKeepsOldOnFailure(t *testing.T) {
	status := http.StatusOK
	host := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		w.Header().Set("Docker-Content-Digest", "sha256:new")
	})
	f := startFakeDocker(t)
	ref := host + "/app:1"
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", Image: ref, State: "running"})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "local", Image: "built-here:dev", State: "running"})
	f.images[ref] = fakeImage{ID: "sha256:img", RepoDigests: []string{host + "/app@sha256:old"}}
	f.images["built-here:dev"] = fakeImage{ID: "sha256:local"}

	h := dockerTestHandlers(t)
	store, err := h.runDockerUpdateCheck(context.Background())
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if u := store.Images[ref]; u == nil || u.Status != "available" || u.LocalDigest != "sha256:old" || u.RemoteDigest != "sha256:new" {
		t.Fatalf("update = %+v", u)
	}
	// A locally built image has nothing to compare against: unknown, never current.
	if u := store.Images["built-here:dev"]; u == nil || u.Status != "unknown" || u.Reason != "no-digest" {
		t.Fatalf("local image = %+v", u)
	}

	status = http.StatusTooManyRequests
	store, _ = h.runDockerUpdateCheck(context.Background())
	if u := store.Images[ref]; u.Status != "available" || u.Reason != "rate-limited" {
		t.Fatalf("a busy registry must not erase what was known: %+v", u)
	}
	if _, err := os.Stat(dockerUpdatesFilePath()); err != nil {
		t.Fatalf("store not written: %v", err)
	}
	if snap := h.dockerUpdateSnapshot(); snap[ref] == nil || snap[ref].Status != "available" {
		t.Fatalf("snapshot = %+v", snap)
	}
}

func TestDockerUpdateCheckCurrentAndForgetsRemovedImages(t *testing.T) {
	host := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Content-Digest", "sha256:same")
	})
	f := startFakeDocker(t)
	ref := host + "/app:1"
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", Image: ref, State: "running"})
	f.images[ref] = fakeImage{ID: "sha256:img", RepoDigests: []string{host + "/app@sha256:same"}}
	h := dockerTestHandlers(t)
	store, _ := h.runDockerUpdateCheck(context.Background())
	if store.Images[ref].Status != "current" {
		t.Fatalf("update = %+v", store.Images[ref])
	}
	delete(f.containers, strings.Repeat("a", 64))
	store, _ = h.runDockerUpdateCheck(context.Background())
	if _, ok := store.Images[ref]; ok {
		t.Fatal("an image no container uses must drop out of the store")
	}
}

func TestDockerUpdateInterval(t *testing.T) {
	cases := map[string]time.Duration{"off": 0, "6h": 6 * time.Hour, "12h": 12 * time.Hour, "24h": 24 * time.Hour, "5m": 0, "": 0}
	for in, want := range cases {
		if got := dockerUpdateIntervalDuration(in); got != want {
			t.Fatalf("%q = %v, want %v", in, got, want)
		}
	}
}

// Checking changes no container, so it needs the socket but not
// NEXTDASH_DOCKER_CONTROL.
func TestDockerUpdateCheckRouteNeedsNoControl(t *testing.T) {
	withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {})
	startFakeDocker(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
	router := newDockerTestRouter(dockerTestHandlers(t))
	if rec := dockerPost(router, "/api/docker/updates/check"); rec.Code != http.StatusOK {
		t.Fatalf("code = %d body = %s", rec.Code, rec.Body)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/updates", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"checkedAt"`) {
		t.Fatalf("GET updates: code = %d body = %s", rec.Code, rec.Body)
	}
}

func TestDockerSchedulerRespectsIntervalAndLastCheck(t *testing.T) {
	calls := 0
	host := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Docker-Content-Digest", "sha256:x")
	})
	f := startFakeDocker(t)
	ref := host + "/app:1"
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", Image: ref, State: "running"})
	f.images[ref] = fakeImage{ID: "sha256:img", RepoDigests: []string{host + "/app@sha256:x"}}
	h := dockerTestHandlers(t)

	h.maybeRunDockerUpdateCheck()
	if calls != 0 {
		t.Fatal("interval off must not check")
	}
	s := h.store.GetSettings()
	s.DockerUpdateInterval = "6h"
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	h.maybeRunDockerUpdateCheck()
	if calls != 1 {
		t.Fatalf("first due check: calls = %d, want 1", calls)
	}
	h.maybeRunDockerUpdateCheck()
	if calls != 1 {
		t.Fatalf("a check inside the interval must wait: calls = %d", calls)
	}
}

func TestDockerMetricsCountUpdates(t *testing.T) {
	host := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Content-Digest", "sha256:new")
	})
	f := startFakeDocker(t)
	ref := host + "/app:1"
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", Image: ref, State: "running"})
	f.images[ref] = fakeImage{ID: "sha256:img", RepoDigests: []string{host + "/app@sha256:old"}}
	h := dockerTestHandlers(t)
	if _, err := h.runDockerUpdateCheck(context.Background()); err != nil {
		t.Fatalf("check: %v", err)
	}
	if got := readDocker(); got.Updates != 1 {
		t.Fatalf("widget updates = %d, want 1", got.Updates)
	}
}

// An update that went through is current at once: the badge must not wait for
// the next check to notice what the update itself just did.
func TestDockerUpdateMarksImageCurrent(t *testing.T) {
	host := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Content-Digest", "sha256:new")
	})
	f := startFakeDocker(t)
	ref := host + "/app:1"
	id := strings.Repeat("a", 64)
	f.add(fakeContainer{ID: id, Name: "web", Image: ref, ImageID: "sha256:old", State: "running"})
	f.images[ref] = fakeImage{ID: "sha256:old", RepoDigests: []string{host + "/app@sha256:old"}}
	f.images[ref+"@new"] = fakeImage{ID: "sha256:newimg", RepoDigests: []string{host + "/app@sha256:new"}}
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	h := dockerTestHandlers(t)
	if _, err := h.runDockerUpdateCheck(context.Background()); err != nil {
		t.Fatalf("check: %v", err)
	}
	if h.dockerUpdateSnapshot()[ref].Status != "available" {
		t.Fatal("setup: expected an update to be available")
	}
	router := newDockerTestRouter(h)
	if rec := dockerPost(router, "/api/docker/containers/web/update"); rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	if u := h.dockerUpdateSnapshot()[ref]; u == nil || u.Status != "current" {
		t.Fatalf("after update = %+v, want current", u)
	}
}

// An update that finishes while a check runs keeps its result: the check read
// the old state, and writing that back would bring the badge back for a day.
func TestDockerUpdateCheckKeepsAnUpdateThatFinishedDuringIt(t *testing.T) {
	var h *Handlers
	var ref string
	during := false
	host := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		if during {
			h.markDockerImageCurrent(ref)
		}
		w.Header().Set("Docker-Content-Digest", "sha256:new")
	})
	f := startFakeDocker(t)
	ref = host + "/app:1"
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", Image: ref, State: "running"})
	f.images[ref] = fakeImage{ID: "sha256:img", RepoDigests: []string{host + "/app@sha256:old"}}

	h = dockerTestHandlers(t)
	if _, err := h.runDockerUpdateCheck(context.Background()); err != nil {
		t.Fatalf("check: %v", err)
	}
	during = true
	store, err := h.runDockerUpdateCheck(context.Background())
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if u := store.Images[ref]; u == nil || u.Status != "current" {
		t.Fatalf("the finished update was overwritten: %+v", u)
	}
}
