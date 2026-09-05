package app

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
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

const dockerAPIVersion = "v1.41"

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

	// Named, because "one unhealthy" sends you looking and "one unhealthy:
	// jellyfin" does not.
	UnhealthyNames []string `json:"unhealthyNames,omitempty"`
	RestartedNames []string `json:"restartedNames,omitempty"`
}

func dockerClientFor(socket string) *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", socket)
			},
		},
		Timeout: 5 * time.Second,
	}
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

	for _, item := range list {
		out.Total++
		name := containerName(item.Names)

		switch item.State {
		case "running":
			out.Running++
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

	resp, err := client.Get("http://docker/" + dockerAPIVersion + "/containers/json?all=1")
	if err != nil {
		return DockerMetrics{MetricStatus: MetricStatus{Reason: reasonNoDockerSocket}}
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
	if info, err := client.Get("http://docker/" + dockerAPIVersion + "/info"); err == nil {
		defer info.Body.Close()
		var payload struct {
			Images int `json:"Images"`
		}
		if json.NewDecoder(info.Body).Decode(&payload) == nil {
			out.Images = payload.Images
		}
	}
	return out
}
