package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

/*
What updates did, and the reader's say over what counts as one.

Every update the view runs is written down: when, which container, from which
image to which, and the versions the images carry. That is what makes a
rollback possible -- the image an update replaced stays on the host, untagged,
until something prunes it -- and what the drawer lists under Updates.

A rollback tags that previous image as the reference again and recreates the
container on it, the same swap an update makes but without a pull. The
container keeps its ordinary reference (sonarr:latest, not an image id), so the
next check still works; and the version it came back from is skipped at once,
or the check would offer it again and an update-all would put it straight back.

Skip and hold are kept in docker-updates.json beside the check's results, keyed
by image reference like them. A skipped digest or a held image no longer counts
as an update: no badge, no count, left out of an update of a selection. A
newer digest than the skipped one does count. Updating by hand still works.
*/

const dockerUpdateHistoryPerContainer = 20

type dockerUpdateHistoryEntry struct {
	At          int64  `json:"at"`   // unix milliseconds
	Kind        string `json:"kind"` // update | rollback
	Container   string `json:"container"`
	Image       string `json:"image"`
	FromImageID string `json:"fromImageId"`
	ToImageID   string `json:"toImageId"`
	FromVersion string `json:"fromVersion,omitempty"`
	ToVersion   string `json:"toVersion,omitempty"`
}

// dockerRollbackOffer is what the drawer's Roll back button names.
type dockerRollbackOffer struct {
	At          int64  `json:"at"`
	ToImageID   string `json:"toImageId"`
	ToVersion   string `json:"toVersion,omitempty"`
	FromVersion string `json:"fromVersion,omitempty"`
}

// dockerRefusalError is a request the action route turns down with a reason
// rather than an error: nothing was touched.
type dockerRefusalError struct {
	Code   int
	Reason string
	// Containers names the others a refusal is about, when there are any.
	Containers []string
}

func (e *dockerRefusalError) Error() string { return e.Reason }

var dockerUpdateHistoryMu sync.Mutex

// readDockerUpdateHistory is empty with no file yet, and an error for a file
// it cannot read: writing over that would lose every rollback in it.
func readDockerUpdateHistory() ([]dockerUpdateHistoryEntry, error) {
	var out struct {
		Entries []dockerUpdateHistoryEntry `json:"entries"`
	}
	data, err := os.ReadFile(dockerUpdateHistoryFilePath())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out.Entries, nil
}

func appendDockerUpdateHistory(e dockerUpdateHistoryEntry) error {
	dockerUpdateHistoryMu.Lock()
	defer dockerUpdateHistoryMu.Unlock()
	prev, err := readDockerUpdateHistory()
	if err != nil {
		return err
	}
	all := append(prev, e)
	// Newest last on disk; each container keeps its last twenty.
	count := map[string]int{}
	kept := make([]dockerUpdateHistoryEntry, 0, len(all))
	for i := len(all) - 1; i >= 0; i-- {
		if count[all[i].Container] < dockerUpdateHistoryPerContainer {
			count[all[i].Container]++
			kept = append(kept, all[i])
		}
	}
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].At < kept[j].At })
	return writeIndentJSONFile(dockerUpdateHistoryFilePath(), map[string]any{"entries": kept})
}

// dockerUpdateHistoryFor is one container's history, newest first.
func dockerUpdateHistoryFor(name string) []dockerUpdateHistoryEntry {
	dockerUpdateHistoryMu.Lock()
	all, err := readDockerUpdateHistory()
	dockerUpdateHistoryMu.Unlock()
	if err != nil {
		logWarn(logComponentMutate, "the update history could not be read: %v", err)
	}
	out := []dockerUpdateHistoryEntry{}
	for i := len(all) - 1; i >= 0; i-- {
		if all[i].Container == name {
			out = append(out, all[i])
		}
	}
	return out
}

// dockerRollbackCandidate is the update a rollback would undo: the newest
// entry, if it is an update and the container still runs what it installed.
// A rollback is not rolled back in turn.
func dockerRollbackCandidate(history []dockerUpdateHistoryEntry, runningImageID string) *dockerUpdateHistoryEntry {
	if len(history) == 0 || history[0].Kind != "update" || history[0].ToImageID != runningImageID {
		return nil
	}
	return &history[0]
}

func dockerImageVersion(ctx context.Context, api *dockerAPI, id string) string {
	img, err := api.inspectImage(ctx, id)
	if err != nil {
		return ""
	}
	return img.Config.Labels["org.opencontainers.image.version"]
}

func (h *Handlers) recordDockerUpdate(ctx context.Context, api *dockerAPI, kind, name, image, fromID, toID string) {
	e := dockerUpdateHistoryEntry{
		At: time.Now().UnixMilli(), Kind: kind, Container: name, Image: image,
		FromImageID: fromID, ToImageID: toID,
		FromVersion: dockerImageVersion(ctx, api, fromID), ToVersion: dockerImageVersion(ctx, api, toID),
	}
	if err := appendDockerUpdateHistory(e); err != nil {
		logWarn(logComponentMutate, "the %s of %s went through, but its history could not be written: %v", kind, name, err)
	}
}

// dockerRollbackOfferFor answers the drawer: there is something to roll back
// to only while the previous image is still on the host.
func dockerRollbackOfferFor(ctx context.Context, api *dockerAPI, history []dockerUpdateHistoryEntry, runningImageID string) *dockerRollbackOffer {
	e := dockerRollbackCandidate(history, runningImageID)
	if e == nil {
		return nil
	}
	if _, err := api.inspectImage(ctx, e.FromImageID); err != nil {
		return nil
	}
	return &dockerRollbackOffer{At: e.At, ToImageID: e.FromImageID, ToVersion: e.FromVersion, FromVersion: e.ToVersion}
}

// dockerRollbackUpdate puts a container back on the image its last update
// replaced, and skips the version it leaves.
func (h *Handlers) dockerRollbackUpdate(ctx context.Context, api *dockerAPI, c dockerContainerSummary) (dockerRecreateResult, error) {
	res := dockerRecreateResult{OldImageID: c.ImageID, ContainerID: c.ID}
	in, err := api.inspectContainer(ctx, c.ID)
	if err != nil {
		return res, err
	}
	ref := in.Config.Image
	if strings.Contains(ref, "@") {
		return res, &dockerRefusalError{Code: http.StatusConflict, Reason: "pinned-by-digest"}
	}
	if err := dockerRecreateRefusal(ctx, api, c, in); err != nil {
		return res, err
	}
	e := dockerRollbackCandidate(dockerUpdateHistoryFor(c.name()), in.Image)
	if e == nil {
		return res, &dockerRefusalError{Code: http.StatusConflict, Reason: "no-rollback"}
	}
	oldImg, err := api.inspectImage(ctx, e.FromImageID)
	if err != nil {
		var apiErr *dockerAPIError
		if errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound {
			return res, &dockerRefusalError{Code: http.StatusConflict, Reason: "old-image-gone"}
		}
		return res, err
	}
	newImg, _ := api.inspectImage(ctx, in.Image)

	repo, tag := splitImageTag(ref)
	tagQuery := func(id string) string {
		q := url.Values{}
		q.Set("repo", repo)
		q.Set("tag", tag)
		return "/images/" + url.PathEscape(id) + "/tag?" + q.Encode()
	}
	if err := api.post(ctx, tagQuery(oldImg.ID), nil); err != nil {
		res.FailedStep = "tag"
		return res, err
	}
	res.OldImageID = in.Image
	res.NewImageID = oldImg.ID
	res, err = h.dockerRecreateOn(ctx, api, c, in, ref, res)
	if err != nil || res.Phase != "done" {
		// The container is back as it was; so is the tag.
		_ = api.post(ctx, tagQuery(in.Image), nil)
		return res, err
	}
	h.recordDockerUpdate(ctx, api, "rollback", c.name(), c.Image, in.Image, oldImg.ID)
	if parsed, ok := parseImageRef(ref); ok {
		h.markDockerImageRolledBack(c.Image, localDigestFor(parsed, oldImg.RepoDigests), localDigestFor(parsed, newImg.RepoDigests))
	}
	return res, nil
}

// markDockerImageRolledBack records what the container runs now and skips the
// digest it left, so the view shows "skipped" rather than an update.
func (h *Handlers) markDockerImageRolledBack(image, local, skip string) {
	h.dockerUpdatesMu.Lock()
	defer h.dockerUpdatesMu.Unlock()
	store := readDockerUpdateStore()
	store.ensureChoices()
	if skip != "" {
		store.Skipped[image] = skip
	}
	u := store.Images[image]
	if u == nil {
		u = &dockerImageUpdate{}
		store.Images[image] = u
	}
	u.LocalDigest = local
	if u.RemoteDigest == "" {
		u.RemoteDigest = skip
	}
	u.Reason = ""
	switch {
	case local == "":
		u.Status, u.Reason = "unknown", "no-digest"
	case u.RemoteDigest != "" && u.RemoteDigest != local:
		u.Status = "available"
	default:
		u.Status = "current"
	}
	u.CheckedAt = time.Now().UnixMilli()
	if err := writeIndentJSONFile(dockerUpdatesFilePath(), store); err != nil {
		logWarn(logComponentMutate, "the rollback of %s went through, but its update status could not be saved: %v", image, err)
	}
}

/* ── Skip and hold ─────────────────────────────────────────────────────── */

func (s *dockerUpdateStore) ensureChoices() {
	if s.Held == nil {
		s.Held = map[string]bool{}
	}
	if s.Skipped == nil {
		s.Skipped = map[string]string{}
	}
	if s.Images == nil {
		s.Images = map[string]*dockerImageUpdate{}
	}
}

// withChoices is the check's results as the reader sees them: an update that
// is skipped or held says so instead of "available", and every entry carries
// whether it is held and which digest is skipped.
func (s dockerUpdateStore) withChoices() map[string]*dockerImageUpdate {
	out := map[string]*dockerImageUpdate{}
	for img, u := range s.Images {
		if u == nil {
			continue
		}
		cp := *u
		out[img] = &cp
	}
	for img, held := range s.Held {
		if held && out[img] == nil {
			out[img] = &dockerImageUpdate{Status: "unknown"}
		}
	}
	for img, u := range out {
		u.Held = s.Held[img]
		if d := s.Skipped[img]; d != "" && d == u.RemoteDigest {
			u.SkippedDigest = d
		}
		if u.Status == "available" {
			if u.Held {
				u.Status = "held"
			} else if u.SkippedDigest != "" {
				u.Status = "skipped"
			}
		}
	}
	return out
}

// carryDockerUpdateChoices keeps the reader's choices across a check, and
// lets go of a skip once the registry has moved past the skipped digest.
func carryDockerUpdateChoices(prev dockerUpdateStore, next *dockerUpdateStore) {
	next.ensureChoices()
	for img, held := range prev.Held {
		if held {
			next.Held[img] = true
		}
	}
	for img, d := range prev.Skipped {
		if u := next.Images[img]; u != nil && u.RemoteDigest != "" && u.RemoteDigest != d {
			continue
		}
		next.Skipped[img] = d
	}
}

// DockerUpdateChoiceHandler skips the update on offer for an image, holds its
// updates, or undoes either. Behind the write token: it changes what the
// view and an update of a selection do.
func (h *Handlers) DockerUpdateChoiceHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var body struct {
		Image  string `json:"image"`
		Choice string `json:"choice"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&body); err != nil || strings.TrimSpace(body.Image) == "" {
		dockerRefuse(w, http.StatusBadRequest, "bad-request")
		return
	}
	image := strings.TrimSpace(body.Image)

	h.dockerUpdatesMu.Lock()
	defer h.dockerUpdatesMu.Unlock()
	store := readDockerUpdateStore()
	store.ensureChoices()
	switch body.Choice {
	case "skip":
		u := store.Images[image]
		if u == nil || u.Status != "available" || u.RemoteDigest == "" {
			dockerRefuse(w, http.StatusConflict, "nothing-to-skip")
			return
		}
		store.Skipped[image] = u.RemoteDigest
	case "unskip":
		delete(store.Skipped, image)
	case "hold":
		store.Held[image] = true
	case "unhold":
		delete(store.Held, image)
	default:
		dockerRefuse(w, http.StatusBadRequest, "unknown-choice")
		return
	}
	if err := writeIndentJSONFile(dockerUpdatesFilePath(), store); err != nil {
		writeDockerError(w, err)
		return
	}
	logActivity(activityCategoryMutate, "docker.update-"+body.Choice, map[string]any{"image": image}, "docker "+body.Choice+" "+image)
	writeJSON(w, store.withChoices()[image])
}
