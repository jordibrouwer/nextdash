package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// netMCPHandlers is an install with the MCP endpoint and the network tools
// switched on, and one page of two bookmarks: A with a tcp and a ping check,
// B with a tcp check on a port of its own.
func netMCPHandlers(t *testing.T, settingsJSON string) (*Handlers, *netRunRecorder) {
	t.Helper()
	if settingsJSON == "" {
		settingsJSON = `{"mcpEnabled":true,"mcpNetTools":true}`
	}
	h, dir := healthRecheckTestHandlers(t, settingsJSON)
	netTestPage(t, dir,
		`{"name":"A","url":"https://a.example:8443","checks":[`+
			`{"id":"`+netTestCheckID(1)+`","type":"tcp","enabled":true,"port":2222,"label":"SSH"},`+
			`{"id":"`+netTestCheckID(2)+`","type":"ping"}]}`,
		`{"name":"B","url":"https://b.example","checks":[{"id":"`+netTestCheckID(3)+`","type":"tcp","port":22}]}`,
	)
	rec := &netRunRecorder{res: NetResult{OK: true, Ms: 4}}
	h.netRunner = rec.run
	h.netToolLimiter = newSlidingWindowLimiter(100, time.Minute)
	h.ssrfAPILimiter = newSlidingWindowLimiter(100, time.Minute)
	return h, rec
}

func mcpNetCall(t *testing.T, h *Handlers, tool, args string, headers ...[2]string) map[string]any {
	t.Helper()
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+tool+`","arguments":`+args+`}}`, headers...)
	if resp.Error != nil {
		t.Fatalf("%s: %s", tool, resp.Error.Message)
	}
	result, _ := resp.Result.(map[string]any)
	payload, _ := result["structuredContent"].(map[string]any)
	if payload == nil {
		t.Fatalf("%s carried no structured result: %v", tool, result)
	}
	if _, refused := payload["error"]; refused != (result["isError"] == true) {
		t.Fatalf("%s: error %v but isError %v", tool, payload["error"], result["isError"])
	}
	return payload
}

func storedNetChecks(h *Handlers, url string) []NetCheck {
	list := h.store.GetBookmarksByPage(1)
	if i := netRowIndex(list, canonicalBookmarkURLKey(url), 0); i >= 0 {
		return list[i].Checks
	}
	return nil
}

var netToolNames = []string{"run_network_test", "list_net_checks", "get_net_check", "set_net_check", "delete_net_check"}

func TestMCPNetToolsGroup(t *testing.T) {
	for _, name := range netToolNames {
		if g := mcpToolGroup(name); g != mcpGroupNetTools {
			t.Errorf("%s is in group %q", name, g)
		}
	}
	h, _ := netMCPHandlers(t, "")
	listed := map[string]bool{}
	for _, name := range listedToolNames(t, h) {
		listed[name] = true
	}
	for _, name := range netToolNames {
		if !listed[name] {
			t.Errorf("%s is not offered with the switch on", name)
		}
	}
	// Only its own switch opens the group.
	s := h.store.GetSettings()
	if !mcpGroupEnabled(s, mcpGroupNetTools) || mcpGroupEnabled(Settings{MCPHealthInbox: true, MCPBookmarksWrite: true}, mcpGroupNetTools) {
		t.Error("the group does not follow mcpNetTools alone")
	}
	if mcpGroupEnabled(Settings{MCPNetTools: true}, mcpGroupHealthInbox) {
		t.Error("the net switch opened another group")
	}
}

func TestMCPNetToolsOffHidesTools(t *testing.T) {
	h, rec := netMCPHandlers(t, `{"mcpEnabled":true}`)
	for _, name := range listedToolNames(t, h) {
		for _, hidden := range netToolNames {
			if name == hidden {
				t.Errorf("%s is listed with the switch off", name)
			}
		}
	}
	before := storedNetChecks(h, "https://a.example:8443")
	for _, name := range netToolNames {
		_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+name+`","arguments":{"url":"https://a.example:8443","type":"tcp","check_id":"`+netTestCheckID(1)+`"}}}`)
		if resp.Error == nil || resp.Error.Message != "Unknown tool: "+name {
			t.Errorf("%s called while off: %+v", name, resp.Error)
		}
	}
	if rec.count() != 0 || len(storedNetChecks(h, "https://a.example:8443")) != len(before) {
		t.Error("a hidden tool ran or changed a check")
	}
}

func TestMCPNetToolAnnotations(t *testing.T) {
	defs := map[string]map[string]any{}
	for _, def := range mcpNetToolsDefinitions() {
		defs[def["name"].(string)] = def
	}
	for _, name := range netToolNames {
		if defs[name] == nil {
			t.Fatalf("%s has no definition", name)
		}
		if _, free := defs[name]["inputSchema"].(map[string]any)["properties"].(map[string]any)["host"]; free {
			t.Errorf("%s takes a host", name)
		}
		// Only the tool that stores a check may carry a port (tcp and tls); a
		// test that runs now never names one.
		if _, free := defs[name]["inputSchema"].(map[string]any)["properties"].(map[string]any)["port"]; free && name != "set_net_check" {
			t.Errorf("%s takes a port", name)
		}
	}
	// It reaches out, so a client can see that; it changes nothing stored.
	ann := defs["run_network_test"]["annotations"].(map[string]any)
	if ann["readOnlyHint"] != true || ann["openWorldHint"] != true || mcpToolIsWrite(defs["run_network_test"]) {
		t.Errorf("run_network_test annotations: %v", ann)
	}
	for _, name := range []string{"list_net_checks", "get_net_check"} {
		if mcpToolIsWrite(defs[name]) || defs[name]["annotations"].(map[string]any)["openWorldHint"] != nil {
			t.Errorf("%s is not a plain read: %v", name, defs[name]["annotations"])
		}
	}
}

func TestMCPSetNetCheckIsWrite(t *testing.T) {
	h, _ := netMCPHandlers(t, "")
	var def map[string]any
	for _, d := range mcpNetToolsDefinitions() {
		if d["name"] == "set_net_check" {
			def = d
		}
	}
	if !mcpToolIsWrite(def) || mcpToolIsDestructive("set_net_check") {
		t.Fatalf("set_net_check: write=%v destructive=%v", mcpToolIsWrite(def), mcpToolIsDestructive("set_net_check"))
	}

	// A new check: its id is the server's, and it is not scheduled unless asked.
	out := mcpNetCall(t, h, "set_net_check", `{"url":"https://b.example","type":"ping","label":"Router","interval_minutes":10}`)
	chk, _ := out["check"].(map[string]any)
	if out["saved"] != true || chk["type"] != "ping" || chk["enabled"] != false || chk["interval_minutes"] != float64(10) {
		t.Fatalf("new check: %v", out)
	}
	if id, _ := chk["check_id"].(string); len(id) != 12 {
		t.Fatalf("id = %q", id)
	}
	if got := storedNetChecks(h, "https://b.example"); len(got) != 2 || got[0].ID != netTestCheckID(3) || got[1].Label != "Router" {
		t.Fatalf("stored = %+v", got)
	}

	// A change keeps the fields it does not name, the stored port included.
	out = mcpNetCall(t, h, "set_net_check", `{"url":"https://a.example:8443","check_id":"`+netTestCheckID(1)+`","muted":true,"max_ms":200}`)
	if out["saved"] != true {
		t.Fatalf("change: %v", out)
	}
	got := storedNetChecks(h, "https://a.example:8443")
	if len(got) != 2 || got[0].Port != 2222 || got[0].Label != "SSH" || !got[0].Enabled || !got[0].Muted || got[0].MaxMs != 200 {
		t.Fatalf("after the change: %+v", got)
	}

	// Refused like the UI refuses them: limits, a changed type, a stray field.
	for name, args := range map[string]string{
		"interval too short": `{"url":"https://b.example","check_id":"` + netTestCheckID(3) + `","interval_minutes":1}`,
		"type change":        `{"url":"https://b.example","check_id":"` + netTestCheckID(3) + `","type":"ping"}`,
		"unknown check":      `{"url":"https://b.example","check_id":"` + netTestCheckID(1) + `"}`,
		"no type":            `{"url":"https://b.example"}`,
		"unbuilt type":       `{"url":"https://b.example","type":"json"}`,
		"host":               `{"url":"https://b.example","type":"tcp","host":"victim.example"}`,
		"port out of range":  `{"url":"https://b.example","type":"tcp","port":70000}`,
		"tls threshold":      `{"url":"https://b.example","type":"tls","min_days_left":500}`,
	} {
		if out := mcpNetCall(t, h, "set_net_check", args); out["error"] == nil {
			t.Errorf("%s: accepted (%v)", name, out)
		}
	}
	if got := storedNetChecks(h, "https://b.example"); len(got) != 2 {
		t.Errorf("a refused call changed the list: %+v", got)
	}

	// A TLS check: the port and the warning threshold are stored config, and the
	// answer reads them back.
	out = mcpNetCall(t, h, "set_net_check", `{"url":"https://b.example","type":"tls","port":8443,"min_days_left":21}`)
	chk, _ = out["check"].(map[string]any)
	if out["saved"] != true || chk["type"] != "tls" || chk["port"] != float64(8443) || chk["min_days_left"] != float64(21) {
		t.Fatalf("tls check: %v", out)
	}

	// The cap is the install's, through the same normaliser.
	if out := mcpNetCall(t, h, "set_net_check", `{"url":"https://a.example:8443","type":"tcp","enabled":true,"label":"x"}`); out["saved"] != true {
		t.Fatalf("under the cap: %v", out)
	}
	s := h.store.GetSettings()
	s.NetToolsMaxChecks = 1
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	out = mcpNetCall(t, h, "set_net_check", `{"url":"https://b.example","type":"tcp","enabled":true}`)
	if e, _ := out["error"].(string); e != errNetCheckCap.Error() {
		t.Errorf("over the cap: %v", out)
	}
}

func TestMCPNetWritesNeedTheToken(t *testing.T) {
	h, rec := netMCPHandlers(t, "")
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret")
	before := len(storedNetChecks(h, "https://a.example:8443"))
	for tool, args := range map[string]string{
		"set_net_check":    `{"url":"https://a.example:8443","type":"tcp"}`,
		"delete_net_check": `{"url":"https://a.example:8443","check_id":"` + netTestCheckID(1) + `"}`,
		"run_network_test": `{"url":"https://a.example:8443","type":"tcp"}`,
	} {
		out := mcpNetCall(t, h, tool, args)
		if out["error"] != "This tool needs the write token." {
			t.Errorf("%s without the token: %v", tool, out)
		}
	}
	if rec.count() != 0 || len(storedNetChecks(h, "https://a.example:8443")) != before {
		t.Error("something ran or changed without the token")
	}
	out := mcpNetCall(t, h, "delete_net_check", `{"url":"https://a.example:8443","check_id":"`+netTestCheckID(1)+`"}`, [2]string{"X-NextDash-Token", "secret"})
	if out["deleted"] != true {
		t.Fatalf("with the token: %v", out)
	}
}

func TestMCPDeleteNetCheckIsDestructive(t *testing.T) {
	if !mcpToolIsDestructive("delete_net_check") {
		t.Fatal("delete_net_check is not marked destructive")
	}
	h, _ := netMCPHandlers(t, "")
	out := mcpNetCall(t, h, "delete_net_check", `{"url":"https://a.example:8443","check_id":"`+netTestCheckID(1)+`"}`)
	if out["deleted"] != true || out["check_id"] != netTestCheckID(1) || out["label"] != "SSH" {
		t.Fatalf("delete: %v", out)
	}
	if got := storedNetChecks(h, "https://a.example:8443"); len(got) != 1 || got[0].ID != netTestCheckID(2) {
		t.Fatalf("after the delete: %+v", got)
	}
	// The other bookmark's check is untouched, and not this one's to delete.
	if got := storedNetChecks(h, "https://b.example"); len(got) != 1 {
		t.Fatalf("B: %+v", got)
	}
	for name, args := range map[string]string{
		"already gone":    `{"url":"https://a.example:8443","check_id":"` + netTestCheckID(1) + `"}`,
		"another's check": `{"url":"https://a.example:8443","check_id":"` + netTestCheckID(3) + `"}`,
		"no id":           `{"url":"https://a.example:8443"}`,
		"no bookmark":     `{"url":"https://nope.example","check_id":"` + netTestCheckID(2) + `"}`,
	} {
		if out := mcpNetCall(t, h, "delete_net_check", args); out["error"] == nil {
			t.Errorf("%s: %v", name, out)
		}
	}
	if len(storedNetChecks(h, "https://b.example")) != 1 || len(storedNetChecks(h, "https://a.example:8443")) != 1 {
		t.Error("a refused delete removed something")
	}
}

func TestMCPRunNetworkTestNoFreeHost(t *testing.T) {
	h, rec := netMCPHandlers(t, `{"mcpEnabled":true,"mcpNetTools":true,"netToolsAllowCustomHost":true}`)
	for name, args := range map[string]string{
		"host":             `{"url":"https://a.example:8443","type":"tcp","host":"victim.example"}`,
		"port":             `{"url":"https://a.example:8443","type":"tcp","port":22}`,
		"address":          `{"url":"https://a.example:8443","type":"tcp","address":"10.0.0.1:22"}`,
		"another's check":  `{"url":"https://a.example:8443","check_id":"` + netTestCheckID(3) + `"}`,
		"neither":          `{"url":"https://a.example:8443"}`,
		"unknown bookmark": `{"url":"https://nope.example","type":"tcp"}`,
		"unbuilt type":     `{"url":"https://a.example:8443","type":"json"}`,
	} {
		if out := mcpNetCall(t, h, "run_network_test", args); out["error"] == nil {
			t.Errorf("%s: ran (%v)", name, out)
		}
	}
	if rec.count() != 0 {
		t.Fatalf("a refused call still ran %d test(s)", rec.count())
	}

	// What does run aims at the bookmark's own address, or at its stored check.
	out := mcpNetCall(t, h, "run_network_test", `{"url":"https://a.example:8443","type":"tcp"}`)
	if out["ok"] != true || out["type"] != "tcp" {
		t.Fatalf("type only: %v", out)
	}
	if c := rec.calls[0]; c.Host != "" || c.Port != 0 || c.ID != "" {
		t.Fatalf("a one-off test carried a target: %+v", c)
	}
	mcpNetCall(t, h, "run_network_test", `{"url":"https://a.example:8443","check_id":"`+netTestCheckID(1)+`"}`)
	if c := rec.calls[1]; c.ID != netTestCheckID(1) || c.Port != 2222 {
		t.Fatalf("stored check: %+v", c)
	}
}

func TestMCPRunNetworkTestSharesLimiter(t *testing.T) {
	h, rec := netMCPHandlers(t, "")
	h.netToolLimiter = newSlidingWindowLimiter(2, time.Minute)
	args := `{"url":"https://a.example:8443","type":"tcp"}`

	// The route and the tool draw on one budget per caller address: one of
	// each, and the third try is refused whichever door it comes through.
	if out := mcpNetCall(t, h, "run_network_test", args); out["ok"] != true {
		t.Fatalf("first: %v", out)
	}
	if got := netRunPost(h, `{"pageId":1,"url":"https://a.example:8443","type":"tcp"}`, "192.0.2.1").Code; got != http.StatusOK {
		t.Fatalf("the route after the tool: %d", got)
	}
	out := mcpNetCall(t, h, "run_network_test", args)
	if e, _ := out["error"].(string); !strings.Contains(e, "Too many") || out["retry_after_seconds"] != float64(60) {
		t.Fatalf("third: %v", out)
	}
	if got := netRunPost(h, `{"pageId":1,"url":"https://a.example:8443","type":"tcp"}`, "192.0.2.1").Code; got != http.StatusTooManyRequests {
		t.Fatalf("the route after the limit: %d", got)
	}
	if rec.count() != 2 {
		t.Fatalf("ran %d tests, want 2", rec.count())
	}
	// Another caller has a budget of its own.
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_network_test","arguments":`+args+`}}`))
	req.RemoteAddr = "192.0.2.77:5555"
	res := httptest.NewRecorder()
	h.MCPHandler(res, req)
	if !strings.Contains(res.Body.String(), `"ok":true`) {
		t.Fatalf("another caller: %s", res.Body.String())
	}

	// The route's own limiter counts for the tool as well.
	h2, rec2 := netMCPHandlers(t, "")
	h2.ssrfAPILimiter = newSlidingWindowLimiter(1, time.Minute)
	mcpNetCall(t, h2, "run_network_test", args)
	if out := mcpNetCall(t, h2, "run_network_test", args); out["error"] == nil || rec2.count() != 1 {
		t.Fatalf("the SSRF budget did not hold: %v (ran %d)", out, rec2.count())
	}
}

func TestMCPRunNetworkTestSharesInflightRule(t *testing.T) {
	h, _ := netMCPHandlers(t, "")
	started, release := make(chan struct{}), make(chan struct{})
	first := true
	h.netRunner = func(_ context.Context, bm Bookmark, c NetCheck) NetResult {
		if first {
			first = false
			close(started)
			<-release
		}
		return NetResult{OK: true}
	}
	done := make(chan map[string]any, 1)
	go func() { done <- mcpNetCall(t, h, "run_network_test", `{"url":"https://a.example:8443","type":"tcp"}`) }()
	<-started
	out := mcpNetCall(t, h, "run_network_test", `{"url":"https://a.example:8443","type":"ping"}`)
	if e, _ := out["error"].(string); !strings.Contains(e, "already running") {
		t.Errorf("second test of the same host: %v", out)
	}
	close(release)
	if out := <-done; out["ok"] != true {
		t.Fatalf("first: %v", out)
	}
}

func TestMCPListAndGetNetChecks(t *testing.T) {
	h, _ := netMCPHandlers(t, "")
	now := time.Now()
	hkey := netHistoryKey(netTestCheckID(1))
	if err := h.appendHealthSamples(map[string][]HealthSample{hkey: {
		{T: now.Add(-2 * time.Minute).UnixMilli(), Up: true, PingMs: 12, D: "2222 open"},
		{T: now.Add(-1 * time.Minute).UnixMilli(), Up: false, Fail: "refused", D: "2222 closed"},
	}}); err != nil {
		t.Fatal(err)
	}

	all := mcpNetCall(t, h, "list_net_checks", `{}`)
	if all["total"] != float64(3) {
		t.Fatalf("total = %v", all["total"])
	}
	one := mcpNetCall(t, h, "list_net_checks", `{"url":"https://a.example:8443"}`)
	list, _ := one["checks"].([]any)
	if len(list) != 2 {
		t.Fatalf("A's checks: %v", one)
	}
	first, _ := list[0].(map[string]any)
	state, _ := first["state"].(map[string]any)
	if first["check_id"] != netTestCheckID(1) || first["label"] != "SSH" || first["port"] != float64(2222) || state["ok"] != false || state["class"] != "refused" {
		t.Fatalf("first check: %v", first)
	}
	if limited := mcpNetCall(t, h, "list_net_checks", `{"limit":1}`); limited["truncated"] != true {
		t.Errorf("a cut list did not say so: %v", limited)
	}
	if out := mcpNetCall(t, h, "list_net_checks", `{"url":"https://nope.example"}`); out["error"] == nil {
		t.Errorf("unknown bookmark: %v", out)
	}

	got := mcpNetCall(t, h, "get_net_check", `{"check_id":"`+netTestCheckID(1)+`"}`)
	samples, _ := got["samples"].([]any)
	if got["check_id"] != netTestCheckID(1) || len(samples) != 2 {
		t.Fatalf("get: %v", got)
	}
	if newest, _ := samples[0].(map[string]any); newest["ok"] != false || newest["class"] != "refused" {
		t.Errorf("newest first: %v", samples)
	}
	if got["stats"] == nil {
		t.Error("no stats")
	}
	if out := mcpNetCall(t, h, "get_net_check", `{"check_id":"nope"}`); out["error"] == nil {
		t.Errorf("unknown check: %v", out)
	}
}

func TestAIOffersRunNetworkTestAsRead(t *testing.T) {
	h, rec := netMCPHandlers(t, "")
	s := h.store.GetSettings()
	specs := aiOfferedTools(s)
	names := offeredNames(specs)
	for _, read := range []string{"run_network_test", "list_net_checks", "get_net_check"} {
		if !names[read] {
			t.Errorf("%s is not offered as a read tool", read)
		}
	}
	for _, write := range []string{"set_net_check", "delete_net_check"} {
		if names[write] {
			t.Errorf("the write tool %s is offered as callable", write)
		}
	}
	var propose string
	for _, spec := range specs {
		if spec.Name == aiProposeChangesTool {
			propose = spec.Description
		}
	}
	if !strings.Contains(propose, "set_net_check") || !strings.Contains(propose, "delete_net_check") {
		t.Errorf("propose_changes does not name the net write tools: %s", propose)
	}
	if names2 := offeredNames(aiOfferedTools(Settings{})); names2["run_network_test"] {
		t.Error("run_network_test is offered with the switch off")
	}

	// Proposals: both pass, the delete carries the destructive flag.
	accepted, told := h.aiCheckProposals(s, []byte(`{"changes":[`+
		`{"tool":"set_net_check","arguments":{"url":"https://b.example","type":"ping"},"reason":"x"},`+
		`{"tool":"delete_net_check","arguments":{"url":"https://b.example","check_id":"`+netTestCheckID(3)+`"},"reason":"y"},`+
		`{"tool":"run_network_test","arguments":{"url":"https://b.example","type":"ping"},"reason":"z"}]}`))
	if len(accepted) != 2 || accepted[0].Destructive || !accepted[1].Destructive {
		t.Fatalf("proposals: %+v (%v)", accepted, told)
	}

	// The assistant runs the test in the loop, without a click.
	fake := &fakeAIProvider{replies: []aiChatReply{
		{ToolCalls: []aiToolCall{aiCall("c1", "run_network_test", `{"url":"https://a.example:8443","type":"tcp"}`)}},
		{Text: "It is open."},
	}}
	_, events, err := runAITurn(t, h, fake, "Is A up?")
	if err != nil {
		t.Fatal(err)
	}
	if rec.count() != 1 {
		t.Fatalf("the assistant's call ran %d test(s)", rec.count())
	}
	if tools := toolEvents(events); len(tools) != 1 || tools[0].Group != mcpGroupNetTools {
		t.Errorf("events: %+v", tools)
	}
	if msgs := toolMessages(fake.seen[1]); len(msgs) != 1 || !strings.Contains(msgs[0].Text, `"ok":true`) {
		t.Errorf("tool result: %+v", msgs)
	}
}
