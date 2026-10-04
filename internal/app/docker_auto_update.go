package app

import (
	"context"
	"fmt"
	"net/url"
	"slices"
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
		// Paused on purpose: the update started it again, unpaused, and the
		// notice said it was left stopped. The view offers no update for a
		// paused container either.
		if !want[c.name()] || isDockerSelf(c.ID, self) || c.State == "paused" {
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
	listCtx, cancelList := context.WithTimeout(context.Background(), time.Minute)
	candidates := h.dockerAutoUpdateCandidates(listCtx, api, settings.DockerAutoUpdate)
	cancelList()
	// The night the window opened, not the calendar day: a window from 23:00
	// got a new day at midnight and tried a failed update a second time.
	day := now.Add(-time.Duration(settings.DockerAutoUpdateFrom) * time.Hour).Format("2006-01-02")
	started := time.Now()
	for _, c := range candidates {
		// A run can take an hour. Turned off for this container meanwhile, or
		// past the end of the window, it is left alone.
		current := h.store.GetSettings()
		if !slices.Contains(current.DockerAutoUpdate, c.name()) ||
			!dockerInAutoWindow(now.Add(time.Since(started)), current.DockerAutoUpdateFrom, current.DockerAutoUpdateTo) {
			continue
		}
		mark := day + "|" + c.ImageID
		a.mu.Lock()
		seen := a.tried[c.name()] == mark
		a.mu.Unlock()
		if seen || h.dockerPruneRunning.Load() {
			continue
		}
		// Each its own time. One context for the whole night let a couple of
		// large pulls use it up, and every container after them failed at once
		// with "context deadline exceeded", a notice each.
		ctx, cancel := context.WithTimeout(context.Background(), dockerActionTimeout)
		attempted := h.autoUpdateOne(ctx, api, c)
		cancel()
		// Marked only once it was really tried: skipped for a running prune or
		// a manual action holding it, it gets the next tick instead of the
		// next night.
		if attempted {
			a.mu.Lock()
			a.tried[c.name()] = mark
			a.mu.Unlock()
		}
	}
}

// autoUpdateOne updates one container as the Update button does, tells of
// it, and watches it in the background. False when it did not get to try:
// the container was busy or a prune was running.
func (h *Handlers) autoUpdateOne(ctx context.Context, api *dockerAPI, c dockerContainerSummary) bool {
	name := c.name()
	release, ok := h.dockerLockContainer(c)
	if !ok {
		return false
	}
	// Read after the lock, the order a prune relies on (docker_disk.go): it
	// sets the flag and then checks the locks. Read before, a prune starting in
	// between could delete the image this update pulls.
	if h.dockerPruneRunning.Load() {
		release()
		return false
	}
	// The run's list can be an hour old by this container's turn. Replaced or
	// removed since, it is not the one that was listed: its old id would fail
	// with a 404 notice. The next tick lists it again.
	if in, err := api.inspectContainer(ctx, name); err != nil || in.ID != c.ID {
		release()
		return false
	}
	dockerNotifications.expect(name, time.Now().Add(dockerActionTimeout))
	outcome, err := h.dockerRecreate(ctx, api, c)
	dockerNotifications.expect(name, time.Now().Add(dockerNotifyExpectWindow))
	release()
	// The notices on a context of their own: an update that ran into its time
	// limit sent its failure on the expired one, and it never arrived.
	nctx, ncancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer ncancel()
	failure := autoUpdateFailureDetail(outcome, err)
	logActivity(activityCategoryMutate, "docker.auto-update", map[string]any{"container": name, "ok": failure == ""}, "docker auto-update "+name)
	if failure != "" {
		logWarn(logComponentMutate, "the automatic update of %s failed: %s", name, failure)
		h.dispatchContainerNotices(nctx, []monitorNotification{containerNotice("down", name,
			name+" could not be updated automatically", failure, time.Now())})
		return true
	}
	if outcome.Phase == "done" || outcome.Phase == "already-current" {
		h.markDockerImageCurrent(c.Image)
	}
	if outcome.Phase != "done" {
		return true
	}
	h.recordDockerUpdate(nctx, api, "update", name, c.Image, outcome.OldImageID, outcome.NewImageID)
	// A stopped container is updated and stays stopped, as it was: there is
	// nothing to watch, and the watch read its "created" state as a failed
	// update, rolled it back and skipped the new version, every night.
	// Restarting counts as running: it was started again, and a crash-looping
	// container is the one the watch exists for. Read from the recreate, not
	// from the run's list: a container stopped before its turn (by hand, or a
	// backup job) was rolled back and started by the watch.
	if !outcome.WasRunning {
		h.dispatchContainerNotices(nctx, []monitorNotification{containerNotice("up", name,
			name+" was updated automatically", "it was not running, and is left stopped", time.Now())})
		return true
	}
	h.dispatchContainerNotices(nctx, []monitorNotification{containerNotice("up", name,
		name+" was updated automatically", "watching it for "+fmt.Sprint(int(dockerAutoUpdateWatch.Minutes()))+" minutes", time.Now())})
	dockerAutoUpdateWatcher(h, api, name)
	return true
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
	// Where the update left the "this is nextDash's doing" mark. A stop or a
	// restart from the view moves it later: then the change is the user's, not a
	// failed update, and rolling back and skipping the version would be wrong.
	ownMark := dockerNotifications.expectedUntil(name)
	for waited := time.Duration(0); waited < dockerAutoUpdateWatch; waited += dockerAutoUpdatePoll {
		dockerAutoUpdateSleep(dockerAutoUpdatePoll)
		if dockerNotifications.expectedUntil(name).After(ownMark) {
			return
		}
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
	// Not while a prune runs: the old image is re-tagged with no container on
	// it yet, which is exactly what "remove unused images" deletes.
	for h.dockerPruneRunning.Load() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
	dockerNotifications.expect(name, time.Now().Add(dockerActionTimeout))
	res, err := h.dockerRollbackUpdate(ctx, api, *c)
	// The container was running when the update began, and the rollback
	// recreates it from the failed one's state -- exited, most of the time -- so
	// the old version came back created but never started, and a restart policy
	// does not pick that up.
	if err == nil && res.ContainerID != "" {
		if in, ierr := api.inspectContainer(ctx, res.ContainerID); ierr == nil && !in.State.Running {
			if serr := api.post(ctx, "/containers/"+url.PathEscape(res.ContainerID)+"/start", nil); serr != nil {
				err = fmt.Errorf("rolled back, but it did not start: %w", serr)
			}
		}
	}
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

// autoUpdateFailureDetail says why an automatic update did not happen, or ""
// when it did. A recreate that failed and put the old container back returns
// no error, so it was logged as a success and nobody heard of it, every night.
func autoUpdateFailureDetail(outcome dockerRecreateResult, err error) string {
	if err != nil {
		return err.Error()
	}
	if outcome.Phase == "rolled-back" {
		return "it failed at " + outcome.FailedStep + "; the previous container runs again"
	}
	return ""
}
