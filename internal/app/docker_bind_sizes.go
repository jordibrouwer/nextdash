package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

/*
What a bind mount's host folder takes, measured on request.

nextDash cannot read those folders itself -- Unraid's appdata is not mounted
into its container -- but the Docker daemon can mount them into another. So a
measurement starts a small throwaway container (alpine) with the folder
mounted read-only and no network, runs du on it, reads the answer from its log
and removes it. Only folders a container on this host mounts can be measured:
the request names one, and it is checked against the list, so the route
cannot be used to mount an arbitrary host path.

One measurement runs at a time. The result is kept per folder in the data
directory, with when it was taken, and rides along with the Disk view.
*/

const (
	dockerBindMeasureImage   = "alpine:3.20"
	dockerBindMeasureTimeout = 5 * time.Minute
	dockerBindMeasureLabel   = "nextdash.measure"
)

type dockerBindSize struct {
	Bytes int64 `json:"bytes"`
	At    int64 `json:"at"` // unix milliseconds
}

var dockerBindSizes = struct {
	mu     sync.Mutex
	loaded bool
	data   map[string]dockerBindSize
}{data: map[string]dockerBindSize{}}

var dockerBindMeasuring atomic.Bool

func dockerBindSizesPath() string {
	return filepath.Join(ResolveDataDir(), "docker-bind-sizes.json")
}

func dockerBindSizeOf(source string) (dockerBindSize, bool) {
	dockerBindSizes.mu.Lock()
	defer dockerBindSizes.mu.Unlock()
	loadDockerBindSizesLocked()
	s, ok := dockerBindSizes.data[source]
	return s, ok
}

func loadDockerBindSizesLocked() {
	if dockerBindSizes.loaded {
		return
	}
	dockerBindSizes.loaded = true
	raw, err := os.ReadFile(dockerBindSizesPath())
	if err != nil {
		return
	}
	var stored map[string]dockerBindSize
	if json.Unmarshal(raw, &stored) == nil && stored != nil {
		dockerBindSizes.data = stored
	}
}

func rememberDockerBindSize(source string, size dockerBindSize) {
	dockerBindSizes.mu.Lock()
	defer dockerBindSizes.mu.Unlock()
	loadDockerBindSizesLocked()
	dockerBindSizes.data[source] = size
	if raw, err := json.Marshal(dockerBindSizes.data); err == nil {
		_ = os.WriteFile(dockerBindSizesPath(), raw, 0o600)
	}
}

// parseDuBytes reads `du -sb` output: "<bytes>\t<path>" on its last line.
func parseDuBytes(lines []string) (int64, error) {
	for i := len(lines) - 1; i >= 0; i-- {
		fields := strings.Fields(lines[i])
		if len(fields) == 0 {
			continue
		}
		if n, err := strconv.ParseInt(fields[0], 10, 64); err == nil && n >= 0 {
			return n, nil
		}
	}
	return 0, errors.New("du gave no size")
}

// dockerBindMeasureRun measures one folder; a variable so a test can stand in
// for the daemon.
var dockerBindMeasureRun = measureDockerBind

func measureDockerBind(ctx context.Context, api *dockerAPI, source string) (int64, error) {
	if _, err := api.inspectImage(ctx, dockerBindMeasureImage); err != nil {
		if err := api.pullImage(ctx, dockerBindMeasureImage); err != nil {
			return 0, err
		}
	}
	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	id, err := api.createContainer(ctx, "nextdash-measure-"+hex.EncodeToString(suffix), dockerCreateBody{
		"Image":  dockerBindMeasureImage,
		"Cmd":    []string{"du", "-sb", "/measure"},
		"Labels": map[string]string{dockerBindMeasureLabel: "1"},
		"HostConfig": map[string]any{
			"Binds":       []string{source + ":/measure:ro"},
			"NetworkMode": "none",
		},
	})
	if err != nil {
		return 0, err
	}
	// Removed however it ends, on a context of its own: the request's may be
	// the one that ran out.
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		resp, err := api.do(cleanup, http.MethodDelete, "/containers/"+url.PathEscape(id)+"?force=true&v=true", nil)
		if err == nil {
			resp.Body.Close()
		}
	}()
	if err := api.post(ctx, "/containers/"+url.PathEscape(id)+"/start", nil); err != nil {
		return 0, err
	}
	var waited struct {
		StatusCode int `json:"StatusCode"`
	}
	resp, err := api.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/wait", nil)
	if err != nil {
		return 0, err
	}
	_ = json.NewDecoder(resp.Body).Decode(&waited)
	resp.Body.Close()
	lines, err := api.logsTail(ctx, id, 20)
	if err != nil {
		return 0, err
	}
	// du exits 1 when a file could not be read, and still prints the total
	// of what it could: that total is the answer, if it is there.
	return parseDuBytes(lines)
}

// dockerMeasurableBind: whether a container on this host mounts the folder.
func dockerMeasurableBind(list []dockerContainerSummary, source string) bool {
	for _, c := range list {
		for _, m := range c.Mounts {
			if m.Type == "bind" && m.Source == source && !dockerSystemBind(source) {
				return true
			}
		}
	}
	return false
}

// DockerBindMeasureHandler measures one bind mount's folder, named in the body.
func (h *Handlers) DockerBindMeasureHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Source string `json:"source"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil || body.Source == "" {
		dockerRefuse(w, http.StatusBadRequest, "source")
		return
	}
	api, ok := h.dockerDiskGuard(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), dockerBindMeasureTimeout)
	defer cancel()
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(dockerBindMeasureTimeout + time.Minute))
	list, err := api.listContainers(ctx)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	if !dockerMeasurableBind(list, body.Source) {
		dockerRefuse(w, http.StatusBadRequest, "not-a-bind")
		return
	}
	if !dockerBindMeasuring.CompareAndSwap(false, true) {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	defer dockerBindMeasuring.Store(false)
	n, err := dockerBindMeasureRun(ctx, api, body.Source)
	if err != nil {
		logWarn(logComponentMutate, "measuring %s failed: %v", body.Source, err)
		writeDockerError(w, err)
		return
	}
	size := dockerBindSize{Bytes: n, At: time.Now().UnixMilli()}
	rememberDockerBindSize(body.Source, size)
	writeJSON(w, map[string]any{"ok": true, "source": body.Source, "bytes": size.Bytes, "at": size.At})
}
