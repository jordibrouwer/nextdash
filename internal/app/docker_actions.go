package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

/*
Changing containers, not only reading them.

A writable Docker socket is root on the host, so every action here passes three
gates before the daemon hears of it: NEXTDASH_DOCKER_CONTROL=1, the write token
when one is set, and -- for the container nextDash itself runs in -- a refusal
of anything that would take the dashboard down in the middle of the request
asking for it.

One action per container at a time. Two tabs pressing stop and update on the
same container would otherwise race a recreate against a stop, and the loser's
error would describe a state neither of them asked for.
*/

// The actions that are one POST to the daemon's endpoint of the same name.
var dockerSimpleActions = map[string]bool{
	"start": true, "stop": true, "restart": true, "pause": true, "unpause": true,
}

// What the own container refuses: each of these stops or replaces the process
// answering the request.
var dockerSelfBlocked = map[string]bool{
	"stop": true, "pause": true, "restart": true, "remove": true, "update": true, "rollback": true,
}

// Long enough for a stop to wait out a container's grace period and for an
// update to pull a large image; bounded so a hung daemon cannot hold the lock
// forever.
const dockerActionTimeout = 10 * time.Minute

func (h *Handlers) dockerLock(id string) (func(), bool) {
	if _, busy := h.dockerBusy.LoadOrStore(id, struct{}{}); busy {
		return nil, false
	}
	return func() { h.dockerBusy.Delete(id) }, true
}

// dockerLockContainer holds a container by id and by name. An update gives
// the name a new id halfway through, and actions resolve names: locked by id
// alone, a stop or remove on the name would slip in mid-update.
func (h *Handlers) dockerLockContainer(c dockerContainerSummary) (func(), bool) {
	return h.dockerLockContainerOn(dockerLocalHostID, c)
}

// dockerLockContainerOn is the same lock on one host. A remote host's keys
// carry its id, so "postgres" on two hosts are two locks; the local keys stay
// exactly as they were.
func (h *Handlers) dockerLockContainerOn(host string, c dockerContainerSummary) (func(), bool) {
	prefix := ""
	if host != dockerLocalHostID {
		prefix = host + "::"
	}
	releaseID, ok := h.dockerLock(prefix + c.ID)
	if !ok {
		return nil, false
	}
	name := c.name()
	if name == "" {
		return releaseID, true
	}
	releaseName, ok := h.dockerLock(prefix + "name:" + name)
	if !ok {
		releaseID()
		return nil, false
	}
	return func() { releaseName(); releaseID() }, true
}

// dockerAnyBusy says whether an action is running on any container.
func (h *Handlers) dockerAnyBusy() bool {
	busy := false
	h.dockerBusy.Range(func(key, _ any) bool {
		// An action on another host does not stop a prune of this one.
		if k, _ := key.(string); strings.Contains(k, "::") {
			return true
		}
		busy = true
		return false
	})
	return busy
}

func dockerRefuse(w http.ResponseWriter, code int, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	writeJSON(w, map[string]string{"reason": reason})
}

func (h *Handlers) DockerActionHandler(w http.ResponseWriter, r *http.Request) {
	remote := dockerRemote(r)
	hostID := dockerHostOf(r)
	if remote {
		if _, ok := findDockerHost(hostID); !ok {
			dockerRefuse(w, http.StatusNotFound, reasonUnknownDockerHost)
			return
		}
	}
	if !dockerHostControl(r) {
		dockerRefuse(w, http.StatusForbidden, reasonDockerControlOff)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	action := mux.Vars(r)["action"]
	if !dockerSimpleActions[action] && action != "remove" && action != "update" && action != "rollback" {
		dockerRefuse(w, http.StatusNotFound, "unknown-action")
		return
	}
	// An update or rollback pulls, replaces and writes this install's update
	// history; that is built around the local host only.
	if remote && (action == "update" || action == "rollback") {
		dockerRefuse(w, http.StatusForbidden, reasonDockerLocalOnly)
		return
	}
	api, c, ok := h.dockerTarget(w, r)
	if !ok {
		return
	}
	api = api.forActions()
	if !remote && dockerSelfBlocked[action] && isDockerSelf(c.ID, dockerSelfID()) {
		dockerRefuse(w, http.StatusForbidden, reasonDockerSelf)
		return
	}
	if action == "remove" && (c.State == "running" || c.State == "paused" || c.State == "restarting") {
		dockerRefuse(w, http.StatusConflict, "running")
		return
	}
	release, ok := h.dockerLockContainerOn(hostID, c)
	if !ok {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	defer release()
	// The lock is taken before the prune flag is read, and the prune sets its
	// flag before it reads the locks: one of the two always sees the other.
	if (action == "update" || action == "rollback") && h.dockerPruneRunning.Load() {
		dockerRefuse(w, http.StatusConflict, "prune-running")
		return
	}
	// What nextDash stops or replaces itself is not a crash to tell about --
	// for as long as the action runs, and a moment after for the late events.
	// The notifier watches the local daemon, so a remote stop is not its to expect.
	if !remote && action != "start" && action != "unpause" {
		dockerNotifications.expect(c.name(), time.Now().Add(dockerActionTimeout))
		defer func() { dockerNotifications.expect(c.name(), time.Now().Add(dockerNotifyExpectWindow)) }()
	}

	// The server's WriteTimeout is a minute; pulling a large image is not. The
	// answer would be cut off while the update carried on, and the reader would
	// see a failure for something that worked.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(dockerActionTimeout + time.Minute))

	// Detached from the request: a stop or an update the reader started should
	// finish even if the tab that asked for it was closed.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), dockerActionTimeout)
	defer cancel()

	// ?stream=1: the steps as they happen, then this route's answer as the
	// last line (docker_progress.go). Refusals above still answer plainly.
	if (action == "update" || action == "rollback") && r.URL.Query().Get("stream") == "1" {
		emit, capture, finish := dockerProgressStream(w)
		ctx = withDockerProgress(ctx, emit)
		w = capture
		defer finish()
	}

	name := c.name()
	result := map[string]any{"ok": true}
	var err error
	switch {
	case dockerSimpleActions[action]:
		err = api.post(ctx, "/containers/"+c.ID+"/"+action, nil)
	case action == "remove":
		err = api.remove(ctx, c.ID)
	case action == "update":
		var outcome dockerRecreateResult
		outcome, err = h.dockerRecreate(ctx, api, c)
		result["update"] = outcome
		if err == nil && (outcome.Phase == "done" || outcome.Phase == "already-current") {
			h.markDockerImageCurrent(c.Image)
		}
		if err == nil && outcome.Phase == "done" {
			h.recordDockerUpdate(ctx, api, "update", name, c.Image, outcome.OldImageID, outcome.NewImageID, "manual")
		}
	case action == "rollback":
		var outcome dockerRecreateResult
		outcome, err = h.dockerRollbackUpdate(ctx, api, c, "manual")
		result["update"] = outcome
	}

	logFields := map[string]any{
		"container": name,
		"ok":        err == nil,
	}
	if remote {
		logFields["host"] = hostID
	}
	// A call that came through the MCP endpoint says so; the browser's own
	// buttons log exactly what they always did.
	if requestFromMCP(r) {
		logFields = mergeActivityFields(activityFieldsFromRequest(r), logFields)
	}
	logActivity(activityCategoryMutate, "docker."+action, logFields, "docker "+action+" "+name)

	var refusal *dockerRefusalError
	if errors.As(err, &refusal) {
		if len(refusal.Containers) > 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(refusal.Code)
			writeJSON(w, map[string]any{"reason": refusal.Reason, "containers": refusal.Containers})
			return
		}
		dockerRefuse(w, refusal.Code, refusal.Reason)
		return
	}
	if err != nil {
		logWarn(logComponentMutate, "docker %s %s failed: %v", action, name, err)
		if outcome, ok := result["update"].(dockerRecreateResult); ok && outcome.FailedStep != "" {
			var apiErr *dockerAPIError
			if !errors.As(err, &apiErr) && !isDockerDialError(err) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				writeJSON(w, map[string]string{"reason": "docker-error", "failedStep": outcome.FailedStep,
					"message": "the update failed at " + outcome.FailedStep + ": " + err.Error()})
				return
			}
		}
		writeDockerError(w, err)
		return
	}
	if action != "remove" {
		// By name: an update gives the container a new id.
		if in, ierr := api.inspectContainer(ctx, name); ierr == nil {
			result["state"] = in.State.Status
		}
	}
	writeJSON(w, result)
}
