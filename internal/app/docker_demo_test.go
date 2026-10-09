package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The demo's daemon answers the calls the Docker views make, its actions
// change its state, and a reset puts that back.
func TestDemoDockerServesTheViews(t *testing.T) {
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
	if err := startDemoDocker(); err != nil {
		t.Skipf("unix sockets unavailable here: %v", err)
	}
	if !dockerControlEnabled() {
		t.Error("container actions are off in the demo")
	}
	api, reason := newDockerAPI()
	if api == nil {
		t.Fatalf("no Docker: %s", reason)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	list, err := api.listContainers(ctx)
	if err != nil || len(list) < 10 {
		t.Fatalf("%d containers, %v", len(list), err)
	}
	var jellyfin dockerContainerSummary
	for _, c := range list {
		if containerName(c.Names) == "jellyfin" {
			jellyfin = c
		}
	}
	if jellyfin.ID == "" || jellyfin.State != "running" {
		t.Fatalf("jellyfin: %+v", jellyfin)
	}
	if _, err := api.inspectContainer(ctx, jellyfin.ID); err != nil {
		t.Errorf("inspect: %v", err)
	}
	if lines, err := api.logsTail(ctx, jellyfin.ID, 50); err != nil || len(lines) == 0 {
		t.Errorf("logs: %d lines, %v", len(lines), err)
	}
	if _, err := api.statsOnce(ctx, jellyfin.ID); err != nil {
		t.Errorf("stats: %v", err)
	}
	if err := api.post(ctx, "/containers/"+jellyfin.ID+"/stop", nil); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if c, _ := api.inspectContainer(ctx, jellyfin.ID); c.State.Status != "exited" {
		t.Errorf("after stop: %q", c.State.Status)
	}
	demoDockerEngine.reset(time.Now())
	if c, _ := api.inspectContainer(ctx, jellyfin.ID); c.State.Status != "running" {
		t.Errorf("after the reset: %q", c.State.Status)
	}
}

func TestDemoUnraidAnswersFromTheFixture(t *testing.T) {
	t.Setenv("NEXTDASH_UNRAID_FIXTURE", "")
	if err := startDemoUnraid(); err != nil {
		t.Fatal(err)
	}
	raw, _, err := unraidQuery(context.Background(), UnraidServer{ID: demoUnraidServerID}, "demo", "# area: info\n{ info { os { hostname } } }", false)
	if err != nil || !strings.Contains(string(raw), "tower") {
		t.Fatalf("answer %s, %v", raw, err)
	}
}

// Updates, all within the demo's daemon: the registry knows newer images for
// a few tags, a pull moves the tag, and the changelog names the new version.
func TestDemoDockerUpdatesAreItsOwn(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "1")
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "")
	h := newTestHandlers(t)
	if err := startDemoDocker(); err != nil {
		t.Skipf("unix sockets unavailable here: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	store, err := h.runDockerUpdateCheck(ctx)
	if err != nil {
		t.Fatal(err)
	}
	available := map[string]bool{}
	for image, u := range store.Images {
		if u.Status == "available" {
			available[image] = true
		}
	}
	if !available["jellyfin/jellyfin:10.10"] || available["lscr.io/linuxserver/radarr:5"] || len(available) != 5 {
		for image, u := range store.Images {
			t.Logf("%s: %+v", image, *u)
		}
		t.Fatalf("updates available: %v", available)
	}
	if releases := demoReleases("jellyfin", "jellyfin"); len(releases) != 2 || releases[0].Tag != "10.10.4" {
		t.Errorf("changelog: %+v", releases)
	}

	api, _ := newDockerAPI()
	if err := api.pullImage(ctx, "jellyfin/jellyfin:10.10"); err != nil {
		t.Fatalf("pull: %v", err)
	}
	store, _ = h.runDockerUpdateCheck(ctx)
	if u := store.Images["jellyfin/jellyfin:10.10"]; u == nil || u.Status != "current" {
		t.Errorf("after the pull: %+v", u)
	}
	demoDockerEngine.reset(time.Now())
}

// One name, one container: a create or rename onto a name in use is refused,
// as the real daemon refuses it.
func TestDemoDockerRefusesATakenName(t *testing.T) {
	demoDockerEngine.reset(time.Now())
	serve := func(method, target, body string) int {
		rec := httptest.NewRecorder()
		demoDockerEngine.ServeHTTP(rec, httptest.NewRequest(method, target, strings.NewReader(body)))
		return rec.Code
	}
	if code := serve(http.MethodPost, "/containers/create?name=sonarr", `{"Image":"lscr.io/linuxserver/sonarr:4"}`); code != http.StatusConflict {
		t.Errorf("create under a taken name: %d, want 409", code)
	}
	if code := serve(http.MethodPost, "/containers/radarr/rename?name=sonarr", ""); code != http.StatusConflict {
		t.Errorf("rename onto a taken name: %d, want 409", code)
	}
	if code := serve(http.MethodPost, "/containers/radarr/rename?name=radarr-old", ""); code != http.StatusNoContent {
		t.Errorf("rename to a free name: %d", code)
	}
	if code := serve(http.MethodPost, "/containers/create?name=radarr", `{"Image":"lscr.io/linuxserver/radarr:5"}`); code != http.StatusCreated {
		t.Errorf("create under the name just freed: %d", code)
	}
}
