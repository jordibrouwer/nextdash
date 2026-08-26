package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

/*
An MCP server, so an assistant can read and add bookmarks.

The reason this exists rather than "point the model at the REST API": an
assistant cannot discover a REST API. It can be told about one in a prompt, and
then the prompt is a copy of the API that goes stale. MCP is the same endpoints
with a discovery call in front, so the model asks what this install can do and
gets an answer that is generated from the same code that serves it.

Written against the stdlib rather than the official SDK. The SDK is not a large
dependency, but this whole program has one, and what is needed here is a JSON
envelope, four tool descriptions and a switch -- the SDK's value is in the
transports and session handling that the current revision no longer requires.

Three deliberate restrictions:

Off unless switched on. This endpoint answers questions about every bookmark in
the install, and adding "somebody could read my whole dashboard" to a default
install is not a thing to do quietly.

Origin is checked. A browser will happily let any page on the internet POST to
localhost, and a local server that answers those posts is a page away from
being read by whoever the reader visited last. Same-origin or no Origin header
at all (which is what a non-browser client sends) gets through; anything else
does not.

Writing goes through the same handler the browser uses. The duplicate check,
the URL validation, the activity log and the outgoing webhook all live there,
and a second path into the store would be a second place for all four to be
forgotten.
*/

// mcpProtocolVersion is the revision this speaks. A client asking for another
// one is answered in its own version when it is one we know, because the
// negotiation exists precisely so neither side has to be upgraded first.
const mcpProtocolVersion = "2026-07-28"

var mcpSupportedVersions = map[string]bool{
	"2026-07-28": true,
	"2025-06-18": true,
	"2025-03-26": true,
}

// mcpSearchDefaultLimit and mcpSearchMaxLimit bound a result set. A model pays
// for every token of the answer, so "all 4000 bookmarks" is not a useful reply
// to a search even when it is the true one.
const (
	mcpSearchDefaultLimit = 20
	mcpSearchMaxLimit     = 100
)

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *jsonRPCError   `json:"error,omitempty"`
}

// The JSON-RPC codes this uses. Standard values: a client library maps them to
// its own errors, and inventing numbers here would produce "unknown error".
const (
	jsonRPCParseError     = -32700
	jsonRPCInvalidRequest = -32600
	jsonRPCMethodNotFound = -32601
	jsonRPCInvalidParams  = -32602
	jsonRPCInternalError  = -32603
)

/*
mcpToolDefinitions is what tools/list answers.

Descriptions are written for a model deciding whether to call the tool, which
is a different reader from the one the config screen is written for: it needs
to know what the tool returns and when it is the wrong one, and it has no
screen to look at while it decides.
*/
func mcpToolDefinitions() []map[string]any {
	return []map[string]any{
		{
			"name": "search_bookmarks",
			"description": "Search the bookmarks in this nextDash install by name, URL, tag or note. " +
				"Returns the matching bookmarks with the page and category they are filed under. " +
				"Use an empty query to list what is there.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "Words to look for. Every word must appear somewhere in the bookmark.",
					},
					"tag": map[string]any{
						"type":        "string",
						"description": "Only bookmarks carrying this tag.",
					},
					"limit": map[string]any{
						"type":        "integer",
						"description": fmt.Sprintf("How many to return, at most %d. Defaults to %d.", mcpSearchMaxLimit, mcpSearchDefaultLimit),
					},
				},
			},
		},
		{
			"name": "get_bookmark",
			"description": "Look up one bookmark by its exact URL, with everything stored about it: " +
				"note, tags, when it was added, when it was last opened, and whether its last check succeeded.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url": map[string]any{"type": "string", "description": "The bookmark's URL."},
				},
				"required": []string{"url"},
			},
		},
		{
			"name": "list_tags",
			"description": "Every tag in use, with how many bookmarks carry it. " +
				"Useful before searching, since tags are the reader's own vocabulary and cannot be guessed.",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			"name": "add_bookmark",
			"description": "Add a bookmark. Fails if the URL is already filed on the page it would land on. " +
				"Leave page empty to use the first page.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url":      map[string]any{"type": "string", "description": "The address to save."},
					"name":     map[string]any{"type": "string", "description": "What to call it. Defaults to the host."},
					"page":     map[string]any{"type": "integer", "description": "Page id to file it on."},
					"category": map[string]any{"type": "string", "description": "Category id on that page."},
					"tags":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"note":     map[string]any{"type": "string", "description": "A note to keep with it."},
				},
				"required": []string{"url"},
			},
		},
	}
}

/*
MCPHandler is the whole server: one POST endpoint carrying JSON-RPC.

No GET, no event stream and no session id. The current revision makes all three
optional, and none of them buys anything for a server whose calls all answer
immediately.
*/
func (h *Handlers) MCPHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !h.store.GetSettings().MCPEnabled {
		http.Error(w, "The MCP endpoint is switched off", http.StatusNotFound)
		return
	}
	if !mcpOriginAllowed(r) {
		// Deliberately not an RPC error: the request never became a
		// conversation, and answering one would be answering the page that
		// should not have been able to ask.
		http.Error(w, "Origin not allowed", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req jsonRPCRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSONRPC(w, jsonRPCResponse{JSONRPC: "2.0", Error: &jsonRPCError{
			Code: jsonRPCParseError, Message: "Could not parse the request",
		}})
		return
	}

	// A notification has no id and takes no answer -- 202 with an empty body is
	// what the spec asks for, and a client that sent "initialized" is not
	// waiting for anything.
	if len(req.ID) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	if req.JSONRPC != "2.0" {
		writeJSONRPC(w, jsonRPCResponse{JSONRPC: "2.0", ID: req.ID, Error: &jsonRPCError{
			Code: jsonRPCInvalidRequest, Message: "Expected jsonrpc 2.0",
		}})
		return
	}

	writeJSONRPC(w, h.dispatchMCP(r, req))
}

func writeJSONRPC(w http.ResponseWriter, resp jsonRPCResponse) {
	w.Header().Set("Content-Type", "application/json")
	// Always 200: a JSON-RPC error is a successful exchange carrying a refusal,
	// and a client reading the status instead of the body would see a transport
	// failure where there is an answer.
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *Handlers) dispatchMCP(r *http.Request, req jsonRPCRequest) jsonRPCResponse {
	resp := jsonRPCResponse{JSONRPC: "2.0", ID: req.ID}
	switch req.Method {
	case "initialize":
		resp.Result = h.mcpInitialize(req.Params)
	case "ping":
		// The spec's keepalive. An empty object is the whole answer.
		resp.Result = map[string]any{}
	case "tools/list":
		resp.Result = map[string]any{"tools": mcpToolDefinitions()}
	case "tools/call":
		result, err := h.mcpCallTool(r, req.Params)
		if err != nil {
			resp.Error = err
			return resp
		}
		resp.Result = result
	default:
		resp.Error = &jsonRPCError{Code: jsonRPCMethodNotFound, Message: "Unknown method: " + req.Method}
	}
	return resp
}

func (h *Handlers) mcpInitialize(params json.RawMessage) map[string]any {
	var body struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	_ = json.Unmarshal(params, &body)
	version := mcpProtocolVersion
	if mcpSupportedVersions[body.ProtocolVersion] {
		version = body.ProtocolVersion
	}
	title := strings.TrimSpace(h.store.GetSettings().CustomTitle)
	if title == "" {
		title = "nextDash"
	}
	return map[string]any{
		"protocolVersion": version,
		// Only tools. No resources and no prompts: a resource list would be
		// every bookmark as a URI, which is the same data search_bookmarks
		// returns and a far larger thing to hand a model unasked.
		"capabilities": map[string]any{"tools": map[string]any{}},
		"serverInfo": map[string]any{
			"name":    "nextdash",
			"title":   title,
			"version": buildVersion,
		},
	}
}

func (h *Handlers) mcpCallTool(r *http.Request, params json.RawMessage) (map[string]any, *jsonRPCError) {
	var body struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &body); err != nil {
		return nil, &jsonRPCError{Code: jsonRPCInvalidParams, Message: "Could not read the tool call"}
	}

	switch body.Name {
	case "search_bookmarks":
		return mcpToolResult(h.mcpSearchBookmarks(body.Arguments)), nil
	case "get_bookmark":
		return mcpToolResult(h.mcpGetBookmark(body.Arguments)), nil
	case "list_tags":
		return mcpToolResult(h.mcpListTags()), nil
	case "add_bookmark":
		return mcpToolResult(h.mcpAddBookmark(r, body.Arguments)), nil
	}
	return nil, &jsonRPCError{Code: jsonRPCInvalidParams, Message: "Unknown tool: " + body.Name}
}

/*
mcpToolResult wraps an answer the way the protocol expects.

Both forms are filled: structuredContent for a client that can read JSON, and
the same JSON as text for one that cannot. Sending only the structured form
leaves the older clients with an empty message rather than an error, which is
the worst of the three outcomes.

A tool that refused sets isError, rather than returning an RPC error: the
distinction is that the call worked and the tool said no, which is something
the model can act on instead of a transport failure it can only retry.
*/
func mcpToolResult(payload map[string]any) map[string]any {
	encoded, err := json.Marshal(payload)
	if err != nil {
		encoded = []byte(`{"error":"could not encode the result"}`)
	}
	result := map[string]any{
		"content":           []map[string]any{{"type": "text", "text": string(encoded)}},
		"structuredContent": payload,
	}
	if _, refused := payload["error"]; refused {
		result["isError"] = true
	}
	return result
}

func (h *Handlers) mcpSearchBookmarks(args json.RawMessage) map[string]any {
	var body struct {
		Query string `json:"query"`
		Tag   string `json:"tag"`
		Limit int    `json:"limit"`
	}
	_ = json.Unmarshal(args, &body)

	limit := body.Limit
	if limit <= 0 {
		limit = mcpSearchDefaultLimit
	}
	if limit > mcpSearchMaxLimit {
		limit = mcpSearchMaxLimit
	}

	// Every word has to appear somewhere in the bookmark. Matching any word
	// instead would make a two-word search broader than a one-word search,
	// which is the opposite of what typing a second word means.
	words := strings.Fields(strings.ToLower(strings.TrimSpace(body.Query)))
	tag := strings.ToLower(strings.TrimSpace(body.Tag))

	matches := []map[string]any{}
	total := 0
	for _, bm := range h.store.GetAllBookmarks() {
		if tag != "" && !bookmarkHasTag(bm, tag) {
			continue
		}
		if !bookmarkMatchesWords(bm, words) {
			continue
		}
		total++
		if len(matches) < limit {
			matches = append(matches, h.mcpBookmarkSummary(bm))
		}
	}
	out := map[string]any{"bookmarks": matches, "total": total}
	if total > len(matches) {
		// Said out loud rather than left to be inferred from the count: a model
		// that does not know it was cut off will answer "there are 20" when
		// there are 300.
		out["truncated"] = true
	}
	return out
}

func bookmarkHasTag(bm Bookmark, tag string) bool {
	for _, t := range bm.Tags {
		if strings.ToLower(strings.TrimSpace(t)) == tag {
			return true
		}
	}
	return false
}

func bookmarkMatchesWords(bm Bookmark, words []string) bool {
	if len(words) == 0 {
		return true
	}
	haystack := strings.ToLower(strings.Join([]string{
		bm.Name, bm.URL, bm.Note, strings.Join(bm.Tags, " "),
	}, " "))
	for _, word := range words {
		if !strings.Contains(haystack, word) {
			return false
		}
	}
	return true
}

// mcpBookmarkSummary is a bookmark as a model should see it: the page and
// category by name rather than by id, because an id means nothing to a reader
// who cannot look it up, and everything internal left out.
func (h *Handlers) mcpBookmarkSummary(bm Bookmark) map[string]any {
	out := map[string]any{
		"name": strings.TrimSpace(bm.Name),
		"url":  strings.TrimSpace(bm.URL),
		"page": pageNameForID(h.store, bm.PageID),
	}
	if bm.PageID != 0 {
		out["pageId"] = bm.PageID
	}
	if name := categoryNameForID(h.store, bm.PageID, bm.Category); name != "" {
		out["category"] = name
	}
	if len(bm.Tags) > 0 {
		out["tags"] = bm.Tags
	}
	if note := strings.TrimSpace(bm.Note); note != "" {
		out["note"] = note
	}
	return out
}

func (h *Handlers) mcpGetBookmark(args json.RawMessage) map[string]any {
	var body struct {
		URL string `json:"url"`
	}
	_ = json.Unmarshal(args, &body)

	key := canonicalBookmarkURLKey(body.URL)
	if key == "" {
		return map[string]any{"error": "A URL is required."}
	}
	found := findBookmarkByURLKey(h.store, key)
	if found == nil {
		return map[string]any{"error": "No bookmark with that URL."}
	}

	out := h.mcpBookmarkSummary(*found)
	// The fields a search result leaves out, because they are what somebody
	// asks about one bookmark: when it arrived, when it was last used, and
	// whether it still answers.
	if found.CreatedAt > 0 {
		out["createdAt"] = found.CreatedAt
	}
	if found.LastOpened > 0 {
		out["lastOpened"] = found.LastOpened
	}
	if found.OpenCount > 0 {
		out["openCount"] = found.OpenCount
	}
	if found.LastChecked > 0 {
		out["lastChecked"] = found.LastChecked
		out["reachable"] = found.LastError == ""
		if found.LastError != "" {
			out["lastError"] = found.LastError
		}
	}
	return out
}

func (h *Handlers) mcpListTags() map[string]any {
	counts := map[string]int{}
	for _, bm := range h.store.GetAllBookmarks() {
		for _, raw := range bm.Tags {
			if tag := strings.TrimSpace(raw); tag != "" {
				counts[tag]++
			}
		}
	}
	names := make([]string, 0, len(counts))
	for tag := range counts {
		names = append(names, tag)
	}
	// Commonest first: the tags that organise this collection are the ones a
	// model should reach for, and an alphabetical list buries them.
	sort.Slice(names, func(i, j int) bool {
		if counts[names[i]] != counts[names[j]] {
			return counts[names[i]] > counts[names[j]]
		}
		return names[i] < names[j]
	})
	tags := make([]map[string]any, 0, len(names))
	for _, tag := range names {
		tags = append(tags, map[string]any{"tag": tag, "count": counts[tag]})
	}
	return map[string]any{"tags": tags}
}

/*
mcpAddBookmark delegates to the handler the browser posts to.

Everything that makes a saved bookmark correct lives there: the URL validation,
the cross-page duplicate check that answers with where the link already is, the
activity log entry and the outgoing webhook. A second write path would be a
second place to forget all four, and it would be forgotten in the one that
nobody watches.
*/
func (h *Handlers) mcpAddBookmark(r *http.Request, args json.RawMessage) map[string]any {
	var body struct {
		URL      string   `json:"url"`
		Name     string   `json:"name"`
		Page     int      `json:"page"`
		Category string   `json:"category"`
		Tags     []string `json:"tags"`
		Note     string   `json:"note"`
	}
	if err := json.Unmarshal(args, &body); err != nil {
		return map[string]any{"error": "Could not read the arguments."}
	}
	if strings.TrimSpace(body.URL) == "" {
		return map[string]any{"error": "A URL is required."}
	}

	page := body.Page
	if page == 0 {
		pages := h.store.GetPages()
		if len(pages) == 0 {
			return map[string]any{"error": "This install has no pages to file a bookmark on."}
		}
		page = pages[0].ID
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		// The host, which is what the browser's own add form falls back to.
		if parsed, err := url.Parse(strings.TrimSpace(body.URL)); err == nil {
			name = parsed.Hostname()
		}
	}

	payload, err := json.Marshal(map[string]any{
		"page": page,
		"bookmark": map[string]any{
			"name": name, "url": strings.TrimSpace(body.URL),
			"category": strings.TrimSpace(body.Category),
			"tags":     body.Tags, "note": strings.TrimSpace(body.Note),
		},
	})
	if err != nil {
		return map[string]any{"error": "Could not encode the bookmark."}
	}

	inner, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "/api/bookmarks/add", bytes.NewReader(payload))
	if err != nil {
		return map[string]any{"error": "Could not build the request."}
	}
	inner.Header.Set("Content-Type", "application/json")
	// The write token travels with the MCP call, so it has to travel on to the
	// handler that checks it -- otherwise an install that demands one would
	// refuse every write through here regardless of what the caller sent.
	if token := r.Header.Get("X-NextDash-Token"); token != "" {
		inner.Header.Set("X-NextDash-Token", token)
	}
	inner.RemoteAddr = r.RemoteAddr

	recorder := &bufferedResponse{header: http.Header{}}
	h.AddBookmark(recorder, inner)

	if recorder.status >= 400 {
		message := strings.TrimSpace(recorder.body.String())
		// The duplicate refusal answers in JSON and says where the link already
		// lives, which is the useful half of it.
		var refusal map[string]any
		if json.Unmarshal(recorder.body.Bytes(), &refusal) == nil {
			refusal["error"] = firstString(refusal["message"], "The bookmark was refused.")
			delete(refusal, "message")
			return refusal
		}
		if message == "" {
			message = fmt.Sprintf("The bookmark was refused (HTTP %d).", recorder.status)
		}
		return map[string]any{"error": message}
	}
	return map[string]any{
		"added": true,
		"name":  name,
		"url":   strings.TrimSpace(body.URL),
		"page":  pageNameForID(h.store, page),
	}
}

func firstString(value any, fallback string) string {
	if s, ok := value.(string); ok && strings.TrimSpace(s) != "" {
		return s
	}
	return fallback
}

// bufferedResponse collects what a handler writes so it can be read back
// instead of sent. Enough of http.ResponseWriter for a handler that writes a
// status, some headers and a body, which is all of them here.
type bufferedResponse struct {
	header http.Header
	body   bytes.Buffer
	status int
}

func (b *bufferedResponse) Header() http.Header { return b.header }

func (b *bufferedResponse) Write(p []byte) (int, error) {
	if b.status == 0 {
		b.status = http.StatusOK
	}
	return b.body.Write(p)
}

func (b *bufferedResponse) WriteHeader(status int) {
	if b.status == 0 {
		b.status = status
	}
}

/*
mcpOriginAllowed keeps a web page from talking to this endpoint.

A browser sends Origin on every cross-site POST and will make that POST to
localhost without asking anyone, so a local server that answers is one visited
page away from being read by whoever wrote it. A client that is not a browser
sends no Origin at all, and that is the normal case here -- so an absent header
passes and a present one has to match the host being posted to.
*/
func mcpOriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	// Compared on host and port, ignoring scheme: an install behind a proxy is
	// reached over https while the server itself speaks http, and refusing that
	// would refuse the dashboard's own page.
	originHost, originPort := splitHostPortLoose(parsed.Host)
	requestHost, requestPort := splitHostPortLoose(requestHostHeader(r))
	if !strings.EqualFold(originHost, requestHost) {
		return false
	}
	return originPort == requestPort || originPort == "" || requestPort == ""
}

func requestHostHeader(r *http.Request) string {
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwarded != "" {
		if first, _, ok := strings.Cut(forwarded, ","); ok {
			return strings.TrimSpace(first)
		}
		return forwarded
	}
	return r.Host
}

func splitHostPortLoose(hostport string) (host, port string) {
	if h, p, err := net.SplitHostPort(hostport); err == nil {
		return h, p
	}
	return hostport, ""
}
