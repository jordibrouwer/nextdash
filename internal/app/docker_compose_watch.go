package app

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

/*
A watch on a stack after a successful Up.

For a bounded time nextDash looks at the stack's containers every few seconds
and says how it went:

	watching   inside the window, nothing wrong so far
	slow       the window was stretched: a health check has a long start period
	healthy    the window ended with no restart loop and nothing unhealthy
	problem    a container keeps restarting, is unhealthy, or exited with an error
	restoring  "Restore previous copy" is running (restore the copy taken before
	           the last save, then Up)
	restored   the restore's Up ended healthy

GET  /api/docker/compose/{project}/watch          the state ({"state":"none"} when there is none)
GET  /api/docker/compose/watches                  every project's state, for the bell
POST /api/docker/compose/{project}/watch/restore  restore the previous copy, then Up
POST /api/docker/compose/{project}/watch/dismiss  forget a finished watch

A problem raises a container notice (muted and ordered like any docker notice)
and stays open until the stack is healthy again. The state is in memory: a
restart of nextDash ends a watch.
*/

const (
	composeWatchWatching  = "watching"
	composeWatchSlow      = "slow"
	composeWatchHealthy   = "healthy"
	composeWatchProblem   = "problem"
	composeWatchRestoring = "restoring"
	composeWatchRestored  = "restored"
	composeWatchNone      = "none"

	composeNoRestore    = "compose-no-restore"
	composeWatchNotOpen = "compose-watch-state"

	composeNoticeKind = "compose-watch"

	// How long a save stays "the last save" for the watch to offer its backup.
	composeLastSaveAge = 30 * time.Minute
	// A restart count this far above the baseline is a loop.
	composeWatchRestartLimit = 2
)

var (
	composeWatchWindow      = 60 * time.Second
	composeWatchMaxWindow   = 10 * time.Minute
	composeWatchInterval    = 2 * time.Second
	composeWatchFailedPolls = 3
)

type composeWatchService struct {
	Service   string `json:"service"`
	Container string `json:"container"`
	State     string `json:"state"`  // the container's: running, restarting, exited ...
	Health    string `json:"health"` // healthy | unhealthy | starting | "" (no health check)
	Restarts  int    `json:"restarts"`
}

type composeWatchIssue struct {
	Service   string `json:"service"`
	Container string `json:"container"`
	Code      string `json:"code"` // restarting | unhealthy | exited | restore-failed
	Restarts  int    `json:"restarts"`
	Message   string `json:"message"`
}

type composeRestoreFile struct {
	File  string `json:"file"`
	Stamp string `json:"stamp"`
	sha   string // what the save wrote; the file must still be this
}

type composeRestoreInfo struct {
	Available bool                 `json:"available"`
	Reason    string               `json:"reason,omitempty"` // no-recent-save | file-changed
	Files     []composeRestoreFile `json:"files"`
	SavedAt   int64                `json:"savedAt,omitempty"` // when the newest of those saves happened, ms
}

// composeWatchState is what the routes show.
type composeWatchState struct {
	Project       string                `json:"project"`
	State         string                `json:"state"`
	StartedAt     int64                 `json:"startedAt"`
	UpdatedAt     int64                 `json:"updatedAt"`
	WindowSeconds int                   `json:"windowSeconds"`
	SecondsLeft   int                   `json:"secondsLeft"`
	Service       string                `json:"service,omitempty"` // set when the Up was for one service
	Services      []composeWatchService `json:"services"`
	Problem       *composeWatchIssue    `json:"problem"`
	Restore       composeRestoreInfo    `json:"restore"`
	AfterRestore  bool                  `json:"afterRestore"`

	deadline time.Time
	cancel   context.CancelFunc
	gen      int
	noticeOn string // the container name a problem notice was raised for
}

var composeWatches = struct {
	mu   sync.Mutex
	m    map[string]*composeWatchState
	next int
}{m: map[string]*composeWatchState{}}

func composeWatchSnapshot(w *composeWatchState) composeWatchState {
	c := *w
	c.Services = append([]composeWatchService{}, w.Services...)
	if w.Problem != nil {
		pr := *w.Problem
		c.Problem = &pr
	}
	c.Restore.Files = append([]composeRestoreFile{}, w.Restore.Files...)
	if left := time.Until(w.deadline); left > 0 && (w.State == composeWatchWatching || w.State == composeWatchSlow) {
		c.SecondsLeft = int((left + time.Second - 1) / time.Second)
	} else {
		c.SecondsLeft = 0
	}
	return c
}

func composeWatchGet(project string) (composeWatchState, bool) {
	composeWatches.mu.Lock()
	defer composeWatches.mu.Unlock()
	w := composeWatches.m[project]
	if w == nil {
		return composeWatchState{}, false
	}
	return composeWatchSnapshot(w), true
}

// composeWatchSet changes the watch of project if it is still generation gen.
func composeWatchSet(project string, gen int, fn func(w *composeWatchState)) bool {
	composeWatches.mu.Lock()
	defer composeWatches.mu.Unlock()
	w := composeWatches.m[project]
	if w == nil || w.gen != gen {
		return false
	}
	fn(w)
	w.UpdatedAt = time.Now().UnixMilli()
	return true
}

// composeWatchGoroutines counts the watch and restore goroutines still running,
// so a test can wait for them: one that outlives its test writes into a data
// directory the test is already removing ("directory not empty").
var composeWatchGoroutines sync.WaitGroup

func composeWatchResetForTest() {
	composeWatches.mu.Lock()
	for _, w := range composeWatches.m {
		if w.cancel != nil {
			w.cancel()
		}
	}
	composeWatches.m = map[string]*composeWatchState{}
	composeWatches.mu.Unlock()
	// Outside the lock: the goroutines take it on their way out.
	composeWatchGoroutines.Wait()
	composeSaves.mu.Lock()
	composeSaves.m = map[string]map[string]composeSaveRec{}
	composeSaves.mu.Unlock()
}

// ---- the saves a watch can undo ----

type composeSaveRec struct {
	FileID   string
	HostPath string
	Stamp    string // the backup taken just before this save
	NewSha   string // what the save wrote
	At       time.Time
}

var composeSaves = struct {
	mu sync.Mutex
	m  map[string]map[string]composeSaveRec // project lock key -> file id -> newest save
}{m: map[string]map[string]composeSaveRec{}}

// composeLastSaveStore remembers a save (or restore) of one file: its backup
// and what it wrote. Only the newest per file is kept.
func composeLastSaveStore(host, project string, f composeFile, stamp, newSha string) {
	composeSaves.mu.Lock()
	defer composeSaves.mu.Unlock()
	k := composeLockKey(host, project)
	if composeSaves.m[k] == nil {
		composeSaves.m[k] = map[string]composeSaveRec{}
	}
	composeSaves.m[k][f.ID] = composeSaveRec{FileID: f.ID, HostPath: f.HostPath, Stamp: stamp, NewSha: newSha, At: time.Now()}
}

// composeRestoreFor says whether the last saves can be put back: each still
// holds what it wrote, and is recent.
func composeRestoreFor(host string, p composeProject) composeRestoreInfo {
	info := composeRestoreInfo{Files: []composeRestoreFile{}}
	composeSaves.mu.Lock()
	recs := make([]composeSaveRec, 0)
	for _, r := range composeSaves.m[composeLockKey(host, p.Name)] {
		recs = append(recs, r)
	}
	composeSaves.mu.Unlock()
	sort.Slice(recs, func(a, b int) bool { return recs[a].FileID < recs[b].FileID })
	files := composeFilesOf(p, composeMap())
	reason := "no-recent-save"
	for _, r := range recs {
		if time.Since(r.At) > composeLastSaveAge {
			continue
		}
		f, ok := composeFileByID(files, r.FileID)
		if !ok || f.HostPath != r.HostPath || f.State != composeStateOK {
			reason = "file-changed"
			continue
		}
		cur, err := readComposeFile(f)
		if err != nil || composeSha(cur) != r.NewSha {
			reason = "file-changed"
			continue
		}
		info.Files = append(info.Files, composeRestoreFile{File: r.FileID, Stamp: r.Stamp, sha: r.NewSha})
		if ms := r.At.UnixMilli(); ms > info.SavedAt {
			info.SavedAt = ms
		}
	}
	if len(info.Files) > 0 {
		info.Available = true
		return info
	}
	info.Reason = reason
	return info
}

// ---- starting a watch ----

// composeWatchStart begins watching after a successful Up. service narrows it
// to one service's containers. A watch already running for the project ends.
func (h *Handlers) composeWatchStart(api *dockerAPI, p composeProject, service string) {
	h.composeWatchBegin(api, p, service, false)
}

func (h *Handlers) composeWatchBegin(api *dockerAPI, p composeProject, service string, afterRestore bool) {
	ctx, cancel := context.WithCancel(context.Background())
	now := time.Now()
	w := &composeWatchState{
		Project: p.Name, State: composeWatchWatching, StartedAt: now.UnixMilli(), UpdatedAt: now.UnixMilli(),
		WindowSeconds: int(composeWatchWindow / time.Second), Service: service, Services: []composeWatchService{},
		Restore: composeRestoreInfo{Files: []composeRestoreFile{}}, AfterRestore: afterRestore,
		deadline: now.Add(composeWatchWindow), cancel: cancel,
	}
	if !afterRestore {
		w.Restore = composeRestoreFor(dockerLocalHostID, p)
	}
	composeWatches.mu.Lock()
	prev := composeWatches.m[p.Name]
	composeWatches.next++
	w.gen = composeWatches.next
	if prev != nil {
		if prev.cancel != nil {
			prev.cancel()
		}
		// A problem that was told stays open until this Up ends healthy.
		w.noticeOn = prev.noticeOn
	}
	composeWatches.m[p.Name] = w
	composeWatches.mu.Unlock()
	composeWatchGoroutines.Add(1)
	go func() {
		defer composeWatchGoroutines.Done()
		h.composeWatchRun(ctx, api, p.Name, service, w.gen, afterRestore, composeWatchWindow, composeWatchInterval)
	}()
}

type composeWatchBase struct {
	restarts map[string]int
	seenBad  map[string]int // consecutive polls a container was restarting
}

// composeWatchPoll reads the stack's containers now.
func composeWatchPoll(ctx context.Context, api *dockerAPI, project, service string) ([]composeWatchService, []time.Duration, error) {
	list, err := api.listContainers(ctx)
	if err != nil {
		return nil, nil, err
	}
	p, ok := composeProjectFrom(list, project)
	if !ok {
		return []composeWatchService{}, nil, nil
	}
	members := composeMembersIn(p, service)
	sort.SliceStable(members, func(a, b int) bool { return members[a].name() < members[b].name() })
	out := make([]composeWatchService, 0, len(members))
	var starts []time.Duration
	for _, m := range members {
		in, err := api.inspectContainer(ctx, m.ID)
		if err != nil {
			return nil, nil, err
		}
		svc := m.Labels[composeLabelService]
		if svc == "" {
			svc = m.name()
		}
		health := ""
		if in.State.Health != nil {
			health = in.State.Health.Status
		}
		state := in.State.Status
		if state == "" {
			state = m.State
		}
		if health == "starting" && in.Config.Healthcheck != nil && in.Config.Healthcheck.StartPeriod > 0 {
			starts = append(starts, time.Duration(in.Config.Healthcheck.StartPeriod))
		}
		cs := composeWatchService{Service: svc, Container: m.name(), State: state, Health: health, Restarts: in.RestartCount}
		if state == "exited" && in.State.ExitCode != 0 {
			cs.Health = "exited:" + strconv.Itoa(in.State.ExitCode)
		}
		out = append(out, cs)
	}
	return out, starts, nil
}

func (h *Handlers) composeWatchRun(ctx context.Context, api *dockerAPI, project, service string, gen int, afterRestore bool, baseWindow, interval time.Duration) {
	base := composeWatchBase{restarts: map[string]int{}, seenBad: map[string]int{}}
	start := time.Now()
	failed := 0
	first := true
	// The restart counts are taken from the first poll that answers, not the
	// first poll: one that fails would leave them out, and every restart a
	// container ever had would then read as a restart loop.
	haveBase := false
	for {
		if !first {
			select {
			case <-ctx.Done():
				return
			case <-time.After(interval):
			}
		}
		pctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		svcs, starts, err := composeWatchPoll(pctx, api, project, service)
		cancel()
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			if failed++; failed >= composeWatchFailedPolls {
				// Not a verdict: the daemon cannot be asked. Drop the watch.
				logWarn(logComponentMutate, "compose watch of %s stopped: %v", project, err)
				composeWatches.mu.Lock()
				if w := composeWatches.m[project]; w != nil && w.gen == gen {
					delete(composeWatches.m, project)
				}
				composeWatches.mu.Unlock()
				return
			}
			first = false
			continue
		}
		failed = 0
		first = false
		if !haveBase {
			for _, s := range svcs {
				base.restarts[s.Container] = s.Restarts
			}
			haveBase = true
		}
		elapsed := time.Since(start)
		window := baseWindow
		for _, sp := range starts {
			if sp > window {
				window = sp
			}
		}
		if window > composeWatchMaxWindow {
			window = composeWatchMaxWindow
		}
		if prob := composeWatchJudge(svcs, &base, start); prob != nil {
			h.composeWatchFinish(project, gen, svcs, prob, afterRestore)
			return
		}
		anyStarting := false
		for _, s := range svcs {
			if s.Health == "starting" {
				anyStarting = true
			}
		}
		stretched := window > baseWindow
		done := elapsed >= window && !(anyStarting && window < composeWatchMaxWindow && elapsed < composeWatchMaxWindow)
		if len(svcs) == 0 {
			done = true
		}
		if done {
			h.composeWatchFinish(project, gen, svcs, nil, afterRestore)
			return
		}
		composeWatchSet(project, gen, func(w *composeWatchState) {
			w.Services = svcs
			w.WindowSeconds = int(window / time.Second)
			w.deadline = start.Add(window)
			w.State = composeWatchWatching
			if stretched || (anyStarting && elapsed >= baseWindow) {
				w.State = composeWatchSlow
			}
		})
	}
}

// composeWatchJudge is a problem if one of the containers is in a restart loop,
// unhealthy, or ended with an error; nil when none is.
func composeWatchJudge(svcs []composeWatchService, base *composeWatchBase, start time.Time) *composeWatchIssue {
	secs := int(time.Since(start) / time.Second)
	for _, s := range svcs {
		delta := s.Restarts - base.restarts[s.Container]
		if s.State == "restarting" {
			base.seenBad[s.Container]++
		} else {
			base.seenBad[s.Container] = 0
		}
		switch {
		case delta >= composeWatchRestartLimit || base.seenBad[s.Container] >= 2:
			n := delta
			if n < composeWatchRestartLimit {
				n = composeWatchRestartLimit
			}
			return &composeWatchIssue{Service: s.Service, Container: s.Container, Code: "restarting", Restarts: delta,
				Message: "restarted " + strconv.Itoa(n) + " times in " + strconv.Itoa(secs) + " s after Up"}
		case s.Health == "unhealthy":
			return &composeWatchIssue{Service: s.Service, Container: s.Container, Code: "unhealthy", Restarts: delta, Message: "its health check is failing"}
		case len(s.Health) > 7 && s.Health[:7] == "exited:":
			return &composeWatchIssue{Service: s.Service, Container: s.Container, Code: "exited", Restarts: delta, Message: "exited with code " + s.Health[7:]}
		}
	}
	return nil
}

// composeWatchFinish ends a watch with a verdict and tells whoever must know.
func (h *Handlers) composeWatchFinish(project string, gen int, svcs []composeWatchService, prob *composeWatchIssue, afterRestore bool) {
	var (
		noticeOn string
		title    string
		kept     bool
	)
	ok := composeWatchSet(project, gen, func(w *composeWatchState) {
		w.Services = svcs
		w.deadline = time.Time{}
		w.SecondsLeft = 0
		if prob != nil {
			w.State, w.Problem = composeWatchProblem, prob
			if afterRestore {
				w.Restore = composeRestoreInfo{Files: []composeRestoreFile{}, Reason: "after-restore"}
			}
			prev := w.noticeOn
			w.noticeOn = prob.Container
			noticeOn = prev
			title = project + ": " + prob.Service + " " + composeProblemPhrase(prob.Code)
			kept = true
			return
		}
		noticeOn = w.noticeOn
		w.noticeOn = ""
		w.Problem = nil
		w.State = composeWatchHealthy
		if afterRestore {
			w.State = composeWatchRestored
		}
		title = project + " is healthy"
		if afterRestore {
			title = project + ": restored the previous copy"
		}
	})
	if !ok {
		return
	}
	now := time.Now()
	if kept {
		n := containerNotice("down", prob.Container, title, prob.Message, now)
		n.Kind = composeNoticeKind
		n.URL = "/#docker/" + url.PathEscape(project)
		h.dispatchContainerNotices(context.Background(), []monitorNotification{n})
		return
	}
	if noticeOn != "" {
		// The problem told earlier is over.
		n := containerNotice("up", noticeOn, title, "", now)
		n.Kind = composeNoticeKind
		h.dispatchContainerNotices(context.Background(), []monitorNotification{n})
	}
}

func composeProblemPhrase(code string) string {
	switch code {
	case "unhealthy":
		return "is unhealthy"
	case "exited":
		return "exited with an error"
	case "restore-failed":
		return "could not be restored"
	}
	return "keeps restarting"
}

// ---- routes ----

func composeWatchWire(w *composeWatchState) map[string]any {
	return map[string]any{"project": w.Project, "state": w.State, "startedAt": w.StartedAt, "updatedAt": w.UpdatedAt,
		"windowSeconds": w.WindowSeconds, "secondsLeft": w.SecondsLeft, "service": w.Service, "services": w.Services,
		"problem": w.Problem, "restore": w.Restore, "afterRestore": w.AfterRestore}
}

// DockerComposeWatchHandler is the state of one project's watch.
func (h *Handlers) DockerComposeWatchHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	name := mux.Vars(r)["project"]
	if !composeProjectName.MatchString(name) {
		writeDockerError(w, errDockerNotFound)
		return
	}
	st, ok := composeWatchGet(name)
	if !ok {
		writeJSON(w, map[string]any{"project": name, "state": composeWatchNone})
		return
	}
	writeJSON(w, composeWatchWire(&st))
}

// DockerComposeWatchesHandler lists every project that has a watch.
func (h *Handlers) DockerComposeWatchesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	composeWatches.mu.Lock()
	var all []composeWatchState
	for _, st := range composeWatches.m {
		all = append(all, composeWatchSnapshot(st))
	}
	composeWatches.mu.Unlock()
	sort.Slice(all, func(a, b int) bool { return all[a].UpdatedAt > all[b].UpdatedAt })
	out := make([]map[string]any, 0, len(all))
	for i := range all {
		out = append(out, composeWatchWire(&all[i]))
	}
	writeJSON(w, map[string]any{"watches": out})
}

// DockerComposeWatchDismissHandler forgets a watch that has an end: healthy,
// restored, or a problem the reader decided to live with. The bell's notice for
// it closes.
func (h *Handlers) DockerComposeWatchDismissHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	name := mux.Vars(r)["project"]
	if !composeProjectName.MatchString(name) {
		writeDockerError(w, errDockerNotFound)
		return
	}
	composeWatches.mu.Lock()
	st := composeWatches.m[name]
	if st == nil {
		composeWatches.mu.Unlock()
		writeDockerError(w, errDockerNotFound)
		return
	}
	switch st.State {
	case composeWatchHealthy, composeWatchRestored, composeWatchProblem:
	default:
		composeWatches.mu.Unlock()
		dockerRefuse(w, http.StatusConflict, composeWatchNotOpen)
		return
	}
	noticeOn := st.noticeOn
	delete(composeWatches.m, name)
	composeWatches.mu.Unlock()
	if noticeOn != "" {
		h.closeOpenAlerts([]string{noticeKey(noticeSourceContainer, monitorNotification{Name: noticeOn, Kind: composeNoticeKind})})
	}
	writeJSON(w, map[string]any{"ok": true})
}

// DockerComposeWatchRestoreHandler puts the previous copy of the files back and
// runs Up. It answers at once (202); the watch says how it goes.
func (h *Handlers) DockerComposeWatchRestoreHandler(w http.ResponseWriter, r *http.Request) {
	p, ok := h.composeWriteGateOpen(w, r)
	if !ok {
		return
	}
	st, found := composeWatchGet(p.Name)
	if !found || st.State != composeWatchProblem || st.AfterRestore {
		dockerRefuse(w, http.StatusConflict, composeWatchNotOpen)
		return
	}
	if !st.Restore.Available {
		dockerRefuse(w, http.StatusConflict, composeNoRestore)
		return
	}
	if len(p.ConfigFiles) == 0 || composeProjectDir(p) == "" {
		dockerRefuse(w, http.StatusConflict, composeNoLabels)
		return
	}
	p.Profiles = composeProfilesOf(p)
	hostID := dockerHostOf(r)
	release, locked := h.dockerLockStackOn(hostID, p.Name, p.Members)
	if !locked {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	if h.dockerPruneRunning.Load() {
		release()
		dockerRefuse(w, http.StatusConflict, "prune-running")
		return
	}
	api, reason := h.dockerAPIFor(r)
	if api == nil {
		release()
		dockerRefuse(w, http.StatusServiceUnavailable, reason)
		return
	}
	api = api.forActions()
	gen := 0
	composeWatches.mu.Lock()
	if cur := composeWatches.m[p.Name]; cur != nil {
		gen = cur.gen
		cur.State, cur.Problem = composeWatchRestoring, nil
		cur.UpdatedAt = time.Now().UnixMilli()
	}
	composeWatches.mu.Unlock()
	fields := map[string]any{"project": p.Name}
	if requestFromMCP(r) {
		fields = mergeActivityFields(activityFieldsFromRequest(r), fields)
	}
	logActivity(activityCategoryMutate, "compose.watch-restore", fields, "compose restore previous copy "+p.Name)
	composeWatchGoroutines.Add(1)
	go func() {
		defer composeWatchGoroutines.Done()
		defer release()
		h.composeWatchRestore(context.WithoutCancel(r.Context()), api, p, st, gen, hostID)
	}()
	w.WriteHeader(http.StatusAccepted)
	writeJSON(w, map[string]any{"ok": true, "state": composeWatchRestoring})
}

// composeWatchRestore is the restoring: every file that still holds what the
// last save wrote gets its backup back (the current text goes to a backup of its
// own), then Up runs, then the stack is watched again.
func (h *Handlers) composeWatchRestore(ctx context.Context, api *dockerAPI, p composeProject, st composeWatchState, gen int, host string) {
	fail := func(code, msg string) {
		composeWatchSet(p.Name, gen, func(w *composeWatchState) {
			w.State = composeWatchProblem
			w.Problem = &composeWatchIssue{Service: p.Name, Container: "", Code: "restore-failed", Message: msg}
			if st.Problem != nil {
				w.Problem.Service, w.Problem.Container = st.Problem.Service, st.Problem.Container
			}
			w.Restore = composeRestoreInfo{Files: []composeRestoreFile{}, Reason: code}
			w.AfterRestore = true
		})
		logWarn(logComponentMutate, "compose restore of %s failed: %s", p.Name, msg)
	}
	maps := composeMap()
	files := composeFilesOf(p, maps)
	dir := composeBackupDir(host, p.Name)
	type job struct {
		f     composeFile
		data  []byte
		stamp string
	}
	var jobs []job
	for _, rf := range st.Restore.Files {
		f, ok := composeFileByID(files, rf.File)
		if !ok || f.State != composeStateOK {
			fail(composeStale, "A file changed since the save; nothing was restored.")
			return
		}
		cur, err := readComposeFile(f)
		if err != nil || composeSha(cur) != rf.sha {
			fail(composeStale, "A file changed since the save; nothing was restored.")
			return
		}
		if err := composeWritableCheck(f); err != nil {
			_, body := composeWriteRefusal(err)
			fail(body["reason"], "The file cannot be written: "+body["reason"])
			return
		}
		raw, err := os.ReadFile(filepath.Join(dir, composeFileKey(f.HostPath)+"."+rf.Stamp))
		if err != nil {
			fail(composeBackupFailed, "The backup copy could not be read.")
			return
		}
		jobs = append(jobs, job{f: f, data: raw, stamp: rf.Stamp})
	}
	for _, j := range jobs {
		cur, err := readComposeFile(j.f)
		if err != nil {
			fail(composeBackupFailed, "The file could not be read.")
			return
		}
		newStamp, err := backupComposeFile(host, p.Name, j.f, cur)
		if err != nil {
			fail(composeBackupFailed, "The current text could not be backed up first.")
			return
		}
		if _, err := writeComposeFile(j.f, j.data); err != nil {
			_, body := composeWriteRefusal(err)
			fail(body["reason"], "The file could not be written.")
			return
		}
		composeLastSaveStore(host, p.Name, j.f, newStamp, composeSha(j.data))
	}
	// Whatever ran before ran: do not refuse on blank variables now.
	shas := composeShasOf(p)
	out := composeExecute(ctx, api, p, "up", "", true, false)
	if !out.OK {
		msg := "Up failed after the restore"
		if len(out.Tail) > 0 {
			msg += ": " + out.Tail[len(out.Tail)-1]
		}
		fail(out.Reason, msg)
		return
	}
	composeAppliedStore(p.Name, shas)
	h.composeWatchBegin(api, p, "", true)
}
