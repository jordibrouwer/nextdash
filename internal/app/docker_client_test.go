package app

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestDockerAPIListAndInspect(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "lscr.io/linuxserver/sonarr:latest",
		State: "running", Status: "Up 2 hours (healthy)", Env: []string{"PUID=99", "API_KEY=secret"}})

	api, reason := newDockerAPI()
	if reason != "" {
		t.Fatalf("reason = %q", reason)
	}
	list, err := api.listContainers(context.Background())
	if err != nil || len(list) != 1 || list[0].name() != "sonarr" {
		t.Fatalf("list = %+v, err = %v", list, err)
	}
	in, err := api.inspectContainer(context.Background(), "sonarr")
	if err != nil {
		t.Fatalf("inspect: %v", err)
	}
	if len(in.Config.Env) != 2 {
		t.Fatalf("env = %v", in.Config.Env)
	}
}

func TestDockerAPILogsDemultiplexes(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "web", State: "running",
		Logs: []string{"first line", "second line"}})
	api, _ := newDockerAPI()
	lines, err := api.logsTail(context.Background(), "web", 200)
	if err != nil {
		t.Fatalf("logs: %v", err)
	}
	if strings.Join(lines, "|") != "first line|second line" {
		t.Fatalf("lines = %q -- frame headers must be stripped", lines)
	}
}

func TestDockerAPIErrorCarriesDaemonMessage(t *testing.T) {
	f := startFakeDocker(t)
	f.failCreate = true
	api, _ := newDockerAPI()
	_, err := api.createContainer(context.Background(), "bad", dockerCreateBody{"Image": "img"})
	var apiErr *dockerAPIError
	if !errors.As(err, &apiErr) || apiErr.Status != 500 || apiErr.Message != "boom" {
		t.Fatalf("err = %#v", err)
	}
}
