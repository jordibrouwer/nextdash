package app

import (
	"context"
	"strings"
	"testing"
)

func recreateFixture(t *testing.T) (*fakeDocker, *Handlers, dockerContainerSummary, *dockerAPI) {
	t.Helper()
	f := startFakeDocker(t)
	f.add(fakeContainer{
		ID: strings.Repeat("a", 64), Name: "sonarr", Image: "img:latest", ImageID: "sha256:old",
		State: "running", Env: []string{"A=1"}, RestartPolicy: "unless-stopped", NetworkMode: "bridge",
		Labels:   map[string]string{"net.unraid.docker.managed": "dockerman"},
		Networks: map[string]map[string]any{"bridge": {}, "proxy": {"Aliases": []string{"sonarr"}}},
	})
	f.images["img:latest"] = fakeImage{ID: "sha256:old"}
	f.images["img:latest@new"] = fakeImage{ID: "sha256:new"}
	h := dockerTestHandlers(t)
	api, _ := newDockerAPI()
	c, err := h.resolveDockerID(context.Background(), api, "sonarr")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	return f, h, c, api
}

func TestDockerRecreateSwapsContainer(t *testing.T) {
	f, h, c, api := recreateFixture(t)
	res, err := h.dockerRecreate(context.Background(), api, c)
	if err != nil || res.Phase != "done" || res.NewImageID != "sha256:new" {
		t.Fatalf("res = %+v err = %v", res, err)
	}
	now, err := h.resolveDockerID(context.Background(), api, "sonarr")
	if err != nil || now.ID == c.ID || now.State != "running" {
		t.Fatalf("new container = %+v err = %v", now, err)
	}
	if now.ImageID != "sha256:new" {
		t.Fatalf("new container runs %q, want sha256:new", now.ImageID)
	}
	if _, err := h.resolveDockerID(context.Background(), api, c.ID); err == nil {
		t.Fatal("old container must be removed after success")
	}
	if now.Labels["net.unraid.docker.managed"] != "dockerman" {
		t.Fatal("labels must survive, or Unraid loses the container")
	}
	in, _ := api.inspectContainer(context.Background(), "sonarr")
	if in.HostConfig.RestartPolicy.Name != "unless-stopped" || len(in.Config.Env) != 1 {
		t.Fatalf("config must survive: restart %q env %v", in.HostConfig.RestartPolicy.Name, in.Config.Env)
	}
	if _, ok := in.NetworkSettings.Networks["proxy"]; !ok || !f.called("POST /networks/proxy/connect") {
		t.Fatalf("extra networks must be reconnected: %v", in.NetworkSettings.Networks)
	}
	if f.called("POST /networks/bridge/connect") {
		t.Fatal("the primary network is attached at create, not connected again")
	}
}

// Nothing to update means nothing is touched: no stop, no rename, no gap in
// service for a pull that brought nothing new.
func TestDockerRecreateAlreadyCurrent(t *testing.T) {
	f, h, c, api := recreateFixture(t)
	delete(f.images, "img:latest@new")
	res, err := h.dockerRecreate(context.Background(), api, c)
	if err != nil || res.Phase != "already-current" {
		t.Fatalf("res = %+v err = %v", res, err)
	}
	if f.called("POST /containers/" + c.ID + "/stop") {
		t.Fatalf("an already-current container must not be stopped; calls = %v", f.calls)
	}
}

func TestDockerRecreateRollsBackOnCreateFailure(t *testing.T) {
	f, h, c, api := recreateFixture(t)
	f.failCreate = true
	res, err := h.dockerRecreate(context.Background(), api, c)
	if err != nil || res.Phase != "rolled-back" || res.FailedStep != "create" {
		t.Fatalf("res = %+v err = %v", res, err)
	}
	back, err := h.resolveDockerID(context.Background(), api, "sonarr")
	if err != nil || back.ID != c.ID || back.State != "running" {
		t.Fatalf("old container must be back under its name and running: %+v err = %v", back, err)
	}
}

func TestDockerRecreateRollsBackOnStartFailure(t *testing.T) {
	f, h, c, api := recreateFixture(t)
	f.failStart = map[string]bool{"sonarr": true}
	res, err := h.dockerRecreate(context.Background(), api, c)
	if err != nil || res.Phase != "rolled-back" || res.FailedStep != "start" {
		t.Fatalf("res = %+v err = %v", res, err)
	}
	back, err := h.resolveDockerID(context.Background(), api, "sonarr")
	if err != nil || back.ID != c.ID || back.State != "running" {
		t.Fatalf("old container not restored: %+v err = %v", back, err)
	}
	list, _ := api.listContainers(context.Background())
	if len(list) != 1 {
		t.Fatalf("the failed new container must be removed; have %d", len(list))
	}
}

// A stopped container is updated and stays stopped: an update is not a start.
func TestDockerRecreateKeepsStoppedStopped(t *testing.T) {
	f, h, _, api := recreateFixture(t)
	f.containers[strings.Repeat("a", 64)].State = "exited"
	c, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	res, err := h.dockerRecreate(context.Background(), api, c)
	if err != nil || res.Phase != "done" {
		t.Fatalf("res = %+v err = %v", res, err)
	}
	now, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	if now.State == "running" {
		t.Fatal("a stopped container must not be started by an update")
	}
}

func TestDockerUpdateRouteReportsPhase(t *testing.T) {
	recreateFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	router := newDockerTestRouter(dockerTestHandlers(t))
	rec := dockerPost(router, "/api/docker/containers/sonarr/update")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"phase":"done"`) || !strings.Contains(rec.Body.String(), `"state":"running"`) {
		t.Fatalf("code = %d body = %s", rec.Code, rec.Body)
	}
}
