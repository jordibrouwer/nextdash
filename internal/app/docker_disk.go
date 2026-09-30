package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

/*
Disk: what images, volumes and build cache take up, and clearing what nothing
uses.

One /system/df read -- slow on a big host, so it has a timeout of its own and
the view asks only when its Disk tab is opened -- joined with the container
list, which says what uses what (a stopped container still holds its image and
its volumes), and with the update history, which says which untagged image is
still some container's way back (docker_update_history.go). Pruning dangling
images ends those rollbacks; the view says so before asking.

Pruning is an action like stop or update: control on, the write token, one at
a time. Volumes are never pruned in bulk -- they hold data -- but removed one
by one, each named twice.
*/

const dockerDiskTimeout = 60 * time.Second

type dockerDfResponse struct {
	// LayersSize is what the images take on disk, each shared layer once;
	// the images' own sizes add those layers up again for every image.
	LayersSize int64 `json:"LayersSize"`
	Images     []struct {
		ID       string   `json:"Id"`
		RepoTags []string `json:"RepoTags"`
		Size     int64    `json:"Size"`
		// SharedSize is the part of Size in layers other images use too;
		// -1 when the daemon did not work it out.
		SharedSize int64 `json:"SharedSize"`
	} `json:"Images"`
	Volumes []struct {
		Name      string `json:"Name"`
		Driver    string `json:"Driver"`
		UsageData struct {
			Size     int64 `json:"Size"`
			RefCount int64 `json:"RefCount"`
		} `json:"UsageData"`
	} `json:"Volumes"`
	// Containers carries each one's writable layer and its size with the
	// image, the figures the list shows (docker_sizes.go).
	Containers []struct {
		ID         string `json:"Id"`
		SizeRw     int64  `json:"SizeRw"`
		SizeRootFs int64  `json:"SizeRootFs"`
	} `json:"Containers"`
	BuildCache []struct {
		Size   int64 `json:"Size"`
		Shared bool  `json:"Shared"`
		InUse  bool  `json:"InUse"`
	} `json:"BuildCache"`
}

type dockerDiskImage struct {
	ID          string   `json:"id"`
	Tags        []string `json:"tags"`
	Size        int64    `json:"size"`
	UsedBy      []string `json:"usedBy"`
	Dangling    bool     `json:"dangling"`
	RollbackFor []string `json:"rollbackFor,omitempty"`
}

type dockerDiskVolume struct {
	Name   string   `json:"name"`
	Driver string   `json:"driver"`
	Size   int64    `json:"size"` // -1 when the daemon did not measure it
	UsedBy []string `json:"usedBy"`
}

// dockerDiskBind is a host folder containers mount (a bind mount, as Unraid's
// appdata). Not a volume: Docker neither owns nor measures it, so it has no
// size and no remove; it is listed so the data a container keeps is findable.
type dockerDiskBind struct {
	Source string             `json:"source"`
	UsedBy []dockerDiskBindAt `json:"usedBy"`
}

type dockerDiskBindAt struct {
	Container   string `json:"container"`
	Destination string `json:"destination"`
}

type dockerDiskTotals struct {
	Images             int64 `json:"images"`
	ImagesUnused       int64 `json:"imagesUnused"`
	ImagesUnusedCount  int   `json:"imagesUnusedCount"`
	Dangling           int64 `json:"dangling"`
	DanglingCount      int   `json:"danglingCount"`
	BuildCache         int64 `json:"buildCache"`
	BuildCacheCount    int   `json:"buildCacheCount"`
	Volumes            int64 `json:"volumes"`
	VolumesUnused      int64 `json:"volumesUnused"`
	VolumesUnusedCount int   `json:"volumesUnusedCount"`
	// Stopped containers: what their writable layers take, and how many.
	// nextDash's own and hidden containers are not counted.
	ContainersStopped      int64 `json:"containersStopped"`
	ContainersStoppedCount int   `json:"containersStoppedCount"`
	Reclaimable        int64 `json:"reclaimable"`
}

type dockerDiskView struct {
	Images  []dockerDiskImage  `json:"images"`
	Volumes []dockerDiskVolume `json:"volumes"`
	Binds   []dockerDiskBind   `json:"binds"`
	// Stopped names the containers "Remove stopped" would remove.
	Stopped []string `json:"stopped"`
	Totals  dockerDiskTotals   `json:"totals"`
}

func dockerTagged(tags []string) []string {
	out := []string{}
	for _, t := range tags {
		if t != "" && t != "<none>:<none>" {
			out = append(out, t)
		}
	}
	return out
}

// dockerRollbackImages: untagged image id -> containers whose rollback needs it.
func dockerRollbackImages(list []dockerContainerSummary) map[string][]string {
	out := map[string][]string{}
	for _, c := range list {
		if e := dockerRollbackCandidate(dockerUpdateHistoryFor(c.name()), c.ImageID); e != nil {
			out[e.FromImageID] = append(out[e.FromImageID], c.name())
		}
	}
	return out
}

// dockerSystemBind: a host file a container mounts to reach the host itself
// (the Docker socket, the clock), not data it keeps.
func dockerSystemBind(src string) bool {
	switch src {
	case "/var/run/docker.sock", "/run/docker.sock", "/etc/localtime", "/etc/timezone":
		return true
	}
	return strings.HasPrefix(src, "/dev/") || strings.HasPrefix(src, "/sys/") || strings.HasPrefix(src, "/proc/")
}

// dockerPrunableContainers: what "Remove stopped" removes -- exited, created
// or dead, and neither hidden in Config nor nextDash's own. Docker's own
// /containers/prune cannot leave the hidden ones be, so it is not used.
func dockerPrunableContainers(list []dockerContainerSummary) []dockerContainerSummary {
	hidden := dockerHiddenSet()
	self := dockerSelfID()
	out := []dockerContainerSummary{}
	for _, c := range list {
		switch c.State {
		case "exited", "created", "dead":
		default:
			continue
		}
		if hidden[c.name()] || isDockerSelf(c.ID, self) {
			continue
		}
		out = append(out, c)
	}
	return out
}

func buildDockerDiskView(df dockerDfResponse, list []dockerContainerSummary) dockerDiskView {
	imageUsers := map[string][]string{}
	volumeUsers := map[string][]string{}
	bindUsers := map[string][]dockerDiskBindAt{}
	for _, c := range list {
		imageUsers[c.ImageID] = append(imageUsers[c.ImageID], c.name())
		for _, m := range c.Mounts {
			if m.Type == "volume" && m.Name != "" {
				volumeUsers[m.Name] = append(volumeUsers[m.Name], c.name())
			}
			if m.Type == "bind" && m.Source != "" && !dockerSystemBind(m.Source) {
				bindUsers[m.Source] = append(bindUsers[m.Source], dockerDiskBindAt{Container: c.name(), Destination: m.Destination})
			}
		}
	}
	rollback := dockerRollbackImages(list)
	v := dockerDiskView{Images: []dockerDiskImage{}, Volumes: []dockerDiskVolume{}, Binds: []dockerDiskBind{}}
	for src, at := range bindUsers {
		sort.Slice(at, func(i, j int) bool { return at[i].Container < at[j].Container })
		v.Binds = append(v.Binds, dockerDiskBind{Source: src, UsedBy: at})
	}
	sort.Slice(v.Binds, func(i, j int) bool { return v.Binds[i].Source < v.Binds[j].Source })
	for _, im := range df.Images {
		users := append([]string{}, imageUsers[im.ID]...)
		sort.Strings(users)
		tags := dockerTagged(im.RepoTags)
		img := dockerDiskImage{ID: im.ID, Tags: tags, Size: im.Size, UsedBy: users, Dangling: len(tags) == 0}
		if img.Dangling {
			img.RollbackFor = rollback[im.ID]
			sort.Strings(img.RollbackFor)
		}
		v.Images = append(v.Images, img)
		v.Totals.Images += im.Size
		if len(users) == 0 {
			// What removing it frees: its size less the layers other images
			// keep, as `docker system df` counts it.
			own := im.Size
			if im.SharedSize > 0 {
				own -= im.SharedSize
			}
			v.Totals.ImagesUnused += own
			v.Totals.ImagesUnusedCount++
			if img.Dangling {
				v.Totals.Dangling += own
				v.Totals.DanglingCount++
			}
		}
	}
	if df.LayersSize > 0 {
		v.Totals.Images = df.LayersSize
	}
	v.Totals.ImagesUnused = max(v.Totals.ImagesUnused, 0)
	v.Totals.Dangling = max(v.Totals.Dangling, 0)
	for _, vol := range df.Volumes {
		users := append([]string{}, volumeUsers[vol.Name]...)
		sort.Strings(users)
		v.Volumes = append(v.Volumes, dockerDiskVolume{Name: vol.Name, Driver: vol.Driver, Size: vol.UsageData.Size, UsedBy: users})
		if vol.UsageData.Size > 0 {
			v.Totals.Volumes += vol.UsageData.Size
			if len(users) == 0 {
				v.Totals.VolumesUnused += vol.UsageData.Size
			}
		}
		if len(users) == 0 {
			v.Totals.VolumesUnusedCount++
		}
	}
	cacheFree := int64(0)
	for _, bc := range df.BuildCache {
		v.Totals.BuildCache += bc.Size
		v.Totals.BuildCacheCount++
		// A shared record or one a build is using does not go with a prune.
		if !bc.Shared && !bc.InUse {
			cacheFree += bc.Size
		}
	}
	written := map[string]int64{}
	for _, c := range df.Containers {
		written[c.ID] = c.SizeRw
	}
	v.Stopped = []string{}
	for _, c := range dockerPrunableContainers(list) {
		v.Stopped = append(v.Stopped, c.name())
		v.Totals.ContainersStopped += written[c.ID]
		v.Totals.ContainersStoppedCount++
	}
	sort.Strings(v.Stopped)
	v.Totals.Reclaimable = v.Totals.ImagesUnused + cacheFree + v.Totals.VolumesUnused + v.Totals.ContainersStopped
	sort.SliceStable(v.Images, func(i, j int) bool { return v.Images[i].Size > v.Images[j].Size })
	sort.SliceStable(v.Volumes, func(i, j int) bool { return v.Volumes[i].Size > v.Volumes[j].Size })
	return v
}

// DockerDiskHandler measures. Read-only, like the list: sizes and names say
// nothing a reader of the view does not already see.
func (h *Handlers) DockerDiskHandler(w http.ResponseWriter, r *http.Request) {
	api, reason := newDockerAPI()
	if api == nil {
		dockerRefuse(w, http.StatusServiceUnavailable, reason)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), dockerDiskTimeout)
	defer cancel()
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(dockerDiskTimeout + 10*time.Second))
	view, err := measureDockerDisk(ctx, api)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, view)
}

// measureDockerDisk is one /system/df read joined with the container list, and
// remembered for the Containers tile's reclaimable figure.
func measureDockerDisk(ctx context.Context, api *dockerAPI) (dockerDiskView, error) {
	list, err := api.listContainers(ctx)
	if err != nil {
		return dockerDiskView{}, err
	}
	var df dockerDfResponse
	resp, err := api.forActions().do(ctx, http.MethodGet, "/system/df", nil)
	if err != nil {
		return dockerDiskView{}, err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(&df); err != nil {
		return dockerDiskView{}, err
	}
	view := buildDockerDiskView(df, list)
	rememberDockerDisk(view.Totals, time.Now())
	// The same read measured every container; the list's sizes follow it.
	if len(df.Containers) > 0 {
		sizes := make(map[string]dockerContainerSize, len(df.Containers))
		for _, c := range df.Containers {
			sizes[c.ID] = dockerContainerSize{RW: c.SizeRw, RootFs: c.SizeRootFs}
		}
		rememberDockerSizes(sizes, time.Now())
	}
	return view, nil
}

/*
The Containers tile's reclaimable figure: the last measurement, whoever asked
for it (the Disk tab or the tile), never measured on the tile's own clock. A
measurement older than dockerDiskStale is followed by a new one in the
background; the tile shows the old figure meanwhile, or none before the first.
*/
const dockerDiskStale = 6 * time.Hour

var dockerDiskCache struct {
	mu        sync.Mutex
	totals    *dockerDiskTotals
	at        time.Time
	measuring bool
}

func rememberDockerDisk(t dockerDiskTotals, at time.Time) {
	dockerDiskCache.mu.Lock()
	defer dockerDiskCache.mu.Unlock()
	dockerDiskCache.totals = &t
	dockerDiskCache.at = at
	// A measurement has come in; the next stale read may start another.
	dockerDiskCache.measuring = false
}

func resetDockerDiskCache() {
	dockerDiskCache.mu.Lock()
	defer dockerDiskCache.mu.Unlock()
	dockerDiskCache.totals = nil
	dockerDiskCache.at = time.Time{}
	dockerDiskCache.measuring = false
}

// dockerDiskRefresh starts a background measurement; a variable so a test can
// see it asked for without a daemon doing the work.
var dockerDiskRefresh = startDockerDiskRefresh

func startDockerDiskRefresh() {
	go func() {
		defer func() {
			dockerDiskCache.mu.Lock()
			dockerDiskCache.measuring = false
			dockerDiskCache.mu.Unlock()
		}()
		api, _ := newDockerAPI()
		if api == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), dockerDiskTimeout)
		defer cancel()
		if _, err := measureDockerDisk(ctx, api); err != nil {
			logWarn(logComponentMutate, "the disk usage for the Containers tile could not be measured: %v", err)
		}
	}()
}

// dockerReclaimable is the last reclaimable figure (-1 when never measured)
// and when it was taken, starting a new measurement when it is stale.
func dockerReclaimable(now time.Time) (int64, int64) {
	dockerDiskCache.mu.Lock()
	defer dockerDiskCache.mu.Unlock()
	stale := dockerDiskCache.totals == nil || now.Sub(dockerDiskCache.at) > dockerDiskStale
	if stale && !dockerDiskCache.measuring {
		dockerDiskCache.measuring = true
		dockerDiskRefresh()
	}
	if dockerDiskCache.totals == nil {
		return -1, 0
	}
	return dockerDiskCache.totals.Reclaimable, dockerDiskCache.at.UnixMilli()
}

// dockerDiskGuard is what every change to the disk asks first: control on and
// the write token.
func (h *Handlers) dockerDiskGuard(w http.ResponseWriter, r *http.Request) (*dockerAPI, bool) {
	if !dockerControlEnabled() {
		dockerRefuse(w, http.StatusForbidden, reasonDockerControlOff)
		return nil, false
	}
	if !h.requireWriteAccess(w, r) {
		return nil, false
	}
	api, reason := newDockerAPI()
	if api == nil {
		dockerRefuse(w, http.StatusServiceUnavailable, reason)
		return nil, false
	}
	return api.forActions(), true
}

// DockerPruneHandler clears one kind: images-dangling, images-unused or
// build-cache.
func (h *Handlers) DockerPruneHandler(w http.ResponseWriter, r *http.Request) {
	kind := mux.Vars(r)["kind"]
	var path string
	switch kind {
	case "images-dangling", "images-unused":
		dangling := "true"
		if kind == "images-unused" {
			dangling = "false"
		}
		filters, _ := json.Marshal(map[string][]string{"dangling": {dangling}})
		path = "/images/prune?filters=" + url.QueryEscape(string(filters))
	case "build-cache":
		path = "/build/prune?all=true"
	case "containers-stopped":
		h.pruneStoppedContainers(w, r)
		return
	default:
		dockerRefuse(w, http.StatusNotFound, "unknown-kind")
		return
	}
	api, ok := h.dockerDiskGuard(w, r)
	if !ok {
		return
	}
	if !h.dockerPruneRunning.CompareAndSwap(false, true) {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	defer h.dockerPruneRunning.Store(false)
	// An update or rollback has an image no container uses yet, between its
	// pull or tag and its create; an image prune now would take it away.
	if kind != "build-cache" && h.dockerAnyBusy() {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(dockerActionTimeout + time.Minute))
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), dockerActionTimeout)
	defer cancel()

	resp, err := api.do(ctx, http.MethodPost, path, nil)
	if err != nil {
		logWarn(logComponentMutate, "docker prune %s failed: %v", kind, err)
		writeDockerError(w, err)
		return
	}
	defer resp.Body.Close()
	var out struct {
		ImagesDeleted  []json.RawMessage `json:"ImagesDeleted"`
		CachesDeleted  []json.RawMessage `json:"CachesDeleted"`
		SpaceReclaimed int64             `json:"SpaceReclaimed"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	removed := len(out.ImagesDeleted) + len(out.CachesDeleted)
	logActivity(activityCategoryMutate, "docker.prune", map[string]any{"kind": kind, "removed": removed, "reclaimed": out.SpaceReclaimed},
		"docker prune "+kind)
	writeJSON(w, map[string]any{"ok": true, "kind": kind, "removed": removed, "reclaimed": out.SpaceReclaimed})
}

// pruneStoppedContainers removes the stopped containers the Disk tab named,
// one at a time, and says how many went and which did not. Their volumes and
// images stay, as with one container's remove.
func (h *Handlers) pruneStoppedContainers(w http.ResponseWriter, r *http.Request) {
	api, ok := h.dockerDiskGuard(w, r)
	if !ok {
		return
	}
	if !h.dockerPruneRunning.CompareAndSwap(false, true) {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	defer h.dockerPruneRunning.Store(false)
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(dockerActionTimeout + time.Minute))
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), dockerActionTimeout)
	defer cancel()
	list, err := api.listContainers(ctx)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	removed := 0
	failed := []string{}
	var reclaimed int64
	for _, c := range dockerPrunableContainers(list) {
		// Held like one container's remove, so an action already running on
		// it is not cut short; that one is left and named.
		release, ok := h.dockerLockContainer(c)
		if !ok {
			failed = append(failed, c.name())
			continue
		}
		err := api.remove(ctx, c.ID)
		release()
		if err != nil {
			failed = append(failed, c.name())
			continue
		}
		removed++
		if size := dockerSizeOf(c.ID, time.Now()); size != nil {
			reclaimed += size.RW
		}
	}
	logActivity(activityCategoryMutate, "docker.prune", map[string]any{"kind": "containers-stopped", "removed": removed, "failed": failed},
		"docker prune containers-stopped")
	writeJSON(w, map[string]any{"ok": true, "kind": "containers-stopped", "removed": removed, "failed": failed, "reclaimed": reclaimed})
}

// DockerVolumeRemoveHandler removes one volume, named twice (?confirm=), that
// no container holds -- a stopped one included.
func (h *Handlers) DockerVolumeRemoveHandler(w http.ResponseWriter, r *http.Request) {
	name := mux.Vars(r)["name"]
	if name == "" || r.URL.Query().Get("confirm") != name {
		dockerRefuse(w, http.StatusBadRequest, "confirm-name")
		return
	}
	api, ok := h.dockerDiskGuard(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), dockerActionTimeout)
	defer cancel()
	list, err := api.listContainers(ctx)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	users := []string{}
	for _, c := range list {
		for _, m := range c.Mounts {
			if m.Type == "volume" && m.Name == name {
				users = append(users, c.name())
			}
		}
	}
	if len(users) > 0 {
		sort.Strings(users)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		writeJSON(w, map[string]any{"reason": "in-use", "containers": users})
		return
	}
	resp, err := api.do(ctx, http.MethodDelete, "/volumes/"+url.PathEscape(name), nil)
	if err != nil {
		var apiErr *dockerAPIError
		if errors.As(err, &apiErr) && apiErr.Status == http.StatusConflict {
			dockerRefuse(w, http.StatusConflict, "in-use")
			return
		}
		writeDockerError(w, err)
		return
	}
	_ = resp.Body.Close()
	logActivity(activityCategoryMutate, "docker.volume-remove", map[string]any{"volume": name}, "docker volume remove "+name)
	writeJSON(w, map[string]any{"ok": true})
}
