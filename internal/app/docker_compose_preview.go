package app

import (
	"context"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

/*
What Up would do, before it does it.

POST /api/docker/compose/{project}/preview    body {file?, content?, masked?, removeOrphans?}

Runs `docker compose up -d --dry-run` in the helper: nothing is created, changed
or removed. The answer sorts the stack's containers into what would be
recreated, created, started, left alone and left over (orphans), each with the
reason. With {file, content} the plan is for that unsaved text, which is what
Apply shows before it saves. Compose older than 2.20 does not know --dry-run:
that is the answer `compose-too-old`.
*/

const (
	composeTooOld = "compose-too-old"

	// Reason codes of one entry.
	composeReasonImage      = "image"       // the image reference changed (from, to)
	composeReasonPorts      = "ports"       // the published host ports changed (from, to)
	composeReasonConfig     = "config"      // compose's config hash changed; the diff is not one of the above
	composeReasonNewService = "new-service" // a service that has no container yet
	composeReasonStopped    = "stopped"     // exists, is not running; Up starts it
	composeReasonSameConfig = "same-config" // nothing to do
	composeReasonNotInFile  = "not-in-file" // a container of the project whose service is no longer in the files
	composeMinVersion       = "2.20"
)

type composeReason struct {
	Code string `json:"code"`
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
}

type composePlanEntry struct {
	Service    string          `json:"service"`
	Container  string          `json:"container"`
	Reason     string          `json:"reason"` // the first of Reasons
	Reasons    []composeReason `json:"reasons"`
	WillRemove bool            `json:"willRemove,omitempty"` // orphans only
}

type composePlan struct {
	Recreate      []composePlanEntry `json:"recreate"`
	Create        []composePlanEntry `json:"create"`
	Start         []composePlanEntry `json:"start"`
	Orphans       []composePlanEntry `json:"orphans"`
	Unchanged     []composePlanEntry `json:"unchanged"`
	RemoveOrphans bool               `json:"removeOrphans"`
	Changes       int                `json:"changes"` // what Up would touch: recreate + create + start + orphans removed
}

var composePlanLine = regexp.MustCompile(`(?i)(?:dry-run mode\s*-\s*)?\b(Container|Network|Volume)\s+(\S+)\s+(Recreate|Recreated|Recreating|Creating|Created|Starting|Started|Running|Removing|Removed|Stopping|Stopped|Restarting|Restarted)\b`)

var composeDryRunUnknown = regexp.MustCompile(`(?i)unknown (shorthand )?flag.{0,20}dry-run|flag provided but not defined.{0,20}dry-run|dry-run.{0,40}(not supported|unknown)`)

var composeOrphanWarn = regexp.MustCompile(`Found orphan containers \(\[([^\]]*)\]\)`)

var composeVersionLine = regexp.MustCompile(`^v?(\d+\.\d+(?:\.\d+)?)`)

// composeInterpolate fills ${VAR}, ${VAR:-d} and $VAR from env, the way
// compose would; an unset variable is blank. Only for comparing a service's
// image with the container's, never written anywhere.
func composeInterpolate(s string, env map[string]string) string {
	if !strings.Contains(s, "$") {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != '$' || i+1 >= len(s) {
			b.WriteByte(s[i])
			continue
		}
		if s[i+1] == '$' {
			b.WriteByte('$')
			i++
			continue
		}
		var name, rest string
		end := i
		if s[i+1] == '{' {
			depth, j := 1, i+2
			for ; j < len(s) && depth > 0; j++ {
				if s[j] == '{' {
					depth++
				} else if s[j] == '}' {
					depth--
				}
			}
			if depth != 0 {
				b.WriteString(s[i:])
				return b.String()
			}
			inner := s[i+2 : j-1]
			name = composeVarName.FindString(inner)
			rest = inner[len(name):]
			end = j - 1
		} else if name = composeVarName.FindString(s[i+1:]); name != "" {
			end = i + len(name)
		} else {
			b.WriteByte('$')
			continue
		}
		val, set := env[name]
		switch {
		case strings.HasPrefix(rest, ":-"):
			if !set || val == "" {
				val = composeInterpolate(rest[2:], env)
			}
		case strings.HasPrefix(rest, "-"):
			if !set {
				val = composeInterpolate(rest[1:], env)
			}
		case strings.HasPrefix(rest, ":+"):
			val = ""
			if set && env[name] != "" {
				val = composeInterpolate(rest[2:], env)
			}
		case strings.HasPrefix(rest, "+"):
			val = ""
			if set {
				val = composeInterpolate(rest[1:], env)
			}
		}
		b.WriteString(val)
		i = end
	}
	return b.String()
}

type composeSvcDef struct {
	image string
	ports []string // host ports, as written
}

// composeServiceDefs reads image and published ports of every service from the
// compose files (the unsaved text in place of its file), a later file over an
// earlier one. Variables are filled from the stack's env files.
func composeServiceDefs(p composeProject, staged *composeStage) map[string]composeSvcDef {
	files := composeFilesOf(p, composeMap())
	env, _, _ := composeVarSources(p, files, staged)
	defs := map[string]composeSvcDef{}
	for _, f := range files {
		if f.Role != composeRoleCompose {
			continue
		}
		var src []byte
		if staged != nil && staged.Role == composeRoleCompose && staged.File == f.HostPath {
			src = []byte(staged.Content)
		} else if f.State == composeStateOK {
			b, err := readComposeFile(f)
			if err != nil {
				continue
			}
			src = b
		} else {
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
			name, svc := services.Content[i].Value, services.Content[i+1]
			d := defs[name]
			if im := yamlMapGet(svc, "image"); im != nil && im.Kind == yaml.ScalarNode {
				d.image = composeInterpolate(im.Value, env)
			}
			if pn := yamlMapGet(svc, "ports"); pn != nil && pn.Kind == yaml.SequenceNode {
				d.ports = nil
				for _, it := range pn.Content {
					if hp := composeHostPortOf(it, env); hp != "" {
						d.ports = append(d.ports, hp)
					}
				}
			}
			defs[name] = d
		}
	}
	return defs
}

// composeHostPortOf is the published host port of one ports: entry, or "".
func composeHostPortOf(n *yaml.Node, env map[string]string) string {
	switch n.Kind {
	case yaml.ScalarNode:
		v := strings.TrimSuffix(strings.TrimSuffix(composeInterpolate(n.Value, env), "/tcp"), "/udp")
		parts := strings.Split(v, ":")
		if len(parts) < 2 {
			return ""
		}
		host := parts[len(parts)-2]
		if i := strings.IndexByte(host, '-'); i >= 0 {
			host = host[:i]
		}
		return host
	case yaml.MappingNode:
		if pub := yamlMapGet(n, "published"); pub != nil && pub.Kind == yaml.ScalarNode {
			return composeInterpolate(pub.Value, env)
		}
	}
	return ""
}

func composeMemberPorts(c dockerContainerSummary) []string {
	seen := map[string]bool{}
	var out []string
	for _, pt := range c.Ports {
		if pt.PublicPort == 0 {
			continue
		}
		s := strconv.Itoa(pt.PublicPort)
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

func composeSortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

func composeSameList(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// composeServiceOfName is the service a container name stands for when the
// container does not exist yet: <project>-<service>-<n>.
func composeServiceOfName(project, name string) string {
	s := strings.TrimPrefix(name, project+"-")
	if i := strings.LastIndexByte(s, '-'); i > 0 {
		if _, err := strconv.Atoi(s[i+1:]); err == nil {
			s = s[:i]
		}
	}
	return s
}

// composePlanOf reads compose's dry-run output into the plan. defs say why a
// container is recreated; the orphans come from the files, since compose only
// warns about them.
func composePlanOf(p composeProject, lines []string, defs map[string]composeSvcDef, removeOrphans bool) composePlan {
	plan := composePlan{Recreate: []composePlanEntry{}, Create: []composePlanEntry{}, Start: []composePlanEntry{}, Orphans: []composePlanEntry{}, Unchanged: []composePlanEntry{}, RemoveOrphans: removeOrphans}
	type seen struct{ recreate, create, started, running, removed bool }
	states := map[string]*seen{}
	var order []string
	for _, l := range lines {
		for _, m := range composePlanLine.FindAllStringSubmatch(l, -1) {
			if !strings.EqualFold(m[1], "container") {
				continue
			}
			name := m[2]
			st := states[name]
			if st == nil {
				st = &seen{}
				states[name] = st
				order = append(order, name)
			}
			switch strings.ToLower(m[3]) {
			case "recreate", "recreated", "recreating":
				st.recreate = true
			case "creating", "created":
				st.create = true
			case "starting", "started":
				st.started = true
			case "running":
				st.running = true
			case "removing", "removed":
				st.removed = true
			}
		}
	}
	byName := map[string]dockerContainerSummary{}
	for _, m := range p.Members {
		byName[m.name()] = m
	}
	service := func(name string) string {
		if m, ok := byName[name]; ok {
			if s := m.Labels[composeLabelService]; s != "" {
				return s
			}
		}
		return composeServiceOfName(p.Name, name)
	}
	reasonsFor := func(name, svc string) []composeReason {
		var rs []composeReason
		m, ok := byName[name]
		d, defined := defs[svc]
		if ok && defined {
			if d.image != "" && m.Image != "" && d.image != m.Image {
				rs = append(rs, composeReason{Code: composeReasonImage, From: m.Image, To: d.image})
			}
			if len(d.ports) > 0 || len(m.Ports) > 0 {
				want, have := composeSortedCopy(d.ports), composeMemberPorts(m)
				if !composeSameList(want, have) {
					rs = append(rs, composeReason{Code: composeReasonPorts, From: strings.Join(have, ","), To: strings.Join(want, ",")})
				}
			}
		}
		if len(rs) == 0 {
			rs = []composeReason{{Code: composeReasonConfig}}
		}
		return rs
	}
	add := func(dst *[]composePlanEntry, name string, rs []composeReason) {
		e := composePlanEntry{Service: service(name), Container: name, Reasons: rs}
		e.Reason = rs[0].Code
		*dst = append(*dst, e)
	}
	for _, name := range order {
		st := states[name]
		switch {
		case st.recreate:
			add(&plan.Recreate, name, reasonsFor(name, service(name)))
		case st.create:
			add(&plan.Create, name, []composeReason{{Code: composeReasonNewService}})
		case st.started:
			add(&plan.Start, name, []composeReason{{Code: composeReasonStopped}})
		case st.removed:
			// An orphan the plan removes; found below with the rest of them.
		case st.running:
			add(&plan.Unchanged, name, []composeReason{{Code: composeReasonSameConfig}})
		}
	}
	// Orphans: a container of the project whose service no file names.
	inFile := map[string]bool{}
	for s := range defs {
		inFile[s] = true
	}
	orphan := map[string]bool{}
	if len(inFile) > 0 {
		for _, m := range p.Members {
			if s := m.Labels[composeLabelService]; s != "" && !inFile[s] {
				orphan[m.name()] = true
			}
		}
	}
	for _, l := range lines {
		if m := composeOrphanWarn.FindStringSubmatch(l); m != nil {
			for _, n := range strings.Fields(m[1]) {
				orphan[n] = true
			}
		}
	}
	for name, st := range states {
		if st.removed && !st.recreate {
			orphan[name] = true
		}
	}
	names := make([]string, 0, len(orphan))
	for n := range orphan {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		e := composePlanEntry{Service: service(n), Container: n, Reasons: []composeReason{{Code: composeReasonNotInFile}}, Reason: composeReasonNotInFile, WillRemove: removeOrphans}
		plan.Orphans = append(plan.Orphans, e)
	}
	plan.Changes = len(plan.Recreate) + len(plan.Create) + len(plan.Start)
	if removeOrphans {
		plan.Changes += len(plan.Orphans)
	}
	return plan
}

func composeVersionOf(lines []string) string {
	for _, l := range lines {
		if m := composeVersionLine.FindStringSubmatch(strings.TrimSpace(l)); m != nil {
			return m[1]
		}
	}
	return ""
}

// DockerComposePreviewHandler answers what Up would change. The gates are a
// Check's: host, control, write token, local only, own stack, the project lock.
func (h *Handlers) DockerComposePreviewHandler(w http.ResponseWriter, r *http.Request) {
	p, ok := h.composeWriteGateOpen(w, r)
	if !ok {
		return
	}
	if len(p.ConfigFiles) == 0 || composeProjectDir(p) == "" {
		dockerRefuse(w, http.StatusConflict, composeNoLabels)
		return
	}
	staged, body, ok := composeBodyFrom(w, r, p)
	if !ok {
		return
	}
	p.Profiles = composeProfilesOf(p)
	if staged != nil && staged.Role == composeRoleEnv {
		if _, can := composeEnvFilesStaged(p, staged.File); !can {
			staged = nil // a service's own env_file does not feed the plan
		}
	}
	api, reason := h.dockerAPIFor(r)
	if api == nil {
		dockerRefuse(w, http.StatusServiceUnavailable, reason)
		return
	}
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
	args := []string{"up", "-d", "--dry-run"}
	if body.RemoveOrphans {
		args = append(args, "--remove-orphans")
	}
	vctx, vcancel := context.WithTimeout(ctx, composeValidateTimeout)
	var (
		exit int
		tail []string
		err  error
	)
	if staged != nil {
		exit, tail, err = composeRunStaged(vctx, api, p, *staged, args)
	} else {
		exit, tail, err = composeRun(vctx, api, p, args)
	}
	vcancel()
	if err != nil {
		writeDockerError(w, err)
		return
	}
	if exit != 0 {
		last := composeLastLines(tail)
		if last == nil {
			last = []string{}
		}
		res := map[string]any{"reason": composeInvalid, "exitCode": exit, "tail": last}
		code := http.StatusUnprocessableEntity
		if composeDryRunUnknown.MatchString(strings.Join(tail, "\n")) {
			res = map[string]any{"reason": composeTooOld, "needs": composeMinVersion, "image": composeHelperImage(), "tail": last,
				"message": "This Compose version cannot preview: up --dry-run needs " + composeMinVersion + " or later. Use a newer helper image (NEXTDASH_COMPOSE_IMAGE)."}
			cctx, ccancel := context.WithTimeout(ctx, 30*time.Second)
			if _, vtail, verr := composeRun(cctx, api, p, []string{"version", "--short"}); verr == nil {
				if v := composeVersionOf(vtail); v != "" {
					res["version"] = v
				}
			}
			ccancel()
		} else if line, col := composeErrorPosition(last); line > 0 {
			res["line"] = line
			if col > 0 {
				res["column"] = col
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		writeJSON(w, res)
		return
	}
	plan := composePlanOf(p, tail, composeServiceDefs(p, staged), body.RemoveOrphans)
	res := map[string]any{"ok": true,
		"recreate": plan.Recreate, "create": plan.Create, "start": plan.Start, "orphans": plan.Orphans,
		"unchanged": plan.Unchanged, "removeOrphans": plan.RemoveOrphans, "changes": plan.Changes,
		"noop": plan.Changes == 0, "varCheck": composeVarCheck(p, staged)}
	if names := composeUnsetNames(tail); len(names) > 0 {
		res["unsetVars"] = names
	}
	writeJSON(w, res)
}
