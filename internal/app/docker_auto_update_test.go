package app

import (
	"context"
	"errors"
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

func autoUpdateTestSetup(t *testing.T) (*fakeDocker, *Handlers, *dockerAPI, *[]string) {
	t.Helper()
	f, h, _, api := recreateFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	if err := writeIndentJSONFile(dockerUpdatesFilePath(), dockerUpdateStore{CheckedAt: time.Now().UnixMilli(),
		Images: map[string]*dockerImageUpdate{"img:latest": {Status: "available", RemoteDigest: "sha256:r2"}}}); err != nil {
		t.Fatal(err)
	}
	watched := []string{}
	dockerAutoUpdateWatcher = func(_ *Handlers, _ *dockerAPI, name string) { watched = append(watched, name) }
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
	return f, h, api, &watched
}

// A stopped container is updated and left stopped, not watched: its "created"
// state read as a failed update and rolled it back every night.
func TestDockerAutoUpdateLeavesAStoppedContainerUnwatched(t *testing.T) {
	f, h, api, watched := autoUpdateTestSetup(t)
	for id := range f.containers {
		f.containers[id].State = "exited"
	}
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 3, 10, 0, 0, time.Local))
	now, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	if now.ImageID != "sha256:new" {
		t.Fatalf("not updated: %s", now.ImageID)
	}
	if len(*watched) != 0 {
		t.Fatalf("a stopped container was watched: %v", *watched)
	}
}

// The rollback brings the old version back running, as it was before the update.
func TestDockerAutoRollbackStartsTheOldVersion(t *testing.T) {
	f, h, api, _ := autoUpdateTestSetup(t)
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 3, 10, 0, 0, time.Local))
	updated, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	f.containers[updated.ID].State = "exited"
	h.watchAutoUpdate(api, "sonarr")
	back, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	if back.ImageID != "sha256:old" || back.State != "running" {
		t.Fatalf("after rollback: image %s, state %s", back.ImageID, back.State)
	}
}

// A stop from the view during the watch is the user's, not a failed update.
func TestDockerAutoUpdateWatchLeavesAUserStopAlone(t *testing.T) {
	f, h, api, _ := autoUpdateTestSetup(t)
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 3, 10, 0, 0, time.Local))
	updated, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	// The stop arrives while the watch is running, as it would from the view.
	dockerAutoUpdateSleep = func(time.Duration) {
		dockerNotifications.expect("sonarr", time.Now().Add(24*time.Hour))
		f.containers[updated.ID].State = "exited"
	}
	h.watchAutoUpdate(api, "sonarr")
	after, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	if after.ImageID != "sha256:new" {
		t.Fatalf("a user stop was rolled back: %s", after.ImageID)
	}
}

// A container skipped because a prune was running gets the next tick, not the
// next night: it was not tried, so it is not marked as tried.
func TestDockerAutoUpdateSkippedForAPruneIsTriedAgainTheSameNight(t *testing.T) {
	_, h, api, _ := autoUpdateTestSetup(t)
	h.dockerPruneRunning.Store(true)
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 3, 10, 0, 0, time.Local))
	if c, _ := h.resolveDockerID(context.Background(), api, "sonarr"); c.ImageID != "sha256:old" {
		t.Fatalf("updated during a prune: %s", c.ImageID)
	}
	h.dockerPruneRunning.Store(false)
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 3, 20, 0, 0, time.Local))
	if c, _ := h.resolveDockerID(context.Background(), api, "sonarr"); c.ImageID != "sha256:new" {
		t.Fatalf("not updated once the prune was done: %s", c.ImageID)
	}
}

// A failure the recreate recovered from comes back without an error; it is
// still a failure, and the notice says where it broke.
func TestAutoUpdateFailureDetailCountsARollback(t *testing.T) {
	if got := autoUpdateFailureDetail(dockerRecreateResult{Phase: "rolled-back", FailedStep: "start"}, nil); !strings.Contains(got, "failed at start") {
		t.Fatalf("detail = %q", got)
	}
	if got := autoUpdateFailureDetail(dockerRecreateResult{Phase: "done"}, nil); got != "" {
		t.Fatalf("a done update reads as failed: %q", got)
	}
	if got := autoUpdateFailureDetail(dockerRecreateResult{}, errors.New("pull refused")); got != "pull refused" {
		t.Fatalf("detail = %q", got)
	}
}

// A window past midnight is one night: an update that failed at 23:10 was
// tried again at 00:10 because the calendar day had changed.
func TestDockerAutoUpdateTriesOncePerNightAcrossMidnight(t *testing.T) {
	f, h, _, _ := autoUpdateTestSetup(t)
	settings := h.store.GetSettings()
	settings.DockerAutoUpdateFrom, settings.DockerAutoUpdateTo = 23, 3
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	f.failCreate = true
	creates := func() int {
		n := 0
		for _, c := range f.calls {
			if strings.HasPrefix(c, "POST /containers/create") {
				n++
			}
		}
		return n
	}
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 23, 10, 0, 0, time.Local))
	first := creates()
	if first == 0 {
		t.Fatal("the update was not tried at all")
	}
	h.runDockerAutoUpdates(time.Date(2026, 10, 1, 0, 10, 0, 0, time.Local))
	if creates() != first {
		t.Fatalf("tried again after midnight: %d creates, want %d", creates(), first)
	}
}

// The run lists its candidates once; a container stopped before its turn (by
// hand, or a backup job) was updated, read as running from that list, watched,
// "rolled back" and started again, and the new version skipped.
func TestDockerAutoUpdateReadsTheStateAtItsTurn(t *testing.T) {
	f, h, api, watched := autoUpdateTestSetup(t)
	listed, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	for id := range f.containers {
		f.containers[id].State = "exited"
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	h.autoUpdateOne(ctx, api, listed)
	if len(*watched) != 0 {
		t.Fatalf("a container stopped before its turn was watched: %v", *watched)
	}
	after, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	if after.ImageID != "sha256:new" || after.State == "running" {
		t.Fatalf("after the update: image %s, state %s; want the new image, left stopped", after.ImageID, after.State)
	}
}

// A container replaced by hand during the run is not the one listed: its old
// id is left alone instead of failing with a 404 notice.
func TestDockerAutoUpdateSkipsAReplacedContainer(t *testing.T) {
	f, h, api, _ := autoUpdateTestSetup(t)
	listed, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	listed.ID = "replaced-since"
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if h.autoUpdateOne(ctx, api, listed) {
		t.Fatal("a container replaced since the list was tried")
	}
	if f.called("POST /containers/create") {
		t.Fatal("a replaced container was recreated")
	}
}

// A stop from outside nextDash (Unraid's Docker tab, the CLI, a backup job)
// during the watch was read as a failed update: rolled back, started again and
// the new version skipped.
func TestDockerAutoUpdateWatchLeavesAnOutsideStopAlone(t *testing.T) {
	f, h, api, _ := autoUpdateTestSetup(t)
	h.runDockerAutoUpdates(time.Date(2026, 9, 30, 3, 10, 0, 0, time.Local))
	updated, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	dockerAutoUpdateSleep = func(time.Duration) {
		ev := dockerEvent{Type: "container", Action: "stop"}
		ev.Actor.ID = updated.ID
		ev.Actor.Attributes = map[string]string{"name": "sonarr"}
		// Past nextDash's own action window, as a stop made minutes later is.
		dockerNotifications.event(ev, time.Now().Add(dockerNotifyExpectWindow+time.Minute), func(string, string) bool { return false })
		f.containers[updated.ID].State = "exited"
	}
	h.watchAutoUpdate(api, "sonarr")
	after, _ := h.resolveDockerID(context.Background(), api, "sonarr")
	if after.ImageID != "sha256:new" || after.State == "running" {
		t.Fatalf("an outside stop was rolled back: image %s, state %s", after.ImageID, after.State)
	}
}
