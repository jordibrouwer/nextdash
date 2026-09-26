package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
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

	var config map[string]any
	var hostConfig map[string]any
	if err := json.Unmarshal(in.raw.Config, &config); err != nil || config == nil {
		return res, fmt.Errorf("reading the container's configuration: %w", err)
	}
	if err := json.Unmarshal(in.raw.HostConfig, &hostConfig); err != nil || hostConfig == nil {
		return res, fmt.Errorf("reading the container's host configuration: %w", err)
	}

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

	config["Image"] = ref
	// Docker defaults the hostname to the short id; carried over, the new
	// container would be named after the one it replaces.
	if host, _ := config["Hostname"].(string); len(c.ID) >= 12 && host == c.ID[:12] {
		delete(config, "Hostname")
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
	logInfo(logComponentMutate, "updated %s to %s", name, shortImageID(img.ID))
	res.Phase = "done"
	res.ContainerID = newID
	return res, nil
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

// dockerRollback removes the half-made new container and puts the old one
// back. A rollback that works is not an error: the reader's service runs as
// before, and the result names the step that failed.
func (h *Handlers) dockerRollback(ctx context.Context, api *dockerAPI, res dockerRecreateResult,
	oldID, newID, name string, wasRunning bool, cause error) (dockerRecreateResult, error) {
	logWarn(logComponentMutate, "the update of %s failed at %s (%v); restoring the previous container", name, res.FailedStep, cause)
	if newID != "" {
		if err := api.remove(ctx, newID); err != nil {
			// Force it: the new container may be half-started.
			_ = api.post(ctx, "/containers/"+newID+"/stop", nil)
			if err := api.remove(ctx, newID); err != nil {
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
