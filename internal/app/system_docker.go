package app

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
What is running, and what is quietly not.

Over the Docker Engine API on its unix socket, with net/http and a custom
dialler -- no SDK, which would be the first dependency in this tree beyond mux
and x/net for calls this small.

The socket is opt-in and stays that way. Read-only access still exposes the
daemon's whole read API: every container, its image, its environment, its
mounts. That is a real grant for a container count, so it is off unless
NEXTDASH_DOCKER_SOCKET names a path, the widget says so until it does, and the
documentation states what is being handed over rather than only how.

Deliberately no per-container CPU or memory: one /stats call measured a full
second, so twenty containers would be twenty seconds of polling per beat. That
is a monitoring system, not a tile, and the custom widget already exists for it.
*/

// dockerAPIVersion is the version nextDash speaks: old enough for any daemon
// still in use. A daemon can refuse it -- Docker Engine 29.0 to 29.2 would take
// nothing older than 1.44 -- and then its own minimum is used instead, which
// dockerAPIVersionFor asks for once per socket.
const dockerAPIVersion = "v1.41"

var dockerAPIVersions sync.Map // socket -> "vX.Y"

// dockerAPIVersionFor is the version to put in front of every path on this
// socket. The unversioned /version answers on every daemon; a daemon that
// cannot be reached is asked again next time, one that answers is not.
func dockerAPIVersionFor(socket string) string {
	if v, ok := dockerAPIVersions.Load(socket); ok {
		return v.(string)
	}
	resp, err := dockerClientFor(socket).Get("http://docker/version")
	if err != nil {
		return dockerAPIVersion
	}
	defer resp.Body.Close()
	version := dockerAPIVersion
	var body struct {
		MinAPIVersion string `json:"MinAPIVersion"`
	}
	if resp.StatusCode == http.StatusOK && json.NewDecoder(resp.Body).Decode(&body) == nil &&
		dockerAPIVersionLess(strings.TrimPrefix(dockerAPIVersion, "v"), body.MinAPIVersion) {
		version = "v" + body.MinAPIVersion
	}
	dockerAPIVersions.Store(socket, version)
	return version
}

// dockerAPIVersionLess compares "1.41" and "1.44" as numbers, not text.
func dockerAPIVersionLess(a, b string) bool {
	parse := func(v string) (int, int, bool) {
		major, minor, ok := strings.Cut(strings.TrimSpace(v), ".")
		x, err1 := strconv.Atoi(major)
		y, err2 := strconv.Atoi(minor)
		return x, y, ok && err1 == nil && err2 == nil
	}
	am, an, ok1 := parse(a)
	bm, bn, ok2 := parse(b)
	if !ok1 || !ok2 {
		return false
	}
	return am < bm || (am == bm && an < bn)
}

// How new a running container has to be to count as recently restarted.
// Something up for minutes while everything else has run for days is the shape
// of a crashloop, and no count can show it.
const dockerRestartWindow = time.Hour

// Beyond this the tile would list rather than report; the count still tells the
// whole story.
const dockerMaxNames = 6

type DockerMetrics struct {
	MetricStatus
	Running   int `json:"running"`
	Stopped   int `json:"stopped"`
	Paused    int `json:"paused"`
	Total     int `json:"total"`
	Images    int `json:"images"`
	Unhealthy int `json:"unhealthy"`
	// Updates is how many images the last update check found newer versions
	// of; the check itself belongs to the Docker view.
	Updates int `json:"updates"`

	// Named, because "one unhealthy" sends you looking and "one unhealthy:
	// jellyfin" does not.
	UnhealthyNames []string `json:"unhealthyNames,omitempty"`
	RestartedNames []string `json:"restartedNames,omitempty"`

	// What the Disk tab last found reclaimable (-1 before any measurement)
	// and when; incidents -- crashes and turns unhealthy -- in the last day,
	// from the timeline; and the three busiest containers by CPU, from the
	// stats sampler.
	Reclaimable   int64          `json:"reclaimable"`
	ReclaimableAt int64          `json:"reclaimableAt,omitempty"`
	Incidents24h  int            `json:"incidents24h"`
	TopCPU        []dockerTopCPU `json:"topCpu,omitempty"`

	running []dockerRunningRef // for the figures above; not sent
}

type dockerTopCPU struct {
	Name string  `json:"name"`
	CPU  float64 `json:"cpu"`
}

type dockerRunningRef struct{ ID, Name string }

const dockerTopCPUCount = 3

// fillDockerExtras adds what the container list alone cannot say: updates as
// the reader sees them (skipped and held left out), the last reclaimable
// figure, the day's incidents and the busiest containers.
func fillDockerExtras(out *DockerMetrics, running []dockerRunningRef, now time.Time) {
	out.Updates = 0
	for _, u := range readDockerUpdateStore().withChoices() {
		if u.Status == "available" {
			out.Updates++
		}
	}
	out.Reclaimable, out.ReclaimableAt = dockerReclaimable(now)
	out.Incidents24h = dockerTimelines.countSince(now.Add(-24*time.Hour), "crash", "unhealthy")
	var top []dockerTopCPU
	for _, r := range running {
		if p, ok := dockerStatsStore.latest(r.ID); ok {
			top = append(top, dockerTopCPU{Name: r.Name, CPU: p.CPU})
		}
	}
	sort.SliceStable(top, func(i, j int) bool { return top[i].CPU > top[j].CPU })
	if len(top) > dockerTopCPUCount {
		top = top[:dockerTopCPUCount]
	}
	out.TopCPU = top
}

/*
dockerClientFor hands back the client for this socket, building it once.

The socket comes from NEXTDASH_DOCKER_SOCKET and does not change while the
process runs, but this was building a fresh client and transport on every
metrics read -- which the floor allows as often as once every two seconds, for
as long as a dashboard is open. Each one kept its connection and the goroutine
behind it until the daemon hung up.

Keyed rather than kept in a single variable so a test can ask for another socket
without inheriting the first one's client. The set of keys is whatever this
process was configured with, not anything a request can name.
*/
var dockerClients sync.Map

// dockerClientTimeout bounds a whole read -- request and body -- so a daemon
// that stops answering cannot hold a metrics poll or a list open. A variable so
// a test can shorten it rather than wait it out.
var dockerClientTimeout = 5 * time.Second

func dockerClientFor(socket string) *http.Client {
	if cached, ok := dockerClients.Load(socket); ok {
		return cached.(*http.Client)
	}
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", socket)
			},
			IdleConnTimeout: 30 * time.Second,
		},
		Timeout: dockerClientTimeout,
	}
	actual, _ := dockerClients.LoadOrStore(socket, client)
	return actual.(*http.Client)
}

// dockerActionClients are the same per-socket clients with no overall
// timeout, for start, stop, update and remove: dockerActionTimeout on the
// request's context is what ends one that hangs.
var dockerActionClients sync.Map

func dockerActionClientFor(socket string) *http.Client {
	if cached, ok := dockerActionClients.Load(socket); ok {
		return cached.(*http.Client)
	}
	client := &http.Client{Transport: dockerClientFor(socket).Transport}
	actual, _ := dockerActionClients.LoadOrStore(socket, client)
	return actual.(*http.Client)
}

// containerName strips the leading slash Docker puts on every name.
func containerName(names []string) string {
	if len(names) == 0 {
		return ""
	}
	return strings.TrimPrefix(names[0], "/")
}

/*
countContainers folds the container list into the figures the tile offers.

Health lives only in the human-readable Status text ("Up 4 minutes
(unhealthy)"), which is the API's own doing: a container can be running and
useless at the same time, and no count of running containers shows that.
*/
func countContainers(body io.Reader) (DockerMetrics, error) {
	var list []struct {
		ID      string   `json:"Id"`
		Names   []string `json:"Names"`
		State   string   `json:"State"`
		Status  string   `json:"Status"`
		Created int64    `json:"Created"`
	}
	if err := json.NewDecoder(body).Decode(&list); err != nil {
		return DockerMetrics{}, err
	}

	out := DockerMetrics{MetricStatus: MetricStatus{Available: true}}
	cutoff := time.Now().Add(-dockerRestartWindow).Unix()

	hidden := dockerHiddenSet()
	for _, item := range list {
		name := containerName(item.Names)
		if hidden[name] {
			continue
		}
		out.Total++

		switch item.State {
		case "running":
			out.Running++
			out.running = append(out.running, dockerRunningRef{ID: item.ID, Name: name})
			// A container with no healthcheck at all is not unhealthy, it is
			// simply unknown -- so this looks for the word, not its absence.
			if strings.Contains(item.Status, "(unhealthy)") {
				out.Unhealthy++
				if name != "" && len(out.UnhealthyNames) < dockerMaxNames {
					out.UnhealthyNames = append(out.UnhealthyNames, name)
				}
			}
			if item.Created > cutoff && name != "" && len(out.RestartedNames) < dockerMaxNames {
				out.RestartedNames = append(out.RestartedNames, name)
			}
		case "paused":
			out.Paused++
		default:
			// exited, created, dead, restarting: not running, which is the
			// distinction the tile draws.
			out.Stopped++
		}
	}
	return out, nil
}

func readDocker() DockerMetrics {
	socket := dockerSocketPath()
	if socket == "" {
		return DockerMetrics{MetricStatus: MetricStatus{Reason: reasonNoDockerSocket}}
	}
	client := dockerClientFor(socket)

	version := dockerAPIVersionFor(socket)
	resp, err := client.Get("http://docker/" + version + "/containers/json?all=1")
	if err != nil {
		return DockerMetrics{MetricStatus: MetricStatus{Reason: dockerDialReason(err)}}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return DockerMetrics{MetricStatus: MetricStatus{Reason: reasonReadFailed}}
	}

	out, err := countContainers(resp.Body)
	if err != nil {
		return DockerMetrics{MetricStatus: MetricStatus{Reason: reasonReadFailed}}
	}

	/*
	   The image count is only in /info, and a daemon that answered the first
	   call and not this one is still worth reporting -- the containers are the
	   point, the images are a bonus.

	   This figure can sit one or two below `docker images`, which counts tags
	   rather than images: the same image under two tags is two CLI rows and one
	   image here. The API's own number is the honest one.
	*/
	if info, err := client.Get("http://docker/" + version + "/info"); err == nil {
		defer info.Body.Close()
		var payload struct {
			Images int `json:"Images"`
		}
		if json.NewDecoder(info.Body).Decode(&payload) == nil {
			out.Images = payload.Images
		}
	}
	fillDockerExtras(&out, out.running, time.Now())
	return out
}
