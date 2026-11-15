package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	// Held and SkippedDigest are filled from the store's choices when served
	// (withChoices), never written per image.
	Held          bool   `json:"held,omitempty"`
	SkippedDigest string `json:"skippedDigest,omitempty"`
	// Recreate is set per row, never stored: the newer image is on the host
	// already and an update only recreates. There is no digest to skip.
	Recreate bool `json:"recreate,omitempty"`
}

type dockerUpdateStore struct {
	CheckedAt int64                         `json:"checkedAt"`
	Images    map[string]*dockerImageUpdate `json:"images"` // keyed by the container's image reference
	// The reader's choices, by image reference too (docker_update_history.go).
	Held    map[string]bool   `json:"held,omitempty"`
	Skipped map[string]string `json:"skipped,omitempty"` // the digest not to offer
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
	return readDockerUpdateStoreAt(dockerUpdatesFilePath())
}

// dockerUpdatesPathFor is where one host's check results live. A remote host
// has a file of its own: the same image reference can carry another digest on
// each host, so one shared map would answer for the wrong one. Skip and hold
// are local only and are never written to a remote file.
func dockerUpdatesPathFor(hostID string) string {
	if hostID == "" || hostID == dockerLocalHostID {
		return dockerUpdatesFilePath()
	}
	return filepath.Join(ResolveDataDir(), "docker-updates-"+hostID+".json")
}

func readDockerUpdateStoreAt(path string) dockerUpdateStore {
	out := dockerUpdateStore{Images: map[string]*dockerImageUpdate{}}
	data, err := os.ReadFile(path)
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
	return h.dockerUpdateSnapshotFor(dockerLocalHostID)
}

func (h *Handlers) dockerUpdateSnapshotFor(hostID string) map[string]*dockerImageUpdate {
	h.dockerUpdatesMu.Lock()
	defer h.dockerUpdatesMu.Unlock()
	return readDockerUpdateStoreAt(dockerUpdatesPathFor(hostID)).withChoices()
}

// localDigestFor finds the digest this image was pulled as for the same
// repository. RepoDigests lists one per repository the image came from, and
// names them the way the daemon does ("linuxserver/sonarr@sha256:..."), so each
// is parsed with the same rules as the reference being checked.
func localDigestFor(ref imageRef, repoDigests []string) string {
	if all := localDigestsFor(ref, repoDigests); len(all) > 0 {
		return all[0]
	}
	return ""
}

// localDigestsFor is every digest the image carries for the repository. One
// image can hold several for one repo -- a re-pull whose index digest changed
// while the platform image did not, or app:latest and app:latest-amd64 side by
// side -- and the daemon lists them sorted, not newest first.
func localDigestsFor(ref imageRef, repoDigests []string) []string {
	var out []string
	for _, entry := range repoDigests {
		name, digest, ok := strings.Cut(entry, "@")
		if !ok {
			continue
		}
		parsed, ok := parseImageRef(name)
		if ok && parsed.Registry == ref.Registry && parsed.Repo == ref.Repo {
			out = append(out, digest)
		}
	}
	return out
}

// dockerRowUpdate is the image's update state as it holds for one container.
// The store says whether the tag is the newest; a container still on an older
// image than its tag -- pulled but not recreated, or left behind when another
// container on the same image was updated -- has an update waiting whatever
// the store says, and it needs only a recreate.
func dockerRowUpdate(u *dockerImageUpdate, c dockerContainerSummary, tagIDs map[string]string) *dockerImageUpdate {
	tagID := tagIDs[dockerTagKey(c.Image)]
	if tagID == "" || c.ImageID == "" || tagID == c.ImageID {
		return u
	}
	if u != nil && u.Status != "current" && u.Status != "unknown" {
		return u
	}
	out := dockerImageUpdate{}
	if u != nil {
		out = *u
	}
	out.Status, out.Reason, out.Recreate = "available", "", true
	if out.Held {
		out.Status = "held"
	}
	return &out
}

func (h *Handlers) runDockerUpdateCheck(ctx context.Context) (dockerUpdateStore, error) {
	return h.runDockerUpdateCheckOn(ctx, dockerLocalHostID)
}

// runDockerUpdateCheckOn is one pass over one host's containers. The registry
// is asked by nextDash itself, so a remote host needs only to answer for its
// containers and images.
func (h *Handlers) runDockerUpdateCheckOn(ctx context.Context, hostID string) (dockerUpdateStore, error) {
	remote := hostID != "" && hostID != dockerLocalHostID
	path := dockerUpdatesPathFor(hostID)
	api, reason := dockerHostAPI(hostID)
	if api == nil {
		return dockerUpdateStore{}, &dockerAPIError{Status: http.StatusServiceUnavailable, Message: reason}
	}
	list, err := api.listContainers(ctx)
	if err != nil {
		return dockerUpdateStore{}, err
	}

	h.dockerUpdatesMu.Lock()
	previous := readDockerUpdateStoreAt(path)
	h.dockerUpdatesMu.Unlock()

	now := time.Now().UnixMilli()
	next := dockerUpdateStore{CheckedAt: now, Images: map[string]*dockerImageUpdate{}}
	hidden := dockerHiddenSet()
	if remote {
		// Hidden containers are named for this host's own.
		hidden = map[string]bool{}
	}
	for _, c := range list {
		if hidden[c.name()] {
			continue
		}
		if _, done := next.Images[c.Image]; done {
			continue
		}
		next.Images[c.Image] = h.checkDockerImage(ctx, api, c.Image, previous.Images[c.Image], now)
	}

	h.dockerUpdatesMu.Lock()
	defer h.dockerUpdatesMu.Unlock()
	// Read again under the lock: a skip or hold made while the check ran
	// must not be lost to it, and neither may an update or rollback that
	// finished meanwhile -- its entry is newer than anything this pass saw.
	latest := readDockerUpdateStoreAt(path)
	carryDockerUpdateChoices(latest, &next)
	for img, u := range latest.Images {
		if _, checked := next.Images[img]; checked && u != nil && u.CheckedAt >= now {
			next.Images[img] = u
		}
	}
	// A host removed while its check ran has nothing to keep results for.
	if remote {
		if _, ok := findDockerHost(hostID); !ok {
			return next, nil
		}
	}
	return next, writeIndentJSONFile(path, next)
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
		// A daemon error or the pass running out of time says nothing about
		// the image: keep what was known, as a registry failure below does.
		// Answered "no-digest", every image after the deadline lost its
		// "available" badge until the next pass.
		if !isDockerNotFound(err) && prev != nil && prev.Status != "unknown" {
			kept := *prev
			kept.Reason = "unreachable"
			return &kept
		}
		return unknown("no-digest")
	}
	localDigests := localDigestsFor(ref, local.RepoDigests)
	if len(localDigests) == 0 {
		return unknown("no-digest")
	}
	localDigest := localDigests[0]
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
	status := "available"
	for _, digest := range localDigests {
		if digest == remote {
			status, localDigest = "current", digest
			break
		}
	}
	return &dockerImageUpdate{Status: status, RemoteDigest: remote, LocalDigest: localDigest, CheckedAt: now}
}

func (h *Handlers) DockerUpdatesHandler(w http.ResponseWriter, r *http.Request) {
	hostID := dockerHostOf(r)
	if _, ok := dockerHostKnown(hostID); !ok {
		dockerRefuse(w, http.StatusNotFound, reasonUnknownDockerHost)
		return
	}
	h.dockerUpdatesMu.Lock()
	store := readDockerUpdateStoreAt(dockerUpdatesPathFor(hostID))
	h.dockerUpdatesMu.Unlock()
	store.Images = store.withChoices()
	writeJSON(w, store)
}

// dockerHostKnown is whether an id names this host or a configured remote one.
func dockerHostKnown(id string) (DockerHost, bool) {
	if id == "" || id == dockerLocalHostID {
		return DockerHost{}, true
	}
	return findDockerHost(id)
}

// beginDockerCheck takes the right to run one pass on a host. The local host
// keeps its own flag; each remote host has one, so a slow host does not hold
// the others off.
func (h *Handlers) beginDockerCheck(hostID string) (func(), bool) {
	if hostID == "" || hostID == dockerLocalHostID {
		if !h.dockerCheckRunning.CompareAndSwap(false, true) {
			return nil, false
		}
		return func() { h.dockerCheckRunning.Store(false) }, true
	}
	if _, busy := h.dockerRemoteChecks.LoadOrStore(hostID, struct{}{}); busy {
		return nil, false
	}
	return func() { h.dockerRemoteChecks.Delete(hostID) }, true
}

// DockerUpdatesCheckHandler runs a pass now. It changes no container, so it
// needs the socket but not NEXTDASH_DOCKER_CONTROL; it does spend requests
// against other hosts, so it sits behind the write token.
func (h *Handlers) DockerUpdatesCheckHandler(w http.ResponseWriter, r *http.Request) {
	hostID := dockerHostOf(r)
	if _, ok := dockerHostKnown(hostID); !ok {
		dockerRefuse(w, http.StatusNotFound, reasonUnknownDockerHost)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	done, ok := h.beginDockerCheck(hostID)
	if !ok {
		dockerRefuse(w, http.StatusConflict, "busy")
		return
	}
	defer done()
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(dockerUpdateCheckTimeout + time.Minute))
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), dockerUpdateCheckTimeout)
	defer cancel()
	store, err := h.runDockerUpdateCheckOn(ctx, hostID)
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
	// Results of a host that is gone (removed during a check, or lost to a
	// restore) are dropped here, so nothing stays behind for good, also when
	// the check itself is switched off.
	pruneDockerHostUpdateFiles()
	every := dockerUpdateIntervalDuration(h.store.GetSettings().DockerUpdateInterval)
	if every == 0 {
		return
	}
	// Every host in its own goroutine: a slow one must not hold the others
	// off. Each has its own timeout and busy flag.
	var wg sync.WaitGroup
	if dockerSocketPath() != "" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.maybeCheckDockerHost(dockerLocalHostID, "", every)
		}()
	}
	for _, host := range listDockerHosts() {
		wg.Add(1)
		go func(host DockerHost) {
			defer wg.Done()
			h.maybeCheckDockerHost(host.ID, host.Name, every)
		}(host)
	}
	wg.Wait()
}

// dockerRemoteAttemptGap is the least time between two scheduled tries on a
// remote host, so one that is down costs a try an hour, not one per tick.
const dockerRemoteAttemptGap = time.Hour

func (h *Handlers) maybeCheckDockerHost(hostID, name string, every time.Duration) {
	remote := hostID != dockerLocalHostID
	h.dockerUpdatesMu.Lock()
	last := readDockerUpdateStoreAt(dockerUpdatesPathFor(hostID)).CheckedAt
	h.dockerUpdatesMu.Unlock()
	// Compared with the stored time rather than an in-process timer, so a
	// restart neither skips a due check nor repeats a fresh one.
	if last > 0 && time.Since(time.UnixMilli(last)) < every {
		return
	}
	if remote {
		if at, ok := h.dockerRemoteAttempts.Load(hostID); ok && time.Since(at.(time.Time)) < dockerRemoteAttemptGap {
			return
		}
		h.dockerRemoteAttempts.Store(hostID, time.Now())
	}
	done, ok := h.beginDockerCheck(hostID)
	if !ok {
		return
	}
	defer done()
	ctx, cancel := context.WithTimeout(context.Background(), dockerUpdateCheckTimeout)
	defer cancel()
	store, err := h.runDockerUpdateCheckOn(ctx, hostID)
	where := "container"
	if remote {
		where = "container on " + name
	}
	if err != nil {
		logWarn(logComponentMutate, "the scheduled %s update check did not run: %v", where, err)
		return
	}
	available := 0
	for _, update := range store.withChoices() {
		if update.Status == "available" {
			available++
		}
	}
	logInfo(logComponentMutate, "the scheduled %s update check found %s", where, plural(available, "update", "updates"))
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
	// Up to date: a skip of an older digest means nothing any more.
	delete(store.Skipped, image)
	if entry.RemoteDigest != "" {
		entry.LocalDigest = entry.RemoteDigest
	}
	entry.CheckedAt = time.Now().UnixMilli()
	if err := writeIndentJSONFile(dockerUpdatesFilePath(), store); err != nil {
		logWarn(logComponentMutate, "the update of %s went through, but its badge could not be cleared: %v", image, err)
	}
}

// pruneDockerHostUpdateFiles deletes the update results of hosts that are no
// longer configured.
func pruneDockerHostUpdateFiles() {
	entries, err := os.ReadDir(ResolveDataDir())
	if err != nil {
		return
	}
	known := map[string]bool{}
	for _, h := range listDockerHosts() {
		known[filepath.Base(dockerUpdatesPathFor(h.ID))] = true
	}
	for _, e := range entries {
		name := e.Name()
		if dockerHostUpdatesFileRe.MatchString(name) && !known[name] {
			_ = os.Remove(filepath.Join(ResolveDataDir(), name))
		}
	}
}
