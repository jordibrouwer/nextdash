package app

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
Containers and the bookmarks they belong to, for the MCP tools.

The link is matchContainerBookmark's, fed the container exactly as the
Containers view sees it: the list handler's rows (hidden containers already
left out), the web UI address the view opens (custom over default), the
container's own LAN address and its published ports, and the names this
server goes by, the way discovery derives them. So "linked" here is the link
icon in the view, not a second opinion.
*/

type mcpContainerLink struct {
	container dockerViewContainer
	bookmark  Bookmark
	via       string
}

type mcpContainerIndex struct {
	list        []dockerViewContainer
	byBookmark  map[string]mcpContainerLink // bookmark key (pageId::url) -> the first container, by name
	byContainer map[string]mcpContainerLink // container name -> its bookmark
}

// mcpContainerRows asks the list handler the Containers view asks. The second
// answer is why there is no list: a sentence, never an error to stop on.
func (h *Handlers) mcpContainerRows(r *http.Request) ([]dockerViewContainer, string) {
	if !h.store.GetSettings().DockerViewEnabled {
		return nil, "The Containers view is switched off in Config, so nothing is known about containers."
	}
	rec, err := h.mcpInner(r, "GET", "/api/docker/containers", nil, nil, h.DockerContainersHandler)
	if err != nil || rec.status >= 400 {
		return nil, "Could not read the container list."
	}
	var list struct {
		Available bool                  `json:"available"`
		Reason    string                `json:"reason"`
		Message   string                `json:"message"`
		Items     []dockerViewContainer `json:"containers"`
	}
	if err := json.Unmarshal(rec.body.Bytes(), &list); err != nil {
		return nil, "Could not read the container list."
	}
	if !list.Available {
		return nil, mcpDockerReasonText(list.Reason, list.Message)
	}
	return list.Items, ""
}

// mcpLinkContainers matches every container to a bookmark.
func (h *Handlers) mcpLinkContainers(list []dockerViewContainer, bookmarks []Bookmark) *mcpContainerIndex {
	settings := h.store.GetSettings()
	hosts := discoveryHosts(settings, h.discoveryHost(settings))
	byKey := make(map[string]Bookmark, len(bookmarks))
	for _, b := range bookmarks {
		if k := matchBookmarkKey(b); byKey[k].URL == "" {
			byKey[k] = b
		}
	}
	sorted := append([]dockerViewContainer(nil), list...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })
	idx := &mcpContainerIndex{list: list, byBookmark: map[string]mcpContainerLink{}, byContainer: map[string]mcpContainerLink{}}
	for _, c := range sorted {
		var ports []int
		for _, p := range c.Ports {
			if p.Public > 0 && !strings.EqualFold(p.Type, "udp") {
				ports = append(ports, p.Public)
			}
		}
		key, via, ok := matchContainerBookmark(discoveryContainer{Name: c.Name, WebUI: c.WebUI, LanIP: c.LanIP, Ports: ports},
			bookmarks, settings.DockerBookmarkLinks, hosts)
		if !ok {
			continue
		}
		link := mcpContainerLink{container: c, bookmark: byKey[key], via: via}
		idx.byContainer[c.Name] = link
		if _, taken := idx.byBookmark[key]; !taken {
			idx.byBookmark[key] = link
		}
	}
	return idx
}

// mcpContainerIndexFor is the index when container links can be known, else
// nil and the sentences that say why.
func (h *Handlers) mcpContainerIndexFor(r *http.Request, bookmarks []Bookmark) (*mcpContainerIndex, []string) {
	if !h.store.GetSettings().MCPContainersRead {
		return nil, []string{"Container links are left out: the Containers: read switch is off (Config → AI Assistant → What it can see)."}
	}
	list, why := h.mcpContainerRows(r)
	if why != "" {
		return nil, []string{"Container links are unknown: " + why}
	}
	return h.mcpLinkContainers(list, bookmarks), nil
}

// mcpBookmarkRef is the bookmark side of a link, by name and page.
func (h *Handlers) mcpBookmarkRef(link mcpContainerLink, ok bool) any {
	if !ok {
		return nil
	}
	return map[string]any{
		"name": strings.TrimSpace(link.bookmark.Name),
		"url":  strings.TrimSpace(link.bookmark.URL),
		"page": pageNameForID(h.store, link.bookmark.PageID),
		"via":  link.via,
	}
}

func mcpContainerSummary(idx *mcpContainerIndex) map[string]any {
	return map[string]any{
		"total":    len(idx.list),
		"linked":   len(idx.byContainer),
		"unlinked": len(idx.list) - len(idx.byContainer),
	}
}

func mcpQueryContainersDefinitions() []map[string]any {
	return []map[string]any{{
		"name":        "query_containers",
		"annotations": mcpAnnotations(true, false),
		"description": "Filter, sort, count and group the Docker containers, each with the bookmark it is linked to. " +
			"Answers \"how many containers have no bookmark\" (linked false, read total), \"which containers use the most memory\" (sort memory), " +
			"\"which have an update\" (update_available true) or \"how many are running\" (group_by state, limit 0). " +
			"total is the exact count of matches before limit and summary counts every container, linked or not; for counts read those, never count the returned list. " +
			"A bookmark link says via which step it was found: manual (set in the Containers view), port, subdomain or title. Environment variables are never included.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"state":            map[string]any{"type": "string", "description": "Only this state: running, exited, paused, restarting, created, dead."},
				"image":            map[string]any{"type": "string", "description": "Only images whose name contains this."},
				"update_available": map[string]any{"type": "boolean", "description": "Only containers with (true) or without (false) an image update."},
				"linked":           map[string]any{"type": "boolean", "description": "Only containers with (true) or without (false) a bookmark."},
				"min_cpu":          map[string]any{"type": "number", "description": "CPU at least this percent of one core (last reading)."},
				"min_mem_percent":  map[string]any{"type": "number", "description": "Memory at least this percent of its limit (last reading)."},
				"sort":             map[string]any{"type": "string", "enum": []string{"name", "cpu", "memory", "uptime", "restarts"}, "description": "name ascending, the others highest first."},
				"order":            map[string]any{"type": "string", "enum": []string{"asc", "desc"}},
				"group_by":         map[string]any{"type": "string", "enum": []string{"state", "image", "host", "linked"}},
				"limit":            map[string]any{"type": "integer", "description": fmt.Sprintf("How many to list, at most %d. Defaults to %d. With group_by, 0 lists none.", mcpContainerListMax, mcpContainerListDefault)},
			},
		},
	}}
}

type mcpContainerQueryArgs struct {
	State           string   `json:"state"`
	Image           string   `json:"image"`
	UpdateAvailable *bool    `json:"update_available"`
	Linked          *bool    `json:"linked"`
	MinCPU          *float64 `json:"min_cpu"`
	MinMemPercent   *float64 `json:"min_mem_percent"`
	Sort            string   `json:"sort"`
	Order           string   `json:"order"`
	GroupBy         string   `json:"group_by"`
	Limit           *int     `json:"limit"`
}

// mcpContainerUsage is the sampler's last reading: CPU of one core as the view
// shows it, memory as a share of the limit as the usage alerts compare it.
func mcpContainerUsage(c dockerViewContainer) (cpu, memPct float64, ok bool) {
	if c.Usage == nil {
		return 0, 0, false
	}
	cpu = c.Usage.CPU
	if p, found := dockerStatsStore.latest(c.ID); found {
		memPct = p.memShare
	}
	return cpu, memPct, true
}

func mcpRound1(v float64) float64 { return math.Round(v*10) / 10 }

func mcpContainerHost(c dockerViewContainer, host string) string {
	if c.LanIP != "" {
		return c.LanIP
	}
	return host
}

func (h *Handlers) mcpContainerRow(c dockerViewContainer, idx *mcpContainerIndex, host string, now time.Time) map[string]any {
	ports := []string{}
	for _, p := range c.Ports {
		if p.Public > 0 {
			ports = append(ports, fmt.Sprintf("%d->%d/%s", p.Public, p.Private, p.Type))
		} else {
			ports = append(ports, fmt.Sprintf("%d/%s", p.Private, p.Type))
		}
	}
	row := map[string]any{
		"id":               c.ShortID,
		"name":             c.Name,
		"image":            c.Image,
		"state":            c.State,
		"status_text":      c.Status,
		"update_available": c.Update != nil && c.Update.Status == "available",
		"ports":            ports,
		"cpu_percent":      nil,
		"mem_percent":      nil,
		"restarts":         c.Restarts,
		"uptime":           nil,
		"host":             mcpContainerHost(c, host),
	}
	if cpu, mem, ok := mcpContainerUsage(c); ok {
		row["cpu_percent"] = mcpRound1(cpu)
		row["mem_percent"] = mcpRound1(mem)
		row["memory"] = mcpBytes(c.Usage.Mem)
	}
	if c.StartedAt > 0 {
		row["uptime"] = (time.Duration(now.Unix()-c.StartedAt) * time.Second).String()
	}
	link, ok := idx.byContainer[c.Name]
	row["bookmark"] = h.mcpBookmarkRef(link, ok)
	return row
}

func (h *Handlers) mcpQueryContainers(r *http.Request, args json.RawMessage) map[string]any {
	var a mcpContainerQueryArgs
	if len(args) > 0 {
		if err := json.Unmarshal(args, &a); err != nil {
			return map[string]any{"error": "Could not read the arguments: " + err.Error()}
		}
	}
	a.Sort = strings.ToLower(strings.TrimSpace(a.Sort))
	a.Order = strings.ToLower(strings.TrimSpace(a.Order))
	a.GroupBy = strings.ToLower(strings.TrimSpace(a.GroupBy))
	a.State = strings.ToLower(strings.TrimSpace(a.State))
	sorts := []string{"name", "cpu", "memory", "uptime", "restarts"}
	if a.Sort != "" && !mcpOneOf(a.Sort, sorts...) {
		return mcpRefuseValue("sort", a.Sort, sorts)
	}
	if a.Order != "" && !mcpOneOf(a.Order, "asc", "desc") {
		return mcpRefuseValue("order", a.Order, []string{"asc", "desc"})
	}
	groupsAllowed := []string{"state", "image", "host", "linked"}
	if a.GroupBy != "" && !mcpOneOf(a.GroupBy, groupsAllowed...) {
		return mcpRefuseValue("group_by", a.GroupBy, groupsAllowed)
	}
	limit := mcpContainerListDefault
	if a.Limit != nil {
		if *a.Limit == 0 && a.GroupBy != "" {
			limit = 0
		} else {
			limit = clampLimit(*a.Limit, mcpContainerListDefault, mcpContainerListMax)
		}
	}

	list, why := h.mcpContainerRows(r)
	if why != "" {
		// Not an error: "Docker is not here" is an answer the model can pass on.
		return map[string]any{
			"available": false, "total": 0, "returned": 0, "truncated": false,
			"containers": []any{}, "summary": map[string]any{"total": 0, "linked": 0, "unlinked": 0},
			"notes": []string{why + " The counts are unknown, not zero."},
		}
	}
	idx := h.mcpLinkContainers(list, h.store.GetAllBookmarks())
	settings := h.store.GetSettings()
	host := h.discoveryHost(settings)
	now := time.Now()
	image := strings.ToLower(strings.TrimSpace(a.Image))

	var matched []dockerViewContainer
	for _, c := range list {
		if a.State != "" && strings.ToLower(c.State) != a.State {
			continue
		}
		if image != "" && !strings.Contains(strings.ToLower(c.Image), image) {
			continue
		}
		if a.UpdateAvailable != nil && (c.Update != nil && c.Update.Status == "available") != *a.UpdateAvailable {
			continue
		}
		if a.Linked != nil {
			if _, linked := idx.byContainer[c.Name]; linked != *a.Linked {
				continue
			}
		}
		cpu, mem, ok := mcpContainerUsage(c)
		if a.MinCPU != nil && (!ok || cpu < *a.MinCPU) {
			continue
		}
		if a.MinMemPercent != nil && (!ok || mem < *a.MinMemPercent) {
			continue
		}
		matched = append(matched, c)
	}

	out := map[string]any{"available": true, "total": len(matched), "summary": mcpContainerSummary(idx)}
	notes := []string{}
	if (a.MinCPU != nil || a.MinMemPercent != nil || a.Sort == "cpu" || a.Sort == "memory") && !settings.DockerStatsHistory {
		notes = append(notes, "Resource history is off under Config → Containers, so there are no CPU or memory readings.")
	}
	if a.GroupBy != "" {
		counts := map[string]int{}
		var keys []string
		for _, c := range matched {
			var key string
			switch a.GroupBy {
			case "state":
				key = c.State
			case "image":
				key, _ = splitImageTag(c.Image)
			case "host":
				key = mcpContainerHost(c, host)
			case "linked":
				_, linked := idx.byContainer[c.Name]
				key = strconv.FormatBool(linked)
			}
			if counts[key] == 0 {
				keys = append(keys, key)
			}
			counts[key]++
		}
		sort.SliceStable(keys, func(i, j int) bool {
			if counts[keys[i]] != counts[keys[j]] {
				return counts[keys[i]] > counts[keys[j]]
			}
			return keys[i] < keys[j]
		})
		groups := make([]map[string]any, 0, len(keys))
		for _, k := range keys {
			groups = append(groups, map[string]any{"key": k, "count": counts[k]})
		}
		out["groups"] = groups
	}
	if a.Sort != "" {
		desc := a.Sort != "name"
		if a.Order != "" {
			desc = a.Order == "desc"
		}
		value := func(c dockerViewContainer) (float64, bool) {
			switch a.Sort {
			case "cpu":
				cpu, _, ok := mcpContainerUsage(c)
				return cpu, ok
			case "memory":
				if c.Usage == nil {
					return 0, false
				}
				return float64(c.Usage.Mem), true
			case "uptime":
				// Running longest first: an earlier start is a longer uptime.
				return float64(now.Unix() - c.StartedAt), c.StartedAt > 0
			case "restarts":
				return float64(c.Restarts), true
			}
			return 0, true
		}
		sort.SliceStable(matched, func(i, j int) bool {
			if a.Sort == "name" {
				if desc {
					return matched[i].Name > matched[j].Name
				}
				return matched[i].Name < matched[j].Name
			}
			vi, oki := value(matched[i])
			vj, okj := value(matched[j])
			if oki != okj {
				return oki
			}
			if vi == vj {
				return matched[i].Name < matched[j].Name
			}
			if desc {
				return vi > vj
			}
			return vi < vj
		})
	}
	rows := []map[string]any{}
	for _, c := range matched {
		if len(rows) >= limit {
			break
		}
		rows = append(rows, h.mcpContainerRow(c, idx, host, now))
	}
	out["containers"] = rows
	out["returned"] = len(rows)
	out["truncated"] = len(matched) > len(rows)
	out["notes"] = notes
	return out
}
