package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func dockerPost(router http.Handler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", path, nil))
	return rec
}

// The socket alone lets nextDash read. Nothing may reach the daemon's write
// side unless NEXTDASH_DOCKER_CONTROL=1 was set as well.
func TestDockerActionsNeedControl(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running"})
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
	router := newDockerTestRouter(dockerTestHandlers(t))
	rec := dockerPost(router, "/api/docker/containers/web/stop")
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), reasonDockerControlOff) {
		t.Fatalf("code = %d body = %s", rec.Code, rec.Body)
	}
	if f.called("POST /containers/") {
		t.Fatal("nothing may reach the daemon without control")
	}
}

func TestDockerActionsNeedWriteToken(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running"})
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	router := newDockerTestRouter(dockerTestHandlers(t))
	if rec := dockerPost(router, "/api/docker/containers/web/stop"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", rec.Code)
	}
	if f.called("POST /containers/") {
		t.Fatal("a request without the token must not reach the daemon")
	}
}

func TestDockerStopStartPause(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running"})
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	router := newDockerTestRouter(dockerTestHandlers(t))
	steps := []struct{ action, state string }{
		{"stop", "exited"}, {"start", "running"}, {"pause", "paused"}, {"unpause", "running"}, {"restart", "running"},
	}
	for _, step := range steps {
		rec := dockerPost(router, "/api/docker/containers/web/"+step.action)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"state":"`+step.state+`"`) {
			t.Fatalf("%s: code = %d body = %s", step.action, rec.Code, rec.Body)
		}
	}
}

func TestDockerUnknownActionIsRefused(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running"})
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	router := newDockerTestRouter(dockerTestHandlers(t))
	if rec := dockerPost(router, "/api/docker/containers/web/kill"); rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	if f.called("POST /containers/") {
		t.Fatal("an action outside the list must not reach the daemon")
	}
}

// Remove is for stopped containers only, and never takes the volumes with it:
// the data a container wrote outlives the container.
func TestDockerRemoveRefusesRunningAndKeepsVolumes(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running"})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "old", State: "exited"})
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	router := newDockerTestRouter(dockerTestHandlers(t))
	if rec := dockerPost(router, "/api/docker/containers/web/remove"); rec.Code != http.StatusConflict {
		t.Fatalf("running remove code = %d, want 409", rec.Code)
	}
	if rec := dockerPost(router, "/api/docker/containers/old/remove"); rec.Code != http.StatusOK {
		t.Fatalf("remove code = %d body = %s", rec.Code, rec.Body)
	}
	if !f.called("DELETE /containers/" + strings.Repeat("b", 64) + "?v=false") {
		t.Fatalf("remove must pass v=false; calls = %v", f.calls)
	}
}

// Stopping, pausing, restarting, removing or updating the container nextDash
// runs in would take the dashboard down halfway through the request asking
// for it.
func TestDockerSelfGuard(t *testing.T) {
	f := startFakeDocker(t)
	id := strings.Repeat("e", 64)
	f.add(fakeContainer{ID: id, Name: "nextdash", State: "running"})
	dockerSelfOverride = id[:12]
	t.Cleanup(func() { dockerSelfOverride = "" })
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	router := newDockerTestRouter(dockerTestHandlers(t))
	for _, action := range []string{"stop", "pause", "restart", "remove", "update"} {
		rec := dockerPost(router, "/api/docker/containers/nextdash/"+action)
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), reasonDockerSelf) {
			t.Fatalf("%s: code = %d body = %s", action, rec.Code, rec.Body)
		}
	}
	if f.called("POST /containers/") || f.called("DELETE /containers/") {
		t.Fatalf("the own container must never be touched; calls = %v", f.calls)
	}
}

func TestDockerLockRefusesSecondAction(t *testing.T) {
	h := dockerTestHandlers(t)
	release, ok := h.dockerLock("abc")
	if !ok {
		t.Fatal("first lock must succeed")
	}
	if _, ok := h.dockerLock("abc"); ok {
		t.Fatal("second lock on the same container must fail")
	}
	if other, ok := h.dockerLock("def"); !ok {
		t.Fatal("a lock on another container must not wait for this one")
	} else {
		other()
	}
	release()
	if again, ok := h.dockerLock("abc"); !ok {
		t.Fatal("lock must be free after release")
	} else {
		again()
	}
}

func TestDockerBusyContainerAnswers409(t *testing.T) {
	f := startFakeDocker(t)
	id := strings.Repeat("a", 64)
	f.add(fakeContainer{ID: id, Name: "web", State: "running"})
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	h := dockerTestHandlers(t)
	router := newDockerTestRouter(h)
	release, _ := h.dockerLock(id)
	defer release()
	if rec := dockerPost(router, "/api/docker/containers/web/stop"); rec.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409", rec.Code)
	}
}

// During an update the name moves to the new container's id; an action that
// resolves the name must still find the container busy.
func TestDockerLockCoversTheNameAcrossIDs(t *testing.T) {
	h := dockerTestHandlers(t)
	old := dockerContainerSummary{ID: strings.Repeat("a", 64), Names: []string{"/sonarr"}}
	replacement := dockerContainerSummary{ID: strings.Repeat("b", 64), Names: []string{"/sonarr"}}
	release, ok := h.dockerLockContainer(old)
	if !ok {
		t.Fatal("the first lock was refused")
	}
	if _, ok := h.dockerLockContainer(replacement); ok {
		t.Fatal("the same name under a new id was not busy")
	}
	release()
	if release, ok := h.dockerLockContainer(replacement); !ok {
		t.Fatal("still busy after release")
	} else {
		release()
	}
}
