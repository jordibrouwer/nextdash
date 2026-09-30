package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"time"
)

/*
Pull and recreate, the way Watchtower does it.

Docker has no "update in place": a container is bound to the image it was made
from. So the old one is renamed out of the way, a new one is made under the
original name from the same Config and HostConfig with the new image, and only
once that one runs is the old one removed. Any failure before that point puts
the old container back under its name, running if it was running.

Config and HostConfig are sent back raw: a field this code does not know about
-- a device mapping, a ulimit, a GPU request -- survives because nothing here
ever decoded it. Labels ride along in Config, so Unraid keeps managing the
container; its own "update ready" flag only catches up when Unraid next checks.
*/

type dockerRecreateResult struct {
	Phase       string `json:"phase"` // done | already-current | rolled-back
	FailedStep  string `json:"failedStep,omitempty"`
	OldImageID  string `json:"oldImageId"`
	NewImageID  string `json:"newImageId"`
	ContainerID string `json:"containerId"`
}

// Network modes that are not a network: a container on the host's stack, on
// none, or sharing another container's namespace cannot be connected anywhere
// else, and create must be given no endpoint for them.
func dockerNetworkModeIsNetwork(mode string) bool {
	return mode != "host" && mode != "none" && !strings.HasPrefix(mode, "container:")
}

func (h *Handlers) dockerRecreate(ctx context.Context, api *dockerAPI, c dockerContainerSummary) (dockerRecreateResult, error) {
	res := dockerRecreateResult{OldImageID: c.ImageID, ContainerID: c.ID}
	in, err := api.inspectContainer(ctx, c.ID)
	if err != nil {
		return res, err
	}
	if err := dockerRecreateRefusal(ctx, api, c, in); err != nil {
		return res, err
	}
	res.OldImageID = in.Image
	ref := in.Config.Image
	if err := api.pullImage(ctx, ref); err != nil {
		res.FailedStep = "pull"
		return res, err
	}
	img, err := api.inspectImage(ctx, ref)
	if err != nil {
		res.FailedStep = "pull"
		return res, err
	}
	res.NewImageID = img.ID
	if img.ID == in.Image {
		res.Phase = "already-current"
		return res, nil
	}
	return h.dockerRecreateOn(ctx, api, c, in, ref, res)
}

// dockerRecreateRefusal is what makes a container unsafe to swap, checked
// before anything is pulled or stopped:
//   - made from an image id rather than a reference: there is nothing to pull;
//   - removed by the daemon once it stops (--rm): the stop would take it away
//     before the new one exists, and there would be nothing to go back to;
//   - another container runs in its network namespace (network_mode:
//     container:X, as a VPN container's clients do): they would be left
//     pointing at a container that no longer exists.
func dockerRecreateRefusal(ctx context.Context, api *dockerAPI, c dockerContainerSummary, in dockerInspect) error {
	if dockerIsImageID(in.Config.Image) {
		return &dockerRefusalError{Code: http.StatusConflict, Reason: "pinned-by-id"}
	}
	if in.HostConfig.AutoRemove {
		return &dockerRefusalError{Code: http.StatusConflict, Reason: "auto-remove"}
	}
	list, err := api.listContainers(ctx)
	if err != nil {
		return err
	}
	if users := dockerNetworkDependents(c, list); len(users) > 0 {
		return &dockerRefusalError{Code: http.StatusConflict, Reason: "network-shared", Containers: users}
	}
	return nil
}

// dockerIsImageID: "sha256:…", or the bare hex a container made from an id
// keeps, rather than a reference a registry knows.
func dockerIsImageID(ref string) bool {
	ref = strings.TrimPrefix(strings.TrimSpace(ref), "sha256:")
	return dockerHexID.MatchString(ref) && len(ref) >= 12 && !strings.Contains(ref, "/")
}

// dockerNetworkDependents names the containers that share c's network
// namespace. Docker keeps "container:" with the name or the id as given.
func dockerNetworkDependents(c dockerContainerSummary, list []dockerContainerSummary) []string {
	users := []string{}
	for _, other := range list {
		mode, ok := strings.CutPrefix(other.HostConfig.NetworkMode, "container:")
		if !ok || other.ID == c.ID || mode == "" {
			continue
		}
		if mode == c.name() || (len(mode) >= 12 && strings.HasPrefix(c.ID, mode)) {
			users = append(users, other.name())
		}
	}
	sort.Strings(users)
	return users
}

// dockerKeepAnonymousVolumes mounts the volumes the old container got from its
// image's VOLUME lines -- anonymous, named by Docker, not in HostConfig -- into
// the new one. A new container would otherwise get fresh, empty ones, and the
// data would sit in a volume nothing uses any more.
func dockerKeepAnonymousVolumes(in dockerInspect, hostConfig map[string]any) {
	covered := map[string]bool{}
	if binds, ok := hostConfig["Binds"].([]any); ok {
		for _, b := range binds {
			if s, ok := b.(string); ok {
				if parts := strings.Split(s, ":"); len(parts) >= 2 {
					covered[parts[1]] = true
				}
			}
		}
	}
	mounts, _ := hostConfig["Mounts"].([]any)
	for _, m := range mounts {
		if mm, ok := m.(map[string]any); ok {
			if target, ok := mm["Target"].(string); ok {
				covered[target] = true
			}
		}
	}
	for _, m := range in.Mounts {
		if m.Type != "volume" || m.Name == "" || covered[m.Destination] {
			continue
		}
		mounts = append(mounts, map[string]any{"Type": "volume", "Source": m.Name, "Target": m.Destination, "ReadOnly": !m.RW})
		covered[m.Destination] = true
	}
	if len(mounts) > 0 {
		hostConfig["Mounts"] = mounts
	}
}

// dockerRecreateOn swaps the container for a new one made from ref, which
// already names the image to run (pulled for an update, tagged back for a
// rollback): stop, rename out of the way, create, reconnect, start, remove.
func (h *Handlers) dockerRecreateOn(ctx context.Context, api *dockerAPI, c dockerContainerSummary, in dockerInspect,
	ref string, res dockerRecreateResult) (dockerRecreateResult, error) {
	var config map[string]any
	var hostConfig map[string]any
	if err := json.Unmarshal(in.raw.Config, &config); err != nil || config == nil {
		return res, fmt.Errorf("reading the container's configuration: %w", err)
	}
	if err := json.Unmarshal(in.raw.HostConfig, &hostConfig); err != nil || hostConfig == nil {
		return res, fmt.Errorf("reading the container's host configuration: %w", err)
	}

	dockerKeepAnonymousVolumes(in, hostConfig)

	name := c.name()
	// Running covers paused as well; either way the reader expects it back up.
	wasRunning := in.State.Running
	if wasRunning {
		if err := api.post(ctx, "/containers/"+c.ID+"/stop", nil); err != nil {
			res.FailedStep = "stop"
			return res, err
		}
	}
	oldName := fmt.Sprintf("%s-nextdash-old-%d", name, time.Now().Unix())
	if err := api.post(ctx, "/containers/"+c.ID+"/rename?name="+url.QueryEscape(oldName), nil); err != nil {
		res.FailedStep = "rename"
		return h.dockerRollback(ctx, api, res, c.ID, "", "", wasRunning, err)
	}

	// Docker folds the image's defaults into a container's Config when it is
	// created, and inspect hands them back merged. Sent back as they are, the
	// old image's Env, Cmd, Entrypoint, healthcheck and labels would override
	// the new image's own. What equals the old image's value is left out, so
	// the new image fills it in; what was set for the container stays.
	if imgConfig, err := api.inspectImageConfig(ctx, in.Image); err == nil && imgConfig != nil {
		dropImageDefaults(config, imgConfig)
	}
	config["Image"] = ref
	// Docker defaults the hostname to the short id; carried over, the new
	// container would be named after the one it replaces.
	if host, _ := config["Hostname"].(string); len(c.ID) >= 12 && host == c.ID[:12] {
		delete(config, "Hostname")
	}
	// Another container's network (gluetun and other VPN clients): Docker
	// copies that container's hostname and domain into this one's config when
	// it starts, and a create that sends them back is refused with
	// "conflicting options: hostname and the network mode" -- every update
	// failed at "create" and rolled back.
	if mode, _ := hostConfig["NetworkMode"].(string); strings.HasPrefix(mode, "container:") {
		delete(config, "Hostname")
		delete(config, "Domainname")
	}
	body := dockerCreateBody{}
	for k, v := range config {
		body[k] = v
	}
	body["HostConfig"] = hostConfig

	// Create attaches one network; the rest are connected afterwards.
	networks := in.NetworkSettings.Networks
	mode, _ := hostConfig["NetworkMode"].(string)
	if mode == "" || mode == "default" {
		mode = "bridge"
	}
	joinable := dockerNetworkModeIsNetwork(mode)
	if n, ok := networks[mode]; ok && joinable {
		body["NetworkingConfig"] = map[string]any{"EndpointsConfig": map[string]any{
			mode: dockerEndpointConfig(n.Aliases, n.IPAMConfig, n.MacAddress, c.ID),
		}}
	}

	newID, err := api.createContainer(ctx, name, body)
	if err != nil {
		res.FailedStep = "create"
		return h.dockerRollback(ctx, api, res, c.ID, "", name, wasRunning, err)
	}
	if joinable {
		for netName, n := range networks {
			if netName == mode {
				continue
			}
			payload := map[string]any{
				"Container":      newID,
				"EndpointConfig": dockerEndpointConfig(n.Aliases, n.IPAMConfig, n.MacAddress, c.ID),
			}
			if err := api.post(ctx, "/networks/"+url.PathEscape(netName)+"/connect", payload); err != nil {
				res.FailedStep = "connect"
				return h.dockerRollback(ctx, api, res, c.ID, newID, name, wasRunning, err)
			}
		}
	}
	if wasRunning {
		if err := api.post(ctx, "/containers/"+newID+"/start", nil); err != nil {
			res.FailedStep = "start"
			return h.dockerRollback(ctx, api, res, c.ID, newID, name, wasRunning, err)
		}
	}
	if err := api.remove(ctx, c.ID); err != nil {
		logWarn(logComponentMutate, "updated %s, but the previous container %s could not be removed: %v", name, oldName, err)
	}
	logInfo(logComponentMutate, "recreated %s on %s", name, shortImageID(res.NewImageID))
	res.Phase = "done"
	res.ContainerID = newID
	return res, nil
}

// dropImageDefaults removes from a container's Config what it only has
// because its image had it. Env lines and labels go one by one; Cmd goes only
// with the Entrypoint, since an entrypoint set for the container keeps the
// command that came with it.
func dropImageDefaults(config, image map[string]any) {
	if env, ok := config["Env"].([]any); ok {
		fromImage := map[string]bool{}
		if imgEnv, ok := image["Env"].([]any); ok {
			for _, e := range imgEnv {
				if s, ok := e.(string); ok {
					fromImage[s] = true
				}
			}
		}
		kept := []any{}
		for _, e := range env {
			if s, ok := e.(string); !ok || !fromImage[s] {
				kept = append(kept, e)
			}
		}
		config["Env"] = kept
	}
	for _, field := range []string{"Labels", "ExposedPorts", "Volumes"} {
		own, _ := config[field].(map[string]any)
		img, _ := image[field].(map[string]any)
		for k, v := range img {
			if cv, ok := own[k]; ok && reflect.DeepEqual(cv, v) {
				delete(own, k)
			}
		}
	}
	for _, field := range []string{"WorkingDir", "User", "Healthcheck", "StopSignal", "Shell", "OnBuild"} {
		if cv, ok := config[field]; ok && reflect.DeepEqual(cv, image[field]) {
			delete(config, field)
		}
	}
	if reflect.DeepEqual(config["Entrypoint"], image["Entrypoint"]) {
		delete(config, "Entrypoint")
		if reflect.DeepEqual(config["Cmd"], image["Cmd"]) {
			delete(config, "Cmd")
		}
	}
}

// dockerEndpointConfig carries a network's aliases, fixed address and MAC over
// to the new container. Docker adds the short id to the aliases on its own;
// the old one is dropped so the new container does not answer to it.
func dockerEndpointConfig(aliases []string, ipam json.RawMessage, mac, oldID string) map[string]any {
	kept := []string{}
	for _, alias := range aliases {
		if len(oldID) >= 12 && alias == oldID[:12] {
			continue
		}
		kept = append(kept, alias)
	}
	out := map[string]any{"Aliases": kept}
	if len(ipam) > 0 && string(ipam) != "null" {
		out["IPAMConfig"] = ipam
	}
	if mac != "" {
		out["MacAddress"] = mac
	}
	return out
}

func shortImageID(id string) string {
	id = strings.TrimPrefix(id, "sha256:")
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

// dockerRollbackTimeout is how long putting the old container back may take:
// a remove, a rename and a start.
const dockerRollbackTimeout = 2 * time.Minute

// isDockerNotFound reports a 404 from the daemon.
func isDockerNotFound(err error) bool {
	var apiErr *dockerAPIError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound
}

// dockerRollback removes the half-made new container and puts the old one
// back. A rollback that works is not an error: the reader's service runs as
// before, and the result names the step that failed.
func (h *Handlers) dockerRollback(ctx context.Context, api *dockerAPI, res dockerRecreateResult,
	oldID, newID, name string, wasRunning bool, cause error) (dockerRecreateResult, error) {
	logWarn(logComponentMutate, "the update of %s failed at %s (%v); restoring the previous container", name, res.FailedStep, cause)
	// Time of its own: the update's budget may be what ran out, and a
	// rollback that fails on it leaves the old container stopped and renamed.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), dockerRollbackTimeout)
	defer cancel()
	// Already gone -- removed from another tab -- is what this wanted.
	removeNew := func() error {
		if err := api.remove(ctx, newID); err != nil && !isDockerNotFound(err) {
			return err
		}
		return nil
	}
	if newID != "" {
		if err := removeNew(); err != nil {
			// Force it: the new container may be half-started.
			_ = api.post(ctx, "/containers/"+newID+"/stop", nil)
			if err := removeNew(); err != nil {
				return res, fmt.Errorf("the update failed at %s and the new container could not be removed: %w", res.FailedStep, err)
			}
		}
	}
	if err := h.dockerRestore(ctx, api, oldID, name, wasRunning); err != nil {
		return res, fmt.Errorf("the update failed at %s and the previous container could not be restored: %w", res.FailedStep, err)
	}
	res.Phase = "rolled-back"
	res.ContainerID = oldID
	return res, nil
}

func (h *Handlers) dockerRestore(ctx context.Context, api *dockerAPI, oldID, name string, wasRunning bool) error {
	if name != "" {
		if err := api.post(ctx, "/containers/"+oldID+"/rename?name="+url.QueryEscape(name), nil); err != nil {
			return err
		}
	}
	if wasRunning {
		return api.post(ctx, "/containers/"+oldID+"/start", nil)
	}
	return nil
}
