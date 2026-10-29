package app

import (
	"encoding/json"
	"net/http"
	"strings"
)

/*
The Containers control tool.

It asks DockerActionHandler, the route the Containers view's buttons use, and
never the daemon itself. Every refusal that route has (control switched off,
the write token, nextDash's own container, the per-container lock, remove only
when stopped, a prune in progress) therefore holds here without a second copy
of it to keep in step. There is no kill: it is not in the handler's list, and
the schema does not offer it either.
*/

// mcpContainerActions is the whole list the tool offers, in the order the
// schema shows it.
var mcpContainerActions = []string{"start", "stop", "restart", "pause", "unpause", "remove", "update", "rollback"}

func mcpContainersControlDefinitions() []map[string]any {
	return []map[string]any{
		{
			"name":        "container_action",
			"annotations": mcpAnnotations(false, true),
			"description": "Run one action on a Docker container: start, stop, restart, pause, unpause, remove, update or rollback. " +
				"This changes what is running. remove only works on a stopped container and keeps its volumes; update pulls the newest image and recreates the container; rollback returns to the image before the last update. " +
				"nextDash refuses to stop, restart, pause, remove or update itself. Needs the write token when one is set, and Docker control switched on for nextDash.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"container": map[string]any{"type": "string", "description": "The container's name, or the start of its id."},
					"action":    map[string]any{"type": "string", "enum": mcpContainerActions, "description": "What to do."},
				},
				"required": []string{"container", "action"},
			},
		},
	}
}

// mcpDockerActionReasonText words the refusals DockerActionHandler gives.
func mcpDockerActionReasonText(reason string) string {
	switch reason {
	case reasonDockerControlOff:
		return "Docker control is switched off for nextDash (NEXTDASH_DOCKER_CONTROL), so containers cannot be changed."
	case reasonDockerSelf:
		return "nextDash cannot stop, restart, pause, remove or update the container it runs in."
	case "busy":
		return "Another action is already running on this container. Try again in a moment."
	case "running":
		return "Only a stopped container can be removed. Stop it first."
	case "prune-running":
		return "A cleanup of Docker images is running. Try the update again when it has finished."
	case "unknown-action":
		return "That action does not exist."
	}
	return ""
}

func (h *Handlers) mcpContainerAction(r *http.Request, args json.RawMessage) map[string]any {
	if e := mcpNeedsToken(r); e != nil {
		return e
	}
	var body struct {
		Container string `json:"container"`
		Action    string `json:"action"`
	}
	_ = json.Unmarshal(args, &body)
	allowed := false
	for _, a := range mcpContainerActions {
		if a == body.Action {
			allowed = true
		}
	}
	if !allowed {
		return map[string]any{"error": "Unknown action \"" + body.Action + "\". Use one of: " + strings.Join(mcpContainerActions, ", ") + "."}
	}
	id, failure := h.mcpResolveContainer(body.Container)
	if failure != nil {
		return failure
	}
	rec, err := h.mcpInner(r, http.MethodPost, "/api/docker/containers/"+id+"/"+body.Action, nil,
		map[string]string{"id": id, "action": body.Action}, h.DockerActionHandler)
	if err != nil {
		return map[string]any{"error": "Could not run the action."}
	}
	if rec.status == http.StatusUnauthorized {
		return map[string]any{"error": "This tool needs the write token."}
	}
	if rec.status >= 400 {
		var refusal struct {
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(rec.body.Bytes(), &refusal)
		if text := mcpDockerActionReasonText(refusal.Reason); text != "" {
			return map[string]any{"error": text, "reason": refusal.Reason}
		}
		failure := mcpDockerFailure(rec)
		if refusal.Reason != "" {
			failure["reason"] = refusal.Reason
		}
		return failure
	}
	return map[string]any{"done": true, "container": body.Container, "action": body.Action}
}
