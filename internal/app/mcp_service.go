package app

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

/*
service_get: the Service overview's aggregate, for the MCP tools.

It runs GET /api/service itself (mcpInner), so the answer is the page's own
and there is one place that decides what is in it -- including what is not:
no env values or names, no labels, no mounts, no log lines and no output of a
container's healthcheck. Nothing here adds to it.

The tool sits with the health tools (its core is the bookmark's health, checks,
watched feeds and timeline). The container half is also behind the Containers
read switch: with that off the call is answered as if no container was named,
so the Docker daemon is never asked on its behalf.
*/

func mcpServiceDefinitions() []map[string]any {
	return []map[string]any{{
		"name":        "service_get",
		"annotations": mcpAnnotations(true, false),
		"description": "One service as the Service overview shows it: the bookmark with its status, score and uptime (24 h, 7 d, 30 d), its network checks, the feeds watched for it, " +
			"the container behind it (state, image, version, ports, restarts, whether an update is waiting) and one merged timeline, newest first, of outages, check changes, " +
			"container starts, stops and crashes, updates and new releases. Give a bookmark url (and its page id when the same address is on several pages), or a container name; " +
			"host names another Docker host's id (d_...), whose timeline then holds the bookmark's events only and timelinePartial says local-only. " +
			"The container is the one you name: this does not guess it from the bookmark. Environment variables, labels, mounts, log lines and healthcheck output are never included " +
			"(use get_container_logs for logs).",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"url":       map[string]any{"type": "string", "description": "The bookmark's address."},
				"page":      map[string]any{"type": "integer", "description": "The page id the bookmark is on, when the same address is on more than one page."},
				"container": map[string]any{"type": "string", "description": "A container's name."},
				"host":      map[string]any{"type": "string", "description": "The Docker host's id (d_...) the container runs on. Omit for this machine."},
			},
		},
	}}
}

func (h *Handlers) mcpServiceGet(r *http.Request, args json.RawMessage) map[string]any {
	var a struct {
		URL       string `json:"url"`
		Page      any    `json:"page"`
		Container string `json:"container"`
		Host      string `json:"host"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &a); err != nil {
			return map[string]any{"error": "Could not read the arguments: " + err.Error()}
		}
	}
	a.URL, a.Container, a.Host = strings.TrimSpace(a.URL), strings.TrimSpace(a.Container), strings.TrimSpace(a.Host)
	if a.URL == "" && a.Container == "" {
		return map[string]any{"error": "Give a bookmark url or a container name."}
	}
	if a.Host != "" && !dockerHostIDRe.MatchString(a.Host) && a.Host != dockerLocalHostID {
		return map[string]any{"error": "host must be a Docker host id like d_0123456789ab, or left out for this machine."}
	}
	settings := h.store.GetSettings()
	containers := settings.MCPContainersRead && settings.DockerViewEnabled
	q := url.Values{}
	if a.URL != "" {
		q.Set("url", a.URL)
	}
	switch p := a.Page.(type) {
	case float64:
		q.Set("page", strconv.Itoa(int(p)))
	case string:
		if n, err := strconv.Atoi(strings.TrimSpace(p)); err == nil {
			q.Set("page", strconv.Itoa(n))
		}
	}
	if containers && a.Container != "" {
		q.Set("container", a.Container)
		if a.Host != "" {
			q.Set("host", a.Host)
		}
	}
	rec, err := h.mcpInner(r, "GET", "/api/service?"+q.Encode(), nil, nil, h.ServiceViewHandler)
	if err != nil || rec.status >= 400 {
		return map[string]any{"error": "Could not read the service."}
	}
	var out map[string]any
	if err := json.Unmarshal(rec.body.Bytes(), &out); err != nil {
		return map[string]any{"error": "Could not read the service."}
	}
	if a.Container != "" && !containers {
		out["notes"] = []string{"Containers are switched off for this tool (Config → MCP → Containers read, or the Containers view), so no container is included."}
	}
	return out
}
