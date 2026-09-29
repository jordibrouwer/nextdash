package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
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
	Images []struct {
		ID       string   `json:"Id"`
		RepoTags []string `json:"RepoTags"`
		Size     int64    `json:"Size"`
	} `json:"Images"`
	Volumes []struct {
		Name      string `json:"Name"`
		Driver    string `json:"Driver"`
		UsageData struct {
			Size     int64 `json:"Size"`
			RefCount int64 `json:"RefCount"`
		} `json:"UsageData"`
	} `json:"Volumes"`
	BuildCache []struct {
		Size int64 `json:"Size"`
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
	Reclaimable        int64 `json:"reclaimable"`
}

type dockerDiskView struct {
	Images  []dockerDiskImage  `json:"images"`
	Volumes []dockerDiskVolume `json:"volumes"`
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

func buildDockerDiskView(df dockerDfResponse, list []dockerContainerSummary) dockerDiskView {
	imageUsers := map[string][]string{}
	volumeUsers := map[string][]string{}
	for _, c := range list {
		imageUsers[c.ImageID] = append(imageUsers[c.ImageID], c.name())
		for _, m := range c.Mounts {
			if m.Type == "volume" && m.Name != "" {
				volumeUsers[m.Name] = append(volumeUsers[m.Name], c.name())
			}
		}
	}
	rollback := dockerRollbackImages(list)
	v := dockerDiskView{Images: []dockerDiskImage{}, Volumes: []dockerDiskVolume{}}
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
			v.Totals.ImagesUnused += im.Size
			v.Totals.ImagesUnusedCount++
			if img.Dangling {
				v.Totals.Dangling += im.Size
				v.Totals.DanglingCount++
			}
		}
	}
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
	for _, bc := range df.BuildCache {
		v.Totals.BuildCache += bc.Size
		v.Totals.BuildCacheCount++
	}
	v.Totals.Reclaimable = v.Totals.ImagesUnused + v.Totals.BuildCache + v.Totals.VolumesUnused
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
	list, err := api.listContainers(ctx)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	var df dockerDfResponse
	resp, err := api.forActions().do(ctx, http.MethodGet, "/system/df", nil)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(&df); err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, buildDockerDiskView(df, list))
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
