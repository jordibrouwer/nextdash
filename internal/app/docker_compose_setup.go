package app

import (
	"context"
	"errors"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

/*
Setup check for Config -> Containers, and the one-line summary of each stack.

Setup: GET /api/docker/status gains compose.setup, six checks, each with ok and,
when it fails, one line saying what to change, in the real names of the
settings (NEXTDASH_COMPOSE_MAP, NEXTDASH_COMPOSE_IMAGE, NEXTDASH_COMPOSE_SOCKET,
NEXTDASH_DOCKER_CONTROL, NEXTDASH_RUN_AS_ROOT).

Summary: GET /api/docker/compose/summary, per stack: is a change pending, how
healthy it is, how often its containers restarted, and CPU and memory when
nextDash already samples them. It asks the daemon for the list and nothing else.
*/

const (
	composeCheckMapping = "mapping"
	composeCheckMount   = "mount"
	composeCheckOwner   = "owner"
	composeCheckImage   = "image"
	composeCheckSocket  = "socket"
	composeCheckControl = "control"
)

type composeFix struct {
	Text string `json:"text"` // one line
	Copy string `json:"copy"` // what the Copy button puts on the clipboard
}

type composeSetupRow struct {
	ID      string      `json:"id"`
	OK      bool        `json:"ok"`
	Skipped bool        `json:"skipped,omitempty"` // nothing to check yet; counts as ok
	Detail  string      `json:"detail"`
	Fix     *composeFix `json:"fix"`
}

type composeSetup struct {
	OK       bool              `json:"ok"`
	Failed   int               `json:"failed"`
	Projects int               `json:"projects"`
	Checks   []composeSetupRow `json:"checks"`
}

// composeSetupTTL is how long a setup answer is reused: Config polls the status.
var composeSetupTTL = 30 * time.Second

var composeSetupCache struct {
	mu   sync.Mutex
	at   time.Time
	data *composeSetup
}

func composeProjectNames(list []dockerContainerSummary) []string {
	set := map[string]bool{}
	for _, c := range list {
		if n := c.Labels[composeLabelProject]; n != "" && composeProjectName.MatchString(n) && !dockerIsOwnHelper(c.Labels) {
			set[n] = true
		}
	}
	out := make([]string, 0, len(set))
	for n := range set {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func composeUsers() string {
	return "uid " + strconv.Itoa(os.Geteuid())
}

// composeSetupCheck runs the six checks against the stacks the daemon lists.
func composeSetupCheck(ctx context.Context, api *dockerAPI, list []dockerContainerSummary) *composeSetup {
	maps := composeMap()
	var projects []composeProject
	for _, n := range composeProjectNames(list) {
		if p, ok := composeProjectFrom(list, n); ok && len(p.ConfigFiles) > 0 {
			projects = append(projects, p)
		}
	}
	out := &composeSetup{Projects: len(projects), Checks: []composeSetupRow{}}
	add := func(r composeSetupRow) {
		if !r.OK {
			out.Failed++
		}
		out.Checks = append(out.Checks, r)
	}

	// 1. mapping: every stack's folder appears inside this container.
	{
		row := composeSetupRow{ID: composeCheckMapping, OK: true}
		var unmapped []string
		var firstBad *composeProject
		for i := range projects {
			f := resolveComposeFile(projects[i].ConfigFiles[0], composeRoleCompose, maps)
			if f.State == composeUnmapped {
				unmapped = append(unmapped, projects[i].Name)
				if firstBad == nil {
					firstBad = &projects[i]
				}
			}
		}
		switch {
		case len(projects) == 0:
			row.Skipped = true
			row.Detail = "No compose stack is running yet."
		case len(unmapped) > 0:
			row.OK = false
			row.Detail = "Not mapped: " + strings.Join(unmapped, ", ") + ". nextDash cannot see their files."
			if sg := composeSuggestFor(*firstBad); sg != nil {
				row.Fix = &composeFix{Text: "Set " + sg.Env + " and mount " + sg.Mount + ".", Copy: sg.Env}
			} else {
				row.Fix = &composeFix{Text: "Set NEXTDASH_COMPOSE_MAP=<host folder>:<folder in this container> and mount the host folder there.", Copy: "NEXTDASH_COMPOSE_MAP="}
			}
		default:
			row.Detail = strconv.Itoa(len(projects)) + " stack(s) mapped through " + strconv.Itoa(len(maps)) + " mapping(s)."
		}
		add(row)
	}

	// 2. mount: the mapped folder is there and can be written.
	{
		row := composeSetupRow{ID: composeCheckMount, OK: true}
		if len(maps) == 0 {
			row.Skipped = true
			row.Detail = "Nothing is mapped yet."
		}
		var ro, gone []composeMapping
		for _, m := range maps {
			switch err := syscall.Access(m.Container, 2); {
			case err == nil:
			case errors.Is(err, syscall.EROFS):
				ro = append(ro, m)
			case errors.Is(err, syscall.ENOENT):
				gone = append(gone, m)
			}
		}
		switch {
		case len(gone) > 0:
			m := gone[0]
			row.OK = false
			row.Detail = m.Container + " is not mounted in this container."
			row.Fix = &composeFix{Text: "Mount " + m.Host + ":" + m.Container + " into nextDash.", Copy: m.Host + ":" + m.Container}
		case len(ro) > 0:
			m := ro[0]
			row.OK = false
			row.Detail = m.Container + " is mounted read-only: you can read the files but not save them."
			row.Fix = &composeFix{Text: "Mount " + m.Host + ":" + m.Container + " without :ro to edit and apply.", Copy: m.Host + ":" + m.Container}
		case len(maps) > 0:
			row.Detail = "Mounted read-write."
		}
		add(row)
	}

	// 3. owner: the user nextDash runs as can write the stacks' files.
	{
		row := composeSetupRow{ID: composeCheckOwner, OK: true}
		root := os.Geteuid() == 0
		var blocked []string
		var uid int
		for _, p := range projects {
			f := resolveComposeFile(p.ConfigFiles[0], composeRoleCompose, maps)
			if f.State != composeStateOK {
				continue
			}
			err := syscall.Access(f.Local, 2)
			if err == nil {
				err = syscall.Access(dirOf(f.Local), 2)
			}
			if err != nil && !errors.Is(err, syscall.EROFS) {
				blocked = append(blocked, p.Name)
				uid = f.UID
			}
		}
		switch {
		case len(projects) == 0:
			row.Skipped = true
			row.Detail = "nextDash runs as " + composeUsers() + "."
		case len(blocked) > 0:
			row.OK = false
			row.Detail = "nextDash runs as " + composeUsers() + "; the files of " + strings.Join(blocked, ", ") + " belong to uid " + strconv.Itoa(uid) + "."
			row.Fix = &composeFix{Text: "Set NEXTDASH_RUN_AS_ROOT=1, or give uid " + strconv.Itoa(os.Geteuid()) + " write access to the stack folder.", Copy: "NEXTDASH_RUN_AS_ROOT=1"}
		case root:
			row.Detail = "nextDash runs as root and can write every stack file."
		default:
			row.Detail = "nextDash runs as " + composeUsers() + " and can write the stack files."
		}
		add(row)
	}

	// 4. image: the helper's image is on this host.
	{
		row := composeSetupRow{ID: composeCheckImage, OK: true}
		img := composeHelperImage()
		if _, err := api.inspectImage(ctx, img); err != nil {
			row.OK = false
			var apiErr *dockerAPIError
			if errors.Is(err, errDockerNotFound) || (errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound) {
				row.Detail = img + " is not on this host yet."
				row.Fix = &composeFix{Text: "Pull it once with docker pull " + img + ", or run Up: nextDash pulls it then. Another image: NEXTDASH_COMPOSE_IMAGE.", Copy: "docker pull " + img}
			} else {
				row.Detail = "The daemon could not say whether " + img + " is there."
				row.Fix = &composeFix{Text: "Check the Docker connection, or set NEXTDASH_COMPOSE_IMAGE to an image that has the compose plugin.", Copy: "NEXTDASH_COMPOSE_IMAGE=" + img}
			}
		} else {
			row.Detail = img + " is on this host."
		}
		add(row)
	}

	// 5. socket: the path the helper mounts, on the host.
	{
		path, src := composeHostSocketSource(ctx, api)
		row := composeSetupRow{ID: composeCheckSocket, OK: true}
		switch src {
		case composeSocketEnv:
			row.Detail = path + " (NEXTDASH_COMPOSE_SOCKET)."
		case composeSocketMount:
			row.Detail = path + " on the host, from this container's own mount."
		case composeSocketNative:
			row.Detail = path + " (nextDash does not run in a container)."
		default:
			row.Detail = path + " (the usual place; not confirmed from a mount)."
			if dockerSelfID() != "" && dockerSocketPath() == "" {
				row.Detail += " If your socket is elsewhere on the host, say where."
				row.Fix = &composeFix{Text: "Set NEXTDASH_COMPOSE_SOCKET=<host path of docker.sock> if it is not " + path + ".", Copy: "NEXTDASH_COMPOSE_SOCKET=" + path}
			}
		}
		add(row)
	}

	// 6. control: Up, Down, Save and Apply are switched on.
	{
		row := composeSetupRow{ID: composeCheckControl, OK: dockerControlEnabled()}
		if row.OK {
			row.Detail = "Container actions are on (NEXTDASH_DOCKER_CONTROL=1)."
		} else {
			row.Detail = "Container actions are off, so Save, Up, Down and Apply are disabled."
			row.Fix = &composeFix{Text: "Set NEXTDASH_DOCKER_CONTROL=1.", Copy: "NEXTDASH_DOCKER_CONTROL=1"}
		}
		add(row)
	}
	out.OK = out.Failed == 0
	return out
}

func dirOf(p string) string {
	if i := strings.LastIndexByte(p, '/'); i > 0 {
		return p[:i]
	}
	return "/"
}

// composeSetupCached is composeSetupCheck, reused for composeSetupTTL.
func composeSetupCached(ctx context.Context, api *dockerAPI) *composeSetup {
	composeSetupCache.mu.Lock()
	defer composeSetupCache.mu.Unlock()
	if composeSetupCache.data != nil && time.Since(composeSetupCache.at) < composeSetupTTL {
		return composeSetupCache.data
	}
	list, err := api.listContainers(ctx)
	if err != nil {
		return nil
	}
	composeSetupCache.data = composeSetupCheck(ctx, api, list)
	composeSetupCache.at = time.Now()
	return composeSetupCache.data
}

// ---- stack summary ----

type composeStackSummary struct {
	Project    string   `json:"project"`
	Self       bool     `json:"self"`
	Containers int      `json:"containers"`
	Running    int      `json:"running"`
	Healthy    int      `json:"healthy"`   // running, and healthy or without a health check
	Unhealthy  int      `json:"unhealthy"` // health check failing
	Starting   int      `json:"starting"`  // health check still starting
	Text       string   `json:"text"`      // "4/4 healthy"
	Restarts   int      `json:"restarts"`  // restarts in the last 24 h, from the timeline
	Pending    bool     `json:"pending"`   // a file changed since the last Up nextDash ran
	Usage      bool     `json:"usage"`     // cpu and mem are real readings
	CPU        *float64 `json:"cpu"`       // percent of one core, summed; null without usage
	Mem        *uint64  `json:"mem"`       // bytes, summed; null without usage
	Watch      string   `json:"watch"`     // the state of the stack's watch, "" when none
}

// DockerComposeSummaryHandler is one line of facts per compose stack.
func (h *Handlers) DockerComposeSummaryHandler(w http.ResponseWriter, r *http.Request) {
	if dockerLocalOnly(w, r) {
		return
	}
	api, reason := h.dockerAPIFor(r)
	if api == nil {
		dockerRefuse(w, http.StatusServiceUnavailable, reason)
		return
	}
	list, err := api.listContainers(r.Context())
	if err != nil {
		writeDockerError(w, err)
		return
	}
	usage := h.store.GetSettings().DockerStatsHistory
	now := time.Now()
	applied := composeAppliedAll()
	out := []composeStackSummary{}
	for _, name := range composeProjectNames(list) {
		p, ok := composeProjectFrom(list, name)
		if !ok {
			continue
		}
		s := composeStackSummary{Project: name, Self: composeSelfOf(p), Usage: false}
		var cpu float64
		var mem uint64
		sampled := false
		for _, m := range p.Members {
			if dockerIsOwnHelper(m.Labels) {
				continue
			}
			s.Containers++
			running := m.State == "running"
			if running {
				s.Running++
			}
			switch {
			case strings.Contains(m.Status, "(unhealthy)"):
				s.Unhealthy++
			case strings.Contains(m.Status, "(health: starting)"):
				s.Starting++
			case running:
				s.Healthy++
			}
			s.Restarts += dockerTimelines.restartsSince(m.name(), now.Add(-24*time.Hour))
			if usage && running {
				if pt, ok := dockerStatsStore.latest(m.ID); ok {
					cpu += pt.CPU
					mem += pt.Mem
					sampled = true
				}
			}
		}
		s.Text = strconv.Itoa(s.Healthy) + "/" + strconv.Itoa(s.Containers) + " healthy"
		if sampled {
			s.Usage, s.CPU, s.Mem = true, &cpu, &mem
		}
		if shas := applied[name]; shas != nil {
			for path, was := range composeShasOf(p) {
				if old := shas[path]; old != "" && old != was {
					s.Pending = true
				}
			}
		}
		if st, ok := composeWatchGet(name); ok {
			s.Watch = st.State
		}
		out = append(out, s)
	}
	writeJSON(w, map[string]any{"projects": out})
}
