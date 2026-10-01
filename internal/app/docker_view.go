package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
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
	// Only Docker's per-container directory names the container: the first
	// 64-hex string in mountinfo is the root mount's storage layer on overlay2,
	// btrfs (Unraid's docker.img) and zfs, which is no container at all.
	dockerMountinfoID = regexp.MustCompile(`/containers/([a-f0-9]{64})/`)
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
	ID             string           `json:"id"`
	ShortID        string           `json:"shortId"`
	Name           string           `json:"name"`
	Image          string           `json:"image"`
	Tag            string           `json:"tag"`
	State          string           `json:"state"`
	Status         string           `json:"status"`
	Health         string           `json:"health"`
	Created        int64            `json:"created"`
	StartedAt      int64            `json:"startedAt,omitempty"`
	Ports          []dockerViewPort `json:"ports"`
	ComposeProject string           `json:"composeProject,omitempty"`
	WebUI          string           `json:"webui,omitempty"`
	WebUIDefault   string           `json:"webuiDefault,omitempty"`
	WebUICustom    string           `json:"webuiCustom,omitempty"`
	// LanIP is the container's own address on the LAN, set only when it sits
	// on a macvlan or ipvlan network (Unraid's br0): there [IP] means the
	// container, not the host nextDash was opened on.
	LanIP string `json:"lanIP,omitempty"`
	// Network is the one the list groups the container under: the network
	// mode it runs in when that is a network, else the first it joined.
	Network string             `json:"network,omitempty"`
	Update  *dockerImageUpdate `json:"update,omitempty"`
	Self    bool               `json:"self,omitempty"`
	// Size is the last background measurement (docker_sizes.go), absent
	// before the first.
	Size *dockerContainerSize `json:"size,omitempty"`
	// Restarts is how often it started again in the last 24 hours, from the
	// timeline (docker_timeline.go); absent at none.
	Restarts int `json:"restarts,omitempty"`
	// Usage is the stats sampler's latest reading, on the list only and only
	// for a running container the sampler has read twice (CPU is a delta).
	Usage *dockerViewUsage `json:"usage,omitempty"`
}

type dockerViewUsage struct {
	CPU float64 `json:"cpu"` // percent of one core, as the Resources chart
	Mem uint64  `json:"mem"` // bytes
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

// dockerStartedFromStatus reads a start time back out of Docker's "Up 3 days".
// The list call has no StartedAt, and an inspect per container to get one
// would multiply every refresh by the container count. The answer is as coarse
// as the words -- "3 days" is any time on the third day -- which is enough to
// order containers by how long they have run. Anything not running is 0.
func dockerStartedFromStatus(status string, now time.Time) int64 {
	rest, ok := strings.CutPrefix(status, "Up ")
	if !ok {
		return 0
	}
	if i := strings.Index(rest, " ("); i >= 0 {
		rest = rest[:i]
	}
	var ago time.Duration
	switch rest {
	case "Less than a second":
		ago = 0
	case "About a minute":
		ago = time.Minute
	case "About an hour":
		ago = time.Hour
	default:
		count, unit, found := strings.Cut(rest, " ")
		n, err := strconv.Atoi(count)
		if !found || err != nil {
			return 0
		}
		units := map[string]time.Duration{
			"second": time.Second, "minute": time.Minute, "hour": time.Hour,
			"day": 24 * time.Hour, "week": 7 * 24 * time.Hour,
			"month": 30 * 24 * time.Hour, "year": 365 * 24 * time.Hour,
		}
		size, known := units[strings.TrimSuffix(unit, "s")]
		if !known {
			return 0
		}
		ago = time.Duration(n) * size
	}
	return now.Add(-ago).Unix()
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
	return dockerSelfIDFromMountinfo(string(mi))
}

// dockerSelfIDFromMountinfo reads the id from the bind mounts Docker makes for
// every container (resolv.conf, hostname, hosts), which live under
// .../containers/<id>/.
func dockerSelfIDFromMountinfo(mountinfo string) string {
	if m := dockerMountinfoID.FindStringSubmatch(mountinfo); m != nil {
		return m[1]
	}
	return ""
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

// dockerLanNetworks names the networks that give a container an address of
// its own on the LAN. A daemon that will not list them gives none: the links
// fall back to the host, as they did before.
func (d *dockerAPI) dockerLanNetworks(ctx context.Context) map[string]bool {
	out := map[string]bool{}
	nets, err := d.listNetworks(ctx)
	if err != nil {
		return out
	}
	for _, n := range nets {
		if n.Driver == "macvlan" || n.Driver == "ipvlan" {
			out[n.Name] = true
		}
	}
	return out
}

// dockerLanIP is the container's address on one of those networks: the one
// it runs in first, else the first other one it joined, by name.
func dockerLanIP(c dockerContainerSummary, lan map[string]bool) string {
	nets := c.NetworkSettings.Networks
	if mode := c.HostConfig.NetworkMode; lan[mode] && nets[mode].IPAddress != "" {
		return nets[mode].IPAddress
	}
	names := make([]string, 0, len(nets))
	for name := range nets {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if lan[name] && nets[name].IPAddress != "" {
			return nets[name].IPAddress
		}
	}
	return ""
}

func toDockerView(c dockerContainerSummary, self string) dockerViewContainer {
	_, tag := splitImageTag(c.Image)
	v := dockerViewContainer{
		ID: c.ID, Name: c.name(), Image: c.Image, Tag: tag, State: c.State,
		Status: c.Status, Health: dockerHealthFromStatus(c.Status), Created: c.Created,
		StartedAt:      dockerStartedFromStatus(c.Status, time.Now()),
		ComposeProject: c.Labels["com.docker.compose.project"], WebUIDefault: dockerWebUI(c),
		WebUICustom: dockerCustomWebUI(c.name()),
		Self:        isDockerSelf(c.ID, self), Ports: []dockerViewPort{},
	}
	if len(c.ID) >= 12 {
		v.ShortID = c.ID[:12]
	}
	v.Network = dockerPrimaryNetwork(c)
	// One address for everything that opens it: the table, the palette, the
	// widget and the drawer read webui and never choose between the two.
	v.WebUI = v.WebUICustom
	if v.WebUI == "" {
		v.WebUI = v.WebUIDefault
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

// dockerPrimaryNetwork: the network a container is grouped under. Its network
// mode when that names a network it is on (bridge, br0, a compose network)
// or is host; a container sharing another's stack (container:<id>) and a
// custom mode fall back to the first network it joined, by name.
func dockerPrimaryNetwork(c dockerContainerSummary) string {
	mode := c.HostConfig.NetworkMode
	if mode == "host" || mode == "none" {
		return mode
	}
	if _, ok := c.NetworkSettings.Networks[mode]; ok {
		return mode
	}
	names := make([]string, 0, len(c.NetworkSettings.Networks))
	for n := range c.NetworkSettings.Networks {
		names = append(names, n)
	}
	sort.Strings(names)
	if len(names) > 0 {
		return names[0]
	}
	return mode
}

// writeDockerError maps whatever went wrong to the status and shape every
// docker route uses: a daemon error names itself, a bad id is 404, anything
// else (no socket, denied, unreachable) is a dial reason.
func writeDockerError(w http.ResponseWriter, err error) {
	// Before WriteHeader: a header set after it is not sent.
	w.Header().Set("Content-Type", "application/json")
	var apiErr *dockerAPIError
	switch {
	case errors.Is(err, errDockerNotFound):
		w.WriteHeader(http.StatusNotFound)
		writeJSON(w, map[string]string{"reason": "not-found"})
	case errors.As(err, &apiErr):
		w.WriteHeader(http.StatusBadGateway)
		writeJSON(w, map[string]string{"reason": "daemon", "message": apiErr.Message})
	case isDockerDialError(err):
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]string{"reason": dockerDialReason(err)})
	default:
		// Reached the daemon, then something else broke: a stream cut off, a
		// deadline, an answer that did not parse. Not a missing socket -- that
		// label sent a reader with a working socket looking in the wrong place.
		w.WriteHeader(http.StatusBadGateway)
		writeJSON(w, map[string]string{"reason": "docker-error", "message": err.Error()})
	}
}

// isDockerDialError is whether the socket itself could not be reached: absent,
// refused or not ours to open. Anything after the connection is something else.
func isDockerDialError(err error) bool {
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Op == "dial" {
		return true
	}
	return errors.Is(err, os.ErrPermission) || errors.Is(err, syscall.EACCES) ||
		errors.Is(err, syscall.ENOENT) || errors.Is(err, syscall.ECONNREFUSED)
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
		dockerRefuse(w, http.StatusServiceUnavailable, reason)
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
	// What updates did to this container, newest first, and what a rollback
	// would go back to while the previous image is still on the host.
	UpdateHistory []dockerUpdateHistoryEntry `json:"updateHistory"`
	Rollback      *dockerRollbackOffer       `json:"rollback,omitempty"`
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
	d.LanIP = dockerLanIP(c, api.dockerLanNetworks(r.Context()))
	d.Update = dockerRowUpdate(h.dockerUpdateSnapshot()[c.Image], c, api.imageTagIDs(r.Context()))
	d.Size = dockerSizeOf(c.ID, time.Now())
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
	d.UpdateHistory = dockerUpdateHistoryFor(c.name())
	d.Rollback = dockerRollbackOfferFor(r.Context(), api, d.UpdateHistory, in.Image)
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
	if r.URL.Query().Get("history") != "1" {
		writeJSON(w, sample)
		return
	}
	// With history: the sampler's last hour, and whether it is on at all, so
	// the drawer can tell "nothing yet" from "switched off".
	enabled := h.store.GetSettings().DockerStatsHistory
	history := []dockerStatsPoint{}
	if enabled {
		history = dockerStatsStore.points(c.ID)
	}
	writeJSON(w, map[string]any{
		"cpuPercent": sample.CPUPercent, "memoryUsed": sample.MemoryUsed, "memoryLimit": sample.MemoryLimit,
		"history": history, "historyEnabled": enabled,
	})
}

// dockerHealthOutputMax caps one check's output: a failing curl can print a
// whole error page, and the drawer shows a line or two of it.
const dockerHealthOutputMax = 2000

// dockerHealthChecksMax is how many checks the route hands over; the daemon
// keeps five itself, so this only matters if that ever changes.
const dockerHealthChecksMax = 5

type dockerHealthCheck struct {
	Start    string `json:"start"`
	End      string `json:"end"`
	ExitCode int    `json:"exitCode"`
	Output   string `json:"output"`
}

type dockerHealthView struct {
	Status        string              `json:"status"`
	FailingStreak int                 `json:"failingStreak"`
	Command       string              `json:"command"`
	Checks        []dockerHealthCheck `json:"checks"`
}

// dockerHealthCommand turns Config.Healthcheck.Test into the line a person
// would type: the arguments of a CMD, the shell line of a CMD-SHELL, and
// nothing for NONE or no healthcheck at all.
func dockerHealthCommand(test []string) string {
	if len(test) < 2 {
		return ""
	}
	switch test[0] {
	case "CMD":
		return strings.Join(test[1:], " ")
	case "CMD-SHELL":
		return test[1]
	}
	return ""
}

// DockerContainerHealthHandler answers the healthcheck's recent checks,
// newest first. A container without a healthcheck answers an empty status.
//
// Behind the write token, like logs: a check's output is a command's output,
// and a failing one can print a URL with its credentials in it.
func (h *Handlers) DockerContainerHealthHandler(w http.ResponseWriter, r *http.Request) {
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
	v := dockerHealthView{Checks: []dockerHealthCheck{}}
	if hc := in.Config.Healthcheck; hc != nil {
		v.Command = dockerHealthCommand(hc.Test)
	}
	if hs := in.State.Health; hs != nil {
		v.Status = hs.Status
		v.FailingStreak = hs.FailingStreak
		for i := len(hs.Log) - 1; i >= 0 && len(v.Checks) < dockerHealthChecksMax; i-- {
			l := hs.Log[i]
			v.Checks = append(v.Checks, dockerHealthCheck{Start: l.Start, End: l.End, ExitCode: l.ExitCode,
				Output: capRunes(strings.TrimSpace(l.Output), dockerHealthOutputMax)})
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, v)
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
	lines, err := api.logsTail(r.Context(), c.ID, dockerLogTail(r))
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
		// A daemon that answered and refused is not a missing socket.
		var apiErr *dockerAPIError
		if errors.As(err, &apiErr) {
			writeJSON(w, map[string]any{"available": false, "reason": "daemon", "message": apiErr.Message, "containers": []any{}})
			return
		}
		writeJSON(w, map[string]any{"available": false, "reason": dockerDialReason(err), "containers": []any{}})
		return
	}
	self := dockerSelfID()
	updates := h.dockerUpdateSnapshot() // Task 8 fills this from the real store.
	out := make([]dockerViewContainer, 0, len(list))
	hidden := dockerHiddenSet()
	lan := api.dockerLanNetworks(r.Context())
	tagIDs := api.imageTagIDs(r.Context())
	// The sampler's last reading rides along, so the table's CPU and RAM
	// columns cost no stats call per row. Off in Config means no columns.
	usageEnabled := h.store.GetSettings().DockerStatsHistory
	now := time.Now()
	for _, c := range list {
		// Hidden in Config, or a size measurement's throwaway container.
		if hidden[c.name()] || c.Labels[dockerBindMeasureLabel] == "1" {
			continue
		}
		v := toDockerView(c, self)
		v.LanIP = dockerLanIP(c, lan)
		v.Update = dockerRowUpdate(updates[c.Image], c, tagIDs)
		v.Size = dockerSizeOf(c.ID, now)
		v.Restarts = dockerTimelines.restartsSince(c.name(), now.Add(-24*time.Hour))
		if usageEnabled && c.State == "running" {
			if p, ok := dockerStatsStore.latest(c.ID); ok {
				v.Usage = &dockerViewUsage{CPU: p.CPU, Mem: p.Mem}
			}
		}
		out = append(out, v)
	}
	writeJSON(w, map[string]any{"available": true, "containers": out, "usageEnabled": usageEnabled})
}
