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

// One image can carry two digests for one repo. When the registry's digest is
// either of them, the image is current, whichever the daemon lists first.
func TestDockerUpdateCheckMatchesAnyLocalDigest(t *testing.T) {
	host := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Content-Digest", "sha256:bbb")
	})
	f := startFakeDocker(t)
	ref := host + "/app:1"
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", Image: ref, State: "running"})
	f.images[ref] = fakeImage{ID: "sha256:img", RepoDigests: []string{host + "/app@sha256:aaa", host + "/app@sha256:bbb"}}
	h := dockerTestHandlers(t)
	store, _ := h.runDockerUpdateCheck(context.Background())
	if u := store.Images[ref]; u == nil || u.Status != "current" || u.LocalDigest != "sha256:bbb" {
		t.Fatalf("update = %+v, want current on the matching digest", u)
	}
}

// One image reference, two hosts, two answers: the remote host's results are
// its own and never touch the local file.
func TestUpdateCheckOnARemoteHostKeepsItsOwnResults(t *testing.T) {
	hostsTestDir(t)
	reg := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Content-Digest", "sha256:new")
	})
	ref := reg + "/app:1"
	local := startFakeDocker(t)
	local.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", Image: ref, State: "running"})
	local.images[ref] = fakeImage{ID: "sha256:img-l", RepoDigests: []string{reg + "/app@sha256:new"}} // up to date
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "web", Image: ref, State: "running"})
	remote.images[ref] = fakeImage{ID: "sha256:img-r", RepoDigests: []string{reg + "/app@sha256:old"}} // behind
	h := dockerTestHandlers(t)
	host := addRemoteHost(t, addr, false)

	if _, err := h.runDockerUpdateCheck(context.Background()); err != nil {
		t.Fatal(err)
	}
	store, err := h.runDockerUpdateCheckOn(context.Background(), host.ID)
	if err != nil {
		t.Fatal(err)
	}
	if u := store.Images[ref]; u == nil || u.Status != "available" || u.LocalDigest != "sha256:old" {
		t.Fatalf("remote result = %+v", u)
	}
	if u := h.dockerUpdateSnapshot()[ref]; u == nil || u.Status != "current" {
		t.Fatalf("the remote check changed the local answer: %+v", u)
	}
	if _, err := os.Stat(dockerUpdatesPathFor(host.ID)); err != nil {
		t.Fatalf("remote file: %v", err)
	}
	if got := h.dockerUpdateSnapshotFor(host.ID)[ref]; got == nil || got.Status != "available" {
		t.Fatalf("snapshot for the host = %+v", got)
	}
}

func TestUpdateRoutesFollowTheHostAndTheListCarriesTheBadge(t *testing.T) {
	hostsTestDir(t)
	h := dockerTestHandlers(t)
	router := newDockerTestRouter(h)
	reg := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Content-Digest", "sha256:new")
	})
	ref := reg + "/app:1"
	startFakeDocker(t)
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "web", Image: ref, State: "running"})
	remote.images[ref] = fakeImage{ID: "sha256:img-r", RepoDigests: []string{reg + "/app@sha256:old"}}
	host := addRemoteHost(t, addr, false)

	rec := hostsCall(t, router, "POST", "/api/docker/updates/check?host="+host.ID, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("check on a remote host: %d %s", rec.Code, rec.Body)
	}
	_, body := getJSON(t, router, "/api/docker/containers?host="+host.ID)
	row := body["containers"].([]any)[0].(map[string]any)
	if u, _ := row["update"].(map[string]any); u == nil || u["status"] != "available" {
		t.Fatalf("remote row update = %v", row["update"])
	}
	// The local list does not know that image.
	_, local := getJSON(t, router, "/api/docker/updates")
	if images, _ := local["images"].(map[string]any); images[ref] != nil {
		t.Errorf("local store holds the remote result: %v", images)
	}
	if rec := hostsCall(t, router, "POST", "/api/docker/updates/check?host=d_nope", "", ""); rec.Code != http.StatusNotFound {
		t.Errorf("unknown host = %d", rec.Code)
	}
}

func TestRemoteChecksDoNotHoldEachOtherOff(t *testing.T) {
	h := dockerTestHandlers(t)
	doneLocal, ok := h.beginDockerCheck(dockerLocalHostID)
	if !ok {
		t.Fatal("local refused")
	}
	defer doneLocal()
	doneRemote, ok := h.beginDockerCheck("d_aaaaaaaaaaaa")
	if !ok {
		t.Fatal("a running local check held a remote one off")
	}
	if _, ok := h.beginDockerCheck("d_aaaaaaaaaaaa"); ok {
		t.Error("two checks ran on one remote host")
	}
	doneRemote()
	if _, ok := h.beginDockerCheck("d_aaaaaaaaaaaa"); !ok {
		t.Error("the remote flag was not released")
	}
}

func TestSchedulerChecksARemoteHostOnTheSameIntervalButNotEveryTick(t *testing.T) {
	hostsTestDir(t)
	h := dockerTestHandlers(t)
	reg := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Docker-Content-Digest", "sha256:new")
	})
	ref := reg + "/app:1"
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "") // no local daemon: only the remote one is checked
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "web", Image: ref, State: "running"})
	remote.images[ref] = fakeImage{ID: "sha256:img-r", RepoDigests: []string{reg + "/app@sha256:old"}}
	host := addRemoteHost(t, addr, false)
	s := h.store.GetSettings()
	s.DockerUpdateInterval = "6h"
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}

	h.maybeRunDockerUpdateCheck()
	if h.dockerUpdateSnapshotFor(host.ID)[ref] == nil {
		t.Fatal("the scheduler did not check the remote host")
	}
	first := readDockerUpdateStoreAt(dockerUpdatesPathFor(host.ID)).CheckedAt
	h.maybeRunDockerUpdateCheck()
	if again := readDockerUpdateStoreAt(dockerUpdatesPathFor(host.ID)).CheckedAt; again != first {
		t.Error("a fresh result was checked again")
	}
}

func TestRemovingAHostDeletesItsUpdateResults(t *testing.T) {
	hostsTestDir(t)
	host, err := addDockerHost(DockerHost{Name: "pi", Kind: "tcp", Address: "10.0.0.2:2375"}, dockerHostSecretUpdate{})
	if err != nil {
		t.Fatal(err)
	}
	if err := writeIndentJSONFile(dockerUpdatesPathFor(host.ID), dockerUpdateStore{CheckedAt: 1}); err != nil {
		t.Fatal(err)
	}
	if err := removeDockerHost(host.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dockerUpdatesPathFor(host.ID)); !os.IsNotExist(err) {
		t.Error("the removed host's update results stayed")
	}
	if p, ok := dataFilePolicyOf("docker-updates-" + host.ID + ".json"); !ok || p != dataNever {
		t.Errorf("backup policy = %v %v", p, ok)
	}
}

// Removed while its check runs: the results must not come back as a file.
func TestRemovingAHostDuringItsCheckLeavesNoFile(t *testing.T) {
	hostsTestDir(t)
	var removeNow func()
	reg := withTestRegistry(t, func(w http.ResponseWriter, r *http.Request) {
		if removeNow != nil {
			removeNow()
		}
		w.Header().Set("Docker-Content-Digest", "sha256:new")
	})
	ref := reg + "/app:1"
	remote, addr := startFakeDockerTCP(t)
	remote.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "web", Image: ref, State: "running"})
	remote.images[ref] = fakeImage{ID: "sha256:img-r", RepoDigests: []string{reg + "/app@sha256:old"}}
	h := dockerTestHandlers(t)
	host := addRemoteHost(t, addr, false)
	removeNow = func() { _ = removeDockerHost(host.ID) }

	if _, err := h.runDockerUpdateCheckOn(context.Background(), host.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dockerUpdatesPathFor(host.ID)); !os.IsNotExist(err) {
		t.Fatal("a removed host's results were written after all")
	}
}

func TestSchedulerPrunesResultsOfHostsThatAreGone(t *testing.T) {
	hostsTestDir(t)
	h := dockerTestHandlers(t)
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	s := h.store.GetSettings()
	s.DockerUpdateInterval = "6h"
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	orphan := dockerUpdatesPathFor("d_aaaaaaaaaaaa")
	if err := writeIndentJSONFile(orphan, dockerUpdateStore{CheckedAt: 1}); err != nil {
		t.Fatal(err)
	}
	h.maybeRunDockerUpdateCheck()
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Error("the orphaned results stayed")
	}
}
