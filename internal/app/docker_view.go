package app

import (
	"context"
	"errors"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

/*
The read model behind the Docker view: turning what the daemon says into what
the table and status line show, resolving the id a request names to a real
container, and telling this container apart from every other one.
*/

var (
	errDockerNotFound = errors.New("container not found")
	dockerHexID       = regexp.MustCompile(`^[a-f0-9]{12,64}$`)
	dockerCgroupID    = regexp.MustCompile(`[a-f0-9]{64}`)
)

// dockerSelfOverride lets tests hand dockerSelfID() a fixed answer instead of
// reading this process's own hostname and cgroup file. Task 5's self-guard
// tests set it; production code never touches it.
var dockerSelfOverride string

type dockerViewPort struct {
	Private int    `json:"private"`
	Public  int    `json:"public"`
	Type    string `json:"type"`
	IP      string `json:"ip,omitempty"`
}

type dockerViewContainer struct {
	ID             string             `json:"id"`
	ShortID        string             `json:"shortId"`
	Name           string             `json:"name"`
	Image          string             `json:"image"`
	Tag            string             `json:"tag"`
	State          string             `json:"state"`
	Status         string             `json:"status"`
	Health         string             `json:"health"`
	Created        int64              `json:"created"`
	Ports          []dockerViewPort   `json:"ports"`
	ComposeProject string             `json:"composeProject,omitempty"`
	WebUI          string             `json:"webui,omitempty"`
	Update         *dockerImageUpdate `json:"update,omitempty"`
	Self           bool               `json:"self,omitempty"`
}

// dockerHealthFromStatus reads the health word Docker appends to Status
// ("Up 2 hours (healthy)") rather than requiring a second inspect call just
// for the list.
func dockerHealthFromStatus(status string) string {
	switch {
	case strings.Contains(status, "(unhealthy)"):
		return "unhealthy"
	case strings.Contains(status, "(healthy)"):
		return "healthy"
	case strings.Contains(status, "(health: starting)"):
		return "starting"
	}
	return ""
}

// dockerSelfIDFrom is split from dockerSelfID so tests can hand it inputs
// directly. Docker sets a container's hostname to its short id unless told
// otherwise; the cgroup path is the fallback when a hostname was set.
func dockerSelfIDFrom(hostname, cgroup string) string {
	if dockerHexID.MatchString(hostname) {
		return hostname
	}
	if m := dockerCgroupID.FindString(cgroup); m != "" {
		return m
	}
	return ""
}

func dockerSelfID() string {
	if dockerSelfOverride != "" {
		return dockerSelfOverride
	}
	host, _ := os.Hostname()
	cg, _ := os.ReadFile("/proc/self/cgroup")
	if id := dockerSelfIDFrom(host, string(cg)); id != "" {
		return id
	}
	mi, _ := os.ReadFile("/proc/self/mountinfo")
	return dockerSelfIDFrom("", string(mi))
}

func isDockerSelf(fullID, self string) bool {
	return self != "" && strings.HasPrefix(fullID, self)
}

// resolveDockerID accepts an id (12-64 hex) or an exact name, and only ever
// returns a container that is in the daemon's own list -- so nothing a
// request says reaches a socket path unless the daemon named it first.
func (h *Handlers) resolveDockerID(ctx context.Context, api *dockerAPI, raw string) (dockerContainerSummary, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return dockerContainerSummary{}, errDockerNotFound
	}
	list, err := api.listContainers(ctx)
	if err != nil {
		return dockerContainerSummary{}, err
	}
	isHex := dockerHexID.MatchString(raw)
	for _, c := range list {
		if c.name() == raw || (isHex && strings.HasPrefix(c.ID, raw)) {
			return c, nil
		}
	}
	return dockerContainerSummary{}, errDockerNotFound
}

var dockerWebUIPort = regexp.MustCompile(`\[PORT:(\d+)\]`)

// dockerWebUI resolves Unraid's WebUI template. [IP] is left for the browser
// to fill with the host it is on; [PORT:n] maps the container port to
// whatever host port it was actually published on.
func dockerWebUI(c dockerContainerSummary) string {
	tpl := c.Labels["net.unraid.docker.webui"]
	if tpl == "" {
		return ""
	}
	return dockerWebUIPort.ReplaceAllStringFunc(tpl, func(m string) string {
		want, _ := strconv.Atoi(dockerWebUIPort.FindStringSubmatch(m)[1])
		for _, p := range c.Ports {
			if p.PrivatePort == want && p.PublicPort > 0 {
				return strconv.Itoa(p.PublicPort)
			}
		}
		return strconv.Itoa(want)
	})
}

func toDockerView(c dockerContainerSummary, self string) dockerViewContainer {
	_, tag := splitImageTag(c.Image)
	v := dockerViewContainer{
		ID: c.ID, Name: c.name(), Image: c.Image, Tag: tag, State: c.State,
		Status: c.Status, Health: dockerHealthFromStatus(c.Status), Created: c.Created,
		ComposeProject: c.Labels["com.docker.compose.project"], WebUI: dockerWebUI(c),
		Self: isDockerSelf(c.ID, self), Ports: []dockerViewPort{},
	}
	if len(c.ID) >= 12 {
		v.ShortID = c.ID[:12]
	}
	seen := map[string]bool{}
	for _, p := range c.Ports {
		// IPv4 and IPv6 bindings of one port arrive as two entries.
		key := strconv.Itoa(p.PrivatePort) + "/" + strconv.Itoa(p.PublicPort) + "/" + p.Type
		if seen[key] {
			continue
		}
		seen[key] = true
		v.Ports = append(v.Ports, dockerViewPort{Private: p.PrivatePort, Public: p.PublicPort, Type: p.Type, IP: p.IP})
	}
	return v
}

// writeDockerError maps whatever went wrong to the status and shape every
// docker route uses: a daemon error names itself, a bad id is 404, anything
// else (no socket, denied, unreachable) is a dial reason.
func writeDockerError(w http.ResponseWriter, err error) {
	var apiErr *dockerAPIError
	switch {
	case errors.Is(err, errDockerNotFound):
		w.WriteHeader(http.StatusNotFound)
		writeJSON(w, map[string]string{"reason": "not-found"})
	case errors.As(err, &apiErr):
		w.WriteHeader(http.StatusBadGateway)
		writeJSON(w, map[string]string{"reason": "daemon", "message": apiErr.Message})
	default:
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]string{"reason": dockerDialReason(err)})
	}
}

func (h *Handlers) DockerStatusHandler(w http.ResponseWriter, r *http.Request) {
	// writeToken is whether one is set, never what it is: Config -> Containers
	// says so beside the actions it protects.
	out := map[string]any{
		"socket": false, "control": dockerControlEnabled(), "reason": "",
		"self": dockerSelfID(), "selfName": "", "writeToken": writeAccessToken() != "",
	}
	api, reason := newDockerAPI()
	if api == nil {
		out["reason"] = reason
		writeJSON(w, out)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if resp, err := api.do(ctx, http.MethodGet, "/_ping", nil); err != nil {
		out["reason"] = dockerDialReason(err)
	} else {
		resp.Body.Close()
		out["socket"] = true
		if self := dockerSelfID(); self != "" {
			if list, lerr := api.listContainers(ctx); lerr == nil {
				for _, c := range list {
					if isDockerSelf(c.ID, self) {
						out["selfName"] = c.name()
						break
					}
				}
			}
		}
	}
	writeJSON(w, out)
}

// dockerTarget resolves the {id} path variable and hands back a live client
// alongside the daemon's own summary for it, or writes the error itself and
// reports false. Every per-container route under /api/docker/containers/{id}
// starts here so the not-found and dial-reason handling stays in one place.
func (h *Handlers) dockerTarget(w http.ResponseWriter, r *http.Request) (*dockerAPI, dockerContainerSummary, bool) {
	api, reason := newDockerAPI()
	if api == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]string{"reason": reason})
		return nil, dockerContainerSummary{}, false
	}
	c, err := h.resolveDockerID(r.Context(), api, mux.Vars(r)["id"])
	if err != nil {
		writeDockerError(w, err)
		return nil, dockerContainerSummary{}, false
	}
	return api, c, true
}

type dockerViewMount struct {
	Type        string `json:"type"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	ReadOnly    bool   `json:"readOnly"`
}

type dockerViewNetwork struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
}

type dockerViewDetail struct {
	dockerViewContainer
	StartedAt     string              `json:"startedAt"`
	RestartPolicy string              `json:"restartPolicy"`
	Mounts        []dockerViewMount   `json:"mounts"`
	Networks      []dockerViewNetwork `json:"networks"`
	EnvNames      []string            `json:"envNames"`
	Version       string              `json:"version,omitempty"`
	Source        string              `json:"source,omitempty"`
}

func (h *Handlers) DockerContainerDetailHandler(w http.ResponseWriter, r *http.Request) {
	api, c, ok := h.dockerTarget(w, r)
	if !ok {
		return
	}
	in, err := api.inspectContainer(r.Context(), c.ID)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	d := dockerViewDetail{dockerViewContainer: toDockerView(c, dockerSelfID())}
	d.Update = h.dockerUpdateSnapshot()[c.Image]
	d.StartedAt = in.State.StartedAt
	d.RestartPolicy = in.HostConfig.RestartPolicy.Name
	for _, m := range in.Mounts {
		src := m.Source
		if m.Type == "volume" && m.Name != "" {
			src = m.Name
		}
		d.Mounts = append(d.Mounts, dockerViewMount{Type: m.Type, Source: src, Destination: m.Destination, ReadOnly: !m.RW})
	}
	for name, n := range in.NetworkSettings.Networks {
		d.Networks = append(d.Networks, dockerViewNetwork{Name: name, IP: n.IPAddress})
	}
	sort.Slice(d.Networks, func(i, j int) bool { return d.Networks[i].Name < d.Networks[j].Name })
	for _, kv := range in.Config.Env {
		if name, _, ok := strings.Cut(kv, "="); ok {
			d.EnvNames = append(d.EnvNames, name)
		}
	}
	sort.Strings(d.EnvNames)
	// By image id, not by the tag: after a pull the tag already points at the
	// new image while this container still runs the old one, and the version
	// shown has to be the one that is running.
	if img, err := api.inspectImage(r.Context(), in.Image); err == nil {
		d.Version = img.Config.Labels["org.opencontainers.image.version"]
		d.Source = img.Config.Labels["org.opencontainers.image.source"]
	}
	if d.Mounts == nil {
		d.Mounts = []dockerViewMount{}
	}
	if d.Networks == nil {
		d.Networks = []dockerViewNetwork{}
	}
	writeJSON(w, d)
}

// DockerContainerEnvHandler answers one value, on request, never cached: env
// is where passwords and API keys live, so the detail route only ever names
// them and a value is fetched only when someone actually asks for it.
//
// Behind the write token, like a health credential's reveal: with a token set,
// reading a secret is no less guarded than changing a bookmark.
func (h *Handlers) DockerContainerEnvHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	api, c, ok := h.dockerTarget(w, r)
	if !ok {
		return
	}
	in, err := api.inspectContainer(r.Context(), c.ID)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	want := mux.Vars(r)["name"]
	w.Header().Set("Cache-Control", "no-store")
	for _, kv := range in.Config.Env {
		if name, value, ok := strings.Cut(kv, "="); ok && name == want {
			writeJSON(w, map[string]string{"name": name, "value": value})
			return
		}
	}
	writeDockerError(w, errDockerNotFound)
}

func (h *Handlers) DockerContainerStatsHandler(w http.ResponseWriter, r *http.Request) {
	api, c, ok := h.dockerTarget(w, r)
	if !ok {
		return
	}
	sample, err := api.statsOnce(r.Context(), c.ID)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, sample)
}

// DockerContainerLogsHandler clamps tail to 1-1000: no tail or a junk value
// falls back to 200, and anything past 1000 is capped there before the
// request ever reaches the daemon.
//
// Behind the write token too: logs print connection strings and keys as
// readily as env does.
func (h *Handlers) DockerContainerLogsHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	api, c, ok := h.dockerTarget(w, r)
	if !ok {
		return
	}
	tail, err := strconv.Atoi(r.URL.Query().Get("tail"))
	if err != nil || tail <= 0 {
		tail = 200
	}
	if tail > 1000 {
		tail = 1000
	}
	lines, err := api.logsTail(r.Context(), c.ID, tail)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"lines": lines})
}

func (h *Handlers) DockerContainersHandler(w http.ResponseWriter, r *http.Request) {
	api, reason := newDockerAPI()
	if api == nil {
		writeJSON(w, map[string]any{"available": false, "reason": reason, "containers": []any{}})
		return
	}
	list, err := api.listContainers(r.Context())
	if err != nil {
		writeJSON(w, map[string]any{"available": false, "reason": dockerDialReason(err), "containers": []any{}})
		return
	}
	self := dockerSelfID()
	updates := h.dockerUpdateSnapshot() // Task 8 fills this from the real store.
	out := make([]dockerViewContainer, 0, len(list))
	hidden := dockerHiddenSet()
	for _, c := range list {
		if hidden[c.name()] {
			continue
		}
		v := toDockerView(c, self)
		v.Update = updates[c.Image]
		out = append(out, v)
	}
	writeJSON(w, map[string]any{"available": true, "containers": out})
}
