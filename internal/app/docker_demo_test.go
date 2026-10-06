package app

import (
	"context"
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
