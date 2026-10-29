package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeAIProvider plays back scripted replies, one per Chat call, and keeps
// every request it was sent. Past the end of the script it repeats the last
// reply. With block set it waits for the context instead, and then answers the
// way the real transport does: as "unreachable".
type fakeAIProvider struct {
	mu      sync.Mutex
	replies []aiChatReply
	seen    []aiChatRequest
	block   bool
}

func (f *fakeAIProvider) Chat(ctx context.Context, req aiChatRequest, onText func(string)) (aiChatReply, error) {
	f.mu.Lock()
	req.Messages = append([]aiWireMessage(nil), req.Messages...)
	f.seen = append(f.seen, req)
	n := len(f.seen)
	f.mu.Unlock()
	if f.block {
		<-ctx.Done()
		return aiChatReply{}, &aiError{Kind: "unreachable"}
	}
	if len(f.replies) == 0 {
		return aiChatReply{}, nil
	}
	reply := f.replies[len(f.replies)-1]
	if n <= len(f.replies) {
		reply = f.replies[n-1]
	}
	if reply.Text != "" && onText != nil {
		onText(reply.Text)
	}
	return reply, nil
}

func (f *fakeAIProvider) Label() string { return "Fake" }
func (f *fakeAIProvider) Model() string { return "fake-1" }

func aiCall(id, name, args string) aiToolCall {
	return aiToolCall{ID: id, Name: name, Arguments: json.RawMessage(args)}
}

// runAITurn runs one turn and collects the events it emitted.
func runAITurn(t *testing.T, h *Handlers, p aiProvider, question string) (aiTurnResult, []aiTurnEvent, error) {
	t.Helper()
	var events []aiTurnEvent
	r := httptest.NewRequest(http.MethodPost, "/api/ai/chat", nil)
	res, err := h.aiRunTurn(context.Background(), r, p, nil, question, func(e aiTurnEvent) { events = append(events, e) })
	return res, events, err
}

func toolEvents(events []aiTurnEvent) []aiTurnEvent {
	var out []aiTurnEvent
	for _, e := range events {
		if e.Type == "tool" {
			out = append(out, e)
		}
	}
	return out
}

// toolMessages are the tool results in one request, in order.
func toolMessages(req aiChatRequest) []aiWireMessage {
	var out []aiWireMessage
	for _, m := range req.Messages {
		if m.Role == "tool" {
			out = append(out, m)
		}
	}
	return out
}

func turnOnEveryMCPGroup(t *testing.T, h *Handlers) {
	t.Helper()
	s := h.store.GetSettings()
	s.MCPBookmarksWrite, s.MCPHealthInbox, s.MCPContainersRead, s.MCPContainersControl = true, true, true, true
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
}

func offeredNames(specs []aiToolSpec) map[string]bool {
	out := map[string]bool{}
	for _, s := range specs {
		out[s.Name] = true
	}
	return out
}

func TestTheModelIsNeverOfferedAWriteTool(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnEveryMCPGroup(t, h)
	names := offeredNames(aiOfferedTools(h.store.GetSettings()))
	for _, want := range []string{"search_bookmarks", "list_containers", "propose_changes"} {
		if !names[want] {
			t.Errorf("%s is not offered; offered %v", want, names)
		}
	}
	for _, write := range []string{"add_bookmark", "update_bookmark", "delete_bookmark", "create_category", "rename_category", "container_action"} {
		if names[write] {
			t.Errorf("the write tool %s is offered as callable", write)
		}
	}

	off := newMCPHandlers(t)
	if offeredNames(aiOfferedTools(off.store.GetSettings()))["list_containers"] {
		t.Error("list_containers is offered with its group off")
	}
}

func TestAReadToolRunsInProcess(t *testing.T) {
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)
	fake := &fakeAIProvider{replies: []aiChatReply{
		{ToolCalls: []aiToolCall{aiCall("c1", "search_bookmarks", `{"query":"sonarr"}`)}},
		{Text: "You have Sonarr."},
	}}
	res, events, err := runAITurn(t, h, fake, "Do I have sonarr?")
	if err != nil {
		t.Fatal(err)
	}
	if len(fake.seen) != 2 {
		t.Fatalf("the fake saw %d requests", len(fake.seen))
	}
	tools := toolMessages(fake.seen[1])
	if len(tools) != 1 || !strings.Contains(tools[0].Text, "https://sonarr.example/") || tools[0].ToolCallID != "c1" {
		t.Fatalf("the tool message sent on is %+v", tools)
	}
	if len(res.Tools) != 1 || res.Tools[0].Name != "search_bookmarks" || res.Tools[0].Bytes != len(tools[0].Text) {
		t.Fatalf("tools summary %+v", res.Tools)
	}
	te := toolEvents(events)
	if len(te) != 1 || te[0].Group != "" {
		t.Fatalf("tool events %+v", te)
	}
	if res.Text != "You have Sonarr." || res.Limit != "" {
		t.Fatalf("result %+v", res)
	}
}

func TestAToolOutsideTheOfferedSetIsNotRun(t *testing.T) {
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)
	turnOnBookmarksWrite(t, h)
	page := h.store.GetPages()[0].ID
	fake := &fakeAIProvider{replies: []aiChatReply{
		{ToolCalls: []aiToolCall{aiCall("c1", "delete_bookmark", `{"url":"https://sonarr.example/"}`)}},
		{Text: "Done."},
	}}
	res, events, err := runAITurn(t, h, fake, "Delete sonarr")
	if err != nil {
		t.Fatal(err)
	}
	if bookmarkOnPage(h, page, "https://sonarr.example/") == nil {
		t.Fatal("the bookmark was deleted")
	}
	tools := toolMessages(fake.seen[1])
	if len(tools) != 1 || !strings.Contains(tools[0].Text, "Unknown tool: delete_bookmark") {
		t.Fatalf("the tool message is %+v", tools)
	}
	if len(toolEvents(events)) != 0 || len(res.Tools) != 0 {
		t.Fatalf("a refused tool was reported as run: %+v %+v", events, res.Tools)
	}
}

func TestLoopStopsAfterEightRounds(t *testing.T) {
	h := newMCPHandlers(t)
	fake := &fakeAIProvider{replies: []aiChatReply{
		{ToolCalls: []aiToolCall{aiCall("c", "list_tags", `{}`)}},
	}}
	res, _, err := runAITurn(t, h, fake, "Tags?")
	if err != nil {
		t.Fatal(err)
	}
	if res.Limit != "rounds" || len(fake.seen) != 8 {
		t.Fatalf("limit %q after %d requests", res.Limit, len(fake.seen))
	}
	if !strings.HasSuffix(res.Text, "I stopped here: it took more than 8 rounds of looking things up.") {
		t.Fatalf("text %q", res.Text)
	}
}

func TestLoopStopsAfterTwentyCalls(t *testing.T) {
	h := newMCPHandlers(t)
	var calls []aiToolCall
	for i := 0; i < 7; i++ {
		calls = append(calls, aiCall(fmt.Sprintf("c%d", i), "list_tags", `{}`))
	}
	fake := &fakeAIProvider{replies: []aiChatReply{{ToolCalls: calls}}}
	res, events, err := runAITurn(t, h, fake, "Tags?")
	if err != nil {
		t.Fatal(err)
	}
	if res.Limit != "calls" || len(fake.seen) != 3 {
		t.Fatalf("limit %q after %d requests", res.Limit, len(fake.seen))
	}
	if n := len(toolEvents(events)); n != 20 {
		t.Fatalf("%d calls ran", n)
	}
	if !strings.HasSuffix(res.Text, "I stopped here: it took more than 20 lookups.") {
		t.Fatalf("text %q", res.Text)
	}
}

func TestLoopHitsTheDeadline(t *testing.T) {
	old := aiTurnDeadline
	aiTurnDeadline = 200 * time.Millisecond
	t.Cleanup(func() { aiTurnDeadline = old })
	h := newMCPHandlers(t)
	start := time.Now()
	res, _, err := runAITurn(t, h, &fakeAIProvider{block: true}, "Slow?")
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("took %v", elapsed)
	}
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "timeout" {
		t.Fatalf("err %v", err)
	}
	if res.Text != "" || len(res.Proposals) != 0 {
		t.Fatalf("a failed turn returned %+v", res)
	}
}

// A closed panel cancels the request context. That is not the provider's
// fault, so it must not come back as "Could not reach the provider".
func TestLoopStopsWhenThePanelCloses(t *testing.T) {
	h := newMCPHandlers(t)
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)
	r := httptest.NewRequest(http.MethodPost, "/api/ai/chat", nil)
	_, err := h.aiRunTurn(ctx, r, &fakeAIProvider{block: true}, nil, "Hi", func(aiTurnEvent) {})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err %v", err)
	}
	var ae *aiError
	if errors.As(err, &ae) {
		t.Fatalf("a cancelled turn came back as provider error %q", ae.Kind)
	}
}

func TestAProviderErrorIsReturnedAsIs(t *testing.T) {
	h := newMCPHandlers(t)
	_, _, err := runAITurn(t, h, errProvider{&aiError{Kind: "bad_key"}}, "Hi")
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "bad_key" {
		t.Fatalf("err %v", err)
	}
}

type errProvider struct{ err error }

func (e errProvider) Chat(context.Context, aiChatRequest, func(string)) (aiChatReply, error) {
	return aiChatReply{}, e.err
}
func (errProvider) Label() string { return "Fake" }
func (errProvider) Model() string { return "fake-1" }

func TestLargeToolResultsAreCut(t *testing.T) {
	h := newMCPHandlers(t)
	page := h.store.GetPages()[0].ID
	var marks []Bookmark
	for i := 0; i < 300; i++ {
		marks = append(marks, Bookmark{
			Name: fmt.Sprintf("Bookmark %03d", i), URL: fmt.Sprintf("https://site-%03d.example/", i),
			Note: strings.Repeat("ü note ", 30), PageID: page,
		})
	}
	if err := h.store.SaveBookmarksByPage(page, marks); err != nil {
		t.Fatal(err)
	}
	fake := &fakeAIProvider{replies: []aiChatReply{
		{ToolCalls: []aiToolCall{aiCall("c1", "search_bookmarks", `{"query":"","limit":100}`)}},
		{Text: "Lots."},
	}}
	res, _, err := runAITurn(t, h, fake, "Everything?")
	if err != nil {
		t.Fatal(err)
	}
	tools := toolMessages(fake.seen[1])
	if len(tools) != 1 {
		t.Fatalf("tool messages %+v", tools)
	}
	text := tools[0].Text
	if len(text) > aiToolResultMax+len("…(cut)") || !strings.HasSuffix(text, "…(cut)") {
		t.Fatalf("tool message of %d bytes, ends %q", len(text), text[max(0, len(text)-20):])
	}
	if strings.ToValidUTF8(text, "?") != text {
		t.Fatal("the cut split a character")
	}
	if res.Tools[0].Bytes != len(text) {
		t.Fatalf("summary says %d bytes, sent %d", res.Tools[0].Bytes, len(text))
	}
}

func TestProposalsAreCheckedAndStored(t *testing.T) {
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)
	turnOnBookmarksWrite(t, h)
	args := `{"changes":[
		{"tool":"update_bookmark","arguments":{"url":"https://sonarr.example/","note":"tv"},"reason":"you asked"},
		{"tool":"container_action","arguments":{"container":"web","action":"restart"},"reason":"stuck"},
		{"tool":"update_bookmark","arguments":{"note":"tv"},"reason":"oops"}
	]}`
	fake := &fakeAIProvider{replies: []aiChatReply{
		{ToolCalls: []aiToolCall{aiCall("p1", "propose_changes", args)}},
		{Text: "I suggested a note."},
	}}
	res, events, err := runAITurn(t, h, fake, "Note sonarr as tv")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Proposals) != 1 {
		t.Fatalf("proposals %+v", res.Proposals)
	}
	p := res.Proposals[0]
	if p.Tool != "update_bookmark" || p.Status != "pending" || p.Destructive || p.Reason != "you asked" {
		t.Fatalf("proposal %+v", p)
	}
	if !regexp.MustCompile(`^[0-9a-f]{16}$`).MatchString(p.ID) {
		t.Fatalf("id %q", p.ID)
	}
	if !strings.Contains(string(p.Arguments), "sonarr.example") {
		t.Fatalf("arguments %s", p.Arguments)
	}
	if b := bookmarkOnPage(h, h.store.GetPages()[0].ID, "https://sonarr.example/"); b == nil || b.Note == "tv" {
		t.Fatal("a proposal was applied")
	}
	if len(toolEvents(events)) != 0 {
		t.Fatalf("propose_changes reported as a lookup: %+v", events)
	}
	tools := toolMessages(fake.seen[1])
	var told struct {
		Stored   int `json:"stored"`
		Rejected []struct {
			Tool, Reason string
		} `json:"rejected"`
	}
	if len(tools) != 1 || json.Unmarshal([]byte(tools[0].Text), &told) != nil {
		t.Fatalf("tool message %+v", tools)
	}
	if told.Stored != 1 || len(told.Rejected) != 2 ||
		told.Rejected[0].Tool != "container_action" || told.Rejected[0].Reason != "that group is switched off" ||
		told.Rejected[1].Tool != "update_bookmark" || told.Rejected[1].Reason != `"url" is required` {
		t.Fatalf("told the model %+v", told)
	}
}

func TestDestructiveProposalsAreMarked(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnBookmarksWrite(t, h)
	accepted, told := h.aiCheckProposals(h.store.GetSettings(), json.RawMessage(`{"changes":[
		{"tool":"delete_bookmark","arguments":{"url":"https://sonarr.example/"},"reason":"gone"},
		{"tool":"search_bookmarks","arguments":{},"reason":"look"},
		{"tool":"make_coffee","arguments":{},"reason":"tired"}
	]}`))
	if len(accepted) != 1 || !accepted[0].Destructive || accepted[0].Tool != "delete_bookmark" {
		t.Fatalf("accepted %+v", accepted)
	}
	rejected, _ := told["rejected"].([]map[string]any)
	if told["stored"] != 1 || len(rejected) != 2 || rejected[0]["reason"] != "not a change" || rejected[1]["reason"] != "unknown tool" {
		t.Fatalf("told %+v", told)
	}
	if !mcpToolIsDestructive("container_action") || mcpToolIsDestructive("update_bookmark") || mcpToolIsDestructive("search_bookmarks") {
		t.Error("destructive hints read wrong")
	}
}

func toolSchema(t *testing.T, name string) map[string]any {
	t.Helper()
	for _, def := range mcpAllToolDefinitions() {
		if def["name"] == name {
			return def["inputSchema"].(map[string]any)
		}
	}
	t.Fatalf("no tool %s", name)
	return nil
}

func TestValidateArgs(t *testing.T) {
	update, move, action := toolSchema(t, "update_bookmark"), toolSchema(t, "move_bookmark"), toolSchema(t, "container_action")
	cases := []struct {
		name   string
		schema map[string]any
		args   string
		want   string // "" is valid
	}{
		{"missing required", update, `{"note":"x"}`, `"url" is required`},
		{"unknown field", update, `{"url":"https://a/","colour":"red"}`, `"colour" is not a field of this tool`},
		{"wrong type", update, `{"url":42}`, `"url" must be a string`},
		{"array items", update, `{"url":"https://a/","tags_add":["a",1]}`, `"tags_add" must be a list of strings`},
		{"non-whole integer", move, `{"url":"https://a/","to_page":1.5}`, `"to_page" must be a whole number`},
		{"enum miss", action, `{"container":"web","action":"kill"}`, `"action" must be one of start, stop, restart, pause, unpause, remove, update, rollback`},
		{"not an object", update, `["https://a/"]`, `the arguments must be an object`},
		{"valid", move, `{"url":"https://a/","to_page":2,"to_category":"media"}`, ""},
		{"valid enum", action, `{"container":"web","action":"restart"}`, ""},
	}
	for _, c := range cases {
		err := aiValidateArgs(c.schema, json.RawMessage(c.args))
		got := ""
		if err != nil {
			got = err.Error()
		}
		if got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestSystemPromptCarriesOnlyDateAndPageNames(t *testing.T) {
	h, _, _ := twoPageMCPInstall(t)
	pages := h.store.GetPages()
	now := time.Date(2026, 10, 29, 9, 30, 0, 0, time.UTC)
	prompt := aiSystemPrompt(now, pages)
	if !strings.Contains(prompt, "Thursday 2026-10-29") {
		t.Errorf("no date in %q", prompt)
	}
	for _, p := range pages {
		if !p.Hidden && !strings.Contains(prompt, p.Name) {
			t.Errorf("page %q missing from %q", p.Name, prompt)
		}
	}
	if !strings.Contains(prompt, "Work") {
		t.Errorf("second page missing from %q", prompt)
	}
	if !strings.Contains(prompt, "You can look things up with the tools. You cannot change anything yourself: to suggest a change, call propose_changes, and the person applies it with a click.") {
		t.Errorf("fixed line missing from %q", prompt)
	}
	for _, leak := range []string{"sonarr.example", "radarr", "Media"} {
		if strings.Contains(prompt, leak) {
			t.Errorf("the prompt carries %q", leak)
		}
	}
}

// The mark travels from the turn into the browser's handlers.
func TestAssistantRequestsAreMarked(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if requestFromAssistant(r) || mcpToolSource(r) != "mcp" {
		t.Fatal("a plain request reads as the assistant")
	}
	marked := aiAssistantRequest(r)
	if !requestFromAssistant(marked) || mcpToolSource(marked) != "assistant" {
		t.Fatal("the mark did not stick")
	}
}
