package app

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

/*
Glances and the Containers view, when they look at the same machine.

The Containers view talks to the Docker socket of the machine nextDash runs on.
A Glances host is wherever the reader pointed it. When both are one machine, a
container in one is the same container in the other, and the two views can lead
to each other. Config → Glances has the setting: Auto compares the hostname
Glances reports with the name Docker reports, Yes and No decide by hand.

A container is matched by its id (Glances and Docker give the same one) before
its name, then its name without a compose index, then a port it publishes. What
matched on which ground, and what exists on one side only, is part of the answer.
*/

const (
	glancesLinkAuto = "auto"
	glancesLinkYes  = "yes"
	glancesLinkNo   = "no"

	glancesLinkTTL = 20 * time.Second
)

func normalizeGlancesLink(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case glancesLinkYes:
		return glancesLinkYes
	case glancesLinkNo:
		return glancesLinkNo
	}
	return glancesLinkAuto
}

// glancesLinkMatch is one container seen from both sides.
type glancesLinkMatch struct {
	Glances  string `json:"glances"`
	Docker   string `json:"docker"`
	DockerID string `json:"dockerId"`
	By       string `json:"by"` // id, name, compose or port
}

// glancesDockerLinkAnswer is what the page and the Containers view read.
type glancesDockerLinkAnswer struct {
	Mode        string             `json:"mode"`
	Same        bool               `json:"same"`
	Reason      string             `json:"reason"` // why not, or how it was decided
	GlancesHost string             `json:"glancesHost,omitempty"`
	DockerHost  string             `json:"dockerHost,omitempty"`
	Matches     []glancesLinkMatch `json:"matches"`
	OnlyGlances []string           `json:"onlyGlances"`
	OnlyDocker  []string           `json:"onlyDocker"`
	ByID        int                `json:"byId"`
	ByName      int                `json:"byName"`
}

var glancesLinkCache = struct {
	sync.Mutex
	key    string
	at     time.Time
	answer glancesDockerLinkAnswer
}{}

var glancesComposeIndexRe = regexp.MustCompile(`[-_]\d+$`)

// glancesHostLabel is a host name's first label, lower case: "NAS.lan" and "nas" are one machine.
func glancesHostLabel(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	if i := strings.Index(name, "."); i > 0 {
		name = name[:i]
	}
	return name
}

func glancesLinkIDUsable(id string) bool {
	id = strings.TrimSpace(id)
	if len(id) < 8 {
		return false
	}
	return strings.Trim(id, "0") != ""
}

type glancesLinkSide struct {
	Name  string
	ID    string
	Ports []int
}

// matchGlancesContainers pairs the two lists. A container pairs once.
func matchGlancesContainers(glances, docker []glancesLinkSide) ([]glancesLinkMatch, []string, []string) {
	usedD := map[int]bool{}
	var matches []glancesLinkMatch
	var rest []int
	add := func(gi, di int, by string) {
		usedD[di] = true
		matches = append(matches, glancesLinkMatch{Glances: glances[gi].Name, Docker: docker[di].Name, DockerID: docker[di].ID, By: by})
	}
	pending := map[int]bool{}
	for gi := range glances {
		pending[gi] = true
	}
	step := func(by string, equal func(g, d glancesLinkSide) bool) {
		for gi := range glances {
			if !pending[gi] {
				continue
			}
			for di := range docker {
				if usedD[di] || !equal(glances[gi], docker[di]) {
					continue
				}
				add(gi, di, by)
				delete(pending, gi)
				break
			}
		}
	}
	step("id", func(g, d glancesLinkSide) bool {
		return glancesLinkIDUsable(g.ID) && glancesLinkIDUsable(d.ID) &&
			(strings.HasPrefix(d.ID, g.ID) || strings.HasPrefix(g.ID, d.ID))
	})
	step("name", func(g, d glancesLinkSide) bool { return strings.EqualFold(g.Name, d.Name) })
	step("compose", func(g, d glancesLinkSide) bool {
		a := strings.ToLower(glancesComposeIndexRe.ReplaceAllString(g.Name, ""))
		b := strings.ToLower(glancesComposeIndexRe.ReplaceAllString(d.Name, ""))
		return a != "" && a == b
	})
	step("port", func(g, d glancesLinkSide) bool {
		for _, gp := range g.Ports {
			for _, dp := range d.Ports {
				if gp > 0 && gp == dp {
					return true
				}
			}
		}
		return false
	})
	_ = rest
	var onlyG, onlyD []string
	for gi := range glances {
		if pending[gi] {
			onlyG = append(onlyG, glances[gi].Name)
		}
	}
	for di := range docker {
		if !usedD[di] {
			onlyD = append(onlyD, docker[di].Name)
		}
	}
	sort.Strings(onlyG)
	sort.Strings(onlyD)
	sort.Slice(matches, func(i, j int) bool { return matches[i].Glances < matches[j].Glances })
	return matches, onlyG, onlyD
}

// glancesPortsOf reads the host ports a Glances container publishes, whichever
// shape this version of Glances uses ("0.0.0.0:8080->80/tcp", or objects).
func glancesPortsOf(raw []json.RawMessage) []int {
	var out []int
	re := regexp.MustCompile(`(?:^|:)(\d{1,5})->`)
	for _, item := range raw {
		var text string
		if json.Unmarshal(item, &text) == nil {
			if m := re.FindStringSubmatch(text); m != nil {
				n := 0
				for _, c := range m[1] {
					n = n*10 + int(c-'0')
				}
				out = append(out, n)
			}
			continue
		}
		var obj map[string]any
		if json.Unmarshal(item, &obj) == nil {
			for _, key := range []string{"PublicPort", "public", "host_port", "HostPort"} {
				if v, ok := obj[key].(float64); ok && v > 0 {
					out = append(out, int(v))
				}
			}
		}
	}
	return out
}

// glancesComputeDockerLink decides whether the two views look at one machine, and pairs the containers.
func (h *Handlers) glancesComputeDockerLink(ctx context.Context, cfg GlancesConfig) glancesDockerLinkAnswer {
	answer := glancesDockerLinkAnswer{Mode: normalizeGlancesLink(cfg.DockerLink), Matches: []glancesLinkMatch{}, OnlyGlances: []string{}, OnlyDocker: []string{}}
	if answer.Mode == glancesLinkNo {
		answer.Reason = "off"
		return answer
	}
	api, reason := newDockerAPI()
	if api == nil {
		answer.Reason = "no-docker"
		_ = reason
		return answer
	}
	var info struct {
		Name string `json:"Name"`
	}
	if err := api.getJSON(ctx, "/info", &info); err == nil {
		answer.DockerHost = info.Name
	}
	var system struct {
		Hostname string `json:"hostname"`
	}
	if cfg.connected() {
		if err := h.glancesAsk(ctx, cfg, "system", &system); err == nil {
			answer.GlancesHost = system.Hostname
		}
	}
	switch answer.Mode {
	case glancesLinkYes:
		answer.Same, answer.Reason = true, "chosen"
	default:
		switch {
		case answer.GlancesHost == "" || answer.DockerHost == "":
			answer.Reason = "unknown"
		case glancesHostLabel(answer.GlancesHost) == glancesHostLabel(answer.DockerHost):
			answer.Same, answer.Reason = true, "same-name"
		default:
			answer.Reason = "different-name"
		}
	}
	if !answer.Same || !cfg.connected() {
		return answer
	}

	var gl []struct {
		Name  string            `json:"name"`
		ID    string            `json:"id"`
		Ports []json.RawMessage `json:"ports"`
	}
	if err := h.glancesAsk(ctx, cfg, "containers", &gl); err != nil {
		return answer
	}
	list, err := api.listContainers(ctx)
	if err != nil {
		return answer
	}
	hidden := dockerHiddenSet()
	var gSide, dSide []glancesLinkSide
	for _, c := range gl {
		if c.Name != "" {
			gSide = append(gSide, glancesLinkSide{Name: c.Name, ID: c.ID, Ports: glancesPortsOf(c.Ports)})
		}
	}
	for _, c := range list {
		name := c.name()
		if name == "" || hidden[name] || c.Labels[dockerBindMeasureLabel] == "1" {
			continue
		}
		var ports []int
		for _, p := range c.Ports {
			if p.PublicPort > 0 {
				ports = append(ports, p.PublicPort)
			}
		}
		dSide = append(dSide, glancesLinkSide{Name: name, ID: c.ID, Ports: ports})
	}
	answer.Matches, answer.OnlyGlances, answer.OnlyDocker = matchGlancesContainers(gSide, dSide)
	for _, m := range answer.Matches {
		switch m.By {
		case "id":
			answer.ByID++
		default:
			answer.ByName++
		}
	}
	return answer
}

// glancesDockerLink is the answer, kept a few seconds: two views ask for it.
func (h *Handlers) glancesDockerLink(ctx context.Context) glancesDockerLinkAnswer {
	cfg := loadGlancesConfig()
	key := cfg.Server + "|" + normalizeGlancesLink(cfg.DockerLink) + "|" + boolWord(cfg.connected())
	glancesLinkCache.Lock()
	if glancesLinkCache.key == key && time.Since(glancesLinkCache.at) < glancesLinkTTL {
		answer := glancesLinkCache.answer
		glancesLinkCache.Unlock()
		return answer
	}
	glancesLinkCache.Unlock()
	answer := h.glancesComputeDockerLink(ctx, cfg)
	glancesLinkCache.Lock()
	glancesLinkCache.key, glancesLinkCache.at, glancesLinkCache.answer = key, time.Now(), answer
	glancesLinkCache.Unlock()
	return answer
}

func boolWord(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func glancesLinkForget() {
	glancesLinkCache.Lock()
	glancesLinkCache.key = ""
	glancesLinkCache.Unlock()
}

func (h *Handlers) glancesDockerLinkHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(h.glancesDockerLink(r.Context()))
}

// glancesContainerRestarts are the moments a container started again, from the
// Containers view's own timeline: a start is a restart once the container had
// stopped before it. Only meaningful when the two views are one machine.
func glancesContainerRestarts(name string, since int64) []int64 {
	out := []int64{}
	for i, e := range dockerTimelines.forContainer(name) {
		if i > 0 && e.Kind == "start" && e.At >= since {
			out = append(out, e.At)
		}
	}
	return out
}

// glancesRestartsAsked answers ?restarts=<container>: when the container
// restarted in the window, from the Containers view's timeline. A name from
// either side will do; nothing comes back unless the two views are one machine.
func (h *Handlers) glancesRestartsAsked(r *http.Request, since int64) []int64 {
	name := strings.TrimSpace(r.URL.Query().Get("restarts"))
	if name == "" {
		return []int64{}
	}
	link := h.glancesDockerLink(r.Context())
	if !link.Same {
		return []int64{}
	}
	docker := name
	for _, m := range link.Matches {
		if strings.EqualFold(m.Glances, name) {
			docker = m.Docker
			break
		}
	}
	return glancesContainerRestarts(docker, since)
}
