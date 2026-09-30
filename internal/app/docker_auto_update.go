package app

import (
	"context"
	"fmt"
	"sync"
	"time"
)

/*
Automatic updates, per container, inside one nightly window.

A container is opted in by name (Config's dockerAutoUpdate list, set from its
side panel or the selection bar). While the clock is inside the window, each
opted-in container whose image has an update waiting -- not skipped, not
held, not nextDash's own -- is updated the way the Update button does it, one
at a time. The update check itself is not run from here: what "waiting" means
is what the last check (Config -> Containers -> Updates) found.

Each update is then watched for a few minutes. If the container stops, starts
again on its own, or its healthcheck turns unhealthy, it is rolled back to the
image the update replaced, and that version is skipped, so the next window
does not try it again. Both the update and a rollback are told through the
container notices.

A container is tried once per window for a given image: a failure before the
swap (a registry that is down) waits for the next night rather than retrying
every tick.
*/

const (
	dockerAutoUpdateTick  = 5 * time.Minute
	dockerAutoUpdateWatch = 5 * time.Minute
	dockerAutoUpdatePoll  = 20 * time.Second
)

var dockerAutoHourChoices = map[int]bool{}

func init() {
	for h := 0; h < 24; h++ {
		dockerAutoHourChoices[h] = true
	}
}

// dockerInAutoWindow: whether a local hour lies in [from, to), a window that
// may run past midnight (22 -> 4). from == to is no window at all.
func dockerInAutoWindow(now time.Time, from, to int) bool {
	h := now.Hour()
	if from == to {
		return false
	}
	if from < to {
		return h >= from && h < to
	}
	return h >= from || h < to
}

type dockerAutoUpdater struct {
	mu    sync.Mutex
	tried map[string]string // container name -> "<day>|<image id it had>"
	busy  bool
}

var dockerAutoUpdates = &dockerAutoUpdater{tried: map[string]string{}}

// StartDockerAutoUpdater looks at the clock on a tick; the settings decide.
func (h *Handlers) StartDockerAutoUpdater(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(dockerAutoUpdateTick)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				h.runDockerAutoUpdates(time.Now())
			}
		}
	}()
}

// dockerAutoUpdateCandidates: the opted-in containers with an update waiting.
func (h *Handlers) dockerAutoUpdateCandidates(ctx context.Context, api *dockerAPI, names []string) []dockerContainerSummary {
	want := map[string]bool{}
	for _, n := range names {
		want[n] = true
	}
	list, err := api.listContainers(ctx)
	if err != nil {
		return nil
	}
	updates := h.dockerUpdateSnapshot()
	tagIDs := api.imageTagIDs(ctx)
	self := dockerSelfID()
	out := []dockerContainerSummary{}
	for _, c := range list {
		if !want[c.name()] || isDockerSelf(c.ID, self) {
			continue
		}
		if u := dockerRowUpdate(updates[c.Image], c, tagIDs); u != nil && u.Status == "available" {
			out = append(out, c)
		}
	}
	return out
}

func (h *Handlers) runDockerAutoUpdates(now time.Time) {
	settings := h.store.GetSettings()
	if len(settings.DockerAutoUpdate) == 0 || !dockerControlEnabled() ||
		!dockerInAutoWindow(now, settings.DockerAutoUpdateFrom, settings.DockerAutoUpdateTo) {
		return
	}
	a := dockerAutoUpdates
	a.mu.Lock()
	if a.busy {
		a.mu.Unlock()
		return
	}
	a.busy = true
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.busy = false
		a.mu.Unlock()
	}()
	api, _ := newDockerAPI()
	if api == nil {
		return
	}
	api = api.forActions()
	ctx, cancel := context.WithTimeout(context.Background(), dockerActionTimeout*3)
	defer cancel()
	day := now.Format("2006-01-02")
	for _, c := range h.dockerAutoUpdateCandidates(ctx, api, settings.DockerAutoUpdate) {
		mark := day + "|" + c.ImageID
		a.mu.Lock()
		seen := a.tried[c.name()] == mark
		a.tried[c.name()] = mark
		a.mu.Unlock()
		if seen || h.dockerPruneRunning.Load() {
			continue
		}
		h.autoUpdateOne(ctx, api, c)
	}
}

// autoUpdateOne updates one container as the Update button does, tells of
// it, and watches it in the background.
func (h *Handlers) autoUpdateOne(ctx context.Context, api *dockerAPI, c dockerContainerSummary) {
	name := c.name()
	release, ok := h.dockerLockContainer(c)
	if !ok {
		return
	}
	dockerNotifications.expect(name, time.Now().Add(dockerActionTimeout))
	outcome, err := h.dockerRecreate(ctx, api, c)
	dockerNotifications.expect(name, time.Now().Add(dockerNotifyExpectWindow))
	release()
	logActivity(activityCategoryMutate, "docker.auto-update", map[string]any{"container": name, "ok": err == nil}, "docker auto-update "+name)
	if err != nil {
		logWarn(logComponentMutate, "the automatic update of %s failed: %v", name, err)
		h.dispatchContainerNotices(ctx, []monitorNotification{containerNotice("down", name,
			name+" could not be updated automatically", err.Error(), time.Now())})
		return
	}
	if outcome.Phase == "done" || outcome.Phase == "already-current" {
		h.markDockerImageCurrent(c.Image)
	}
	if outcome.Phase != "done" {
		return
	}
	h.recordDockerUpdate(ctx, api, "update", name, c.Image, outcome.OldImageID, outcome.NewImageID)
	h.dispatchContainerNotices(ctx, []monitorNotification{containerNotice("up", name,
		name+" was updated automatically", "watching it for "+fmt.Sprint(int(dockerAutoUpdateWatch.Minutes()))+" minutes", time.Now())})
	dockerAutoUpdateWatcher(h, api, name)
}

// dockerAutoUpdateVerdict: what a look at the container says, against when it
// started after the update. "" is fine.
func dockerAutoUpdateVerdict(in dockerInspect, startedAt string) string {
	switch {
	case in.State.Status != "running":
		return "it is " + in.State.Status
	case startedAt != "" && in.State.StartedAt != startedAt:
		return "it restarted"
	case in.State.Health != nil && in.State.Health.Status == "unhealthy":
		return "it turned unhealthy"
	}
	return ""
}

// dockerAutoUpdateWatcher starts the watch; a variable so a test can see it
// started without waiting it out.
var dockerAutoUpdateWatcher = func(h *Handlers, api *dockerAPI, name string) { go h.watchAutoUpdate(api, name) }

// dockerAutoUpdateSleep waits between looks; a variable so a test does not.
var dockerAutoUpdateSleep = time.Sleep

// watchAutoUpdate looks at the container for a few minutes after its update
// and rolls it back if it did not take.
func (h *Handlers) watchAutoUpdate(api *dockerAPI, name string) {
	ctx, cancel := context.WithTimeout(context.Background(), dockerAutoUpdateWatch+dockerActionTimeout)
	defer cancel()
	first, err := api.inspectContainer(ctx, name)
	if err != nil {
		return
	}
	started := first.State.StartedAt
	for waited := time.Duration(0); waited < dockerAutoUpdateWatch; waited += dockerAutoUpdatePoll {
		dockerAutoUpdateSleep(dockerAutoUpdatePoll)
		in, err := api.inspectContainer(ctx, name)
		if err != nil {
			return
		}
		reason := dockerAutoUpdateVerdict(in, started)
		if reason == "" {
			continue
		}
		h.rollBackAutoUpdate(ctx, api, name, reason)
		return
	}
}

func (h *Handlers) rollBackAutoUpdate(ctx context.Context, api *dockerAPI, name, reason string) {
	list, err := api.listContainers(ctx)
	if err != nil {
		return
	}
	var c *dockerContainerSummary
	for i := range list {
		if list[i].name() == name {
			c = &list[i]
		}
	}
	if c == nil {
		return
	}
	release, ok := h.dockerLockContainer(*c)
	if !ok {
		return
	}
	defer release()
	dockerNotifications.expect(name, time.Now().Add(dockerActionTimeout))
	_, err = h.dockerRollbackUpdate(ctx, api, *c)
	dockerNotifications.expect(name, time.Now().Add(dockerNotifyExpectWindow))
	logActivity(activityCategoryMutate, "docker.auto-rollback", map[string]any{"container": name, "ok": err == nil, "why": reason}, "docker auto-rollback "+name)
	title := name + " was rolled back after its automatic update"
	detail := reason + "; the new version is skipped"
	if err != nil {
		title = name + " failed after its automatic update and could not be rolled back"
		detail = reason + "; " + err.Error()
	}
	h.dispatchContainerNotices(ctx, []monitorNotification{containerNotice("down", name, title, detail, time.Now())})
}
