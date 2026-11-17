package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"gopkg.in/yaml.v3"
)

/*
Round 2 of compose management.

POST /api/docker/compose/{project}/check          compose config -q, no container touched; a body {file, content} checks that text in place of the file
GET  /api/docker/compose/{project}/logs/stream    every service's log in one NDJSON stream

Also here: the service name a run may be narrowed to, and the record of which
file contents nextDash last brought up (so the files view can say "edited, not
applied").
*/

const (
	composeLabelService      = "com.docker.compose.service"
	composeUnknownService    = "compose-unknown-service"
	composeServiceNotAllowed = "compose-service-not-allowed"
	composeAppliedFile       = "compose-applied.json"
)

// composeServiceName is what a compose service may be called.
var composeServiceName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)

// ---- services ----

// composeKnownServices is every service name the request may pick: the ones in
// the stack's readable compose files and the ones its containers carry as a label.
func composeKnownServices(p composeProject) map[string]bool {
	set := map[string]bool{}
	for _, m := range p.Members {
		if s := m.Labels[composeLabelService]; s != "" {
			set[s] = true
		}
	}
	for _, f := range composeFilesOf(p, composeMap()) {
		if f.Role != composeRoleCompose || f.State != composeStateOK {
			continue
		}
		src, err := readComposeFile(f)
		if err != nil {
			continue
		}
		var doc yaml.Node
		if yaml.Unmarshal(src, &doc) != nil || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
			continue
		}
		services := yamlMapGet(doc.Content[0], "services")
		if services == nil || services.Kind != yaml.MappingNode {
			continue
		}
		for i := 0; i+1 < len(services.Content); i += 2 {
			if k := services.Content[i].Value; composeServiceName.MatchString(k) {
				set[k] = true
			}
		}
	}
	return set
}

// composeServiceParam reads ?service=. Empty means the whole stack. A name that
// is no service of this stack is refused (422) and the caller stops.
func composeServiceParam(w http.ResponseWriter, r *http.Request, p composeProject) (string, bool) {
	// A query that does not parse (a stray ;) or an empty service= must not
	// quietly widen the run to the whole stack.
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil && strings.Contains(r.URL.RawQuery, "service") {
		dockerRefuse(w, http.StatusUnprocessableEntity, composeUnknownService)
		return "", false
	}
	if !q.Has("service") {
		return "", true
	}
	s := q.Get("service")
	if !composeServiceName.MatchString(s) || !composeKnownServices(p)[s] {
		dockerRefuse(w, http.StatusUnprocessableEntity, composeUnknownService)
		return "", false
	}
	return s, true
}

// composeMembersIn is the stack's containers, or only one service's.
func composeMembersIn(p composeProject, service string) []dockerContainerSummary {
	if service == "" {
		return p.Members
	}
	var out []dockerContainerSummary
	for _, m := range p.Members {
		if m.Labels[composeLabelService] == service {
			out = append(out, m)
		}
	}
	return out
}

// ---- edited, not applied ----

var composeAppliedMu sync.Mutex

func composeAppliedPath() string { return filepath.Join(ResolveDataDir(), composeAppliedFile) }

// composeAppliedAll is project -> host path -> sha256 as of the last Up.
func composeAppliedAll() map[string]map[string]string {
	out := map[string]map[string]string{}
	if b, err := os.ReadFile(composeAppliedPath()); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

func composeAppliedStore(project string, shas map[string]string) {
	composeAppliedMu.Lock()
	defer composeAppliedMu.Unlock()
	all := composeAppliedAll()
	if shas == nil {
		delete(all, project)
	} else {
		all[project] = shas
	}
	if err := writeIndentJSONFile(composeAppliedPath(), all); err != nil {
		logWarn(logComponentMutate, "compose applied state could not be written: %v", err)
	}
}

// composeShasOf is the sha256 of every readable file of the project right now.
func composeShasOf(p composeProject) map[string]string {
	out := map[string]string{}
	for _, f := range composeFilesOf(p, composeMap()) {
		if f.State != composeStateOK {
			continue
		}
		if src, err := readComposeFile(f); err == nil {
			out[f.HostPath] = composeSha(src)
		}
	}
	return out
}

// composeMarkPending fills appliedSha256 and pendingChange on a files answer.
func composeMarkPending(out *composeFilesView) {
	applied := composeAppliedAll()[out.Project]
	for i := range out.Files {
		f := &out.Files[i]
		f.AppliedSha256 = applied[f.HostPath]
		if f.AppliedSha256 != "" && f.Sha256 != "" && f.AppliedSha256 != f.Sha256 {
			f.PendingChange = true
			out.PendingChange = true
		}
	}
}

// ---- check ----

var composeErrPos = regexp.MustCompile(`(?i)line (\d+)(?:,? col(?:umn)? (\d+))?`)

// composeErrorPosition finds "line N" / "line N, column M" in compose's output.
func composeErrorPosition(tail []string) (line, col int) {
	m := composeErrPos.FindStringSubmatch(strings.Join(tail, "\n"))
	if m == nil {
		return 0, 0
	}
	line, _ = strconv.Atoi(m[1])
	col, _ = strconv.Atoi(m[2])
	return line, col
}

// composeStageMax is the longest text a staged Check takes: it travels in one
// environment variable, which the kernel caps near 128 KiB.
const composeStageMax = 96 << 10

type composeCheckBody struct {
	File    string `json:"file"`
	Content string `json:"content"`
	// Masked: Content is the masked view of an env file, edited; a value that is
	// still the mask stands for the value on disk.
	Masked bool `json:"masked"`
	// RemoveOrphans: the preview plans `up --remove-orphans`.
	RemoveOrphans bool `json:"removeOrphans"`
}

// composeStagedFromBody reads the optional body of a Check: {file, content}
// asks for that text to be checked in place of the saved file. No body is the
// saved files. A refusal has been written when ok is false.
func composeStagedFromBody(w http.ResponseWriter, r *http.Request, p composeProject) (*composeStage, bool) {
	st, _, ok := composeBodyFrom(w, r, p)
	return st, ok
}

// composeBodyFrom is composeStagedFromBody and the rest of the body's fields.
func composeBodyFrom(w http.ResponseWriter, r *http.Request, p composeProject) (*composeStage, composeCheckBody, bool) {
	var body composeCheckBody
	if r.ContentLength == 0 || r.Body == nil || r.Body == http.NoBody {
		return nil, body, true
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, composeFileMax+8<<10)).Decode(&body); err != nil {
		if err == io.EOF {
			return nil, body, true
		}
		dockerRefuse(w, http.StatusBadRequest, "body")
		return nil, body, false
	}
	st, ok := composeStageOf(w, p, body)
	return st, body, ok
}

func composeStageOf(w http.ResponseWriter, p composeProject, body composeCheckBody) (*composeStage, bool) {
	if body.File == "" {
		return nil, true
	}
	f, found := composeFileByID(composeFilesOf(p, composeMap()), body.File)
	if !found {
		writeDockerError(w, errDockerNotFound)
		return nil, false
	}
	if f.State != composeStateOK {
		composeRefuseState(w, f.State)
		return nil, false
	}
	if len(body.Content) > composeStageMax {
		dockerRefuse(w, http.StatusRequestEntityTooLarge, composeTooLarge)
		return nil, false
	}
	if f.Role == composeRoleEnv {
		content := body.Content
		if body.Masked {
			src, err := readComposeFile(f)
			if err != nil {
				writeDockerError(w, errDockerNotFound)
				return nil, false
			}
			merged, merr := composeMergeMaskedEnv(src, []byte(content))
			if merr != nil {
				composeRefuseMerge(w, merr)
				return nil, false
			}
			content = string(merged)
		}
		// An env file is not YAML: compose reads it as it is.
		return &composeStage{File: f.HostPath, Role: composeRoleEnv, Content: content}, true
	}
	// The same parse a save runs, so a text that is not YAML says where.
	if yerr, _ := checkComposeYAML([]byte(body.Content), f.ID == "c0"); yerr != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		writeJSON(w, map[string]any{"reason": composeYAMLInvalid, "line": yerr.Line, "column": yerr.Column, "message": yerr.Message})
		return nil, false
	}
	return &composeStage{File: f.HostPath, Role: composeRoleCompose, Content: body.Content}, true
}

// DockerComposeCheckHandler runs `compose config -q`: the file is validated by
// compose itself and no container is touched, so it takes no container lock.
func (h *Handlers) DockerComposeCheckHandler(w http.ResponseWriter, r *http.Request) {
	p, ok := h.composeWriteGateOpen(w, r)
	if !ok {
		return
	}
	if len(p.ConfigFiles) == 0 || composeProjectDir(p) == "" {
		dockerRefuse(w, http.StatusConflict, composeNoLabels)
		return
	}
	staged, ok := composeStagedFromBody(w, r, p)
	if !ok {
		return
	}
	p.Profiles = composeProfilesOf(p)
	// What the files use that nothing sets, read from the text (the unsaved
	// edit when there is one), whatever compose then says.
	varCheck := composeVarCheck(p, staged)
	// An edited .env stands in for the env file compose reads. A text for a
	// service's own env_file entry cannot: that one is checked as saved, and the
	// answer says so.
	stagedIgnored := false
	if staged != nil && staged.Role == composeRoleEnv {
		if _, can := composeEnvFilesStaged(p, staged.File); !can {
			staged, stagedIgnored = nil, true
		}
	}
	api, reason := h.dockerAPIFor(r)
	if api == nil {
		dockerRefuse(w, http.StatusServiceUnavailable, reason)
		return
	}
	// The project lock (no container's): a run's sweep must not delete the
	// check's helper, and a prune must not take its image.
	release, ok := h.dockerLock(composeLockKey(dockerHostOf(r), p.Name))
	if !ok {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	defer release()
	if h.dockerPruneRunning.Load() {
		dockerRefuse(w, http.StatusConflict, "prune-running")
		return
	}
	api = api.forActions()
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), composeRunTimeout)
	defer cancel()
	if err := composeEnsureImage(ctx, api); err != nil {
		writeDockerError(w, err)
		return
	}
	vctx, vcancel := context.WithTimeout(ctx, composeValidateTimeout)
	var (
		exit int
		tail []string
		err  error
	)
	if staged != nil {
		exit, tail, err = composeRunStaged(vctx, api, p, *staged, []string{"config", "-q"})
	} else {
		exit, tail, err = composeRun(vctx, api, p, []string{"config", "-q"})
	}
	vcancel()
	if err != nil {
		writeDockerError(w, err)
		return
	}
	if exit != 0 {
		tail = composeLastLines(tail)
		if tail == nil {
			tail = []string{}
		}
		body := map[string]any{"reason": composeInvalid, "exitCode": exit, "tail": tail, "varCheck": varCheck}
		if line, col := composeErrorPosition(tail); line > 0 {
			body["line"] = line
			if col > 0 {
				body["column"] = col
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		writeJSON(w, body)
		return
	}
	res := map[string]any{"ok": true, "varCheck": varCheck}
	// Variables nothing sets are not an error for a Check (an Up refuses on them).
	if names := composeUnsetNames(tail); len(names) > 0 {
		res["unsetVars"] = names
	}
	if stagedIgnored {
		res["stagedIgnored"] = true
	}
	writeJSON(w, res)
}

// ---- combined log ----

// composeLogSettle is how long the first lines of every service are held, so
// the history of all of them comes out in time order. After that lines go
// straight through.
var composeLogSettle = 400 * time.Millisecond

type composeLogLine struct {
	T         string `json:"t"`
	S         string `json:"s"`
	M         string `json:"m"`
	Service   string `json:"service"`
	Container string `json:"container"`
}

func composeLogTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}

// DockerComposeLogStreamHandler follows every container of a stack (or one
// service, ?service=) as NDJSON, each line tagged with its service. Behind the
// write token like a single container's stream; no control needed. Works on a
// remote host too: it reads logs only.
func (h *Handlers) DockerComposeLogStreamHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	api, reason := h.dockerAPIFor(r)
	if api == nil {
		code := http.StatusServiceUnavailable
		if reason == reasonUnknownDockerHost {
			code = http.StatusNotFound
		}
		dockerRefuse(w, code, reason)
		return
	}
	name := mux.Vars(r)["project"]
	if !composeProjectName.MatchString(name) {
		writeDockerError(w, errDockerNotFound)
		return
	}
	list, err := api.listContainers(r.Context())
	if err != nil {
		writeDockerError(w, err)
		return
	}
	p, ok := composeProjectFrom(list, name)
	if !ok {
		writeDockerError(w, errDockerNotFound)
		return
	}
	members := p.Members
	if s := r.URL.Query().Get("service"); s != "" {
		members = composeMembersIn(p, s)
		if len(members) == 0 {
			dockerRefuse(w, http.StatusUnprocessableEntity, composeUnknownService)
			return
		}
	}
	sort.SliceStable(members, func(i, j int) bool { return members[i].name() < members[j].name() })

	since := r.URL.Query().Get("since")
	if !dockerLogSince.MatchString(since) {
		since = ""
	}
	tail := dockerLogTail(r)
	if since != "" {
		tail = dockerLogResumeMax
	}
	type stream struct {
		c    dockerContainerSummary
		body io.ReadCloser
		tty  bool
	}
	var streams []stream
	closeAll := func() {
		for _, s := range streams {
			s.body.Close()
		}
	}
	for _, c := range members {
		in, err := api.inspectContainer(r.Context(), c.ID)
		if err != nil {
			closeAll()
			writeDockerError(w, err)
			return
		}
		body, err := api.logsFollow(r.Context(), c.ID, tail, since)
		if err != nil {
			closeAll()
			writeDockerError(w, err)
			return
		}
		streams = append(streams, stream{c: c, body: body, tty: in.Config.Tty})
	}

	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_ = rc.Flush()

	ctx := r.Context()
	lines := make(chan composeLogLine)
	var wg sync.WaitGroup
	// Defers run last-first: the bodies close (which ends the readers), then
	// the readers are waited for, so none outlives the handler.
	defer wg.Wait()
	defer closeAll()
	for _, s := range streams {
		wg.Add(1)
		go func() {
			defer wg.Done()
			svc := s.c.Labels[composeLabelService]
			if svc == "" {
				svc = s.c.name()
			}
			send := func(l composeLogLine) {
				select {
				case lines <- l:
				case <-ctx.Done():
				}
			}
			_ = readDockerLogFrames(s.body, s.tty, func(l dockerLogLine) {
				send(composeLogLine{T: l.T, S: l.S, M: l.M, Service: svc, Container: s.c.name()})
			}, func() {})
			// This container's follow is over (stopped, restarted, recreated).
			// The others keep the stream open, so say so: the client reconnects.
			send(composeLogLine{S: "end", Service: svc, Container: s.c.name()})
		}()
	}
	go func() { wg.Wait(); close(lines) }()

	enc := json.NewEncoder(w)
	emit := func(l composeLogLine) {
		_ = enc.Encode(l)
		_ = rc.Flush()
	}
	var pending, ends []composeLogLine // end markers wait behind the sorted history
	settled := false
	release := func() {
		sort.SliceStable(pending, func(i, j int) bool { return composeLogTime(pending[i].T).Before(composeLogTime(pending[j].T)) })
		for _, l := range append(pending, ends...) {
			emit(l)
		}
		pending, ends, settled = nil, nil, true
	}
	settle := time.NewTimer(composeLogSettle)
	defer settle.Stop()
	beat := time.NewTicker(dockerLogHeartbeat)
	defer beat.Stop()
	for {
		select {
		case l, open := <-lines:
			if !open {
				if !settled {
					release()
				}
				return
			}
			switch {
			case settled:
				emit(l)
			case l.S == "end":
				ends = append(ends, l)
			default:
				pending = append(pending, l)
			}
		case <-settle.C:
			if !settled {
				release()
			}
		case <-beat.C:
			_, _ = w.Write([]byte("\n"))
			_ = rc.Flush()
		case <-ctx.Done():
			return
		}
	}
}
