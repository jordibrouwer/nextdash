package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

/*
The funnel tools on one realistic page: two answering links, one down with an
error that repeats a key, one never checked with a note, one monitored with an
expectation and a credential, and a duplicated pair. The containers match four
of them, one through each step of matchContainerBookmark.
*/

const (
	funnelErrSentinel    = "LEAKED-ERR-7731"
	funnelExpectSentinel = "EXPECT-BODY-7731"
)

func turnOnGroups(t *testing.T, h *Handlers, health, containers bool) {
	t.Helper()
	s := h.store.GetSettings()
	s.MCPHealthInbox = health
	s.MCPContainersRead = containers
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
}

func seedFunnelInstall(t *testing.T, h *Handlers) int {
	t.Helper()
	page := h.store.GetPages()[0].ID
	now := time.Now()
	day := 24 * time.Hour
	ago := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	if err := h.store.SaveCategoriesByPage(page, []Category{{ID: "media", Name: "Media"}, {ID: "tools", Name: "Tools"}}); err != nil {
		t.Fatal(err)
	}
	err := h.store.SaveBookmarksByPage(page, []Bookmark{
		{Name: "Sonarr", URL: "http://localhost:8989/", Category: "media", CheckStatus: true, LastChecked: ago(time.Hour),
			OpenCount: 10, LastOpened: ago(2 * day), Tags: []string{"media", "arr"}, PreviewTitle: "Sonarr", CreatedAt: ago(100 * day)},
		{Name: "Radarr", URL: "https://radarr.home.lan/", Category: "media", CheckStatus: true, LastChecked: ago(time.Hour),
			LastError: "connection refused at https://radarr.home.lan/?apikey=" + funnelErrSentinel, BrokenSince: ago(3 * time.Hour),
			OpenCount: 3, LastOpened: ago(200 * day), Tags: []string{"media", "arr"}, PreviewTitle: "Radarr", CreatedAt: ago(300 * day)},
		{Name: "Plex", URL: "https://media.example/web", Category: "media", Note: "watch later", Tags: []string{"media"}, CreatedAt: ago(10 * day)},
		{Name: "App", URL: "https://app.example/?token=TOKEN-IN-URL", Category: "tools", Monitor: true, MonitorIntervalMinutes: 5,
			LastChecked: ago(time.Minute), PreviewTitle: "App", ExpectText: funnelExpectSentinel, CredentialID: "cred-7731",
			OpenCount: 1, LastOpened: ago(day), CreatedAt: ago(5 * day)},
		{Name: "Dup A", URL: "https://dup.example/", Category: "tools", PreviewTitle: "Dup", OpenCount: 1, LastOpened: ago(day), CreatedAt: ago(50 * day)},
		{Name: "Dup B", URL: "https://dup.example/", Category: "tools", PreviewTitle: "Dup", OpenCount: 1, LastOpened: ago(day), CreatedAt: ago(50 * day)},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Nine of ten checks up at 100 ms over the last day: 90% and 100 ms.
	var samples []HealthSample
	for i := 0; i < 10; i++ {
		samples = append(samples, HealthSample{T: ago(time.Duration(10-i) * time.Hour), Up: i != 4, PingMs: 100})
	}
	samples[4].PingMs = 0
	if err := writeHealthHistoryFile(HealthHistoryFile{Samples: map[string][]HealthSample{
		canonicalBookmarkURLKey("https://app.example/?token=TOKEN-IN-URL"): samples,
	}}); err != nil {
		t.Fatal(err)
	}
	if err := writeHealthTrendFile(HealthTrendFile{Points: []HealthTrendPoint{
		{T: dayStart(now.Add(-40 * day)), Total: 4, Healthy: 3, Score: 70},
		{T: dayStart(now.Add(-day)), Total: 6, Healthy: 5, Broken: 1, Score: 80},
	}}); err != nil {
		t.Fatal(err)
	}
	return page
}

// funnelDocker starts the fake daemon with one container per matching step
// and one that matches nothing, and links "app-server" by hand.
func funnelDocker(t *testing.T, h *Handlers, page int) {
	t.Helper()
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "lscr.io/sonarr:4", State: "running", Status: "Up 2 hours",
		Ports: []map[string]any{{"PrivatePort": 8989, "PublicPort": 8989, "Type": "tcp"}}})
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "radarr", Image: "lscr.io/radarr:5", State: "running", Status: "Up 3 days"})
	f.add(fakeContainer{ID: strings.Repeat("c", 64), Name: "plex", Image: "plexinc/pms:latest", State: "exited", Status: "Exited (0) 1 hour ago"})
	f.add(fakeContainer{ID: strings.Repeat("d", 64), Name: "app-server", Image: "app:1", State: "running", Status: "Up 5 minutes"})
	f.add(fakeContainer{ID: strings.Repeat("e", 64), Name: "lonely", Image: "busybox:1", State: "exited", Status: "Exited (1) 2 days ago"})
	h.wireDockerSettings()
	t.Cleanup(func() { dockerSettingsFrom.Store(nil) })
	s := h.store.GetSettings()
	s.DockerBookmarkLinks = map[string]string{"app-server": strconv.Itoa(page) + "::https://app.example/?token=TOKEN-IN-URL"}
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
}

func asList(v any) []map[string]any {
	raw, _ := v.([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		m, _ := item.(map[string]any)
		out = append(out, m)
	}
	return out
}

func names(rows []map[string]any) []string {
	out := []string{}
	for _, r := range rows {
		out = append(out, r["name"].(string))
	}
	return out
}

func numberAt(t *testing.T, m map[string]any, key string) int {
	t.Helper()
	v, ok := m[key].(float64)
	if !ok {
		t.Fatalf("%s is %v (%T) in %v", key, m[key], m[key], m)
	}
	return int(v)
}

func groupCounts(v any) map[string]int {
	out := map[string]int{}
	for _, g := range asList(v) {
		out[g["key"].(string)] = int(g["count"].(float64))
	}
	return out
}

func TestQueryBookmarksFiltersWithExactTotals(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnGroups(t, h, true, false)
	seedFunnelInstall(t, h)

	cases := []struct {
		args  string
		total int
		names string
	}{
		{`{}`, 6, ""},
		{`{"status":"broken"}`, 1, "Radarr"},
		{`{"status":"ok"}`, 2, "Sonarr,App"},
		{`{"status":"unknown"}`, 3, "Plex,Dup A,Dup B"},
		{`{"flag":"duplicate"}`, 2, "Dup A,Dup B"},
		{`{"flag":"unused"}`, 1, "Plex"},
		{`{"max_score":50}`, 1, "Radarr"},
		{`{"min_score":90,"max_score":99}`, 1, "Plex"},
		{`{"query":"arr"}`, 2, "Sonarr,Radarr"},
		{`{"category":"Tools"}`, 3, "App,Dup A,Dup B"},
		{`{"tag":"ARR"}`, 2, "Sonarr,Radarr"},
		{`{"monitored":true}`, 1, "App"},
		{`{"has_note":true}`, 1, "Plex"},
		{`{"opened_min":3}`, 2, "Sonarr,Radarr"},
		{`{"opened_max":0}`, 1, "Plex"},
		{`{"unused_days":30}`, 1, "Radarr"},
		{`{"added_since":"30d"}`, 2, "Plex,App"},
		{`{"page":"` + h.store.GetPages()[0].Name + `","category":"media"}`, 3, "Sonarr,Radarr,Plex"},
	}
	for _, c := range cases {
		got := toolCall(t, h, "query_bookmarks", c.args)
		if got["error"] != nil {
			t.Fatalf("%s: %v", c.args, got["error"])
		}
		if numberAt(t, got, "total") != c.total {
			t.Errorf("%s: total %v, want %d (%v)", c.args, got["total"], c.total, names(asList(got["bookmarks"])))
		}
		if c.names != "" && strings.Join(names(asList(got["bookmarks"])), ",") != c.names {
			t.Errorf("%s: %v, want %s", c.args, names(asList(got["bookmarks"])), c.names)
		}
	}

	// Cut off: the total is still the whole set, and says so.
	got := toolCall(t, h, "query_bookmarks", `{"limit":2}`)
	if numberAt(t, got, "total") != 6 || numberAt(t, got, "returned") != 2 || got["truncated"] != true || len(asList(got["bookmarks"])) != 2 {
		t.Errorf("truncated answer = %v", got)
	}

	for _, bad := range []string{`{"status":"down"}`, `{"flag":"nope"}`, `{"sort":"size"}`, `{"group_by":"colour"}`, `{"added_since":"yesterday"}`} {
		if msg, _ := toolCall(t, h, "query_bookmarks", bad)["error"].(string); msg == "" {
			t.Errorf("%s was not refused", bad)
		}
	}
}

func TestQueryBookmarksSortsAndGroups(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnGroups(t, h, true, false)
	seedFunnelInstall(t, h)

	lowest := toolCall(t, h, "query_bookmarks", `{"sort":"score","limit":3}`)
	if strings.Join(names(asList(lowest["bookmarks"])), ",") != "Radarr,Dup A,Dup B" {
		t.Errorf("lowest score first = %v", names(asList(lowest["bookmarks"])))
	}
	first := asList(lowest["bookmarks"])[0]
	health, _ := first["health"].(map[string]any)
	if health["score"] != float64(40) || health["status"] != "broken" || health["condition"] != "broken" {
		t.Errorf("radarr health = %v", health)
	}
	if rs, _ := health["reasons"].([]any); len(rs) == 0 || rs[0] != "Unreachable" {
		t.Errorf("reasons = %v", health["reasons"])
	}
	opens := toolCall(t, h, "query_bookmarks", `{"sort":"opens","limit":2}`)
	if strings.Join(names(asList(opens["bookmarks"])), ",") != "Sonarr,Radarr" {
		t.Errorf("most opened = %v", names(asList(opens["bookmarks"])))
	}
	added := toolCall(t, h, "query_bookmarks", `{"sort":"added","order":"asc","limit":1}`)
	if names(asList(added["bookmarks"]))[0] != "Radarr" {
		t.Errorf("oldest = %v", names(asList(added["bookmarks"])))
	}

	// Groups count the whole set; limit 0 lists nothing.
	flags := toolCall(t, h, "query_bookmarks", `{"group_by":"flag","limit":0}`)
	if len(asList(flags["bookmarks"])) != 0 || flags["returned"] != float64(0) {
		t.Errorf("limit 0 listed %v", flags["bookmarks"])
	}
	report := h.loadBookmarkHealthReport(false)
	counts := groupCounts(flags["groups"])
	for flag, want := range map[string]int{
		"healthy": report.Summary.HealthyCount, "duplicate": report.Summary.DuplicateCount,
		"unused": report.Summary.UnusedCount, "missing-preview": report.Summary.MissingPreviewCount, "broken": report.Summary.BrokenCount,
	} {
		if counts[flag] != want {
			t.Errorf("group %s = %d, the report says %d (%v)", flag, counts[flag], want, counts)
		}
	}
	if counts["healthy"] != 5 {
		t.Errorf("healthy = %d", counts["healthy"])
	}
	byCategory := groupCounts(toolCall(t, h, "query_bookmarks", `{"group_by":"category","limit":0}`)["groups"])
	pageName := h.store.GetPages()[0].Name
	if byCategory[pageName+" / Media"] != 3 || byCategory[pageName+" / Tools"] != 3 {
		t.Errorf("per category = %v", byCategory)
	}
	status := toolCall(t, h, "query_bookmarks", `{"group_by":"status","limit":0}`)
	for _, g := range asList(status["groups"]) {
		if g["key"] == "broken" && g["avg_score"] != float64(40) {
			t.Errorf("broken avg = %v", g)
		}
	}
	if c := groupCounts(status["groups"]); c["ok"] != 2 || c["broken"] != 1 || c["unknown"] != 3 {
		t.Errorf("per status = %v", c)
	}
	// A page of 2 still groups all 6.
	paged := toolCall(t, h, "query_bookmarks", `{"group_by":"status","limit":2}`)
	if c := groupCounts(paged["groups"]); c["ok"]+c["broken"]+c["unknown"] != 6 || len(asList(paged["bookmarks"])) != 2 {
		t.Errorf("paged groups = %v", paged)
	}
}

func TestQueryBookmarksMonitoringAndUsage(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnGroups(t, h, true, false)
	seedFunnelInstall(t, h)
	got := toolCall(t, h, "query_bookmarks", `{"monitored":true}`)
	app := asList(got["bookmarks"])[0]
	mon, _ := app["monitoring"].(map[string]any)
	if mon["monitored"] != true || mon["interval_minutes"] != float64(5) || mon["uptime_percent"] != float64(90) || mon["avg_response_ms"] != float64(100) {
		t.Errorf("monitoring = %v", mon)
	}
	usage, _ := app["usage"].(map[string]any)
	if usage["opens"] != float64(1) || usage["last_opened"] == "" || usage["added"] == "" {
		t.Errorf("usage = %v", usage)
	}
	if app["container"] != nil {
		t.Errorf("container without the containers group: %v", app["container"])
	}
	if notes := mustJSON(t, got["notes"]); !strings.Contains(notes, "Containers: read") {
		t.Errorf("no note about the switch: %s", notes)
	}
}

func TestFunnelAnswersCarryNoCheckSecrets(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnGroups(t, h, true, false)
	seedFunnelInstall(t, h)
	for _, call := range [][2]string{
		{"query_bookmarks", `{"limit":100}`},
		{"query_bookmarks", `{"status":"broken"}`},
		{"list_health_issues", `{"max_score":100,"limit":100}`},
		{"get_stats", `{}`},
		{"get_health_summary", `{}`},
	} {
		raw := rawToolText(t, h, call[0], call[1])
		for _, banned := range []string{funnelErrSentinel, "connection refused", funnelExpectSentinel, "cred-7731", "credentialId", "lastError", "expectText"} {
			if strings.Contains(raw, banned) {
				t.Errorf("%s %s carries %q", call[0], call[1], banned)
			}
		}
	}
	// get_bookmark's new blocks add none of it either (its own lastError
	// field predates them and is left as it was).
	got := toolCall(t, h, "get_bookmark", `{"url":"https://radarr.home.lan/"}`)
	blocks, _ := json.Marshal(map[string]any{"health": got["health"], "monitoring": got["monitoring"], "usage": got["usage"]})
	if strings.Contains(string(blocks), funnelErrSentinel) || strings.Contains(string(blocks), "connection refused") {
		t.Errorf("get_bookmark blocks carry the error: %s", blocks)
	}
}

func TestListHealthIssuesFiltersAndSorts(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnGroups(t, h, true, false)
	seedFunnelInstall(t, h)
	plain := toolCall(t, h, "list_health_issues", `{}`)
	issues := asList(plain["issues"])
	if len(issues) != 1 || issues[0]["name"] != "Radarr" || issues[0]["score"] != float64(40) || plain["total"] != float64(1) {
		t.Fatalf("plain = %v", plain)
	}
	if flags, _ := issues[0]["flags"].([]any); len(flags) == 0 || flags[0] != "broken" {
		t.Errorf("flags = %v", issues[0]["flags"])
	}
	dups := toolCall(t, h, "list_health_issues", `{"flag":"duplicate"}`)
	if strings.Join(names(asList(dups["issues"])), ",") != "Dup A,Dup B" || dups["total"] != float64(2) {
		t.Errorf("duplicates = %v", dups)
	}
	worst := toolCall(t, h, "list_health_issues", `{"max_score":95,"sort":"score","limit":2}`)
	if strings.Join(names(asList(worst["issues"])), ",") != "Radarr,Dup A" || worst["total"] != float64(4) || worst["truncated"] != true {
		t.Errorf("worst = %v", worst)
	}
	if down := toolCall(t, h, "list_health_issues", `{"status":"certificate_due"}`); down["total"] != float64(0) {
		t.Errorf("certificate_due = %v", down)
	}
	if msg, _ := toolCall(t, h, "list_health_issues", `{"status":"broken"}`)["error"].(string); msg == "" {
		t.Error("an unknown status was not refused")
	}
}

func TestGetStatsMatchesTheReport(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnGroups(t, h, true, false)
	seedFunnelInstall(t, h)
	stats := toolCall(t, h, "get_stats", `{}`)
	report := h.loadBookmarkHealthReport(false)
	s := report.Summary

	bookmarks, _ := stats["bookmarks"].(map[string]any)
	if numberAt(t, bookmarks, "total") != s.TotalBookmarks || s.TotalBookmarks != 6 {
		t.Errorf("total = %v, report %d", bookmarks["total"], s.TotalBookmarks)
	}
	perPage := asList(bookmarks["per_page"])
	if len(perPage) == 0 || perPage[0]["count"] != float64(6) {
		t.Errorf("per page = %v", perPage)
	}
	tags := asList(bookmarks["per_tag_top"])
	if len(tags) == 0 || tags[0]["tag"] != "media" || tags[0]["count"] != float64(3) {
		t.Errorf("tags = %v", tags)
	}

	health, _ := stats["health"].(map[string]any)
	summary := toolCall(t, h, "get_health_summary", `{}`)
	checks := map[string]int{
		"healthy": s.HealthyCount, "duplicates": s.DuplicateCount, "unused": s.UnusedCount,
		"avg_score": averageHealthScore(report.Issues), "certificates_due": len(report.Certificates),
		"broken": numberAt(t, summary, "down"), "checked": numberAt(t, summary, "checked"),
		"ok": 2, "unknown": 3,
	}
	for key, want := range checks {
		if numberAt(t, health, key) != want {
			t.Errorf("health.%s = %v, want %d", key, health[key], want)
		}
	}
	if summary["avg_score"] != health["avg_score"] || mustJSON(t, summary["score_buckets"]) != mustJSON(t, health["score_buckets"]) {
		t.Errorf("summary %v and stats %v disagree on the score", summary, health)
	}
	buckets := 0
	for _, b := range asList(health["score_buckets"]) {
		buckets += int(b["count"].(float64))
	}
	if buckets != 6 {
		t.Errorf("buckets add to %d", buckets)
	}
	flags, _ := health["flags"].(map[string]any)
	if flags["duplicate"] != float64(s.DuplicateCount) || flags["missing-preview"] != float64(s.MissingPreviewCount) {
		t.Errorf("flags = %v", flags)
	}
	// The same figure query_bookmarks would give for the same question.
	if q := toolCall(t, h, "query_bookmarks", `{"status":"broken","limit":0}`); q["total"] != health["broken"] {
		t.Errorf("query %v, stats %v", q["total"], health["broken"])
	}

	mon, _ := stats["monitoring"].(map[string]any)
	if numberAt(t, mon, "monitored") != s.MonitoredCount || mon["up"] != float64(1) || mon["down"] != float64(0) || mon["avg_uptime_percent"] != float64(90) {
		t.Errorf("monitoring = %v", mon)
	}
	usage, _ := stats["usage"].(map[string]any)
	if usage["total_opens"] != float64(16) || usage["opened_last_30_days"] != float64(4) || usage["never_opened"] != float64(s.UnusedCount) {
		t.Errorf("usage = %v", usage)
	}

	trend := asList(stats["trend"])
	dates := map[string]bool{}
	for _, p := range trend {
		dates[p["date"].(string)] = true
	}
	yesterday := time.Now().Add(-24 * time.Hour).UTC().Format("2006-01-02")
	old := time.Now().Add(-40 * 24 * time.Hour).UTC().Format("2006-01-02")
	if !dates[yesterday] || dates[old] {
		t.Errorf("30-day trend = %v", dates)
	}
	long := asList(toolCall(t, h, "get_stats", `{"trend_days":60}`)["trend"])
	if len(long) != len(trend)+1 {
		t.Errorf("60 days = %d points, 30 days = %d", len(long), len(trend))
	}
	if _, ok := stats["containers"]; ok {
		t.Error("containers reported with the containers group off")
	}
}

func TestContainerLinksThroughEachStep(t *testing.T) {
	h := newMCPHandlers(t)
	page := seedFunnelInstall(t, h)
	funnelDocker(t, h, page)
	turnOnGroups(t, h, true, true)

	linked := toolCall(t, h, "query_bookmarks", `{"linked_container":true,"limit":100}`)
	if linked["total"] != float64(4) {
		t.Fatalf("linked = %v", linked)
	}
	via := map[string]string{}
	for _, row := range asList(linked["bookmarks"]) {
		c, _ := row["container"].(map[string]any)
		via[row["name"].(string)] = c["name"].(string) + ":" + c["via"].(string)
	}
	want := map[string]string{"Sonarr": "sonarr:port", "Radarr": "radarr:subdomain", "Plex": "plex:title", "App": "app-server:manual"}
	for name, w := range want {
		if via[name] != w {
			t.Errorf("%s linked %q, want %q", name, via[name], w)
		}
	}
	if unlinked := toolCall(t, h, "query_bookmarks", `{"linked_container":false}`); unlinked["total"] != float64(2) {
		t.Errorf("unlinked = %v", unlinked)
	}
	if g := groupCounts(toolCall(t, h, "query_bookmarks", `{"group_by":"linked_container","limit":0}`)["groups"]); g["true"] != 4 || g["false"] != 2 {
		t.Errorf("groups = %v", g)
	}

	q := toolCall(t, h, "query_containers", `{"linked":false}`)
	if q["total"] != float64(1) || names(asList(q["containers"]))[0] != "lonely" {
		t.Errorf("unlinked containers = %v", q)
	}
	if mustJSON(t, q["summary"]) != `{"linked":4,"total":5,"unlinked":1}` {
		t.Errorf("summary = %v", q["summary"])
	}
	states := groupCounts(toolCall(t, h, "query_containers", `{"group_by":"state","limit":0}`)["groups"])
	if states["running"] != 3 || states["exited"] != 2 {
		t.Errorf("states = %v", states)
	}
	running := toolCall(t, h, "query_containers", `{"state":"running","sort":"name","limit":1}`)
	if running["total"] != float64(3) || running["truncated"] != true || names(asList(running["containers"]))[0] != "app-server" {
		t.Errorf("running = %v", running)
	}
	row := asList(running["containers"])[0]
	bm, _ := row["bookmark"].(map[string]any)
	if bm["name"] != "App" || bm["via"] != "manual" || bm["page"] == "" {
		t.Errorf("app-server bookmark = %v", bm)
	}
	if img := toolCall(t, h, "query_containers", `{"image":"LSCR.IO"}`); img["total"] != float64(2) {
		t.Errorf("image filter = %v", img)
	}
	byUptime := toolCall(t, h, "query_containers", `{"sort":"uptime","limit":1}`)
	if names(asList(byUptime["containers"]))[0] != "radarr" {
		t.Errorf("longest up = %v", names(asList(byUptime["containers"])))
	}

	list := toolCall(t, h, "list_containers", `{}`)
	if mustJSON(t, list["summary"]) != `{"linked":4,"total":5,"unlinked":1}` {
		t.Errorf("list summary = %v", list["summary"])
	}
	for _, c := range asList(list["containers"]) {
		if c["name"] == "radarr" && c["via"] != "subdomain" {
			t.Errorf("radarr row = %v", c)
		}
		if c["name"] == "lonely" && (c["via"] != nil || c["bookmark"] != nil) {
			t.Errorf("lonely row = %v", c)
		}
	}
	detail := toolCall(t, h, "get_container", `{"container":"plex"}`)
	if detail["via"] != "title" {
		t.Errorf("plex detail via = %v", detail["via"])
	}

	stats := toolCall(t, h, "get_stats", `{}`)
	containers, _ := stats["containers"].(map[string]any)
	if mustJSON(t, containers) != `{"linked_to_bookmark":4,"running":3,"stopped":2,"total":5,"with_updates":0}` {
		t.Errorf("stats containers = %v", containers)
	}
	got := toolCall(t, h, "get_bookmark", `{"url":"http://localhost:8989/"}`)
	if c, _ := got["container"].(map[string]any); c["name"] != "sonarr" || c["via"] != "port" {
		t.Errorf("get_bookmark container = %v", got["container"])
	}
}

func TestNoDockerGivesNotesNotErrors(t *testing.T) {
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	h := newMCPHandlers(t)
	seedFunnelInstall(t, h)
	turnOnGroups(t, h, true, true)

	q := toolCall(t, h, "query_bookmarks", `{"linked_container":true}`)
	if q["error"] != nil || q["unknown"] != true || !strings.Contains(mustJSON(t, q["notes"]), "Docker") {
		t.Errorf("query_bookmarks = %v", q)
	}
	all := toolCall(t, h, "query_bookmarks", `{}`)
	if all["error"] != nil || all["total"] != float64(6) {
		t.Errorf("plain query = %v", all)
	}
	stats := toolCall(t, h, "get_stats", `{}`)
	if _, ok := stats["containers"]; ok || stats["error"] != nil || !strings.Contains(mustJSON(t, stats["notes"]), "Docker") {
		t.Errorf("get_stats = %v", stats)
	}
	qc := toolCall(t, h, "query_containers", `{}`)
	if qc["error"] != nil || qc["available"] != false || qc["total"] != float64(0) || !strings.Contains(mustJSON(t, qc["notes"]), "not zero") {
		t.Errorf("query_containers = %v", qc)
	}
	bm := toolCall(t, h, "get_bookmark", `{"url":"http://localhost:8989/"}`)
	if bm["error"] != nil || bm["container"] != nil || bm["notes"] == nil {
		t.Errorf("get_bookmark: error %v, container %v, notes %v", bm["error"], bm["container"], bm["notes"])
	}
	s := h.store.GetSettings()
	s.DockerViewEnabled = false
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if qc := toolCall(t, h, "query_containers", `{}`); qc["error"] != nil || !strings.Contains(mustJSON(t, qc["notes"]), "switched off") {
		t.Errorf("view off = %v", qc)
	}
}

func TestFunnelToolsAndFieldsFollowTheirGroups(t *testing.T) {
	h := newMCPHandlers(t)
	seedFunnelInstall(t, h)
	listed := func() map[string]bool {
		out := map[string]bool{}
		for _, n := range listedToolNames(t, h) {
			out[n] = true
		}
		return out
	}
	refused := func(name string) bool {
		_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+name+`","arguments":{}}}`)
		return resp.Error != nil && resp.Error.Message == "Unknown tool: "+name
	}
	seen := listed()
	for _, name := range []string{"query_bookmarks", "get_stats", "query_containers"} {
		if seen[name] || !refused(name) {
			t.Errorf("%s is available with every group off", name)
		}
	}
	got := toolCall(t, h, "get_bookmark", `{"url":"https://radarr.home.lan/"}`)
	for _, key := range []string{"health", "monitoring", "container"} {
		if _, ok := got[key]; ok {
			t.Errorf("get_bookmark carries %s with its group off", key)
		}
	}
	if _, ok := got["usage"]; !ok {
		t.Error("usage missing")
	}

	turnOnGroups(t, h, true, false)
	seen = listed()
	if !seen["query_bookmarks"] || !seen["get_stats"] || seen["query_containers"] || !refused("query_containers") {
		t.Errorf("with health on: %v", seen)
	}
	got = toolCall(t, h, "get_bookmark", `{"url":"https://radarr.home.lan/"}`)
	if _, ok := got["health"]; !ok {
		t.Error("health missing with its group on")
	}
	if _, ok := got["container"]; ok {
		t.Error("container present with its group off")
	}

	turnOnGroups(t, h, false, true)
	seen = listed()
	if seen["query_bookmarks"] || !seen["query_containers"] {
		t.Errorf("with containers on: %v", seen)
	}
	for _, name := range []string{"query_bookmarks", "get_stats", "query_containers"} {
		if mcpToolIsWrite(mcpFindDefinition(name)) {
			t.Errorf("%s is not marked read only", name)
		}
	}
	offered := map[string]bool{}
	for _, spec := range aiOfferedTools(h.store.GetSettings()) {
		offered[spec.Name] = true
	}
	if !offered["query_containers"] || offered["query_bookmarks"] {
		t.Errorf("assistant offered %v", offered)
	}
}

func mcpFindDefinition(name string) map[string]any {
	for _, def := range mcpAllToolDefinitions() {
		if def["name"] == name {
			return def
		}
	}
	return nil
}

func TestFunnelLimitsAreClamped(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnGroups(t, h, true, false)
	page := h.store.GetPages()[0].ID
	var list []Bookmark
	for i := 0; i < 130; i++ {
		list = append(list, Bookmark{Name: "B" + strconv.Itoa(i), URL: "https://b" + strconv.Itoa(i) + ".example/"})
	}
	if err := h.store.SaveBookmarksByPage(page, list); err != nil {
		t.Fatal(err)
	}
	for limit, want := range map[string]int{"0": 25, "-1": 25, "7": 7, "100000": 100} {
		got := toolCall(t, h, "query_bookmarks", `{"limit":`+limit+`}`)
		if len(asList(got["bookmarks"])) != want || got["total"] != float64(130) || got["truncated"] != true {
			t.Errorf("limit %s: %d listed, total %v", limit, len(asList(got["bookmarks"])), got["total"])
		}
	}
	groups := toolCall(t, h, "query_bookmarks", `{"group_by":"page","limit":0}`)
	if len(asList(groups["bookmarks"])) != 0 || groupCounts(groups["groups"])[h.store.GetPages()[0].Name] != 130 {
		t.Errorf("groups only = %v", groups["groups"])
	}
}

func TestSystemPromptNamesTheFunnelTools(t *testing.T) {
	h, _, _ := twoPageMCPInstall(t)
	prompt := aiSystemPrompt(time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC), h.store.GetPages())
	for _, want := range []string{"query_bookmarks", "query_containers", "get_stats", "get_settings_overview",
		"never count the returned list", "Config → AI Assistant → What it can see", "Settings overview: read"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the prompt lacks %q", want)
		}
	}
}

// An answer too long for the assistant keeps its counts: the list is
// shortened, not the text cut after "bookmarks" and before "total".
func TestTheAssistantKeepsTheTotalOfALongAnswer(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnGroups(t, h, true, false)
	page := h.store.GetPages()[0].ID
	var list []Bookmark
	for i := 0; i < 130; i++ {
		list = append(list, Bookmark{Name: "Bookmark with a long name " + strconv.Itoa(i), URL: "https://b" + strconv.Itoa(i) + ".example/some/long/path/to/make/rows/larger",
			Tags: []string{"one", "two", "three"}})
	}
	if err := h.store.SaveBookmarksByPage(page, list); err != nil {
		t.Fatal(err)
	}
	r := aiAssistantRequest(httptest.NewRequest(http.MethodPost, "/api/ai/chat", nil))
	text := h.aiRunTool(r, aiToolCall{Name: "query_bookmarks", Arguments: json.RawMessage(`{"limit":100}`)})
	if len(text) > aiToolResultMax || strings.HasSuffix(text, aiCutMarker) {
		t.Fatalf("cut as text: %d bytes", len(text))
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(text), &got); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	rows := asList(got["bookmarks"])
	if got["total"] != float64(130) || got["truncated"] != true || got["returned"] != float64(len(rows)) || len(rows) == 0 || len(rows) >= 100 || got["shortened"] == nil {
		t.Errorf("total %v, returned %v, rows %d, shortened %v", got["total"], got["returned"], len(rows), got["shortened"])
	}
}
