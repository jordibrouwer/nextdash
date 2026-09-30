package app

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestDockerInAutoWindow(t *testing.T) {
	at := func(h int) time.Time { return time.Date(2026, 9, 30, h, 30, 0, 0, time.Local) }
	cases := []struct {
		h, from, to int
		want        bool
	}{
		{3, 3, 5, true}, {4, 3, 5, true}, {5, 3, 5, false}, {2, 3, 5, false},
		{23, 22, 4, true}, {1, 22, 4, true}, {4, 22, 4, false}, {12, 22, 4, false},
		{3, 3, 3, false},
	}
	for _, tc := range cases {
		if got := dockerInAutoWindow(at(tc.h), tc.from, tc.to); got != tc.want {
			t.Errorf("%d:30 in [%d,%d) = %v", tc.h, tc.from, tc.to, got)
		}
	}
}

// After an update: stopped, restarted or unhealthy is a failure; running on
// as it started is not.
func TestDockerAutoUpdateVerdict(t *testing.T) {
	var in dockerInspect
	in.State.Status, in.State.StartedAt = "running", "t1"
	if v := dockerAutoUpdateVerdict(in, "t1"); v != "" {
		t.Fatalf("fine: %q", v)
	}
	if v := dockerAutoUpdateVerdict(in, "t0"); v != "it restarted" {
		t.Fatalf("restart: %q", v)
	}
	in.State.Health = &struct {
		Status        string `json:"Status"`
		FailingStreak int    `json:"FailingStreak"`
		Log           []struct {
			Start    string `json:"Start"`
			End      string `json:"End"`
			ExitCode int    `json:"ExitCode"`
			Output   string `json:"Output"`
		} `json:"Log"`
	}{Status: "unhealthy"}
	if v := dockerAutoUpdateVerdict(in, "t1"); v != "it turned unhealthy" {
		t.Fatalf("unhealthy: %q", v)
	}
	in.State.Status = "exited"
	if v := dockerAutoUpdateVerdict(in, "t1"); !strings.Contains(v, "exited") {
		t.Fatalf("stopped: %q", v)
	}
}

// Inside the window, an opted-in container with an update waiting is updated
// and watched; outside it, or not opted in, nothing happens.
func TestDockerAutoUpdateRunsInTheWindow(t *testing.T) {
	f, h, _, api := recreateFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	if err := writeIndentJSONFile(dockerUpdatesFilePath(), dockerUpdateStore{CheckedAt: time.Now().UnixMilli(),
		Images: map[string]*dockerImageUpdate{"img:latest": {Status: "available", RemoteDigest: "sha256:r2"}}}); err != nil {
		t.Fatal(err)
	}
	watched := []string{}
	dockerAutoUpdateWatcher = func(_ *Handlers, _ *dockerAPI, name string) { watched = append(watched, name) }
	t.Cleanup(func() {
		dockerAutoUpdateWatcher = func(h *Handlers, api *dockerAPI, name string) { go h.watchAutoUpdate(api, name) }
		dockerAutoUpdates.tried = map[string]string{}
	})
	dockerAutoUpdates.tried = map[string]string{}
	settings := h.store.GetSettings()
	settings.DockerAutoUpdate = []string{"sonarr"}
	settings.DockerAutoUpdateFrom, settings.DockerAutoUpdateTo = 3, 5
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 12, 0, 0, 0, time.Local))
	if len(watched) != 0 {
		t.Fatal("outside the window nothing is updated")
	}
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 3, 10, 0, 0, time.Local))
	now, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	if now.ImageID != "sha256:new" || strings.Join(watched, ",") != "sonarr" {
		t.Fatalf("image = %s, watched = %v, calls = %v", now.ImageID, watched, f.calls)
	}
}

// A container that does not keep running after its automatic update is put
// back on the image it had, and that version is skipped.
func TestDockerAutoUpdateRollsBackAFailure(t *testing.T) {
	f, h, _, api := recreateFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	if err := writeIndentJSONFile(dockerUpdatesFilePath(), dockerUpdateStore{CheckedAt: time.Now().UnixMilli(),
		Images: map[string]*dockerImageUpdate{"img:latest": {Status: "available", RemoteDigest: "sha256:r2"}}}); err != nil {
		t.Fatal(err)
	}
	dockerAutoUpdateWatcher = func(*Handlers, *dockerAPI, string) {}
	dockerAutoUpdateSleep = func(time.Duration) {}
	t.Cleanup(func() {
		dockerAutoUpdateWatcher = func(h *Handlers, api *dockerAPI, name string) { go h.watchAutoUpdate(api, name) }
		dockerAutoUpdateSleep = time.Sleep
		dockerAutoUpdates.tried = map[string]string{}
	})
	dockerAutoUpdates.tried = map[string]string{}
	settings := h.store.GetSettings()
	settings.DockerAutoUpdate = []string{"sonarr"}
	settings.DockerAutoUpdateFrom, settings.DockerAutoUpdateTo = 3, 5
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 3, 10, 0, 0, time.Local))
	updated, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	if updated.ImageID != "sha256:new" {
		t.Fatalf("not updated: %s", updated.ImageID)
	}
	f.containers[updated.ID].State = "exited"
	h.watchAutoUpdate(api, "sonarr")
	back, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	if back.ImageID != "sha256:old" {
		t.Fatalf("not rolled back: %s, calls %v", back.ImageID, f.calls)
	}
}
