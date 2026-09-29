package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// An update fixture with versions and digests on both images, so the history
// and the skip have something to name.
func rollbackFixture(t *testing.T) (*fakeDocker, *Handlers) {
	t.Helper()
	f, _, _, _ := recreateFixture(t)
	f.images["img:latest"] = fakeImage{ID: "sha256:old", RepoDigests: []string{"img@sha256:olddigest"},
		Labels: map[string]string{"org.opencontainers.image.version": "4.0.9"}}
	f.images["img:latest@new"] = fakeImage{ID: "sha256:new", RepoDigests: []string{"img@sha256:newdigest"},
		Labels: map[string]string{"org.opencontainers.image.version": "4.0.10"}}
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	return f, dockerTestHandlers(t)
}

func dockerDetail(t *testing.T, h *Handlers, name string) dockerViewDetail {
	t.Helper()
	rec := httptest.NewRecorder()
	newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/"+name, nil))
	var d dockerViewDetail
	_ = json.NewDecoder(rec.Body).Decode(&d)
	return d
}

// An update is written down; rolling it back tags the previous image as the
// reference again, recreates the container on it, writes that down too, and
// skips the version it came back from so it is not offered straight away.
func TestDockerUpdateHistoryAndRollback(t *testing.T) {
	f, h := rollbackFixture(t)
	router := newDockerTestRouter(h)
	if rec := dockerPost(router, "/api/docker/containers/sonarr/update"); rec.Code != 200 {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	d := dockerDetail(t, h, "sonarr")
	if len(d.UpdateHistory) != 1 {
		t.Fatalf("history = %+v", d.UpdateHistory)
	}
	e := d.UpdateHistory[0]
	if e.Kind != "update" || e.FromImageID != "sha256:old" || e.ToImageID != "sha256:new" || e.FromVersion != "4.0.9" || e.ToVersion != "4.0.10" {
		t.Fatalf("entry = %+v", e)
	}
	if d.Rollback == nil || d.Rollback.ToVersion != "4.0.9" {
		t.Fatalf("rollback = %+v", d.Rollback)
	}

	rec := dockerPost(router, "/api/docker/containers/sonarr/rollback")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"phase":"done"`) {
		t.Fatalf("rollback: %d %s", rec.Code, rec.Body)
	}
	if !f.called("POST /images/sha256:old/tag?repo=img&tag=latest") {
		t.Fatalf("the old image must get the tag back; calls = %v", f.calls)
	}
	api, _ := newDockerAPI()
	now, err := h.resolveDockerID(context.Background(), api, "sonarr")
	if err != nil || now.ImageID != "sha256:old" || now.Image != "img:latest" || now.State != "running" {
		t.Fatalf("after rollback: %+v %v", now, err)
	}
	if n := strings.Count(strings.Join(f.calls, "\n"), "POST /images/create"); n != 1 {
		t.Fatalf("a rollback must not pull; %d pulls", n)
	}
	d = dockerDetail(t, h, "sonarr")
	if len(d.UpdateHistory) != 2 || d.UpdateHistory[0].Kind != "rollback" || d.UpdateHistory[0].ToImageID != "sha256:old" {
		t.Fatalf("history = %+v", d.UpdateHistory)
	}
	if d.Rollback != nil {
		t.Fatalf("nothing left to roll back, got %+v", d.Rollback)
	}
	if got := readDockerUpdateStore().Skipped["img:latest"]; got != "sha256:newdigest" {
		t.Fatalf("skipped = %q", got)
	}
}

// Without the previous image -- pruned since -- there is nothing to go back to,
// and nothing is touched.
func TestDockerRollbackRefusals(t *testing.T) {
	f, h := rollbackFixture(t)
	router := newDockerTestRouter(h)
	rec := dockerPost(router, "/api/docker/containers/sonarr/rollback")
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "no-rollback") {
		t.Fatalf("no history: %d %s", rec.Code, rec.Body)
	}
	dockerPost(router, "/api/docker/containers/sonarr/update")
	delete(f.images, "<none>@sha256:old")
	if d := dockerDetail(t, h, "sonarr"); d.Rollback != nil {
		t.Fatalf("rollback offered without the image: %+v", d.Rollback)
	}
	before := len(f.calls)
	rec = dockerPost(router, "/api/docker/containers/sonarr/rollback")
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "old-image-gone") {
		t.Fatalf("image gone: %d %s", rec.Code, rec.Body)
	}
	for _, call := range f.calls[before:] {
		if strings.HasPrefix(call, "POST") {
			t.Fatalf("a refused rollback touched the daemon: %v", f.calls[before:])
		}
	}
}

func seedDockerUpdates(t *testing.T, store dockerUpdateStore) {
	t.Helper()
	if err := writeIndentJSONFile(dockerUpdatesFilePath(), store); err != nil {
		t.Fatal(err)
	}
}

// Skip and hold are the reader's, kept beside the check's results: a skipped
// digest or a held image no longer counts as an update, and a newer digest
// than the skipped one does.
func TestDockerUpdateChoices(t *testing.T) {
	startFakeDocker(t)
	h := dockerTestHandlers(t)
	router := newDockerTestRouter(h)
	seedDockerUpdates(t, dockerUpdateStore{Images: map[string]*dockerImageUpdate{
		"img:latest": {Status: "available", RemoteDigest: "sha256:r1", LocalDigest: "sha256:l"},
		"other:1":    {Status: "current", RemoteDigest: "sha256:x", LocalDigest: "sha256:x"},
	}})
	choose := func(image, choice string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("POST", "/api/docker/updates/choice",
			strings.NewReader(`{"image":"`+image+`","choice":"`+choice+`"}`)))
		return rec
	}
	status := func(image string) *dockerImageUpdate { return h.dockerUpdateSnapshot()[image] }

	if rec := choose("other:1", "skip"); rec.Code != 409 {
		t.Fatalf("skipping with nothing to skip: %d", rec.Code)
	}
	if rec := choose("img:latest", "skip"); rec.Code != 200 {
		t.Fatalf("skip: %d %s", rec.Code, rec.Body)
	}
	if s := status("img:latest"); s.Status != "skipped" || s.SkippedDigest != "sha256:r1" {
		t.Fatalf("after skip: %+v", s)
	}
	choose("img:latest", "unskip")
	if s := status("img:latest"); s.Status != "available" {
		t.Fatalf("after unskip: %+v", s)
	}
	choose("other:1", "hold")
	choose("img:latest", "hold")
	if s := status("img:latest"); s.Status != "held" || !s.Held {
		t.Fatalf("after hold: %+v", s)
	}
	if s := status("other:1"); s.Status != "current" || !s.Held {
		t.Fatalf("held and current: %+v", s)
	}
	choose("img:latest", "unhold")
	if s := status("img:latest"); s.Status != "available" || s.Held {
		t.Fatalf("after unhold: %+v", s)
	}
	if rec := choose("img:latest", "bogus"); rec.Code != 400 {
		t.Fatalf("unknown choice: %d", rec.Code)
	}

	// The next check carries the choices over and drops a skip the registry
	// has moved past.
	prev := dockerUpdateStore{Held: map[string]bool{"a": true}, Skipped: map[string]string{"a": "sha256:1", "b": "sha256:2"}}
	next := dockerUpdateStore{Images: map[string]*dockerImageUpdate{
		"a": {Status: "available", RemoteDigest: "sha256:1"},
		"b": {Status: "available", RemoteDigest: "sha256:3"},
	}}
	carryDockerUpdateChoices(prev, &next)
	if !next.Held["a"] || next.Skipped["a"] != "sha256:1" || next.Skipped["b"] != "" {
		t.Fatalf("carried = held %v skipped %v", next.Held, next.Skipped)
	}
}

func TestDockerUpdateChoiceNeedsWriteToken(t *testing.T) {
	startFakeDocker(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	rec := httptest.NewRecorder()
	newDockerTestRouter(dockerTestHandlers(t)).ServeHTTP(rec, httptest.NewRequest("POST", "/api/docker/updates/choice",
		strings.NewReader(`{"image":"img:latest","choice":"hold"}`)))
	if rec.Code != 401 {
		t.Fatalf("code = %d", rec.Code)
	}
}

// A history file that does not parse is left alone: writing over it would lose
// every rollback in it.
func TestDockerUpdateHistoryKeepsAnUnreadableFile(t *testing.T) {
	_ = dockerTestHandlers(t)
	if err := os.WriteFile(dockerUpdateHistoryFilePath(), []byte(`{"entries":[{"at":1,`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := appendDockerUpdateHistory(dockerUpdateHistoryEntry{At: 2, Kind: "update", Container: "web"}); err == nil {
		t.Fatalf("append over an unreadable file must fail")
	}
	if data, _ := os.ReadFile(dockerUpdateHistoryFilePath()); string(data) != `{"entries":[{"at":1,` {
		t.Fatalf("file was rewritten: %s", data)
	}
	if got := dockerUpdateHistoryFor("web"); len(got) != 0 {
		t.Fatalf("history = %+v", got)
	}
}
