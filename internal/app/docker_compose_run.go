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
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/mux"
	"gopkg.in/yaml.v3"
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
	// composeRingLines is what a helper's output keeps: enough for every
	// "variable is not set" warning of a big file; the answer shows the last
	// composeTailLines of it.
	composeRingLines = 200

	composeStagePath = "/tmp/nextdash-stage.env"

	composeTimeout   = "compose-timeout"
	composeUnsetVars = "compose-unset-vars"
	composeRunning   = "compose-running"

	composeOrphansNeedStack = "compose-orphans-need-stack"
)

// composeRunTimeout bounds ONE up, down or restart step; composePullTimeout one
// pull (a slow registry needs longer than a start does). Each step has its own
// budget, so a long pull never eats the time `up` needs. Variables so a test
// does not wait.
var (
	composeRunTimeout  = dockerActionTimeout
	composePullTimeout = 30 * time.Minute
)

// composeTotalBudget is the longest a whole action can take, for write
// deadlines and the notifier's expect window.
func composeTotalBudget(action string) time.Duration {
	switch action {
	case "update":
		return composeValidateTimeout + composePullTimeout + composeRunTimeout
	case "pull":
		return composePullTimeout
	case "up":
		return composeValidateTimeout + composeRunTimeout
	}
	return composeRunTimeout
}

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
	path, _ := composeHostSocketSource(ctx, api)
	return path
}

// Where composeHostSocketSource found the path.
const (
	composeSocketEnv     = "env"     // NEXTDASH_COMPOSE_SOCKET
	composeSocketMount   = "mount"   // the mount of this container
	composeSocketNative  = "native"  // not in a container: the configured path is the host's
	composeSocketDefault = "default" // nothing said: /var/run/docker.sock, unchecked
)

func composeHostSocketSource(ctx context.Context, api *dockerAPI) (string, string) {
	if v := envPath("NEXTDASH_COMPOSE_SOCKET"); v != "" {
		return v, composeSocketEnv
	}
	if inside := dockerSocketPath(); inside != "" {
		if self := dockerSelfID(); self != "" {
			if in, err := api.inspectContainer(ctx, self); err == nil {
				for _, m := range in.Mounts {
					if m.Destination == inside && m.Source != "" {
						return m.Source, composeSocketMount
					}
				}
			}
		} else {
			// Not in a container (a bare-metal or rootless daemon): the configured
			// path IS the host path. The default would make the daemon bind a
			// socket that is not there and create an empty directory instead.
			return inside, composeSocketNative
		}
	}
	return composeDefaultSocket, composeSocketDefault
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
// The stack's environment_file label becomes --env-file (compose would read a
// blank otherwise), and the profiles of its running services --profile.
func composeHelperBody(p composeProject, args []string, socket string) dockerCreateBody {
	wd := composeProjectDir(p)
	cmd := []string{"compose", "--ansi", "never", "-p", p.Name, "--project-directory", wd}
	binds := []string{socket + ":/var/run/docker.sock", wd + ":" + wd + ":ro"}
	seen := map[string]bool{wd: true}
	bindDir := func(path string) {
		if dir := filepath.Dir(path); !underDir(dir, wd) && !seen[dir] {
			seen[dir] = true
			binds = append(binds, dir+":"+dir+":ro")
		}
	}
	for _, e := range p.EnvFiles {
		if !filepath.IsAbs(e) {
			continue
		}
		cmd = append(cmd, "--env-file", e)
		if e != composeStagePath {
			bindDir(e)
		}
	}
	for _, pr := range p.Profiles {
		cmd = append(cmd, "--profile", pr)
	}
	for _, f := range p.ConfigFiles {
		cmd = append(cmd, "-f", f)
		bindDir(f)
	}
	cmd = append(cmd, args...)
	// Private images: the host's registry logins, only when the owner points at them.
	if dir := envPath("NEXTDASH_COMPOSE_DOCKER_CONFIG"); filepath.IsAbs(dir) {
		binds = append(binds, dir+":/root/.docker:ro")
	}
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

// composeProfilesOf is every profile a RUNNING service of the stack belongs to,
// read from the compose files. Without it `up` would treat those services as
// outside the project and leave them as they are, or drop them.
func composeProfilesOf(p composeProject) []string {
	running := map[string]bool{}
	for _, m := range p.Members {
		if s := m.Labels[composeLabelService]; s != "" {
			running[s] = true
		}
	}
	set := map[string]bool{}
	for _, f := range composeFilesOf(p, composeMap()) {
		if f.Role != composeRoleCompose || f.State != composeStateOK {
			continue
		}
		src, err := readComposeFile(f)
		if err != nil {
			continue
		}
		var doc yaml.Node
		if yaml.Unmarshal(src, &doc) != nil || len(doc.Content) == 0 {
			continue
		}
		services := yamlMapGet(doc.Content[0], "services")
		if services == nil || services.Kind != yaml.MappingNode {
			continue
		}
		for i := 0; i+1 < len(services.Content); i += 2 {
			if !running[services.Content[i].Value] {
				continue
			}
			profiles := yamlMapGet(services.Content[i+1], "profiles")
			if profiles == nil || profiles.Kind != yaml.SequenceNode {
				continue
			}
			for _, pr := range profiles.Content {
				if pr.Kind == yaml.ScalarNode && pr.Value != "" {
					set[pr.Value] = true
				}
			}
		}
	}
	out := make([]string, 0, len(set))
	for pr := range set {
		out = append(out, pr)
	}
	sort.Strings(out)
	return out
}

// composeRun is swappable like dockerBindMeasureRun, so a test can stand in for the daemon.
var composeRun = runComposeHelper

// composeLineRing keeps the last lines a helper printed. The follower writes
// while the run reads, so it has a lock.
type composeLineRing struct {
	mu    sync.Mutex
	lines []string
}

func (r *composeLineRing) add(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lines = append(r.lines, line)
	if len(r.lines) > composeRingLines {
		r.lines = r.lines[len(r.lines)-composeRingLines:]
	}
}

func (r *composeLineRing) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.lines...)
}

// composeLastLines is what an answer shows of a helper's output.
func composeLastLines(lines []string) []string {
	if len(lines) > composeTailLines {
		return lines[len(lines)-composeTailLines:]
	}
	return lines
}

// runComposeHelper runs one compose command in one helper and reports its exit
// code and the last lines it printed. err is the daemon's, not compose's: a
// non-zero exit is not an error here.
func runComposeHelper(ctx context.Context, api *dockerAPI, p composeProject, args []string) (exit int, tail []string, err error) {
	return runComposeHelperWith(ctx, api, p, args, nil)
}

// composeStage is text to run compose on in place of one of the stack's files:
// a Check of what the editor holds, before anything is written. Role says what
// kind of file it is: a compose file goes in on stdin, an env file is written to
// a path inside the helper and handed over with --env-file.
type composeStage struct {
	File    string // the host path of the file the text stands in for
	Role    string
	Content string
}

// composeRunStaged is composeRun with one file's text swapped; swappable for tests.
var composeRunStaged = func(ctx context.Context, api *dockerAPI, p composeProject, st composeStage, args []string) (int, []string, error) {
	return runComposeHelperWith(ctx, api, p, args, &st)
}

// composeEnvFilesStaged is the helper's env-file list with the staged env file
// in the place of the saved one. ok is false when the text cannot stand in for
// anything compose reads through --env-file (a service's own env_file entry).
func composeEnvFilesStaged(p composeProject, hostPath string) ([]string, bool) {
	files := append([]string(nil), p.EnvFiles...)
	for i, e := range files {
		if e == hostPath {
			files[i] = composeStagePath
			return files, true
		}
	}
	if len(files) == 0 && hostPath == filepath.Join(composeProjectDir(p), ".env") {
		return []string{composeStagePath}, true
	}
	return nil, false
}

// composeStagedBody feeds the text to the helper through an environment
// variable, so no file is written on the host. The helper's own sh does the
// piping or the writing; docker's CLI image has one. The text, secrets included,
// is therefore in the helper's config (docker inspect) until the helper is
// removed a few seconds later: accepted, and the reason for the size cap.
func composeStagedBody(body dockerCreateBody, st composeStage) dockerCreateBody {
	cmd := append([]string(nil), body["Cmd"].([]string)...)
	script := `printf '%s' "$NEXTDASH_COMPOSE_STAGE" | docker "$@"`
	if st.Role == composeRoleEnv {
		script = `printf '%s' "$NEXTDASH_COMPOSE_STAGE" > ` + composeStagePath + ` && exec docker "$@"`
	} else {
		for i := 0; i+1 < len(cmd); i++ {
			if cmd[i] == "-f" && cmd[i+1] == st.File {
				cmd[i+1] = "-"
			}
		}
	}
	body["Entrypoint"] = []string{"sh", "-c"}
	body["Cmd"] = append([]string{script, "sh"}, cmd...)
	body["Env"] = []string{"NEXTDASH_COMPOSE_STAGE=" + st.Content}
	return body
}

// errComposeTimeout is a step that ran past its budget while compose was
// changing containers. The helper is NOT killed: it is left to finish.
var errComposeTimeout = errors.New("compose is still running past its time limit")

func runComposeHelperWith(ctx context.Context, api *dockerAPI, p composeProject, args []string, stage *composeStage) (exit int, tail []string, err error) {
	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	if stage != nil && stage.Role == composeRoleEnv {
		if files, ok := composeEnvFilesStaged(p, stage.File); ok {
			p.EnvFiles = files
		}
	}
	body := composeHelperBody(p, args, composeHostSocket(ctx, api))
	if stage != nil {
		body = composeStagedBody(body, *stage)
	}
	id, err := api.createContainer(ctx, "nextdash-compose-"+p.Name+"-"+hex.EncodeToString(suffix), body)
	if err != nil {
		return 0, nil, err // nothing was made, so nothing to remove
	}
	announce := len(args) > 0 && args[0] != "config"
	// Only a step that changes containers is spared a kill at its time limit.
	mutating := len(args) > 0 && (args[0] == "up" || args[0] == "down" || args[0] == "restart")
	var (
		keep    bool        // leave the helper running: compose is mid-flight
		stopped atomic.Bool // the run is over: the follower must not emit any more
		ring    composeLineRing
	)
	followed := make(chan struct{})
	// Removed however it ends -- start fails, the follow breaks, the wait fails,
	// the run times out, a panic -- on a context of its own: the run's may be
	// the one that ran out. Force takes a running helper down too, except when
	// compose is in the middle of `up`: killing that leaves a half-recreated stack.
	defer func() {
		if keep {
			stopped.Store(true)
			logWarn(logComponentMutate, "compose helper %s is still running past its limit and was left to finish", id)
			return
		}
		if announce {
			dockerStep(ctx, "cleanup", "start")
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		resp, derr := api.do(cleanup, http.MethodDelete, "/containers/"+url.PathEscape(id)+"?force=true&v=true", nil)
		if derr == nil {
			resp.Body.Close()
		}
		// The follower ends with the container; wait for it on every path, so no
		// line is written after this function has returned.
		select {
		case <-followed:
		case <-time.After(5 * time.Second):
		}
		stopped.Store(true)
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
		close(followed)
		return 0, nil, err
	}
	go func() {
		defer close(followed)
		rc, ferr := api.logsFollow(ctx, id, 0, "")
		if ferr != nil {
			return
		}
		defer rc.Close()
		_ = readDockerLogFrames(rc, false, func(l dockerLogLine) {
			if stopped.Load() {
				return
			}
			ring.add(l.M)
			dockerLog(ctx, "%s", l.M)
		}, func() {})
	}()
	var waited struct {
		StatusCode int `json:"StatusCode"`
	}
	resp, werr := api.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/wait", nil)
	if werr != nil {
		if mutating && (errors.Is(werr, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded)) {
			keep = true
			return 0, nil, errComposeTimeout
		}
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
	return waited.StatusCode, ring.snapshot(), nil
}

// composeSweep removes this project's finished helpers that an earlier process
// left behind. A running one is somebody's run and is left alone; running says
// whether there is one.
func composeSweep(ctx context.Context, api *dockerAPI, project string) (running bool) {
	list, err := api.listAllContainers(ctx)
	if err != nil {
		return false
	}
	for _, c := range list {
		if c.Labels[dockerHelperLabel] != "compose" || c.Labels["nextdash.compose.project"] != project {
			continue
		}
		if composeHelperLive(c) {
			running = true
			continue
		}
		composeRemoveHelper(ctx, api, c.ID)
	}
	return running
}

// composeSweepAll is the same for every project, run once at start-up: a helper
// of a stack that is never run again would otherwise stay for good, hidden from
// every list.
func composeSweepAll(ctx context.Context, api *dockerAPI) {
	list, err := api.listAllContainers(ctx)
	if err != nil {
		return
	}
	for _, c := range list {
		if c.Labels[dockerHelperLabel] == "compose" && !composeHelperLive(c) {
			composeRemoveHelper(ctx, api, c.ID)
		}
	}
}

func composeHelperLive(c dockerContainerSummary) bool {
	return c.State == "running" || c.State == "restarting" || c.State == "paused"
}

func composeRemoveHelper(ctx context.Context, api *dockerAPI, id string) {
	if resp, derr := api.do(ctx, http.MethodDelete, "/containers/"+url.PathEscape(id)+"?force=true&v=true", nil); derr == nil {
		resp.Body.Close()
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
	Reason   string // composeInvalid, composeFailed, composeTimeout, composeUnsetVars or composeRunning
	ExitCode int
	Tail     []string
	Err      error
	Vars     []string // variables the files use but nothing sets
	Left     bool     // composeTimeout: the helper is still running
	Minutes  int      // composeTimeout: the budget that ran out
	Hint     string   // a pointer to the likely fix, from the output
}

var composeUnsetVar = regexp.MustCompile(`The \\?"([A-Za-z_][A-Za-z0-9_]*)\\?" variable is not set`)

// composeUnsetNames reads the warnings `compose config` prints for a variable
// that nothing sets: it exits 0, and the stack would start with a blank.
func composeUnsetNames(lines []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, l := range lines {
		for _, m := range composeUnsetVar.FindAllStringSubmatch(l, -1) {
			if !seen[m[1]] {
				seen[m[1]] = true
				out = append(out, m[1])
			}
		}
	}
	sort.Strings(out)
	return out
}

var composeAuthFail = regexp.MustCompile(`(?i)unauthorized|authentication required|pull access denied|requested access to the resource is denied|denied: `)

const composeRegistryHint = "A private image needs a registry login the helper does not have. Set NEXTDASH_COMPOSE_DOCKER_CONFIG to the host folder with the docker config.json (it is mounted read-only), or pull the image once on the host."

func composeHintFor(lines []string) string {
	if composeAuthFail.MatchString(strings.Join(lines, "\n")) {
		return composeRegistryHint
	}
	return ""
}

// composeStepFailed turns one step's error into an outcome: a time limit gets
// its own honest answer, anything else is the daemon's.
func composeStepFailed(err error, budget time.Duration) composeRunOutcome {
	switch {
	case errors.Is(err, errComposeTimeout):
		return composeRunOutcome{Reason: composeTimeout, Left: true, Minutes: int(budget / time.Minute), Err: nil}
	case errors.Is(err, context.DeadlineExceeded):
		return composeRunOutcome{Reason: composeTimeout, Minutes: int(budget / time.Minute)}
	}
	return composeRunOutcome{Err: err}
}

// composeExecute is the state machine: image, sweep, validate (up and update),
// then the run. service, when set, is the last argument of every compose
// command; update is a pull followed by an up. Every step has its own time
// budget. allowUnset lets a run go on although a variable is not set;
// removeOrphans adds --remove-orphans to `up` (stack-wide only).
func composeExecute(ctx context.Context, api *dockerAPI, p composeProject, action, service string, allowUnset, removeOrphans bool) composeRunOutcome {
	if err := composeEnsureImage(ctx, api); err != nil {
		return composeRunOutcome{Err: err}
	}
	if composeSweep(ctx, api, p.Name) {
		return composeRunOutcome{Reason: composeRunning}
	}
	if action == "up" || action == "update" {
		dockerStep(ctx, "validate", "start")
		vctx, cancel := context.WithTimeout(ctx, composeValidateTimeout)
		exit, tail, err := composeRun(vctx, api, p, []string{"config", "-q"})
		cancel()
		if err != nil {
			dockerStep(ctx, "validate", "fail")
			return composeStepFailed(err, composeValidateTimeout)
		}
		if exit != 0 {
			dockerStep(ctx, "validate", "fail")
			return composeRunOutcome{Reason: composeInvalid, ExitCode: exit, Tail: composeLastLines(tail)}
		}
		// compose only warns about a variable nothing sets, and then fills in a
		// blank: refuse before a container is touched, and say which.
		if names := composeUnsetNames(tail); len(names) > 0 && !allowUnset {
			dockerStep(ctx, "validate", "fail")
			return composeRunOutcome{Reason: composeUnsetVars, Vars: names}
		}
		dockerStep(ctx, "validate", "done")
	}
	type step struct {
		name   string
		args   []string
		budget time.Duration
	}
	upArgs := []string{"up", "-d"}
	if removeOrphans {
		upArgs = append(upArgs, "--remove-orphans")
	}
	with := func(args ...string) []string {
		if service != "" {
			args = append(args, service)
		}
		return args
	}
	steps := map[string][]step{
		"up":      {{"run", with(upArgs...), composeRunTimeout}},
		"down":    {{"run", []string{"down"}, composeRunTimeout}},
		"pull":    {{"run", with("pull"), composePullTimeout}},
		"restart": {{"run", with("restart"), composeRunTimeout}},
		"update":  {{"pull", with("pull"), composePullTimeout}, {"run", with(upArgs...), composeRunTimeout}},
	}[action]
	for _, st := range steps {
		dockerStep(ctx, st.name, "start")
		sctx, cancel := context.WithTimeout(ctx, st.budget)
		exit, tail, err := composeRun(sctx, api, p, st.args)
		cancel()
		if err != nil {
			dockerStep(ctx, st.name, "fail")
			return composeStepFailed(err, st.budget)
		}
		if exit != 0 {
			dockerStep(ctx, st.name, "fail")
			tail = composeLastLines(tail)
			return composeRunOutcome{Reason: composeFailed, ExitCode: exit, Tail: tail, Hint: composeHintFor(tail)}
		}
		dockerStep(ctx, st.name, "done")
	}
	return composeRunOutcome{OK: true}
}

// composeRecordUpdates writes one update-history entry for every container of
// the run whose image changed, found by name once the run is over.
func (h *Handlers) composeRecordUpdates(ctx context.Context, api *dockerAPI, before []dockerContainerSummary) {
	after, err := api.listContainers(ctx)
	if err != nil {
		return
	}
	now := map[string]dockerContainerSummary{}
	for _, c := range after {
		now[c.name()] = c
	}
	for _, b := range before {
		c, ok := now[b.name()]
		if !ok || b.name() == "" || c.ImageID == "" || c.ImageID == b.ImageID {
			continue
		}
		h.recordDockerUpdate(ctx, api, "update", b.name(), b.Image, b.ImageID, c.ImageID, "compose")
	}
}

func (h *Handlers) DockerComposeRunHandler(w http.ResponseWriter, r *http.Request) {
	action := mux.Vars(r)["action"]
	if action != "up" && action != "down" && action != "pull" && action != "restart" && action != "update" {
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
	p.Profiles = composeProfilesOf(p)
	service, ok := composeServiceParam(w, r, p)
	if !ok {
		return
	}
	if service != "" && action == "down" {
		dockerRefuse(w, http.StatusUnprocessableEntity, composeServiceNotAllowed)
		return
	}
	removeOrphans := r.URL.Query().Get("removeOrphans") == "1" || r.URL.Query().Get("remove-orphans") == "1"
	if removeOrphans && service != "" {
		// Orphans belong to the stack, not to one service.
		dockerRefuse(w, http.StatusUnprocessableEntity, composeOrphansNeedStack)
		return
	}
	removeOrphans = removeOrphans && (action == "up" || action == "update")
	members := composeMembersIn(p, service)
	hostID := dockerHostOf(r)
	release, ok := h.dockerLockStackOn(hostID, p.Name, members)
	if !ok {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	defer release()
	// The lock is taken before the prune flag is read, as in DockerActionHandler.
	if action != "down" && action != "restart" && h.dockerPruneRunning.Load() {
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
		for _, m := range members {
			if name := m.name(); name != "" {
				dockerNotifications.expect(name, time.Now().Add(composeTotalBudget(action)))
				defer func(n string) { dockerNotifications.expect(n, time.Now().Add(dockerNotifyExpectWindow)) }(name)
			}
		}
	}
	// No deadline on the run as a whole: every step of composeExecute has its own.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(composeTotalBudget(action) + time.Minute))
	ctx := context.WithoutCancel(r.Context())
	if r.URL.Query().Get("stream") == "1" {
		emit, capture, finish := dockerProgressStream(w)
		ctx = withDockerProgress(ctx, emit)
		w = capture
		defer finish()
	}

	// What compose is about to read; kept as "applied" only if the run works.
	var shas map[string]string
	if service == "" && (action == "up" || action == "update") {
		shas = composeShasOf(p)
	}
	out := composeExecute(ctx, api, p, action, service, r.URL.Query().Get("allowUnset") == "1" || r.URL.Query().Get("allow-unset") == "1", removeOrphans)
	if out.OK {
		if action == "up" || action == "update" {
			h.composeWatchStart(api, p, service)
		}
		switch {
		case shas != nil:
			composeAppliedStore(p.Name, shas)
		case action == "down":
			composeAppliedStore(p.Name, nil)
		}
		if action == "update" {
			h.composeRecordUpdates(ctx, api, members)
		}
	}

	fields := map[string]any{"project": p.Name, "ok": out.OK}
	if service != "" {
		fields["service"] = service
	}
	if removeOrphans {
		fields["removeOrphans"] = true
	}
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
	case out.Reason == composeRunning:
		dockerRefuse(w, http.StatusConflict, composeRunning)
	case out.Reason == composeUnsetVars:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]any{"reason": composeUnsetVars, "names": out.Vars, "vars": out.Vars,
			"message":  "These variables are used in the compose files but not set: " + strings.Join(out.Vars, ", ") + ". Put them in the stack's env file (or confirm to run with blanks).",
			"varCheck": composeVarCheck(p, nil)})
	case out.Reason == composeTimeout:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGatewayTimeout)
		msg := "The step ran longer than " + strconv.Itoa(out.Minutes) + " minutes and was stopped; no container was changed by it."
		if out.Left {
			msg = "Compose is still working after " + strconv.Itoa(out.Minutes) + " minutes and was left to finish; it was not stopped. Follow the stack logs, then check the stack. The next run is refused until it is done."
		}
		writeJSON(w, map[string]any{"reason": composeTimeout, "running": out.Left, "message": msg})
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
		resp := map[string]any{"reason": out.Reason, "exitCode": out.ExitCode, "tail": tail}
		if out.Hint != "" {
			resp["hint"] = out.Hint
		}
		if out.Reason == composeInvalid && (action == "up" || action == "update") {
			resp["varCheck"] = composeVarCheck(p, nil)
		}
		writeJSON(w, resp)
	default:
		res := map[string]any{"ok": true, "action": action, "exitCode": 0}
		if service != "" {
			res["service"] = service
		}
		writeJSON(w, res)
	}
}
