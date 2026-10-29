package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func newMCPHandlers(t *testing.T) *Handlers {
	t.Helper()
	h := newTestHandlers(t)
	settings := h.store.GetSettings()
	settings.MCPEnabled = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	return h
}

// call sends one JSON-RPC request and hands back the recorder and the decoded
// response, because nearly every test below wants both.
func callMCP(t *testing.T, h *Handlers, body string, headers ...[2]string) (*httptest.ResponseRecorder, jsonRPCResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for _, pair := range headers {
		req.Header.Set(pair[0], pair[1])
	}
	res := httptest.NewRecorder()
	h.MCPHandler(res, req)

	var decoded jsonRPCResponse
	_ = json.Unmarshal(res.Body.Bytes(), &decoded)
	return res, decoded
}

// toolCall runs one tool and returns its structured payload.
func toolCall(t *testing.T, h *Handlers, name, args string) map[string]any {
	t.Helper()
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+name+`","arguments":`+args+`}}`)
	if resp.Error != nil {
		t.Fatalf("%s: %s", name, resp.Error.Message)
	}
	result, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("%s returned %T", name, resp.Result)
	}
	payload, ok := result["structuredContent"].(map[string]any)
	if !ok {
		t.Fatalf("%s carried no structured result: %v", name, result)
	}
	return payload
}

/*
The endpoint is shut on an install that never asked for it.

It answers questions about every bookmark there is, so "anyone who can reach
this server can read the whole dashboard" must be something somebody turned on.
*/
func TestTheMCPEndpointIsOffUntilItIsSwitchedOn(t *testing.T) {
	h := newTestHandlers(t)
	res, _ := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if res.Code != http.StatusNotFound {
		t.Fatalf("a fresh install answered HTTP %d", res.Code)
	}
	// And says nothing about what it would have answered.
	if strings.Contains(res.Body.String(), "search_bookmarks") {
		t.Error("the closed endpoint listed its tools anyway")
	}

	on := newMCPHandlers(t)
	if res, _ := callMCP(t, on, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`); res.Code != http.StatusOK {
		t.Fatalf("the switched-on endpoint answered HTTP %d", res.Code)
	}
}

/*
A web page must not be able to talk to this.

A browser will POST to localhost from any site on the internet, and it sends
Origin when it does. A client that is not a browser sends none at all, which is
the normal case here -- so the absent header passes and a foreign one does not.
*/
func TestAForeignPageCannotReachTheEndpoint(t *testing.T) {
	h := newMCPHandlers(t)
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`

	if res, _ := callMCP(t, h, body, [2]string{"Origin", "https://evil.example"}); res.Code != http.StatusForbidden {
		t.Errorf("a cross-site page got HTTP %d", res.Code)
	}
	// httptest's request Host is example.com, so this is the dashboard's own
	// page talking to its own server.
	if res, _ := callMCP(t, h, body, [2]string{"Origin", "https://example.com"}); res.Code != http.StatusOK {
		t.Errorf("the dashboard's own page got HTTP %d", res.Code)
	}
	if res, _ := callMCP(t, h, body); res.Code != http.StatusOK {
		t.Errorf("a client sending no Origin got HTTP %d", res.Code)
	}
}

/*
The handshake, and the version negotiation that is the point of it.

Answering in our own version regardless would make the negotiation decorative
and force one side to be upgraded before the other can connect.
*/
func TestInitializeAnswersInTheClientsVersionWhenItKnowsIt(t *testing.T) {
	h := newMCPHandlers(t)

	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`)
	result, _ := resp.Result.(map[string]any)
	if result["protocolVersion"] != "2025-06-18" {
		t.Errorf("answered %v to a client asking for 2025-06-18", result["protocolVersion"])
	}
	if _, ok := result["capabilities"].(map[string]any)["tools"]; !ok {
		t.Errorf("no tools capability: %v", result["capabilities"])
	}

	// A version nobody here knows gets ours, which is what lets the client
	// decide whether it can proceed.
	_, resp = callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}`)
	result, _ = resp.Result.(map[string]any)
	if result["protocolVersion"] != mcpProtocolVersion {
		t.Errorf("answered %v to a client asking for a version we do not know", result["protocolVersion"])
	}
}

// A notification has no id and takes no answer. A body in reply is a client
// left waiting for a response to something it never asked a question about.
func TestANotificationGetsNoAnswer(t *testing.T) {
	h := newMCPHandlers(t)
	res, _ := callMCP(t, h, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if res.Code != http.StatusAccepted {
		t.Errorf("HTTP %d", res.Code)
	}
	if strings.TrimSpace(res.Body.String()) != "" {
		t.Errorf("answered with %q", res.Body.String())
	}
}

/*
An unknown method is a JSON-RPC error, and the exchange still succeeded.

A client reading the HTTP status instead of the body would see a transport
failure and retry, where what happened is a clear answer that will not change.
*/
func TestAnUnknownMethodIsAnAnswerNotAFailure(t *testing.T) {
	h := newMCPHandlers(t)
	res, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":7,"method":"resources/list"}`)
	if res.Code != http.StatusOK {
		t.Errorf("HTTP %d", res.Code)
	}
	if resp.Error == nil || resp.Error.Code != jsonRPCMethodNotFound {
		t.Fatalf("error = %+v", resp.Error)
	}
	if string(resp.ID) != "7" {
		t.Errorf("the answer came back under id %s", resp.ID)
	}
}

func TestToolsAreDiscoverable(t *testing.T) {
	h := newMCPHandlers(t)
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	result, _ := resp.Result.(map[string]any)
	tools, _ := result["tools"].([]any)

	seen := map[string]bool{}
	for _, entry := range tools {
		tool, _ := entry.(map[string]any)
		name, _ := tool["name"].(string)
		seen[name] = true
		// A tool a model cannot tell apart from another is a tool it calls at
		// random, so both halves of the description have to be there.
		if desc, _ := tool["description"].(string); len(desc) < 20 {
			t.Errorf("%s is described as %q", name, desc)
		}
		if _, ok := tool["inputSchema"].(map[string]any); !ok {
			t.Errorf("%s has no input schema", name)
		}
	}
	for _, want := range []string{"search_bookmarks", "get_bookmark", "list_tags", "add_bookmark"} {
		if !seen[want] {
			t.Errorf("%s is not offered", want)
		}
	}
}

func seedMCPBookmarks(t *testing.T, h *Handlers) {
	t.Helper()
	pages := h.store.GetPages()
	if len(pages) == 0 {
		t.Fatal("the test install has no pages")
	}
	err := h.store.SaveBookmarksByPage(pages[0].ID, []Bookmark{
		{Name: "Sonarr", URL: "https://sonarr.example/", Tags: []string{"media", "selfhosted"}, PageID: pages[0].ID},
		{Name: "Radarr", URL: "https://radarr.example/", Tags: []string{"media"}, PageID: pages[0].ID},
		{Name: "Go docs", URL: "https://go.dev/doc/", Note: "language reference", Tags: []string{"archive"}, PageID: pages[0].ID},
	})
	if err != nil {
		t.Fatal(err)
	}
}

/*
Search narrows as words are added, rather than widening.

Matching any word instead of all of them would make a two-word search broader
than a one-word one, which is the opposite of what typing a second word means.
*/
func TestSearchNarrowsWithEveryWord(t *testing.T) {
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)

	all := toolCall(t, h, "search_bookmarks", `{"query":""}`)
	if all["total"].(float64) < 3 {
		t.Fatalf("an empty query found %v bookmarks", all["total"])
	}

	one := toolCall(t, h, "search_bookmarks", `{"query":"arr"}`)
	two := toolCall(t, h, "search_bookmarks", `{"query":"arr sonarr"}`)
	if two["total"].(float64) >= one["total"].(float64) {
		t.Errorf("a second word did not narrow: %v then %v", one["total"], two["total"])
	}

	// A note is searched too: it is where the reader put the words they would
	// look for later.
	if byNote := toolCall(t, h, "search_bookmarks", `{"query":"language reference"}`); byNote["total"].(float64) != 1 {
		t.Errorf("the note was not searched: %v", byNote["total"])
	}

	byTag := toolCall(t, h, "search_bookmarks", `{"tag":"selfhosted"}`)
	if byTag["total"].(float64) != 1 {
		t.Errorf("the tag filter found %v", byTag["total"])
	}
}

/*
A truncated answer says it was truncated.

A model that does not know it was cut off answers "there are 20" when there are
three hundred, and nothing in the reply contradicts it.
*/
func TestATruncatedSearchSaysSo(t *testing.T) {
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)

	cut := toolCall(t, h, "search_bookmarks", `{"query":"","limit":1}`)
	if len(cut["bookmarks"].([]any)) != 1 {
		t.Fatalf("the limit was ignored: %v", cut["bookmarks"])
	}
	if cut["truncated"] != true {
		t.Error("a cut-off answer did not say so")
	}
	// The true count is still reported, so the model can say how many there are
	// without being handed all of them.
	if cut["total"].(float64) < 3 {
		t.Errorf("total = %v", cut["total"])
	}

	whole := toolCall(t, h, "search_bookmarks", `{"query":"sonarr"}`)
	if _, cutOff := whole["truncated"]; cutOff {
		t.Error("a complete answer claimed to be truncated")
	}
}

func TestGetBookmarkAnswersAboutOneAndSaysWhenThereIsNone(t *testing.T) {
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)

	found := toolCall(t, h, "get_bookmark", `{"url":"https://sonarr.example/"}`)
	if found["name"] != "Sonarr" {
		t.Errorf("name = %v", found["name"])
	}
	if tags, _ := found["tags"].([]any); len(tags) != 2 {
		t.Errorf("tags = %v", found["tags"])
	}

	missing := toolCall(t, h, "get_bookmark", `{"url":"https://nothing.example/"}`)
	if _, refused := missing["error"]; !refused {
		t.Errorf("a URL nobody saved answered %v", missing)
	}
}

// Commonest first: the tags that organise a collection are the ones to reach
// for, and alphabetical order buries them.
func TestTagsComeBackCommonestFirst(t *testing.T) {
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)

	tags, _ := toolCall(t, h, "list_tags", `{}`)["tags"].([]any)
	if len(tags) != 3 {
		t.Fatalf("got %v", tags)
	}
	// "archive" would come first alphabetically and "media" is the one that
	// organises this collection, which is the whole difference being asserted.
	first, _ := tags[0].(map[string]any)
	if first["tag"] != "media" || first["count"].(float64) != 2 {
		t.Errorf("first tag = %v", first)
	}
}

/*
Adding goes through the handler the browser posts to, so the refusals it makes
are the refusals here.

The duplicate check in particular: a second write path would file the same link
twice on one page, which the dashboard refuses every time.
*/
func TestAddingABookmarkGetsTheSameRefusalsAsTheBrowser(t *testing.T) {
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)

	added := toolCall(t, h, "add_bookmark", `{"url":"https://prowlarr.example/","name":"Prowlarr","tags":["media"]}`)
	if added["added"] != true {
		t.Fatalf("adding answered %v", added)
	}
	if findBookmarkByURLKey(h.store, canonicalBookmarkURLKey("https://prowlarr.example/")) == nil {
		t.Fatal("the bookmark was not stored")
	}

	again := toolCall(t, h, "add_bookmark", `{"url":"https://prowlarr.example/","name":"Prowlarr"}`)
	if _, refused := again["error"]; !refused {
		t.Errorf("the same URL went in twice: %v", again)
	}

	// A URL nothing can be done with is refused rather than stored empty.
	bad := toolCall(t, h, "add_bookmark", `{"url":"ftp://files.example/x"}`)
	if _, refused := bad["error"]; !refused {
		t.Errorf("an ftp bookmark was accepted: %v", bad)
	}
	if missing := toolCall(t, h, "add_bookmark", `{"name":"nothing"}`); missing["error"] == nil {
		t.Errorf("a bookmark with no URL was accepted: %v", missing)
	}
}

/*
A tool that refused says so in a way the model can act on.

isError means "the call worked and the tool said no", which is something to
read and respond to; a JSON-RPC error means the transport failed, which is only
something to retry.
*/
func TestARefusedToolCallIsMarkedAsSuchNotAsATransportFailure(t *testing.T) {
	h := newMCPHandlers(t)
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_bookmark","arguments":{"url":"https://nothing.example/"}}}`)
	if resp.Error != nil {
		t.Fatalf("a refusal came back as an RPC error: %+v", resp.Error)
	}
	result, _ := resp.Result.(map[string]any)
	if result["isError"] != true {
		t.Errorf("the refusal was not marked: %v", result)
	}
	// A client that cannot read structured output still gets the answer.
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		t.Fatal("no text content")
	}
	if text, _ := content[0].(map[string]any)["text"].(string); !strings.Contains(text, "error") {
		t.Errorf("the text form does not carry the refusal: %q", text)
	}

	// A tool nobody offers is a different thing: the model asked for something
	// that does not exist, which tools/list already told it.
	_, unknown := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"delete_everything","arguments":{}}}`)
	if unknown.Error == nil {
		t.Error("an unknown tool was treated as a call that ran")
	}
}

func listedToolNames(t *testing.T, h *Handlers) []string {
	t.Helper()
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	result, _ := resp.Result.(map[string]any)
	tools, _ := result["tools"].([]any)
	names := []string{}
	for _, entry := range tools {
		tool, _ := entry.(map[string]any)
		name, _ := tool["name"].(string)
		names = append(names, name)
	}
	return names
}

/*
A group that is off is absent from the list, not merely refused when called.

A model that sees a tool will try it, so the switch has to hide it.
*/
func TestGroupedToolsAreHiddenUntilTheirSwitchIsOn(t *testing.T) {
	h := newMCPHandlers(t)
	base := map[string]bool{"search_bookmarks": true, "get_bookmark": true, "list_tags": true, "add_bookmark": true, "list_pages": true}

	for _, name := range listedToolNames(t, h) {
		if !base[name] {
			t.Errorf("%s is listed with every group off", name)
		}
		delete(base, name)
	}
	for name := range base {
		t.Errorf("%s is not offered", name)
	}

	writeTools := []string{"update_bookmark", "move_bookmark", "delete_bookmark", "create_category", "rename_category"}
	turnOnBookmarksWrite(t, h)
	listed := map[string]bool{}
	for _, name := range listedToolNames(t, h) {
		listed[name] = true
	}
	for _, name := range writeTools {
		if !listed[name] {
			t.Errorf("%s is not offered with the bookmarks switch on", name)
		}
	}
	settings := h.store.GetSettings()
	settings.MCPBookmarksWrite = false
	settings.MCPHealthInbox = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	for _, name := range listedToolNames(t, h) {
		for _, w := range writeTools {
			if name == w {
				t.Errorf("%s is listed with the bookmarks switch off", name)
			}
		}
	}
	healthTools := map[string]bool{"get_health_summary": true, "list_health_issues": true, "list_inbox": true}
	for name := range healthTools {
		if mcpToolGroup(name) != mcpGroupHealthInbox {
			t.Errorf("%s is in group %q", name, mcpToolGroup(name))
		}
	}
	// Whatever is listed beyond the always-on ones must belong to the switch
	// that was just turned on.
	for _, name := range listedToolNames(t, h) {
		if g := mcpToolGroup(name); g != "" && g != mcpGroupHealthInbox {
			t.Errorf("%s (group %q) is listed with only the health switch on", name, g)
		}
	}
	if mcpGroupEnabled(settings, mcpGroupContainersControl) {
		t.Error("an unrelated group counts as enabled")
	}
	if !mcpGroupEnabled(settings, mcpGroupHealthInbox) || !mcpGroupEnabled(settings, "") {
		t.Error("the switched-on group or the always-on group counts as disabled")
	}
}

func TestAHiddenToolCannotBeCalledByName(t *testing.T) {
	h, first, _ := twoPageMCPInstall(t)
	before, _ := json.Marshal(h.store.GetAllBookmarks())
	for _, name := range []string{"list_inbox", "delete_bookmark"} {
		_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+name+`","arguments":{"url":"https://radarr.example/","page":`+strconv.Itoa(first)+`}}}`)
		if resp.Error == nil || resp.Error.Message != "Unknown tool: "+name {
			t.Fatalf("%s: got %+v", name, resp.Error)
		}
	}
	after, _ := json.Marshal(h.store.GetAllBookmarks())
	if string(before) != string(after) {
		t.Error("a hidden tool changed the data")
	}
}

func TestListPagesGivesIdsAndCategories(t *testing.T) {
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)
	pages := h.store.GetPages()
	if err := h.store.SaveCategoriesByPage(pages[0].ID, []Category{{ID: "media", Name: "Media"}}); err != nil {
		t.Fatal(err)
	}
	out := toolCall(t, h, "list_pages", `{}`)
	list, _ := out["pages"].([]any)
	if len(list) != len(pages) {
		t.Fatalf("%d pages came back, want %d", len(list), len(pages))
	}
	first, _ := list[0].(map[string]any)
	if int(first["id"].(float64)) != pages[0].ID || first["name"] != pages[0].Name {
		t.Errorf("first page is %v", first)
	}
	cats, _ := first["categories"].([]any)
	found := false
	for _, c := range cats {
		cm, _ := c.(map[string]any)
		if cm["id"] == "media" && cm["name"] == "Media" {
			found = true
		}
	}
	if !found {
		t.Errorf("category media missing from %v", cats)
	}
}

func TestToolsCarryReadOnlyAnnotations(t *testing.T) {
	h := newMCPHandlers(t)
	turnOnBookmarksWrite(t, h)
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	result, _ := resp.Result.(map[string]any)
	tools, _ := result["tools"].([]any)
	writers := map[string]bool{
		"add_bookmark": true, "update_bookmark": true, "move_bookmark": true,
		"delete_bookmark": true, "create_category": true, "rename_category": true,
	}
	seenDelete := false
	for _, entry := range tools {
		tool, _ := entry.(map[string]any)
		name, _ := tool["name"].(string)
		ann, _ := tool["annotations"].(map[string]any)
		readOnly, _ := ann["readOnlyHint"].(bool)
		destructive, _ := ann["destructiveHint"].(bool)
		if writers[name] {
			if readOnly {
				t.Errorf("%s claims to be read only", name)
			}
			if name == "delete_bookmark" {
				seenDelete = true
				if !destructive {
					t.Error("delete_bookmark is not marked destructive")
				}
			} else if destructive {
				t.Errorf("%s is marked destructive", name)
			}
			continue
		}
		if !readOnly {
			t.Errorf("%v has no readOnlyHint", name)
		}
	}
	if !seenDelete {
		t.Error("delete_bookmark is not offered")
	}
}

// twoPageMCPInstall is the seeded install plus a second page "Work", with the
// first page's categories "Media" (id media) and "Docs" (id docs).
func twoPageMCPInstall(t *testing.T) (*Handlers, int, int) {
	t.Helper()
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)
	first := h.store.GetPages()[0].ID
	second := first + 1
	body, _ := json.Marshal(append(h.store.GetPages(), Page{ID: second, Name: "Work"}))
	rec := httptest.NewRecorder()
	h.SavePages(rec, httptest.NewRequest(http.MethodPost, "/api/pages", strings.NewReader(string(body))))
	if rec.Code != http.StatusOK {
		t.Fatalf("save pages: %d %s", rec.Code, rec.Body.String())
	}
	if err := h.store.SaveCategoriesByPage(first, []Category{{ID: "media", Name: "Media"}, {ID: "docs", Name: "Docs"}}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SaveCategoriesByPage(second, []Category{{ID: "inbox", Name: "Inbox"}}); err != nil {
		t.Fatal(err)
	}
	return h, first, second
}

func bookmarkOnPage(h *Handlers, page int, url string) *Bookmark {
	return findBookmarkByURLKeyOnPage(h.store, page, canonicalBookmarkURLKey(url))
}

func turnOnBookmarksWrite(t *testing.T, h *Handlers) {
	t.Helper()
	settings := h.store.GetSettings()
	settings.MCPBookmarksWrite = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateBookmarkChangesNoteAndTagsOnly(t *testing.T) {
	h, first, _ := twoPageMCPInstall(t)
	turnOnBookmarksWrite(t, h)

	out := toolCall(t, h, "update_bookmark", `{"url":"https://sonarr.example/","name":"Sonarr TV","note":"tv shows","tags_add":["tv"],"tags_remove":["selfhosted"]}`)
	if out["updated"] != true {
		t.Fatalf("answered %v", out)
	}
	bm := bookmarkOnPage(h, first, "https://sonarr.example/")
	if bm == nil {
		t.Fatal("the bookmark is gone")
	}
	if bm.Name != "Sonarr TV" || bm.Note != "tv shows" {
		t.Errorf("name %q note %q", bm.Name, bm.Note)
	}
	if strings.Join(bm.Tags, ",") != "media,tv" {
		t.Errorf("tags %v", bm.Tags)
	}
	if bm.URL != "https://sonarr.example/" {
		t.Errorf("the URL changed to %q", bm.URL)
	}
	if other := bookmarkOnPage(h, first, "https://radarr.example/"); other == nil || other.Name != "Radarr" {
		t.Errorf("another bookmark was touched: %v", other)
	}
	if missing := toolCall(t, h, "update_bookmark", `{"url":"https://nothing.example/","note":"x"}`); missing["error"] == nil {
		t.Errorf("an unknown URL was accepted: %v", missing)
	}
}

func TestMoveBookmarkLandsInTheTargetCategory(t *testing.T) {
	h, first, second := twoPageMCPInstall(t)
	turnOnBookmarksWrite(t, h)

	out := toolCall(t, h, "move_bookmark", `{"url":"https://radarr.example/","to_page":`+strconv.Itoa(second)+`,"to_category":"inbox"}`)
	if out["moved"] != true {
		t.Fatalf("answered %v", out)
	}
	if bookmarkOnPage(h, first, "https://radarr.example/") != nil {
		t.Error("it is still on the first page")
	}
	moved := bookmarkOnPage(h, second, "https://radarr.example/")
	if moved == nil || moved.Category != "inbox" {
		t.Fatalf("on the second page: %v", moved)
	}

	// The category may be named instead of identified.
	byName := toolCall(t, h, "move_bookmark", `{"url":"https://sonarr.example/","to_page":`+strconv.Itoa(second)+`,"to_category":"Inbox"}`)
	if byName["moved"] != true {
		t.Fatalf("by name: %v", byName)
	}
	if got := bookmarkOnPage(h, second, "https://sonarr.example/"); got == nil || got.Category != "inbox" {
		t.Errorf("by name landed in %v", got)
	}

	// A category the target page does not have is refused, and nothing moves.
	bad := toolCall(t, h, "move_bookmark", `{"url":"https://go.dev/doc/","to_page":`+strconv.Itoa(second)+`,"to_category":"nope"}`)
	if bad["error"] == nil || bookmarkOnPage(h, first, "https://go.dev/doc/") == nil {
		t.Errorf("a made-up category: %v", bad)
	}
}

func TestDeleteBookmarkIsLoggedAndRestorable(t *testing.T) {
	h, first, _ := twoPageMCPInstall(t)
	turnOnBookmarksWrite(t, h)
	toolCall(t, h, "update_bookmark", `{"url":"https://radarr.example/","note":"movies"}`)

	lines := captureActivityLogs(t, func() {
		cfg := activityConfig()
		cfg.enabled = map[string]bool{activityCategoryMutate: true}
		resetActivityLogForTest(cfg)
		out := toolCall(t, h, "delete_bookmark", `{"url":"https://radarr.example/"}`)
		if out["deleted"] != true {
			t.Fatalf("answered %v", out)
		}
	})
	if bookmarkOnPage(h, first, "https://radarr.example/") != nil {
		t.Error("the bookmark is still there")
	}
	found := false
	for _, line := range lines {
		if strings.Contains(line, `"event":"bookmark.delete"`) && strings.Contains(line, `"source":"mcp"`) && strings.Contains(line, `"name":"Radarr"`) {
			found = true
		}
	}
	if !found {
		t.Errorf("no bookmark.delete entry with source mcp in %v", lines)
	}
	items := h.store.GetTrashItems()
	if len(items) != 1 || items[0].Bookmark.URL != "https://radarr.example/" || items[0].PageID != first {
		t.Fatalf("the trash holds %+v", items)
	}
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+items[0].ID+`"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body.String())
	}
	back := bookmarkOnPage(h, first, "https://radarr.example/")
	if back == nil || back.Name != "Radarr" || strings.Join(back.Tags, ",") != "media" || back.Note != "movies" {
		t.Fatalf("restored as %+v", back)
	}
	if again := toolCall(t, h, "delete_bookmark", `{"url":"https://nothing.example/"}`); again["error"] == nil {
		t.Errorf("deleting twice answered %v", again)
	}
}

func TestAmbiguousUrlNeedsAPage(t *testing.T) {
	h, first, second := twoPageMCPInstall(t)
	turnOnBookmarksWrite(t, h)
	if err := h.store.SaveBookmarksByPage(second, []Bookmark{{Name: "Radarr again", URL: "https://radarr.example/", PageID: second}}); err != nil {
		t.Fatal(err)
	}
	before := len(h.store.GetAllBookmarks())

	for tool, args := range map[string]string{
		"update_bookmark": `{"url":"https://radarr.example/","note":"x"}`,
		"move_bookmark":   `{"url":"https://radarr.example/","to_page":` + strconv.Itoa(second) + `}`,
		"delete_bookmark": `{"url":"https://radarr.example/"}`,
	} {
		out := toolCall(t, h, tool, args)
		if out["error"] == nil {
			t.Errorf("%s picked a page on its own: %v", tool, out)
			continue
		}
		pages, _ := out["pages"].([]any)
		if len(pages) != 2 {
			t.Errorf("%s listed %v", tool, out["pages"])
		}
	}
	if len(h.store.GetAllBookmarks()) != before {
		t.Error("the data changed")
	}
	if bm := bookmarkOnPage(h, first, "https://radarr.example/"); bm == nil || bm.Note != "" {
		t.Errorf("the first copy is %v", bm)
	}
	// With a page it goes through.
	if out := toolCall(t, h, "delete_bookmark", `{"url":"https://radarr.example/","page":`+strconv.Itoa(second)+`}`); out["deleted"] != true {
		t.Errorf("with a page: %v", out)
	}
	if bookmarkOnPage(h, first, "https://radarr.example/") == nil {
		t.Error("the other page's copy went too")
	}
}

func TestWriteToolsRefuseWithoutTheToken(t *testing.T) {
	h, first, second := twoPageMCPInstall(t)
	turnOnBookmarksWrite(t, h)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret")
	before, _ := json.Marshal(h.store.GetAllBookmarks())
	cats, _ := json.Marshal(h.store.GetCategoriesByPage(first))

	calls := map[string]string{
		"update_bookmark": `{"url":"https://radarr.example/","note":"x"}`,
		"move_bookmark":   `{"url":"https://radarr.example/","to_page":` + strconv.Itoa(second) + `}`,
		"delete_bookmark": `{"url":"https://radarr.example/"}`,
		"create_category": `{"page":` + strconv.Itoa(first) + `,"name":"New"}`,
		"rename_category": `{"page":` + strconv.Itoa(first) + `,"category":"media","name":"Shows"}`,
	}
	for tool, args := range calls {
		_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+tool+`","arguments":`+args+`}}`)
		result, _ := resp.Result.(map[string]any)
		if resp.Error != nil || result["isError"] != true {
			t.Errorf("%s without the token: %+v %v", tool, resp.Error, result)
		}
		// The refusal is ours and says what to do, not the inner handler's bare
		// "Unauthorized".
		if payload, _ := result["structuredContent"].(map[string]any); payload["error"] != "This tool needs the write token." {
			t.Errorf("%s refused with %v", tool, payload["error"])
		}
	}
	after, _ := json.Marshal(h.store.GetAllBookmarks())
	catsAfter, _ := json.Marshal(h.store.GetCategoriesByPage(first))
	if string(before) != string(after) || string(cats) != string(catsAfter) {
		t.Error("data changed without the token")
	}

	// With the token the same call works.
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"delete_bookmark","arguments":{"url":"https://radarr.example/"}}}`, [2]string{"X-NextDash-Token", "secret"})
	result, _ := resp.Result.(map[string]any)
	if result["isError"] == true {
		t.Errorf("with the token: %v", result)
	}
}

func TestCategoryToolsRefuseADuplicateName(t *testing.T) {
	h, first, _ := twoPageMCPInstall(t)
	turnOnBookmarksWrite(t, h)

	out := toolCall(t, h, "create_category", `{"page":`+strconv.Itoa(first)+`,"name":"Games"}`)
	if out["created"] != true || out["category"] != "games" {
		t.Fatalf("answered %v", out)
	}
	if categoryNameForID(h.store, first, "games") != "Games" {
		t.Error("the category was not stored")
	}
	if dup := toolCall(t, h, "create_category", `{"page":`+strconv.Itoa(first)+`,"name":" media "}`); dup["error"] == nil {
		t.Errorf("a duplicate was created: %v", dup)
	}
	if n := len(h.store.GetCategoriesByPage(first)); n != 3 {
		t.Errorf("%d categories", n)
	}

	// Rename keeps the id, so the bookmarks in it stay in it.
	if renamed := toolCall(t, h, "rename_category", `{"page":`+strconv.Itoa(first)+`,"category":"Docs","name":"Reference"}`); renamed["renamed"] != true {
		t.Fatalf("rename answered %v", renamed)
	}
	if categoryNameForID(h.store, first, "docs") != "Reference" {
		t.Error("the name did not change")
	}
	if dup := toolCall(t, h, "rename_category", `{"page":`+strconv.Itoa(first)+`,"category":"docs","name":"media"}`); dup["error"] == nil {
		t.Errorf("renamed onto an existing name: %v", dup)
	}
	if missing := toolCall(t, h, "rename_category", `{"page":`+strconv.Itoa(first)+`,"category":"zzz","name":"X"}`); missing["error"] == nil {
		t.Errorf("renamed a category that is not there: %v", missing)
	}
}

func TestWriteToolsAreHiddenWhenTheirSwitchIsOff(t *testing.T) {
	h := newMCPHandlers(t)
	tools := []string{"update_bookmark", "move_bookmark", "delete_bookmark", "create_category", "rename_category"}
	has := func() map[string]bool {
		seen := map[string]bool{}
		for _, n := range listedToolNames(t, h) {
			seen[n] = true
		}
		return seen
	}
	for n := range has() {
		for _, tool := range tools {
			if n == tool {
				t.Errorf("%s is listed with the switch off", n)
			}
		}
	}
	turnOnBookmarksWrite(t, h)
	seen := has()
	for _, tool := range tools {
		if !seen[tool] {
			t.Errorf("%s is missing with the switch on", tool)
		}
	}
}
