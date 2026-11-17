package app

import (
	"encoding/binary"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

/*
Compose in the demo.

The demo's stacks (media, photos, security, infra and home) have compose files
and a .env, written to a folder of their own at every reset. The containers
carry the labels a real compose project does, so the compose panel finds the
files the way it finds them at home: under /srv/stacks on an imaginary host,
mapped by NEXTDASH_COMPOSE_MAP to that folder (startDemoDocker).

The run itself is a helper container in the real flow: nextDash creates one,
starts it, follows its log and waits for its exit. The demo's daemon plays the
helper's part: it reads the arguments `docker compose` would get, reads the
files, checks them, and changes the demo's own containers. No docker binary
runs and nothing reaches a registry, so a visitor can edit a file, check it,
bring a stack up and take it down, and the next reset puts everything back.
*/

// demoStackHostDir is where the demo's stacks are on its imaginary host.
const demoStackHostDir = "/srv/stacks"

// demoComposeVersion is what `compose version` answers: past the 2.20 that
// `up --dry-run` needs.
const demoComposeVersion = "2.30.3"

// demoHelperJob is one helper's order: the arguments after `docker`, and the
// text a staged run (an unsaved edit) feeds it.
type demoHelperJob struct {
	Args  []string
	Stage string
}

// demoStackExtras is what each stack's .env holds besides the usual: values a
// visitor sees masked in the panel.
var demoStackExtras = map[string][]string{
	"photos":   {"DB_PASSWORD=demo-not-a-secret"},
	"security": {"ADMIN_TOKEN=demo-not-a-token"},
	"infra":    {"PIHOLE_PASSWORD=demo-not-a-secret", "ACME_EMAIL=admin@example.com"},
	"home":     {"HA_API_TOKEN=demo-not-a-token"},
}

// demoStackEnvironment is the extra lines of a service's environment, written
// with the variable that carries the value.
var demoStackEnvironment = map[string][]string{
	"immich-server":   {"DB_PASSWORD: ${DB_PASSWORD}"},
	"immich-postgres": {"POSTGRES_PASSWORD: ${DB_PASSWORD}"},
	"vaultwarden":     {"ADMIN_TOKEN: ${ADMIN_TOKEN}"},
	"pihole":          {"WEBPASSWORD: ${PIHOLE_PASSWORD}"},
	"traefik":         {"ACME_EMAIL: ${ACME_EMAIL}"},
	"homeassistant":   {"HA_API_TOKEN: ${HA_API_TOKEN}"},
}

// writeStacks writes every stack's compose file and .env under stacksDir, over
// what a visitor changed. d.mu is held, or nobody else has d yet.
func (d *demoDocker) writeStacks() {
	if d.stacksDir == "" {
		return
	}
	byProject := map[string][]*demoContainer{}
	for _, id := range d.order {
		if c := d.containers[id]; c != nil && c.Helper == nil {
			byProject[c.Project] = append(byProject[c.Project], c)
		}
	}
	_ = os.RemoveAll(d.stacksDir)
	for project, members := range byProject {
		dir := filepath.Join(d.stacksDir, project)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			continue
		}
		_ = os.WriteFile(filepath.Join(dir, "compose.yml"), []byte(demoComposeFile(project, members)), 0o644)
		_ = os.WriteFile(filepath.Join(dir, ".env"), []byte(demoEnvFile(project)), 0o644)
	}
}

func demoComposeFile(project string, members []*demoContainer) string {
	var b strings.Builder
	b.WriteString("# The " + project + " stack of the nextDash demo.\nservices:\n")
	for _, c := range members {
		b.WriteString("  " + c.Name + ":\n")
		b.WriteString("    image: " + c.Image + "\n")
		b.WriteString("    container_name: " + c.Name + "\n")
		b.WriteString("    restart: unless-stopped\n")
		if len(c.Ports) > 0 {
			b.WriteString("    ports:\n")
			for _, port := range c.Ports {
				b.WriteString(fmt.Sprintf("      - \"%d:%d\"\n", port, port))
			}
		}
		b.WriteString("    environment:\n      TZ: ${TZ}\n      PUID: ${PUID}\n      PGID: ${PGID}\n")
		for _, line := range demoStackEnvironment[c.Name] {
			b.WriteString("      " + line + "\n")
		}
		b.WriteString("    volumes:\n      - ./" + c.Name + ":/config\n")
	}
	return b.String()
}

func demoEnvFile(project string) string {
	lines := append([]string{"TZ=Europe/Amsterdam", "PUID=1000", "PGID=1000"}, demoStackExtras[project]...)
	return strings.Join(lines, "\n") + "\n"
}

// localStackPath is a path on the imaginary host as it is here, or "" for a
// path outside the demo's stacks.
func (d *demoDocker) localStackPath(host string) string {
	rel := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(host)), demoStackHostDir+"/")
	if d.stacksDir == "" || rel == filepath.ToSlash(filepath.Clean(host)) || strings.Contains(rel, "..") {
		return ""
	}
	return filepath.Join(d.stacksDir, filepath.FromSlash(rel))
}

// createHelper makes a helper container: it exists, with its labels, and does
// nothing until it is started. d.mu is held.
func (d *demoDocker) createHelper(w http.ResponseWriter, name, image string, entrypoint, cmd, env []string, labels map[string]string, now time.Time) {
	// A helper made through `sh -c script sh docker-args...` carries the text of
	// an unsaved edit in its environment (composeStagedBody).
	args, stage := cmd, ""
	if len(entrypoint) > 0 && entrypoint[0] == "sh" && len(cmd) >= 2 {
		args = cmd[2:]
		for _, e := range env {
			if v, ok := strings.CutPrefix(e, "NEXTDASH_COMPOSE_STAGE="); ok {
				stage = v
			}
		}
	}
	id := demoID(fmt.Sprintf("helper-%s-%d", name, d.seq))
	c := &demoContainer{ID: id, Name: name, Image: image, State: "created", Created: now.Unix(), Helper: labels}
	d.containers[id] = c
	d.order = append(d.order, id)
	d.jobs[id] = demoHelperJob{Args: args, Stage: stage}
	demoJSON(w, http.StatusCreated, map[string]string{"Id": id})
}

// serveHelperAction answers a helper's start and wait; the others do nothing.
func (d *demoDocker) serveHelperAction(w http.ResponseWriter, c *demoContainer, action string) {
	switch action {
	case "start":
		d.runHelper(c)
		w.WriteHeader(http.StatusNoContent)
	case "wait":
		demoJSON(w, http.StatusOK, map[string]int{"StatusCode": c.ExitCode})
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// demoComposeCall is the arguments of one `docker compose` call, read.
type demoComposeCall struct {
	Project  string
	Files    []string
	EnvFiles []string
	Action   string
	Rest     []string
}

func parseDemoComposeArgs(args []string) (demoComposeCall, bool) {
	var call demoComposeCall
	if len(args) == 0 || args[0] != "compose" {
		return call, false
	}
	for i := 1; i < len(args); i++ {
		a := args[i]
		take := func() string {
			if i+1 < len(args) {
				i++
				return args[i]
			}
			return ""
		}
		switch a {
		case "--ansi", "--project-directory", "--profile":
			take()
		case "-p":
			call.Project = take()
		case "-f":
			call.Files = append(call.Files, take())
		case "--env-file":
			call.EnvFiles = append(call.EnvFiles, take())
		default:
			call.Action, call.Rest = a, args[i+1:]
			return call, true
		}
	}
	return call, false
}

var demoVarPlain = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// runHelper is what the helper does when it starts: it sets the log and the
// exit code and leaves the container exited. d.mu is held.
func (d *demoDocker) runHelper(c *demoContainer) {
	job := d.jobs[c.ID]
	c.State = "exited"
	fail := func(code int, lines ...string) {
		c.ExitCode = code
		c.Logs = append(c.Logs, lines...)
	}
	call, ok := parseDemoComposeArgs(job.Args)
	if !ok {
		fail(1, "demo: this helper was not asked for docker compose")
		return
	}
	if call.Action == "version" {
		c.Logs = append(c.Logs, demoComposeVersion)
		return
	}
	texts, env := d.demoComposeInputs(call, job)
	services := []demoComposeService{}
	for _, text := range texts {
		list, err := demoComposeServices(text)
		if err != nil {
			fail(15, err.Error())
			return
		}
		services = append(services, list...)
	}
	if len(services) == 0 {
		fail(15, "no service selected")
		return
	}
	seen := map[string]bool{}
	for _, text := range texts {
		for _, m := range demoVarPlain.FindAllStringSubmatch(text, -1) {
			if _, set := env[m[1]]; !set && !seen[m[1]] {
				seen[m[1]] = true
				c.Logs = append(c.Logs, fmt.Sprintf(`time="%s" level=warning msg="The \"%s\" variable is not set. Defaulting to a blank string."`,
					time.Now().UTC().Format(time.RFC3339), m[1]))
			}
		}
	}
	only := ""
	dry, removeOrphans := false, false
	for _, a := range call.Rest {
		switch {
		case a == "--dry-run":
			dry = true
		case a == "--remove-orphans":
			removeOrphans = true
		case !strings.HasPrefix(a, "-"):
			only = a
		}
	}
	chosen := services[:0:0]
	for _, s := range services {
		if only == "" || s.Name == only {
			chosen = append(chosen, s)
		}
	}
	if only != "" && len(chosen) == 0 {
		fail(1, fmt.Sprintf("no such service: %s", only))
		return
	}
	switch call.Action {
	case "config":
	case "up":
		d.helperUp(c, call.Project, services, chosen, dry, removeOrphans)
	case "down":
		d.helperDown(c, call.Project)
	case "pull":
		for _, s := range chosen {
			c.Logs = append(c.Logs, fmt.Sprintf(" Image %s Pulling", s.Image))
			d.pullDemoImage(s.Image)
			c.Logs = append(c.Logs, fmt.Sprintf(" Image %s Pulled", s.Image))
		}
	case "restart":
		for _, s := range chosen {
			if m := d.stackMember(call.Project, s.Name); m != nil {
				c.Logs = append(c.Logs, fmt.Sprintf(" Container %s  Restarting", m.Name))
				m.State, m.Created = "running", time.Now().Unix()
				c.Logs = append(c.Logs, fmt.Sprintf(" Container %s  Started", m.Name))
			}
		}
	default:
		fail(1, "demo: docker compose "+call.Action+" is not played here")
	}
}

type demoComposeService struct{ Name, Image string }

// demoComposeServices reads the services of one compose text, in file order.
func demoComposeServices(text string) ([]demoComposeService, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(text), &doc); err != nil {
		return nil, err
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, fmt.Errorf("empty compose file")
	}
	var out []demoComposeService
	root := doc.Content[0]
	for i := 0; i+1 < len(root.Content); i += 2 {
		if root.Content[i].Value != "services" {
			continue
		}
		list := root.Content[i+1]
		if list.Kind != yaml.MappingNode {
			return nil, fmt.Errorf("services must be a mapping")
		}
		for j := 0; j+1 < len(list.Content); j += 2 {
			svc := demoComposeService{Name: list.Content[j].Value}
			body := list.Content[j+1]
			if body.Kind == yaml.MappingNode {
				for k := 0; k+1 < len(body.Content); k += 2 {
					if body.Content[k].Value == "image" {
						svc.Image = body.Content[k+1].Value
					}
				}
			}
			if svc.Image == "" {
				return nil, fmt.Errorf("service %q has neither an image nor a build context specified: invalid compose project", svc.Name)
			}
			out = append(out, svc)
		}
	}
	return out, nil
}

// demoComposeInputs reads the compose texts and the variables an env file sets.
func (d *demoDocker) demoComposeInputs(call demoComposeCall, job demoHelperJob) ([]string, map[string]string) {
	var texts []string
	for _, f := range call.Files {
		if f == "-" {
			texts = append(texts, job.Stage)
		} else if local := d.localStackPath(f); local != "" {
			if data, err := os.ReadFile(local); err == nil {
				texts = append(texts, string(data))
			}
		}
	}
	env := map[string]string{}
	for _, e := range call.EnvFiles {
		var text string
		if e == composeStagePath {
			text = job.Stage
		} else if local := d.localStackPath(e); local != "" {
			if data, err := os.ReadFile(local); err == nil {
				text = string(data)
			}
		}
		for _, line := range strings.Split(text, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			if k, v, ok := strings.Cut(line, "="); ok {
				env[strings.TrimSpace(k)] = v
			}
		}
	}
	return texts, env
}

func (d *demoDocker) stackMember(project, name string) *demoContainer {
	for _, c := range d.containers {
		if c.Helper == nil && c.Project == project && c.Name == name {
			return c
		}
	}
	return nil
}

// pullDemoImage moves a tag to the newer image the registry has for it, as the
// daemon's pull does.
func (d *demoDocker) pullDemoImage(ref string) {
	if next, ok := d.newer[ref]; ok {
		d.images[ref], d.byID[next.ID] = next, next
		delete(d.newer, ref)
	}
}

// helperUp makes the stack match its file: a missing service is made, a
// stopped one started, one whose image changed made again.
func (d *demoDocker) helperUp(c *demoContainer, project string, all, chosen []demoComposeService, dry, removeOrphans bool) {
	say := func(format string, a ...any) {
		line := fmt.Sprintf(format, a...)
		if dry {
			line = " DRY-RUN MODE - " + strings.TrimLeft(line, " ")
		}
		c.Logs = append(c.Logs, line)
	}
	now := time.Now().Unix()
	for _, s := range chosen {
		m := d.stackMember(project, s.Name)
		switch {
		case m == nil:
			say(" Container %s  Creating", s.Name)
			if !dry {
				d.makeStackMember(project, s, now)
			}
			say(" Container %s  Created", s.Name)
			say(" Container %s  Starting", s.Name)
			say(" Container %s  Started", s.Name)
		case m.Image != s.Image:
			say(" Container %s  Recreate", s.Name)
			if !dry {
				m.Image, m.Created, m.State = s.Image, now, "running"
				if img, ok := d.images[s.Image]; ok {
					m.ImageID = img.ID
				} else {
					m.ImageID = "sha256:" + demoID(s.Image)
				}
			}
			say(" Container %s  Recreated", s.Name)
			say(" Container %s  Started", s.Name)
		case m.State != "running":
			say(" Container %s  Starting", s.Name)
			if !dry {
				m.State, m.Created = "running", now
			}
			say(" Container %s  Started", s.Name)
		default:
			say(" Container %s  Running", s.Name)
		}
	}
	var orphans []string
	keep := map[string]bool{}
	for _, s := range all {
		keep[s.Name] = true
	}
	for _, id := range d.order {
		if m := d.containers[id]; m != nil && m.Helper == nil && m.Project == project && !keep[m.Name] {
			orphans = append(orphans, m.Name)
		}
	}
	sort.Strings(orphans)
	if len(orphans) > 0 {
		if removeOrphans {
			for _, name := range orphans {
				say(" Container %s  Removing", name)
				if !dry {
					d.removeContainer(d.stackMember(project, name))
				}
				say(" Container %s  Removed", name)
			}
		} else {
			c.Logs = append(c.Logs, fmt.Sprintf("level=warning msg=\"Found orphan containers ([%s]) for this project. If you removed or renamed this service in your compose file, you can run this command with the --remove-orphans flag to clean it up.\"", strings.Join(orphans, " ")))
		}
	}
}

// makeStackMember starts a service that was not there: as the demo had it when
// it has it, else as a plain container of that image.
func (d *demoDocker) makeStackMember(project string, s demoComposeService, now int64) {
	d.seq++
	base := demoContainer{Name: s.Name, Image: s.Image, Project: project, CPU: 0.4, MemMB: 80}
	if t, ok := d.templates[s.Name]; ok && t.Project == project {
		base = t
		base.Image = s.Image
		base.Health = ""
	}
	base.State, base.Created = "running", now
	base.ID = demoID(fmt.Sprintf("%s-%d", s.Name, d.seq))
	if img, ok := d.images[s.Image]; ok {
		base.ImageID = img.ID
	} else {
		base.ImageID = "sha256:" + demoID(s.Image)
	}
	d.containers[base.ID] = &base
	d.order = append(d.order, base.ID)
}

func (d *demoDocker) removeContainer(c *demoContainer) {
	if c == nil {
		return
	}
	delete(d.containers, c.ID)
	delete(d.jobs, c.ID)
	kept := d.order[:0]
	for _, id := range d.order {
		if id != c.ID {
			kept = append(kept, id)
		}
	}
	d.order = kept
}

// helperDown stops every container of the project and keeps it, stopped. A real
// down removes them, and a stack without containers is no longer on the list, so
// a visitor could not bring it up again until the reset: the demo keeps the
// stack in view instead. Volumes are not touched either way.
func (d *demoDocker) helperDown(c *demoContainer, project string) {
	for _, id := range d.order {
		if m := d.containers[id]; m != nil && m.Helper == nil && m.Project == project {
			c.Logs = append(c.Logs, fmt.Sprintf(" Container %s  Stopping", m.Name))
			m.State = "exited"
			c.Logs = append(c.Logs, fmt.Sprintf(" Container %s  Stopped", m.Name))
		}
	}
}

// demoLogFrame is one line of a container's log in the daemon's framing; the
// tests read a helper's log with it.
func demoLogFrame(line string) []byte {
	full := line + "\n"
	header := make([]byte, 8)
	header[0] = 1
	binary.BigEndian.PutUint32(header[4:], uint32(len(full)))
	return append(header, full...)
}
