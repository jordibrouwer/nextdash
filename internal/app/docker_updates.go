package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

/*
Which containers have a newer image waiting.

One pass asks the registry, once per distinct image, which digest the tag points
at now, and compares it with the digest the local image was pulled as. The
result is kept in data/docker-updates.json so the view, the widget and a restart
all read the same answer without asking again.

A failed lookup never erases what was known: a registry that is busy or down
says nothing about the image, so the last good status stays and only the reason
changes. An image with nothing to compare against -- built locally, pinned by
digest -- is "unknown", never "current": claiming it is up to date would be a
guess.
*/

type dockerImageUpdate struct {
	Status       string `json:"status"` // current | available | unknown
	Reason       string `json:"reason,omitempty"`
	RemoteDigest string `json:"remoteDigest,omitempty"`
	LocalDigest  string `json:"localDigest,omitempty"`
	CheckedAt    int64  `json:"checkedAt"`
}

type dockerUpdateStore struct {
	CheckedAt int64                         `json:"checkedAt"`
	Images    map[string]*dockerImageUpdate `json:"images"` // keyed by the container's image reference
}

// How often the scheduler looks at the clock. The interval itself is the
// setting; this only bounds how late a due check can start.
const dockerUpdateSchedulerTick = 10 * time.Minute

// A whole pass, however many images: long enough for a slow registry, short
// enough that a hung one cannot hold the check flag for good.
const dockerUpdateCheckTimeout = 5 * time.Minute

func dockerUpdateIntervalDuration(setting string) time.Duration {
	switch setting {
	case "6h":
		return 6 * time.Hour
	case "12h":
		return 12 * time.Hour
	case "24h":
		return 24 * time.Hour
	}
	return 0
}

func readDockerUpdateStore() dockerUpdateStore {
	out := dockerUpdateStore{Images: map[string]*dockerImageUpdate{}}
	data, err := os.ReadFile(dockerUpdatesFilePath())
	if err != nil {
		return out
	}
	_ = json.Unmarshal(data, &out)
	if out.Images == nil {
		out.Images = map[string]*dockerImageUpdate{}
	}
	return out
}

func (h *Handlers) dockerUpdateSnapshot() map[string]*dockerImageUpdate {
	h.dockerUpdatesMu.Lock()
	defer h.dockerUpdatesMu.Unlock()
	return readDockerUpdateStore().Images
}

// localDigestFor finds the digest this image was pulled as for the same
// repository. RepoDigests lists one per repository the image came from, and
// names them the way the daemon does ("linuxserver/sonarr@sha256:..."), so each
// is parsed with the same rules as the reference being checked.
func localDigestFor(ref imageRef, repoDigests []string) string {
	for _, entry := range repoDigests {
		name, digest, ok := strings.Cut(entry, "@")
		if !ok {
			continue
		}
		parsed, ok := parseImageRef(name)
		if ok && parsed.Registry == ref.Registry && parsed.Repo == ref.Repo {
			return digest
		}
	}
	return ""
}

func (h *Handlers) runDockerUpdateCheck(ctx context.Context) (dockerUpdateStore, error) {
	api, reason := newDockerAPI()
	if api == nil {
		return dockerUpdateStore{}, &dockerAPIError{Status: http.StatusServiceUnavailable, Message: reason}
	}
	list, err := api.listContainers(ctx)
	if err != nil {
		return dockerUpdateStore{}, err
	}

	h.dockerUpdatesMu.Lock()
	previous := readDockerUpdateStore()
	h.dockerUpdatesMu.Unlock()

	now := time.Now().UnixMilli()
	next := dockerUpdateStore{CheckedAt: now, Images: map[string]*dockerImageUpdate{}}
	for _, c := range list {
		if _, done := next.Images[c.Image]; done {
			continue
		}
		next.Images[c.Image] = h.checkDockerImage(ctx, api, c.Image, previous.Images[c.Image], now)
	}

	h.dockerUpdatesMu.Lock()
	defer h.dockerUpdatesMu.Unlock()
	return next, writeIndentJSONFile(dockerUpdatesFilePath(), next)
}

func (h *Handlers) checkDockerImage(ctx context.Context, api *dockerAPI, image string, prev *dockerImageUpdate, now int64) *dockerImageUpdate {
	unknown := func(reason string) *dockerImageUpdate {
		return &dockerImageUpdate{Status: "unknown", Reason: reason, CheckedAt: now}
	}
	ref, ok := parseImageRef(image)
	if !ok {
		return unknown("no-digest")
	}
	local, err := api.inspectImage(ctx, image)
	if err != nil {
		return unknown("no-digest")
	}
	localDigest := localDigestFor(ref, local.RepoDigests)
	if localDigest == "" {
		return unknown("no-digest")
	}
	remote, why, _ := dockerRegistry.remoteDigest(ctx, ref)
	if remote == "" {
		if why == "" {
			why = "unreachable"
		}
		// Keep what was last known; only the reason is news.
		if prev != nil && prev.Status != "unknown" {
			kept := *prev
			kept.Reason = why
			return &kept
		}
		return unknown(why)
	}
	status := "current"
	if remote != localDigest {
		status = "available"
	}
	return &dockerImageUpdate{Status: status, RemoteDigest: remote, LocalDigest: localDigest, CheckedAt: now}
}

func (h *Handlers) DockerUpdatesHandler(w http.ResponseWriter, r *http.Request) {
	h.dockerUpdatesMu.Lock()
	store := readDockerUpdateStore()
	h.dockerUpdatesMu.Unlock()
	writeJSON(w, store)
}

// DockerUpdatesCheckHandler runs a pass now. It changes no container, so it
// needs the socket but not NEXTDASH_DOCKER_CONTROL; it does spend requests
// against other hosts, so it sits behind the write token.
func (h *Handlers) DockerUpdatesCheckHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.dockerCheckRunning.CompareAndSwap(false, true) {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	defer h.dockerCheckRunning.Store(false)
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(dockerUpdateCheckTimeout + time.Minute))
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), dockerUpdateCheckTimeout)
	defer cancel()
	store, err := h.runDockerUpdateCheck(ctx)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	writeJSON(w, store)
}

// StartDockerUpdateScheduler checks on a tick and lets the setting decide
// whether anything is due, so changing the interval needs no restart and no
// second timer.
func (h *Handlers) StartDockerUpdateScheduler(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(dockerUpdateSchedulerTick)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				h.maybeRunDockerUpdateCheck()
			}
		}
	}()
}

func (h *Handlers) maybeRunDockerUpdateCheck() {
	every := dockerUpdateIntervalDuration(h.store.GetSettings().DockerUpdateInterval)
	if every == 0 || dockerSocketPath() == "" {
		return
	}
	h.dockerUpdatesMu.Lock()
	last := readDockerUpdateStore().CheckedAt
	h.dockerUpdatesMu.Unlock()
	// Compared with the stored time rather than an in-process timer, so a
	// restart neither skips a due check nor repeats a fresh one.
	if last > 0 && time.Since(time.UnixMilli(last)) < every {
		return
	}
	if !h.dockerCheckRunning.CompareAndSwap(false, true) {
		return
	}
	defer h.dockerCheckRunning.Store(false)
	ctx, cancel := context.WithTimeout(context.Background(), dockerUpdateCheckTimeout)
	defer cancel()
	store, err := h.runDockerUpdateCheck(ctx)
	if err != nil {
		logWarn(logComponentMutate, "the scheduled container update check did not run: %v", err)
		return
	}
	available := 0
	for _, update := range store.Images {
		if update.Status == "available" {
			available++
		}
	}
	logInfo(logComponentMutate, "the scheduled container update check found %s", plural(available, "update", "updates"))
}

// markDockerImageCurrent records that an update just brought this image up to
// date, so the view drops its badge now rather than at the next check. The
// digest the registry named is the one the pull fetched.
func (h *Handlers) markDockerImageCurrent(image string) {
	h.dockerUpdatesMu.Lock()
	defer h.dockerUpdatesMu.Unlock()
	store := readDockerUpdateStore()
	entry := store.Images[image]
	if entry == nil {
		return
	}
	entry.Status = "current"
	entry.Reason = ""
	if entry.RemoteDigest != "" {
		entry.LocalDigest = entry.RemoteDigest
	}
	entry.CheckedAt = time.Now().UnixMilli()
	if err := writeIndentJSONFile(dockerUpdatesFilePath(), store); err != nil {
		logWarn(logComponentMutate, "the update of %s went through, but its badge could not be cleared: %v", image, err)
	}
}
