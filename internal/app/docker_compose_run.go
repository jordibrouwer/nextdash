package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"time"

	"github.com/gorilla/mux"
)

/*
Up, Down and Pull for a stack, run by docker compose in a short-lived helper
container -- not by nextDash.

POST /api/docker/compose/{project}/{up|down|pull}?host=&stream=1

nextDash only knows the files under its own mount, but compose resolves relative
paths on the machine it runs on. The helper therefore gets the stack's HOST
folder at the same path, the Docker socket, and no network. It is labelled so
no view lists it and the notifier never raises a crash for it (dockerIsOwnHelper).

Up is preceded by `compose config -q` in a first helper, so a file that does not
validate never touches a container. Every helper is removed however the run
ends, on a context of its own. Down never carries -v.
*/

const (
	dockerHelperLabel = "nextdash.helper"

	// Pinned: `docker:<x.y>-cli` ships the compose plugin. NEXTDASH_COMPOSE_IMAGE overrides it.
	composeDefaultImage    = "docker:29.7-cli"
	composeDefaultSocket   = "/var/run/docker.sock"
	composeValidateTimeout = 2 * time.Minute
	composeTailLines       = 20
)

// composeRunTimeout bounds the whole run, validate included; a variable so a
// test does not wait ten minutes.
var composeRunTimeout = dockerActionTimeout

// dockerIsOwnHelper is whether a container is one nextDash made for itself:
// the disk-size probe or a compose helper. Views skip it, the notifier ignores it.
func dockerIsOwnHelper(labels map[string]string) bool {
	return labels[dockerBindMeasureLabel] == "1" || labels[dockerHelperLabel] != ""
}

func composeHelperImage() string {
	if v := envPath("NEXTDASH_COMPOSE_IMAGE"); v != "" {
		return v
	}
	return composeDefaultImage
}

// composeHostSocket is the daemon socket's path ON THE HOST, which is what a
// bind needs. nextDash only knows the container path. Order: the env override,
// the mount of this very container whose destination is that path, then the
// usual /var/run/docker.sock.
func composeHostSocket(ctx context.Context, api *dockerAPI) string {
	if v := envPath("NEXTDASH_COMPOSE_SOCKET"); v != "" {
		return v
	}
	if inside := dockerSocketPath(); inside != "" {
		if self := dockerSelfID(); self != "" {
			if in, err := api.inspectContainer(ctx, self); err == nil {
				for _, m := range in.Mounts {
					if m.Destination == inside && m.Source != "" {
						return m.Source
					}
				}
			}
		}
	}
	return composeDefaultSocket
}

// dockerLockStackOn holds the project and every member container: a stack run
// and a container action never overlap. All or nothing.
func (h *Handlers) dockerLockStackOn(host, project string, members []dockerContainerSummary) (func(), bool) {
	var releases []func()
	undo := func() {
		for i := len(releases) - 1; i >= 0; i-- {
			releases[i]()
		}
	}
	rel, ok := h.dockerLock(composeLockKey(host, project))
	if !ok {
		return nil, false
	}
	releases = append(releases, rel)
	for _, m := range members {
		rel, ok := h.dockerLockContainerOn(host, m)
		if !ok {
			undo()
			return nil, false
		}
		releases = append(releases, rel)
	}
	return undo, true
}

// composeProjectDir is the folder compose runs from: the working_dir label, or
// the first config file's folder.
func composeProjectDir(p composeProject) string {
	if p.WorkingDir != "" {
		return filepath.Clean(p.WorkingDir)
	}
	if len(p.ConfigFiles) > 0 {
		return filepath.Dir(p.ConfigFiles[0])
	}
	return ""
}

// composeHelperBody is the create request for one helper. args is what follows
// `docker compose ... -f F`: ["up","-d"], ["down"], ["pull"] or ["config","-q"].
func composeHelperBody(p composeProject, args []string, socket string) dockerCreateBody {
	wd := composeProjectDir(p)
	cmd := []string{"compose", "--ansi", "never", "-p", p.Name, "--project-directory", wd}
	binds := []string{socket + ":/var/run/docker.sock", wd + ":" + wd + ":ro"}
	seen := map[string]bool{wd: true}
	for _, f := range p.ConfigFiles {
		cmd = append(cmd, "-f", f)
		if dir := filepath.Dir(f); !underDir(dir, wd) && !seen[dir] {
			seen[dir] = true
			binds = append(binds, dir+":"+dir+":ro")
		}
	}
	cmd = append(cmd, args...)
	return dockerCreateBody{
		"Image":      composeHelperImage(),
		"Entrypoint": []string{"docker"},
		"Cmd":        cmd,
		"WorkingDir": wd,
		"Labels":     map[string]string{dockerHelperLabel: "compose", "nextdash.compose.project": p.Name},
		"HostConfig": map[string]any{
			"Binds":       binds,
			"NetworkMode": "none",
			"AutoRemove":  false,
		},
	}
}

// composeRun is swappable like dockerBindMeasureRun, so a test can stand in for the daemon.
var composeRun = runComposeHelper

type composeLineRing struct {
	lines []string
}

func (r *composeLineRing) add(line string) {
	r.lines = append(r.lines, line)
	if len(r.lines) > composeTailLines {
		r.lines = r.lines[len(r.lines)-composeTailLines:]
	}
}

// runComposeHelper runs one compose command in one helper and reports its exit
// code and the last lines it printed. err is the daemon's, not compose's: a
// non-zero exit is not an error here.
func runComposeHelper(ctx context.Context, api *dockerAPI, p composeProject, args []string) (exit int, tail []string, err error) {
	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	body := composeHelperBody(p, args, composeHostSocket(ctx, api))
	id, err := api.createContainer(ctx, "nextdash-compose-"+p.Name+"-"+hex.EncodeToString(suffix), body)
	if err != nil {
		return 0, nil, err // nothing was made, so nothing to remove
	}
	announce := len(args) > 0 && args[0] != "config"
	// Removed however it ends -- start fails, the follow breaks, the wait fails,
	// the run times out, a panic -- on a context of its own: the run's may be
	// the one that ran out. Force takes a running helper down too.
	defer func() {
		if announce {
			dockerStep(ctx, "cleanup", "start")
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		resp, derr := api.do(cleanup, http.MethodDelete, "/containers/"+url.PathEscape(id)+"?force=true&v=true", nil)
		if derr == nil {
			resp.Body.Close()
		}
		if announce {
			state := "done"
			if derr != nil {
				state = "fail"
				logWarn(logComponentMutate, "compose helper %s could not be removed: %v", id, derr)
			}
			dockerStep(ctx, "cleanup", state)
		}
	}()
	if err := api.post(ctx, "/containers/"+url.PathEscape(id)+"/start", nil); err != nil {
		return 0, nil, err
	}
	var ring composeLineRing
	followed := make(chan struct{})
	go func() {
		defer close(followed)
		rc, ferr := api.logsFollow(ctx, id, 0, "")
		if ferr != nil {
			return
		}
		defer rc.Close()
		_ = readDockerLogFrames(rc, false, func(l dockerLogLine) {
			ring.add(l.M)
			dockerLog(ctx, "%s", l.M)
		}, func() {})
	}()
	var waited struct {
		StatusCode int `json:"StatusCode"`
	}
	resp, werr := api.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/wait", nil)
	if werr != nil {
		return 0, nil, werr
	}
	derr := json.NewDecoder(resp.Body).Decode(&waited)
	resp.Body.Close()
	if derr != nil && !errors.Is(derr, io.EOF) {
		return 0, nil, derr
	}
	// The container has exited, so the log stream is about to end.
	select {
	case <-followed:
	case <-time.After(5 * time.Second):
	}
	return waited.StatusCode, append([]string(nil), ring.lines...), nil
}

// composeSweep removes this project's finished helpers that an earlier process
// left behind. A running one is somebody's run and is left alone.
func composeSweep(ctx context.Context, api *dockerAPI, project string) {
	list, err := api.listContainers(ctx)
	if err != nil {
		return
	}
	for _, c := range list {
		if c.Labels[dockerHelperLabel] != "compose" || c.Labels["nextdash.compose.project"] != project {
			continue
		}
		if c.State == "running" || c.State == "restarting" || c.State == "paused" {
			continue
		}
		if resp, derr := api.do(ctx, http.MethodDelete, "/containers/"+url.PathEscape(c.ID)+"?force=true&v=true", nil); derr == nil {
			resp.Body.Close()
		}
	}
}

// composeEnsureImage has the helper image locally, pulling it when it is not.
func composeEnsureImage(ctx context.Context, api *dockerAPI) error {
	dockerStep(ctx, "image", "start")
	img := composeHelperImage()
	if _, err := api.inspectImage(ctx, img); err != nil {
		if err := api.pullImage(ctx, img); err != nil {
			dockerStep(ctx, "image", "fail")
			return err
		}
	}
	dockerStep(ctx, "image", "done")
	return nil
}

type composeRunOutcome struct {
	OK       bool
	Reason   string // composeInvalid or composeFailed
	ExitCode int
	Tail     []string
	Err      error
}

// composeExecute is the state machine: image, sweep, validate (up only), run.
func composeExecute(ctx context.Context, api *dockerAPI, p composeProject, action string) composeRunOutcome {
	if err := composeEnsureImage(ctx, api); err != nil {
		return composeRunOutcome{Err: err}
	}
	composeSweep(ctx, api, p.Name)
	if action == "up" {
		dockerStep(ctx, "validate", "start")
		vctx, cancel := context.WithTimeout(ctx, composeValidateTimeout)
		exit, tail, err := composeRun(vctx, api, p, []string{"config", "-q"})
		cancel()
		if err != nil {
			dockerStep(ctx, "validate", "fail")
			return composeRunOutcome{Err: err}
		}
		if exit != 0 {
			dockerStep(ctx, "validate", "fail")
			return composeRunOutcome{Reason: composeInvalid, ExitCode: exit, Tail: tail}
		}
		dockerStep(ctx, "validate", "done")
	}
	args := map[string][]string{"up": {"up", "-d"}, "down": {"down"}, "pull": {"pull"}}[action]
	dockerStep(ctx, "run", "start")
	exit, tail, err := composeRun(ctx, api, p, args)
	if err != nil {
		dockerStep(ctx, "run", "fail")
		return composeRunOutcome{Err: err}
	}
	if exit != 0 {
		dockerStep(ctx, "run", "fail")
		return composeRunOutcome{Reason: composeFailed, ExitCode: exit, Tail: tail}
	}
	dockerStep(ctx, "run", "done")
	return composeRunOutcome{OK: true}
}

func (h *Handlers) DockerComposeRunHandler(w http.ResponseWriter, r *http.Request) {
	action := mux.Vars(r)["action"]
	if action != "up" && action != "down" && action != "pull" {
		dockerRefuse(w, http.StatusNotFound, "unknown-action")
		return
	}
	p, ok := h.composeWriteGateOpen(w, r) // host, control, token, local-only, project, own stack
	if !ok {
		return
	}
	if len(p.ConfigFiles) == 0 || composeProjectDir(p) == "" {
		dockerRefuse(w, http.StatusConflict, composeNoLabels)
		return
	}
	hostID := dockerHostOf(r)
	release, ok := h.dockerLockStackOn(hostID, p.Name, p.Members)
	if !ok {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	defer release()
	// The lock is taken before the prune flag is read, as in DockerActionHandler.
	if (action == "up" || action == "pull") && h.dockerPruneRunning.Load() {
		dockerRefuse(w, http.StatusConflict, "prune-running")
		return
	}
	api, reason := h.dockerAPIFor(r)
	if api == nil {
		dockerRefuse(w, http.StatusServiceUnavailable, reason)
		return
	}
	api = api.forActions()
	if action != "pull" {
		for _, m := range p.Members {
			if name := m.name(); name != "" {
				dockerNotifications.expect(name, time.Now().Add(composeRunTimeout))
				defer func(n string) { dockerNotifications.expect(n, time.Now().Add(dockerNotifyExpectWindow)) }(name)
			}
		}
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(composeRunTimeout + time.Minute))
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), composeRunTimeout)
	defer cancel()
	if r.URL.Query().Get("stream") == "1" {
		emit, capture, finish := dockerProgressStream(w)
		ctx = withDockerProgress(ctx, emit)
		w = capture
		defer finish()
	}

	out := composeExecute(ctx, api, p, action)

	fields := map[string]any{"project": p.Name, "ok": out.OK}
	if out.ExitCode != 0 {
		fields["exitCode"] = out.ExitCode
	}
	if dockerRemote(r) {
		fields["host"] = hostID
	}
	if requestFromMCP(r) {
		fields = mergeActivityFields(activityFieldsFromRequest(r), fields)
	}
	logActivity(activityCategoryMutate, "compose."+action, fields, "compose "+action+" "+p.Name)

	switch {
	case out.Err != nil:
		logWarn(logComponentMutate, "compose %s %s failed: %v", action, p.Name, out.Err)
		writeDockerError(w, out.Err)
	case !out.OK:
		code := http.StatusBadGateway
		if out.Reason == composeInvalid {
			code = http.StatusUnprocessableEntity
		}
		tail := out.Tail
		if tail == nil {
			tail = []string{}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		writeJSON(w, map[string]any{"reason": out.Reason, "exitCode": out.ExitCode, "tail": tail})
	default:
		writeJSON(w, map[string]any{"ok": true, "action": action, "exitCode": 0})
	}
}
