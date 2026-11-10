package app

import (
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
get_settings_overview: how this install is configured, for a model to read.

Built from an explicit allowlist and nothing else. Settings holds the notify
URL, the Pushover token and user key, the Telegram chat id and more, and it
grows a field every few releases; a walk over its fields would hand the next
secret out the day it is added. So every value that leaves is one line in the
table below, read by name, and the test next to this file fails when a line
names a field whose name looks like a secret without being in the short list
of fields that are only ever reduced to a host or a yes/no.

Never here: tokens, keys, passwords, webhook and notify targets, chat ids,
anything in the *-secrets.json files or health-credentials.json, push
subscriptions, the write token. Addresses appear as their host only, and the
container-to-bookmark links as the bookmark's name and page, never its URL.
*/

func mcpSettingsOverviewDefinitions() []map[string]any {
	return []map[string]any{{
		"name":        "get_settings_overview",
		"annotations": mcpAnnotations(true, false),
		"description": "How this nextDash install is configured, as a safe read-only subset: health checking and monitoring settings " +
			"(auto recheck, timeouts, retries, which conditions are ignored and how often, whether alerts are configured), the Containers settings " +
			"(view, refresh, hidden containers, alerts, auto update, which containers are linked to which bookmark), the pages and their categories with bookmark counts, " +
			"which features are on, language and theme, and the MCP and assistant switches. " +
			"Use it for \"is health auto recheck on\", \"which containers auto update\" or \"how many categories does my Media page have\". " +
			"Never contains keys, tokens, passwords, webhook or notify addresses; addresses appear as their host only.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
	}}
}

// mcpOverviewInput is what the getters read: the settings and the structure
// around them, loaded once per call.
type mcpOverviewInput struct {
	s          Settings
	now        time.Time
	pages      []Page
	bookmarks  map[int][]Bookmark
	categories map[int][]Category
	statusPage bool
}

type mcpOverviewEntry struct {
	path string
	get  func(in *mcpOverviewInput) any
}

/*
mcpOverviewReducedFields are the Settings fields this file reads although
their JSON name looks like a secret, and how each is reduced before it leaves.
The reflection test holds every field the allowlist reads to this list.
*/
var mcpOverviewReducedFields = map[string]string{
	"AIBaseURL": "host-only",
}

// mcpOverviewDeniedWords are the name fragments that mark a field as secret.
var mcpOverviewDeniedWords = []string{"token", "secret", "password", "key", "webhook", "url", "chatid", "userkey", "credential"}

// mcpHostOnly is an address reduced to its host: no scheme, user, password,
// port, path or query. A template address keeps its [IP] placeholder.
func mcpHostOnly(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, "[IP]") {
		return "[IP]"
	}
	candidate := raw
	if !strings.Contains(candidate, "://") {
		candidate = "http://" + candidate
	}
	u, err := url.Parse(candidate)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

func mcpStringList(list []string) []string {
	out := append([]string{}, list...)
	sort.Strings(out)
	return out
}

func mcpSortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// mcpIgnoredConditions counts the conditions bookmarks are told to ignore
// right now: per condition, and how many bookmarks ignore anything. No names
// or addresses, which belong to query_bookmarks.
func mcpIgnoredConditions(in *mcpOverviewInput) any {
	byFlag := map[string]int{}
	bookmarks := 0
	for _, list := range in.bookmarks {
		for _, bm := range list {
			set := healthIgnoreSet(bm.HealthIgnored, in.now)
			if len(set) > 0 {
				bookmarks++
			}
			for flag := range set {
				byFlag[flag]++
			}
		}
	}
	return map[string]any{"bookmarks": bookmarks, "byCondition": byFlag}
}

// mcpOverviewBookmarkLinks resolves the Containers view's manual links to the
// bookmark's name and page. The stored value is pageId::url, and a URL can
// carry a token in its query, so it never leaves as it is.
func mcpOverviewBookmarkLinks(in *mcpOverviewInput) any {
	out := []map[string]any{}
	links := in.s.DockerBookmarkLinks
	for _, container := range mcpSortedKeys(links) {
		value := links[container]
		row := map[string]any{"container": container}
		if value == "-" {
			row["linked"] = false
			row["note"] = "set never to link"
			out = append(out, row)
			continue
		}
		row["linked"] = false
		row["bookmark"] = nil
		if pageText, rawURL, ok := strings.Cut(value, "::"); ok {
			if pageID, err := strconv.Atoi(pageText); err == nil {
				for _, bm := range in.bookmarks[pageID] {
					if strings.TrimSpace(bm.URL) == rawURL {
						row["linked"] = true
						row["bookmark"] = strings.TrimSpace(bm.Name)
						row["page"] = mcpOverviewPageName(in, pageID)
						break
					}
				}
			}
		}
		out = append(out, row)
	}
	return out
}

func mcpOverviewPageName(in *mcpOverviewInput, id int) string {
	for _, p := range in.pages {
		if p.ID == id {
			return p.Name
		}
	}
	return ""
}

// mcpOverviewWebUIs is each custom web UI address as whether one is set and
// its host.
func mcpOverviewWebUIs(in *mcpOverviewInput) any {
	out := []map[string]any{}
	webUIs := in.s.DockerWebUIs
	for _, container := range mcpSortedKeys(webUIs) {
		value := strings.TrimSpace(webUIs[container])
		out = append(out, map[string]any{"container": container, "set": value != "", "host": mcpHostOnly(value)})
	}
	return out
}

func mcpOverviewPages(in *mcpOverviewInput) any {
	out := []map[string]any{}
	for _, p := range in.pages {
		out = append(out, map[string]any{"id": p.ID, "name": p.Name, "hidden": p.Hidden, "bookmarks": len(in.bookmarks[p.ID])})
	}
	return out
}

func mcpOverviewCategories(in *mcpOverviewInput) any {
	out := []map[string]any{}
	for _, p := range in.pages {
		count := map[string]int{}
		for _, bm := range in.bookmarks[p.ID] {
			count[bm.Category]++
		}
		for _, c := range in.categories[p.ID] {
			out = append(out, map[string]any{"page": p.Name, "id": c.ID, "name": c.Name, "bookmarks": count[c.ID]})
		}
	}
	return out
}

func mcpOverviewMonitorNotify(in *mcpOverviewInput) any {
	_, configured := monitorNotifyTarget(in.s)
	return map[string]any{"configured": configured}
}

// mcpSettingsOverviewAllowlist is every value the overview carries. A path is
// where it lands in the answer; the getter reads it by name.
var mcpSettingsOverviewAllowlist = []mcpOverviewEntry{
	// Health and monitoring.
	{"health.healthAutoRecheckEnabled", func(in *mcpOverviewInput) any { return in.s.HealthAutoRecheckEnabled }},
	{"health.healthAutoRecheckIntervalHours", func(in *mcpOverviewInput) any { return in.s.HealthAutoRecheckIntervalHours }},
	{"health.healthCheckTimeoutSeconds", func(in *mcpOverviewInput) any { return in.s.HealthCheckTimeoutSeconds }},
	{"health.statusOfflineRetries", func(in *mcpOverviewInput) any { return in.s.StatusOfflineRetries }},
	{"health.statusOfflineRetryDelayMs", func(in *mcpOverviewInput) any { return in.s.StatusOfflineRetryDelayMs }},
	{"health.statusRecheckIntervalMinutes", func(in *mcpOverviewInput) any { return in.s.StatusRecheckIntervalMinutes }},
	{"health.monitorEmphasis", func(in *mcpOverviewInput) any { return in.s.MonitorEmphasis }},
	{"health.healthIgnored", mcpIgnoredConditions},
	{"health.monitorNotify", mcpOverviewMonitorNotify},
	{"health.uptimeBadges", func(in *mcpOverviewInput) any { return in.s.UptimeBadges }},
	{"health.netToolsEnabled", func(in *mcpOverviewInput) any { return in.s.NetToolsEnabled }},
	{"health.netToolsPing", func(in *mcpOverviewInput) any { return in.s.NetToolsPing }},
	{"health.netToolsAllowCustomHost", func(in *mcpOverviewInput) any { return in.s.NetToolsAllowCustomHost }},
	{"health.netToolsMaxChecks", func(in *mcpOverviewInput) any { return in.s.NetToolsMaxChecks }},

	// Containers.
	{"containers.dockerViewEnabled", func(in *mcpOverviewInput) any { return in.s.DockerViewEnabled }},
	{"containers.dockerRefreshSeconds", func(in *mcpOverviewInput) any { return in.s.DockerRefreshSeconds }},
	{"containers.dockerHiddenContainers", func(in *mcpOverviewInput) any { return mcpStringList(in.s.DockerHiddenContainers) }},
	{"containers.dockerNotify", func(in *mcpOverviewInput) any { return in.s.DockerNotify }},
	{"containers.dockerNotifyMuted", func(in *mcpOverviewInput) any { return mcpStringList(in.s.DockerNotifyMuted) }},
	{"containers.dockerUsageAlerts", func(in *mcpOverviewInput) any { return in.s.DockerUsageAlerts }},
	{"containers.dockerCpuAlertPercent", func(in *mcpOverviewInput) any { return in.s.DockerCPUAlertPercent }},
	{"containers.dockerMemAlertPercent", func(in *mcpOverviewInput) any { return in.s.DockerMemAlertPercent }},
	{"containers.dockerUsageAlertMinutes", func(in *mcpOverviewInput) any { return in.s.DockerUsageAlertMinutes }},
	{"containers.dockerAutoUpdate", func(in *mcpOverviewInput) any { return mcpStringList(in.s.DockerAutoUpdate) }},
	{"containers.dockerAutoUpdateFrom", func(in *mcpOverviewInput) any { return in.s.DockerAutoUpdateFrom }},
	{"containers.dockerAutoUpdateTo", func(in *mcpOverviewInput) any { return in.s.DockerAutoUpdateTo }},
	{"containers.dockerStatsHistory", func(in *mcpOverviewInput) any { return in.s.DockerStatsHistory }},
	{"containers.dockerBookmarkLinks", mcpOverviewBookmarkLinks},
	{"containers.dockerWebUIs", mcpOverviewWebUIs},
	{"containers.dockerHostAddress", func(in *mcpOverviewInput) any {
		host := mcpHostOnly(in.s.DockerHostAddress)
		return map[string]any{"set": host != "", "host": host}
	}},

	// Structure and features.
	{"structure.pages", mcpOverviewPages},
	{"structure.categories", mcpOverviewCategories},
	{"features.dockerView", func(in *mcpOverviewInput) any { return in.s.DockerViewEnabled }},
	{"features.inbox", func(in *mcpOverviewInput) any { return in.s.InboxEnabled }},
	{"features.statusPage", func(in *mcpOverviewInput) any { return in.statusPage }},
	{"features.uptimeBadges", func(in *mcpOverviewInput) any { return in.s.UptimeBadges }},
	{"features.healthAutoRecheck", func(in *mcpOverviewInput) any { return in.s.HealthAutoRecheckEnabled }},
	{"features.analyticsOptIn", func(in *mcpOverviewInput) any { return in.s.AnalyticsOptIn }},
	{"appearance.language", func(in *mcpOverviewInput) any { return in.s.Language }},
	{"appearance.theme", func(in *mcpOverviewInput) any { return in.s.Theme }},

	// MCP and the assistant.
	{"assistant.mcpEnabled", func(in *mcpOverviewInput) any { return in.s.MCPEnabled }},
	{"assistant.mcpBookmarksWrite", func(in *mcpOverviewInput) any { return in.s.MCPBookmarksWrite }},
	{"assistant.mcpHealthInbox", func(in *mcpOverviewInput) any { return in.s.MCPHealthInbox }},
	{"assistant.mcpContainersRead", func(in *mcpOverviewInput) any { return in.s.MCPContainersRead }},
	{"assistant.mcpContainersControl", func(in *mcpOverviewInput) any { return in.s.MCPContainersControl }},
	{"assistant.mcpSettingsOverview", func(in *mcpOverviewInput) any { return in.s.MCPSettingsOverview }},
	{"assistant.mcpNetTools", func(in *mcpOverviewInput) any { return in.s.MCPNetTools }},
	{"assistant.aiEnabled", func(in *mcpOverviewInput) any { return in.s.AIEnabled }},
	{"assistant.aiProvider", func(in *mcpOverviewInput) any { return in.s.AIProvider }},
	{"assistant.aiModel", func(in *mcpOverviewInput) any { return in.s.AIModel }},
	{"assistant.aiHistoryMax", func(in *mcpOverviewInput) any { return in.s.AIHistoryMax }},
	{"assistant.aiHistoryDays", func(in *mcpOverviewInput) any { return in.s.AIHistoryDays }},
	{"assistant.aiBaseURLHost", func(in *mcpOverviewInput) any { return mcpHostOnly(in.s.AIBaseURL) }},
}

func (h *Handlers) mcpOverviewInput() *mcpOverviewInput {
	in := &mcpOverviewInput{
		s: h.store.GetSettings(), now: time.Now(), pages: h.store.GetPages(),
		bookmarks: map[int][]Bookmark{}, categories: map[int][]Category{},
	}
	for _, p := range in.pages {
		in.bookmarks[p.ID] = h.store.GetBookmarksByPage(p.ID)
		in.categories[p.ID] = h.store.GetCategoriesByPage(p.ID)
	}
	if page, err := readStatusPage(); err == nil {
		in.statusPage = page.Enabled
	}
	return in
}

// buildSettingsOverview runs every getter and nests the answers by path.
func buildSettingsOverview(in *mcpOverviewInput) map[string]any {
	out := map[string]any{}
	for _, entry := range mcpSettingsOverviewAllowlist {
		parts := strings.Split(entry.path, ".")
		node := out
		for _, part := range parts[:len(parts)-1] {
			next, ok := node[part].(map[string]any)
			if !ok {
				next = map[string]any{}
				node[part] = next
			}
			node = next
		}
		node[parts[len(parts)-1]] = entry.get(in)
	}
	return out
}

func (h *Handlers) mcpSettingsOverview() map[string]any {
	return buildSettingsOverview(h.mcpOverviewInput())
}
