package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
The Containers read tools.

They ask the same handlers the Containers view asks and reshape the answer.
Environment variables never leave: the detail handler already only names them,
but a reader of this file should not have to trust that, so the reshaping step
drops every key that is about the environment itself.

Logs are the exception to "nothing sensitive": they can print a key as readily
as the environment can. They stay in because the question "why is it down" is
answered there, capped at 200 lines, and behind the write token when one is
set, because that is how the handler already guards them.
*/

const (
	mcpContainerListDefault = 50
	mcpContainerListMax     = 200
	mcpLogLinesDefault      = 100
	mcpLogLinesMax          = 200
)

func mcpContainersReadDefinitions() []map[string]any {
	containerProp := map[string]any{
		"type":        "string",
		"description": "The container's name, or the start of its id.",
	}
	return []map[string]any{
		{
			"name":        "list_containers",
			"annotations": mcpAnnotations(true, false),
			"description": "The Docker containers nextDash can see, with state (running, exited, ...), image, whether an image update is available, and the last CPU and memory reading when one is known. " +
				"Use get_container for one container's detail.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"limit": map[string]any{"type": "integer", "description": "How many to return, at most 200. Defaults to 50."},
				},
			},
		},
		{
			"name":        "get_container",
			"annotations": mcpAnnotations(true, false),
			"description": "One container's detail as the Containers view shows it: state, image and version, ports, mounts, networks, restart policy and update history. " +
				"Environment variables are never included.",
			"inputSchema": map[string]any{
				"type":       "object",
				"properties": map[string]any{"container": containerProp},
				"required":   []string{"container"},
			},
		},
		{
			"name":        "get_container_logs",
			"annotations": mcpAnnotations(true, false),
			"description": "The last lines of a container's log, oldest first, at most 200. Logs can contain secrets; with a write token set this needs the token.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"container": containerProp,
					"lines":     map[string]any{"type": "integer", "description": "How many lines, at most 200. Defaults to 100."},
				},
				"required": []string{"container"},
			},
		},
	}
}

// mcpDockerReasonText turns the reason words the Docker routes use into
// something a person can act on.
func mcpDockerReasonText(reason, message string) string {
	var text string
	switch reason {
	case reasonNoDockerSocket:
		text = "Docker is not reachable: no Docker socket is mounted into nextDash."
	case reasonDockerSocketDenied:
		text = "Docker is not reachable: nextDash is not allowed to use the Docker socket."
	case "not-found":
		text = "No such container."
	case "daemon":
		text = "The Docker daemon refused the request."
	case "":
		text = "Docker did not answer."
	default:
		text = "Docker did not answer (" + reason + ")."
	}
	if message != "" {
		text += " " + message
	}
	return text
}

// mcpWriteTokenSentence is what a refused write token reads as.
const mcpWriteTokenSentence = "This tool needs the write token."

func mcpDockerFailure(rec *bufferedResponse) map[string]any {
	var body struct {
		Reason  string `json:"reason"`
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(rec.body.Bytes(), &body) == nil && (body.Reason != "" || body.Message != "" || body.Error != "") {
		if body.Reason == "" && body.Error != "" {
			return map[string]any{"error": body.Error}
		}
		return map[string]any{"error": mcpDockerReasonText(body.Reason, body.Message)}
	}
	return mcpErrorFrom(rec)
}

func (h *Handlers) mcpDockerViewOff() map[string]any {
	if !h.store.GetSettings().DockerViewEnabled {
		return map[string]any{"error": "The Containers view is switched off in Config, so the container read tools are unavailable."}
	}
	return nil
}

func (h *Handlers) mcpListContainers(r *http.Request, args json.RawMessage) map[string]any {
	if off := h.mcpDockerViewOff(); off != nil {
		return off
	}
	var body struct {
		Limit int `json:"limit"`
	}
	_ = json.Unmarshal(args, &body)
	limit := clampLimit(body.Limit, mcpContainerListDefault, mcpContainerListMax)

	rec, err := h.mcpInner(r, "GET", "/api/docker/containers", nil, nil, h.DockerContainersHandler)
	if err != nil {
		return map[string]any{"error": "Could not read the container list."}
	}
	if rec.status >= 400 {
		return mcpDockerFailure(rec)
	}
	var list struct {
		Available bool                  `json:"available"`
		Reason    string                `json:"reason"`
		Message   string                `json:"message"`
		Items     []dockerViewContainer `json:"containers"`
	}
	if err := json.Unmarshal(rec.body.Bytes(), &list); err != nil {
		return map[string]any{"error": "Could not read the container list."}
	}
	if !list.Available {
		return map[string]any{"error": mcpDockerReasonText(list.Reason, list.Message)}
	}
	out := []map[string]any{}
	for _, c := range list.Items {
		if len(out) >= limit {
			break
		}
		row := map[string]any{
			"id":               c.ShortID,
			"name":             c.Name,
			"image":            c.Image,
			"state":            c.State,
			"update_available": c.Update != nil && c.Update.Status == "available",
			"cpu":              nil,
			"memory":           nil,
		}
		if c.Usage != nil {
			row["cpu"] = fmt.Sprintf("%.1f%%", c.Usage.CPU)
			row["memory"] = mcpBytes(c.Usage.Mem)
		}
		out = append(out, row)
	}
	return map[string]any{"containers": out, "truncated": len(list.Items) > len(out)}
}

func mcpBytes(n uint64) string {
	const mib = 1 << 20
	if n >= 1<<30 {
		return strconv.FormatFloat(float64(n)/(1<<30), 'f', 1, 64) + " GiB"
	}
	return strconv.FormatFloat(float64(n)/mib, 'f', 0, 64) + " MiB"
}

// mcpStripEnv removes anything about the environment, at any depth. Keys are
// matched by name rather than by position so a field added to the detail later
// cannot carry values out unnoticed.
func mcpStripEnv(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for key := range t {
			if strings.HasPrefix(strings.ToLower(key), "env") {
				delete(t, key)
				continue
			}
			t[key] = mcpStripEnv(t[key])
		}
		return t
	case []any:
		for i := range t {
			t[i] = mcpStripEnv(t[i])
		}
		return t
	}
	return v
}

func (h *Handlers) mcpGetContainer(r *http.Request, args json.RawMessage) map[string]any {
	if off := h.mcpDockerViewOff(); off != nil {
		return off
	}
	var body struct {
		Container string `json:"container"`
	}
	_ = json.Unmarshal(args, &body)
	id, failure := h.mcpResolveContainer(body.Container)
	if failure != nil {
		return failure
	}
	rec, err := h.mcpInner(r, "GET", "/api/docker/containers/"+id, nil, map[string]string{"id": id}, h.DockerContainerDetailHandler)
	if err != nil {
		return map[string]any{"error": "Could not read the container."}
	}
	if rec.status >= 400 {
		return mcpDockerFailure(rec)
	}
	var detail map[string]any
	if err := json.Unmarshal(rec.body.Bytes(), &detail); err != nil {
		return map[string]any{"error": "Could not read the container."}
	}
	mcpStripEnv(detail)
	return detail
}

func (h *Handlers) mcpContainerLogs(r *http.Request, args json.RawMessage) map[string]any {
	if off := h.mcpDockerViewOff(); off != nil {
		return off
	}
	var body struct {
		Container string `json:"container"`
		Lines     int    `json:"lines"`
	}
	_ = json.Unmarshal(args, &body)
	n := clampLimit(body.Lines, mcpLogLinesDefault, mcpLogLinesMax)
	id, failure := h.mcpResolveContainer(body.Container)
	if failure != nil {
		return failure
	}
	path := "/api/docker/containers/" + id + "/logs?tail=" + strconv.Itoa(n)
	rec, err := h.mcpInner(r, "GET", path, nil, map[string]string{"id": id}, h.DockerContainerLogsHandler)
	if err != nil {
		return map[string]any{"error": "Could not read the logs."}
	}
	if rec.status == http.StatusUnauthorized {
		return map[string]any{"error": mcpWriteTokenSentence}
	}
	if rec.status >= 400 {
		return mcpDockerFailure(rec)
	}
	var logs struct {
		Lines []string `json:"lines"`
	}
	if err := json.Unmarshal(rec.body.Bytes(), &logs); err != nil {
		return map[string]any{"error": "Could not read the logs."}
	}
	// The daemon was asked for n, but the cap is ours to keep.
	if len(logs.Lines) > n {
		logs.Lines = logs.Lines[len(logs.Lines)-n:]
	}
	if logs.Lines == nil {
		logs.Lines = []string{}
	}
	return map[string]any{"lines": logs.Lines}
}

// mcpResolveContainer finds one container by exact name or by the start of its
// id. An unknown or ambiguous reference answers with what it could have been.
func (h *Handlers) mcpResolveContainer(ref string) (string, map[string]any) {
	id, _, failure := h.mcpResolveContainerNamed(ref)
	return id, failure
}

// mcpResolveContainerNamed is mcpResolveContainer that also answers the name.
func (h *Handlers) mcpResolveContainerNamed(ref string) (string, string, map[string]any) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", "", map[string]any{"error": "Say which container: a name or the start of an id."}
	}
	api, reason := newDockerAPI()
	if api == nil {
		return "", "", map[string]any{"error": mcpDockerReasonText(reason, "")}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	list, err := api.listContainers(ctx)
	if err != nil {
		return "", "", map[string]any{"error": mcpDockerReasonText(dockerDialReason(err), "")}
	}
	label := func(c dockerContainerSummary) string {
		short := c.ID
		if len(short) > 12 {
			short = short[:12]
		}
		return c.name() + " (" + short + ")"
	}
	var byName, byID []dockerContainerSummary
	isHex := dockerHexID.MatchString(ref)
	for _, c := range list {
		if c.name() == ref {
			byName = append(byName, c)
		} else if isHex && strings.HasPrefix(c.ID, ref) {
			byID = append(byID, c)
		}
	}
	matches := append(byName, byID...)
	if len(byName) == 1 {
		return byName[0].ID, byName[0].name(), nil
	}
	if len(matches) == 1 {
		return matches[0].ID, matches[0].name(), nil
	}
	candidates := []string{}
	if len(matches) > 1 {
		for _, c := range matches {
			candidates = append(candidates, label(c))
		}
		sort.Strings(candidates)
		return "", "", map[string]any{"error": "More than one container matches \"" + ref + "\"; use the full name or more of the id.", "candidates": candidates}
	}
	lower := strings.ToLower(ref)
	for _, c := range list {
		if strings.Contains(strings.ToLower(c.name()), lower) {
			candidates = append(candidates, label(c))
		}
	}
	if len(candidates) == 0 {
		for _, c := range list {
			candidates = append(candidates, label(c))
		}
	}
	sort.Strings(candidates)
	if len(candidates) > 20 {
		candidates = candidates[:20]
	}
	return "", "", map[string]any{"error": "No container matches \"" + ref + "\".", "candidates": candidates}
}
