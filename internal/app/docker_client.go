package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

/*
The Engine API calls the Docker view makes, over the same unix-socket client the
widget uses. Typed only as far as the view reads: every field here is one the
table, the drawer or recreate needs, and nothing else is decoded.
*/

type dockerAPI struct {
	client *http.Client
	socket string
}

// forActions is the same daemon without the read client's deadline. A pull
// streams for as long as the layers take and a stop waits out the container's
// own timeout; the action's context bounds them instead.
func (d *dockerAPI) forActions() *dockerAPI {
	return &dockerAPI{client: dockerActionClientFor(d.socket), socket: d.socket}
}

type dockerAPIError struct {
	Status  int
	Message string
}

func (e *dockerAPIError) Error() string { return fmt.Sprintf("docker: %d %s", e.Status, e.Message) }

// newDockerAPI returns the client, or the reason there is none.
func newDockerAPI() (*dockerAPI, string) {
	socket := dockerSocketPath()
	if socket == "" {
		return nil, reasonNoDockerSocket
	}
	return &dockerAPI{client: dockerClientFor(socket), socket: socket}, ""
}

func (d *dockerAPI) url(path string) string {
	return "http://docker/" + dockerAPIVersionFor(d.socket) + path
}

func (d *dockerAPI) do(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.url(path), reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusNotModified {
		defer resp.Body.Close()
		var payload struct {
			Message string `json:"message"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&payload)
		return nil, &dockerAPIError{Status: resp.StatusCode, Message: payload.Message}
	}
	return resp, nil
}

func (d *dockerAPI) getJSON(ctx context.Context, path string, out any) error {
	resp, err := d.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(out)
}

// post sends an action. 304 ("already started") counts as success: the state
// the reader asked for is the state the container is in.
func (d *dockerAPI) post(ctx context.Context, path string, body any) error {
	resp, err := d.do(ctx, http.MethodPost, path, body)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.Body.Close()
}

type dockerPort struct {
	IP          string `json:"IP"`
	PrivatePort int    `json:"PrivatePort"`
	PublicPort  int    `json:"PublicPort"`
	Type        string `json:"Type"`
}

type dockerContainerSummary struct {
	ID      string            `json:"Id"`
	Names   []string          `json:"Names"`
	Image   string            `json:"Image"`
	ImageID string            `json:"ImageID"`
	State   string            `json:"State"`
	Status  string            `json:"Status"`
	Created int64             `json:"Created"`
	Labels  map[string]string `json:"Labels"`
	Ports   []dockerPort      `json:"Ports"`
	// The network a container runs in, and its address on each network it
	// joined -- how a macvlan container's own LAN address is found.
	HostConfig struct {
		NetworkMode string `json:"NetworkMode"`
	} `json:"HostConfig"`
	NetworkSettings struct {
		Networks map[string]struct {
			IPAddress string `json:"IPAddress"`
		} `json:"Networks"`
	} `json:"NetworkSettings"`
	// Mounts: which volumes the container holds, running or not.
	Mounts []struct {
		Type        string `json:"Type"`
		Name        string `json:"Name"`
		Source      string `json:"Source"`
		Destination string `json:"Destination"`
	} `json:"Mounts"`
}

func (c dockerContainerSummary) name() string { return containerName(c.Names) }

func (d *dockerAPI) listContainers(ctx context.Context) ([]dockerContainerSummary, error) {
	var out []dockerContainerSummary
	if err := d.getJSON(ctx, "/containers/json?all=1", &out); err != nil {
		return out, err
	}
	// A container whose tag has moved on -- pulled but not recreated, or
	// another container on the same image updated -- is listed by its image
	// id. The reference it was made from is in its own Config, and everything
	// keyed by image (the update state, the Image column) wants that.
	for i := range out {
		if strings.HasPrefix(out[i].Image, "sha256:") {
			if in, err := d.inspectContainer(ctx, out[i].ID); err == nil && in.Config.Image != "" {
				out[i].Image = in.Config.Image
			}
		}
	}
	return out, nil
}

// dockerTagKey names a tag the same way however it was written:
// "nginx", "nginx:latest" and "docker.io/library/nginx:latest" are one.
func dockerTagKey(ref string) string {
	parsed, ok := parseImageRef(ref)
	if !ok {
		return ""
	}
	return parsed.Registry + "/" + parsed.Repo + ":" + parsed.Tag
}

// imageTagIDs maps each local tag to the image it points at, in one call.
func (d *dockerAPI) imageTagIDs(ctx context.Context) map[string]string {
	var images []struct {
		ID       string   `json:"Id"`
		RepoTags []string `json:"RepoTags"`
	}
	out := map[string]string{}
	if err := d.getJSON(ctx, "/images/json", &images); err != nil {
		return out
	}
	for _, im := range images {
		for _, tag := range im.RepoTags {
			if key := dockerTagKey(tag); key != "" {
				out[key] = im.ID
			}
		}
	}
	return out
}

type dockerNetworkSummary struct {
	Name   string `json:"Name"`
	Driver string `json:"Driver"`
}

func (d *dockerAPI) listNetworks(ctx context.Context) ([]dockerNetworkSummary, error) {
	var out []dockerNetworkSummary
	err := d.getJSON(ctx, "/networks", &out)
	return out, err
}

type dockerInspect struct {
	ID      string `json:"Id"`
	Name    string `json:"Name"`
	Image   string `json:"Image"`
	Created string `json:"Created"`
	State   struct {
		Status    string `json:"Status"`
		Running   bool   `json:"Running"`
		Paused    bool   `json:"Paused"`
		StartedAt string `json:"StartedAt"`
		ExitCode  int    `json:"ExitCode"`
		Health    *struct {
			Status        string `json:"Status"`
			FailingStreak int    `json:"FailingStreak"`
			Log           []struct {
				Start    string `json:"Start"`
				End      string `json:"End"`
				ExitCode int    `json:"ExitCode"`
				Output   string `json:"Output"`
			} `json:"Log"`
		} `json:"Health"`
	} `json:"State"`
	// Config and HostConfig are kept raw as well as typed: recreate hands them
	// back to the daemon unchanged, and a field this struct does not know about
	// must survive the trip.
	Config struct {
		Image  string            `json:"Image"`
		Env    []string          `json:"Env"`
		Labels map[string]string `json:"Labels"`
		// Tty: the log is the raw terminal output, with no frame headers.
		Tty bool `json:"Tty"`
		// Healthcheck.Test is the healthcheck command as the image or the
		// run set it: ["CMD", args...], ["CMD-SHELL", line] or ["NONE"].
		Healthcheck *struct {
			Test []string `json:"Test"`
		} `json:"Healthcheck"`
	} `json:"Config"`
	HostConfig struct {
		RestartPolicy struct {
			Name string `json:"Name"`
		} `json:"RestartPolicy"`
		// AutoRemove: the daemon removes the container once it stops.
		AutoRemove bool `json:"AutoRemove"`
	} `json:"HostConfig"`
	Mounts []struct {
		Type        string `json:"Type"`
		Name        string `json:"Name"`
		Source      string `json:"Source"`
		Destination string `json:"Destination"`
		RW          bool   `json:"RW"`
	} `json:"Mounts"`
	NetworkSettings struct {
		Networks map[string]struct {
			IPAddress  string          `json:"IPAddress"`
			Aliases    []string        `json:"Aliases"`
			MacAddress string          `json:"MacAddress"`
			IPAMConfig json.RawMessage `json:"IPAMConfig"`
		} `json:"Networks"`
	} `json:"NetworkSettings"`

	raw struct {
		Config     json.RawMessage
		HostConfig json.RawMessage
	}
}

func (d *dockerAPI) inspectContainer(ctx context.Context, id string) (dockerInspect, error) {
	resp, err := d.do(ctx, http.MethodGet, "/containers/"+url.PathEscape(id)+"/json", nil)
	if err != nil {
		return dockerInspect{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return dockerInspect{}, err
	}
	var out dockerInspect
	if err := json.Unmarshal(body, &out); err != nil {
		return dockerInspect{}, err
	}
	var raw struct {
		Config     json.RawMessage `json:"Config"`
		HostConfig json.RawMessage `json:"HostConfig"`
	}
	_ = json.Unmarshal(body, &raw)
	out.raw.Config, out.raw.HostConfig = raw.Config, raw.HostConfig
	return out, nil
}

type dockerImageInspect struct {
	ID          string   `json:"Id"`
	RepoDigests []string `json:"RepoDigests"`
	Config      struct {
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
}

func (d *dockerAPI) inspectImage(ctx context.Context, ref string) (dockerImageInspect, error) {
	var out dockerImageInspect
	err := d.getJSON(ctx, "/images/"+url.PathEscape(ref)+"/json", &out)
	return out, err
}

// inspectImageConfig is an image's Config as the daemon keeps it, untyped:
// recreate compares a container's Config against it field by field.
func (d *dockerAPI) inspectImageConfig(ctx context.Context, ref string) (map[string]any, error) {
	var out struct {
		Config map[string]any `json:"Config"`
	}
	err := d.getJSON(ctx, "/images/"+url.PathEscape(ref)+"/json", &out)
	return out.Config, err
}

type dockerCreateBody map[string]any

func (d *dockerAPI) createContainer(ctx context.Context, name string, body dockerCreateBody) (string, error) {
	resp, err := d.do(ctx, http.MethodPost, "/containers/create?name="+url.QueryEscape(name), body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		ID string `json:"Id"`
	}
	err = json.NewDecoder(resp.Body).Decode(&out)
	return out.ID, err
}

// pullImage reads the progress stream to its end: the pull is finished when
// the stream is, and an error arrives as a line in it, not as a status code.
func (d *dockerAPI) pullImage(ctx context.Context, ref string) error {
	repo, tag := splitImageTag(ref)
	resp, err := d.do(ctx, http.MethodPost,
		"/images/create?fromImage="+url.QueryEscape(repo)+"&tag="+url.QueryEscape(tag), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	for scanner.Scan() {
		var line struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(scanner.Bytes(), &line) == nil && line.Error != "" {
			return &dockerAPIError{Status: http.StatusBadGateway, Message: line.Error}
		}
	}
	return scanner.Err()
}

func (d *dockerAPI) remove(ctx context.Context, id string) error {
	resp, err := d.do(ctx, http.MethodDelete, "/containers/"+url.PathEscape(id)+"?v=false", nil)
	if err != nil {
		return err
	}
	return resp.Body.Close()
}

type dockerStatsSample struct {
	CPUPercent  float64 `json:"cpuPercent"`
	MemoryUsed  uint64  `json:"memoryUsed"`
	MemoryLimit uint64  `json:"memoryLimit"`
}

// dockerStatsRaw is the part of a stats reading this reads.
type dockerStatsRaw struct {
	CPU struct {
		Usage struct {
			Total uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		System uint64 `json:"system_cpu_usage"`
		Online int    `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPU struct {
		Usage struct {
			Total uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		System uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	Mem struct {
		Usage uint64            `json:"usage"`
		Limit uint64            `json:"limit"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
	// Networks: bytes in and out per interface since the container started.
	Networks map[string]struct {
		Rx uint64 `json:"rx_bytes"`
		Tx uint64 `json:"tx_bytes"`
	} `json:"networks"`
	// Blkio: bytes read and written since it started, per device and op.
	// cgroup v1 names the ops Read/Write, v2 read/write.
	Blkio struct {
		Bytes []struct {
			Op    string `json:"op"`
			Value uint64 `json:"value"`
		} `json:"io_service_bytes_recursive"`
	} `json:"blkio_stats"`
}

// netTotals adds up every interface's bytes in and out.
func (raw dockerStatsRaw) netTotals() (rx, tx uint64) {
	for _, n := range raw.Networks {
		rx += n.Rx
		tx += n.Tx
	}
	return rx, tx
}

// diskTotals adds up the bytes read and written on every device.
func (raw dockerStatsRaw) diskTotals() (read, write uint64) {
	for _, b := range raw.Blkio.Bytes {
		switch strings.ToLower(b.Op) {
		case "read":
			read += b.Value
		case "write":
			write += b.Value
		}
	}
	return read, write
}

// memoryUsed is what `docker stats` shows: page cache is reclaimable, so it
// is not "used".
func (raw dockerStatsRaw) memoryUsed() uint64 {
	used := raw.Mem.Usage
	if cache, ok := raw.Mem.Stats["inactive_file"]; ok && cache < used {
		used -= cache
	}
	return used
}

func (d *dockerAPI) statsOnce(ctx context.Context, id string) (dockerStatsSample, error) {
	var raw dockerStatsRaw
	if err := d.getJSON(ctx, "/containers/"+url.PathEscape(id)+"/stats?stream=false", &raw); err != nil {
		return dockerStatsSample{}, err
	}
	out := dockerStatsSample{MemoryLimit: raw.Mem.Limit, MemoryUsed: raw.memoryUsed()}
	cpuDelta := float64(raw.CPU.Usage.Total) - float64(raw.PreCPU.Usage.Total)
	sysDelta := float64(raw.CPU.System) - float64(raw.PreCPU.System)
	if cpuDelta > 0 && sysDelta > 0 {
		online := raw.CPU.Online
		if online == 0 {
			online = 1
		}
		out.CPUPercent = cpuDelta / sysDelta * float64(online) * 100
	}
	return out, nil
}

// logsTail demultiplexes the 8-byte frame headers a non-TTY container writes.
// A TTY container sends raw text; that is detected by the first byte not being
// a stream id (0, 1 or 2).
func (d *dockerAPI) logsTail(ctx context.Context, id string, tail int) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	resp, err := d.do(ctx, http.MethodGet, "/containers/"+url.PathEscape(id)+
		"/logs?stdout=1&stderr=1&tail="+strconv.Itoa(tail), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	var text bytes.Buffer
	if len(body) >= 8 && body[0] <= 2 && body[1] == 0 && body[2] == 0 && body[3] == 0 {
		for len(body) >= 8 {
			size := int(binary.BigEndian.Uint32(body[4:8]))
			body = body[8:]
			if size > len(body) {
				size = len(body)
			}
			text.Write(body[:size])
			body = body[size:]
		}
	} else {
		text.Write(body)
	}
	lines := strings.Split(strings.TrimRight(text.String(), "\n"), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return []string{}, nil
	}
	return lines, nil
}

// splitImageTag separates "repo:tag" without mistaking a registry port for a
// tag: "host:5000/app" has no tag, "host:5000/app:1" has tag "1".
func splitImageTag(ref string) (string, string) {
	if at := strings.Index(ref, "@"); at >= 0 {
		return ref[:at], ref[at+1:]
	}
	slash := strings.LastIndex(ref, "/")
	colon := strings.LastIndex(ref, ":")
	if colon > slash {
		return ref[:colon], ref[colon+1:]
	}
	return ref, "latest"
}
