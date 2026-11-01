package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	moreTrashTitleSentinel = "TRASHED-TITLE-5521"
	moreTrashURLSentinel   = "https://trashed.example/?token=TRASH-URL-5521"
	moreSecretSentinel     = "SECRET-5521"
)

func seedInboxAndTrash(t *testing.T, h *Handlers) {
	t.Helper()
	day := int64(24 * time.Hour / time.Millisecond)
	now := time.Now().UnixMilli()
	h.store.RecordInboxEvents([]InboxEvent{
		{Type: inboxEventAdded, Source: "extension", AtMs: now - 40*day},
		{Type: inboxEventAdded, Source: "paste", AtMs: now - 2*day},
		{Type: inboxEventAdded, Source: "paste", AtMs: now - day},
		{Type: inboxEventPromoted, AtMs: now - day, RetentionMs: 3 * 3600 * 1000},
		{Type: inboxEventDeleted, AtMs: now - day, RetentionMs: 1 * 3600 * 1000},
		{Type: inboxEventKept, AtMs: now - day},
	})
	err := h.store.AddTrashedBookmarks([]TrashedBookmark{
		{ID: "a", DeletedAt: now - 3*day, Bookmark: Bookmark{Name: moreTrashTitleSentinel, URL: moreTrashURLSentinel}},
		{ID: "b", DeletedAt: now - day, Bookmark: Bookmark{Name: "x", URL: "https://x.example/"}},
		{ID: "c", DeletedAt: now - 2*day, Kind: TrashKindPage, PageName: moreTrashTitleSentinel, TrashedPage: &TrashedPage{Page: Page{ID: 9, Name: moreTrashTitleSentinel}}},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestGetStatsCarriesInboxAndTrashOnlyWithHealthAndInbox(t *testing.T) {
	h := newMCPHandlers(t)
	seedFunnelInstall(t, h)
	seedInboxAndTrash(t, h)

	turnOnGroups(t, h, true, false)
	stats := toolCall(t, h, "get_stats", `{}`)
	inbox, _ := stats["inbox"].(map[string]any)
	if inbox == nil {
		t.Fatalf("no inbox block: %v", stats)
	}
	if numberAt(t, inbox, "added") != 3 || numberAt(t, inbox, "promoted") != 1 || numberAt(t, inbox, "deleted") != 1 || numberAt(t, inbox, "kept") != 1 {
		t.Errorf("lifetime counters: %v", inbox)
	}
	// Two triaged items after 3 h and 1 h: 2 h on average.
	if numberAt(t, inbox, "avg_retention_seconds") != 7200 || inbox["avg_retention"] != "2h 0m" {
		t.Errorf("retention = %v / %v", inbox["avg_retention"], inbox["avg_retention_seconds"])
	}
	if by, _ := inbox["by_source"].(map[string]any); by["paste"] != float64(2) || by["extension"] != float64(1) {
		t.Errorf("by_source = %v", inbox["by_source"])
	}
	if s, _ := inbox["since"].(string); s == "" {
		t.Errorf("since = %v", inbox["since"])
	}
	// The 40-day-old event is outside the default 30-day window, and trend_days narrows it.
	if got := len(asList(inbox["daily"])); got != 2 {
		t.Errorf("daily rows = %d, want 2: %v", got, inbox["daily"])
	}
	// Two days is yesterday and today: the event two days back drops out.
	two := toolCall(t, h, "get_stats", `{"trend_days":2}`)
	if rows := asList(two["inbox"].(map[string]any)["daily"]); len(rows) != 1 || rows[0]["promoted"] != float64(1) {
		t.Errorf("trend_days 2: %v", rows)
	}
	wide := toolCall(t, h, "get_stats", `{"trend_days":60}`)
	if got := len(asList(wide["inbox"].(map[string]any)["daily"])); got != 3 {
		t.Errorf("60 days: %d rows", got)
	}

	trash, _ := stats["trash"].(map[string]any)
	byKind, _ := trash["by_kind"].(map[string]any)
	if numberAt(t, trash, "items") != 3 || byKind["bookmark"] != float64(2) || byKind["page"] != float64(1) || byKind["category"] != float64(0) {
		t.Errorf("trash = %v", trash)
	}
	oldest, _ := trash["oldest"].(string)
	newest, _ := trash["newest"].(string)
	if oldest == "" || newest == "" || oldest >= newest {
		t.Errorf("oldest %q, newest %q", oldest, newest)
	}
	raw := rawToolText(t, h, "get_stats", `{}`)
	for _, banned := range []string{moreTrashTitleSentinel, "TRASH-URL-5521", "trashed.example"} {
		if strings.Contains(raw, banned) {
			t.Errorf("get_stats carries %q", banned)
		}
	}

	// With the group off the tool is refused altogether, so the blocks cannot leak.
	turnOnGroups(t, h, false, false)
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_stats","arguments":{}}}`)
	if resp.Error == nil {
		t.Error("get_stats answered with Health and Inbox off")
	}
}

func TestGetAppStatusReadsTheCacheAndLeaksNothing(t *testing.T) {
	h := newMCPHandlers(t)
	page := h.store.GetPages()[0].ID
	if err := h.store.SaveBookmarksByPage(page, []Bookmark{{Name: "A", URL: "https://a.example/"}, {Name: "B", URL: "https://b.example/"}}); err != nil {
		t.Fatal(err)
	}
	s := h.store.GetSettings()
	s.UpdateCheckEnabled = true
	s.MonitorNotifyPushoverToken = moreSecretSentinel
	s.MonitorNotifyURL = "https://user:" + moreSecretSentinel + "@hook.example/x"
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DISABLE_UPDATE_CHECK", "")
	h.setUpdateCheckCache(updateCheckCacheEntry{info: upstreamReleaseInfo{Tag: "v999.0.0", ReleaseURL: "https://github.example/rel?t=" + moreSecretSentinel}, fetchedAt: time.Now()})
	if err := writeStatusPage(StatusPageConfig{Enabled: true, Title: "t", Groups: []StatusGroup{{ID: "g", Name: "G", Services: []StatusService{
		{ID: "1", Name: "one", MonitorURL: "https://m.example/?k=" + moreSecretSentinel}, {ID: "2", Name: "two", Container: "c"}}}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureStatusToken(); err != nil {
		t.Fatal(err)
	}
	if err := writeFeedWatchFile(FeedWatchFile{Watches: []FeedWatch{
		{BookmarkKey: "a", FeedURL: "https://a.example/feed?k=" + moreSecretSentinel, CheckedAt: time.Now().UnixMilli()},
		{BookmarkKey: "b", FeedURL: "https://b.example/feed", Failures: 2},
		{BookmarkKey: "c", FeedURL: "https://c.example/feed", Failures: feedMaxFailures},
	}}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "filler.bin"), make([]byte, 4096), 0o600); err != nil {
		t.Fatal(err)
	}

	// Hidden until its switch is on, and then on with Health and Inbox still off.
	if mcpToolGroup("get_app_status") != mcpGroupSettingsOverview {
		t.Fatalf("group = %q", mcpToolGroup("get_app_status"))
	}
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_app_status","arguments":{}}}`)
	if resp.Error == nil || resp.Error.Message != "Unknown tool: get_app_status" {
		t.Errorf("called with its switch off: %+v", resp)
	}
	for _, spec := range aiOfferedTools(h.store.GetSettings()) {
		if spec.Name == "get_app_status" {
			t.Error("offered to the assistant with the switch off")
		}
	}
	turnOnSettingsOverview(t, h, true)
	offered := false
	for _, spec := range aiOfferedTools(h.store.GetSettings()) {
		offered = offered || spec.Name == "get_app_status"
	}
	if !offered || mcpToolIsWrite(mcpFindDefinition("get_app_status")) {
		t.Errorf("offered %v, or not read only", offered)
	}

	got := toolCall(t, h, "get_app_status", `{}`)
	version, _ := got["version"].(map[string]any)
	if version["update_available"] != true || version["latest"] != "v999.0.0" || version["update_check"] != "ok" {
		t.Errorf("version = %v", version)
	}
	counts, _ := got["counts"].(map[string]any)
	if numberAt(t, counts, "bookmarks") != 2 || numberAt(t, counts, "pages") != len(h.store.GetPages()) {
		t.Errorf("counts = %v", counts)
	}
	status, _ := got["status_page"].(map[string]any)
	if status["enabled"] != true || status["monitors"] != float64(2) {
		t.Errorf("status_page = %v", status)
	}
	feeds, _ := got["feeds"].(map[string]any)
	if feeds["enabled"] != true || feeds["followed"] != float64(3) || feeds["failing"] != float64(1) || feeds["given_up"] != float64(1) {
		t.Errorf("feeds = %v", feeds)
	}
	data, _ := got["data"].(map[string]any)
	if numberAt(t, data, "size_bytes") < 4096 || data["size_complete"] != true || data["folder"] != filepath.Base(ResolveDataDir()) {
		t.Errorf("data = %v", data)
	}
	if up, _ := got["uptime"].(map[string]any); numberAt(t, up, "seconds") < 0 || up["human"] == "" {
		t.Errorf("uptime = %v", got["uptime"])
	}

	token := readStatusToken()
	raw := rawToolText(t, h, "get_app_status", `{}`)
	for _, banned := range []string{moreSecretSentinel, "hook.example", "m.example", "a.example", "github.example", ResolveDataDir(), token, "http://", "https://"} {
		if banned != "" && strings.Contains(raw, banned) {
			t.Errorf("get_app_status carries %q", banned)
		}
	}

	// No cached answer, a failed one, and the check switched off.
	h.setUpdateCheckCache(updateCheckCacheEntry{})
	if v := toolCall(t, h, "get_app_status", `{}`)["version"].(map[string]any); v["update_check"] != "not run yet" || v["update_available"] != nil {
		t.Errorf("no cache: %v", v)
	}
	h.setUpdateCheckCache(updateCheckCacheEntry{fetchedAt: time.Now(), err: errors.New("Get \"https://api.github.com/x?t=" + moreSecretSentinel + "\": boom")})
	failed := rawToolText(t, h, "get_app_status", `{}`)
	if strings.Contains(failed, moreSecretSentinel) || strings.Contains(failed, "boom") {
		t.Error("a failed update check leaks its error text")
	}
	s = h.store.GetSettings()
	s.UpdateCheckEnabled = false
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if v := toolCall(t, h, "get_app_status", `{}`)["version"].(map[string]any); v["update_check"] != "off" {
		t.Errorf("switched off: %v", v)
	}
}

func TestDataFolderSizeIsCapped(t *testing.T) {
	newMCPHandlers(t)
	dir := ResolveDataDir()
	for i := 0; i < mcpDataSizeMaxEntries+10; i++ {
		if err := os.WriteFile(filepath.Join(dir, "f"+strings.Repeat("x", i%5)+time.Duration(i).String()), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, complete := mcpDataFolderSize(); complete {
		t.Error("the walk was not cut off")
	}
}

func TestGetBookmarkHistoryFoldsDaysAndStaysSafe(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnGroups(t, h, true, false)
	seedFunnelInstall(t, h)
	appURL := "https://app.example/?token=TOKEN-IN-URL"
	key := canonicalBookmarkURLKey(appURL)
	now := time.Now()
	day := 24 * time.Hour
	old := dayStart(now.Add(-60 * day))
	recent := dayStart(now.Add(-10 * day))
	file := HealthHistoryFile{
		Samples: map[string][]HealthSample{key: {
			{T: now.Add(-2 * time.Hour).UnixMilli(), Up: true, PingMs: 100},
			{T: now.Add(-3 * time.Hour).UnixMilli(), Up: false, Fail: "timeout"},
		}},
		Days: map[string][]HealthDay{key: {{D: old, N: 10, U: 10, P: 50}, {D: recent, N: 4, U: 3, P: 200}}},
	}
	if err := writeHealthHistoryFile(file); err != nil {
		t.Fatal(err)
	}
	args := `{"url":"` + appURL + `"}`
	got := toolCall(t, h, "get_bookmark_history", args)
	rows := asList(got["days"])
	if len(rows) < 2 {
		t.Fatalf("rows = %v", got["days"])
	}
	first := rows[0]
	if first["date"] != time.UnixMilli(recent).UTC().Format("2006-01-02") || first["checks"] != float64(4) || first["ok"] != float64(3) ||
		first["uptime_ratio"] != 0.75 || first["mean_response_ms"] != float64(200) {
		t.Errorf("first day = %v", first)
	}
	for _, row := range rows {
		if row["date"] == time.UnixMilli(old).UTC().Format("2006-01-02") {
			t.Error("a day outside the default 30 is listed")
		}
	}
	wide := asList(toolCall(t, h, "get_bookmark_history", `{"url":"`+appURL+`","days":90}`)["days"])
	if len(wide) != len(rows)+1 {
		t.Errorf("90 days: %d rows, 30 days: %d", len(wide), len(rows))
	}
	if len(asList(toolCall(t, h, "get_bookmark_history", `{"url":"`+appURL+`","days":1000}`)["days"])) != len(wide) {
		t.Error("days is not clamped to 90")
	}
	if usage, _ := got["usage"].(map[string]any); usage["opens"] != float64(1) {
		t.Errorf("usage = %v", got["usage"])
	}
	health, _ := got["health"].(map[string]any)
	if health == nil || health["score"] == nil || health["flags"] == nil {
		t.Errorf("health = %v", got["health"])
	}

	// A bookmark with an error and no history: an empty list, a note, the label only.
	radarr := toolCall(t, h, "get_bookmark_history", `{"url":"https://radarr.home.lan/"}`)
	if len(asList(radarr["days"])) != 0 || radarr["note"] == nil || radarr["last_failure"] != "Unreachable" {
		t.Errorf("radarr = %v", radarr)
	}
	for _, call := range []string{args, `{"url":"https://radarr.home.lan/"}`} {
		raw := rawToolText(t, h, "get_bookmark_history", call)
		for _, banned := range []string{funnelErrSentinel, "connection refused", "TOKEN-IN-URL", funnelExpectSentinel, "cred-7731", "apikey"} {
			if strings.Contains(raw, banned) {
				t.Errorf("history %s carries %q", call, banned)
			}
		}
	}
	if got := toolCall(t, h, "get_bookmark_history", `{"url":"https://nobody.example/"}`); got["error"] == nil {
		t.Error("an unknown URL did not fail")
	}
	if got := toolCall(t, h, "get_bookmark_history", `{}`); got["error"] == nil {
		t.Error("a missing URL did not fail")
	}
}

func TestGetBookmarkHistoryFollowsHealthAndInbox(t *testing.T) {
	h := newMCPHandlers(t)
	seedFunnelInstall(t, h)
	if mcpToolGroup("get_bookmark_history") != mcpGroupHealthInbox {
		t.Fatalf("group = %q", mcpToolGroup("get_bookmark_history"))
	}
	call := func() *jsonRPCError {
		_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_bookmark_history","arguments":{"url":"https://radarr.home.lan/"}}}`)
		return resp.Error
	}
	if call() == nil {
		t.Error("answered with the group off")
	}
	for _, spec := range aiOfferedTools(h.store.GetSettings()) {
		if spec.Name == "get_bookmark_history" {
			t.Error("offered with the group off")
		}
	}
	turnOnGroups(t, h, true, false)
	if call() != nil {
		t.Error("refused with the group on")
	}
	offered := false
	for _, spec := range aiOfferedTools(h.store.GetSettings()) {
		offered = offered || spec.Name == "get_bookmark_history"
	}
	if !offered || mcpToolIsWrite(mcpFindDefinition("get_bookmark_history")) {
		t.Error("not offered to the assistant, or not read only")
	}
}

func TestFitPayloadShortensTheDaysOfAHistory(t *testing.T) {
	var days []any
	for i := 0; i < 90; i++ {
		days = append(days, map[string]any{"date": "2026-01-01", "checks": 288, "ok": 280, "uptime_ratio": 0.97, "padding": strings.Repeat("x", 40)})
	}
	payload := map[string]any{"name": "N", "days": days, "usage": map[string]any{"opens": 3}, "health": map[string]any{"score": 80}}
	text, ok := aiFitPayload(payload, 1500)
	if !ok {
		t.Fatal("did not fit")
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(text), &got); err != nil {
		t.Fatal(err)
	}
	if len(got["days"].([]any)) >= 90 || got["usage"] == nil || got["health"] == nil || got["shortened"] == nil {
		t.Errorf("fitted = %s", text)
	}
}

func TestSystemPromptNamesTheStatusAndHistoryTools(t *testing.T) {
	prompt := aiSystemPrompt(time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC), nil)
	for _, want := range []string{"get_app_status", "get_bookmark_history", "`inbox`", "`trash`"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the prompt lacks %q", want)
		}
	}
}
