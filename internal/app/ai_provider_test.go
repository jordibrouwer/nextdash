package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// aiFake starts a provider stand-in and points the package at it.
func aiFake(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	prevA, prevO, prevClient, prevWait := aiAnthropicBaseURL, aiOpenAIBaseURL, aiHTTPClient, aiRetryWait
	aiAnthropicBaseURL = srv.URL
	aiOpenAIBaseURL = srv.URL + "/v1"
	aiHTTPClient = func(bool) *http.Client { return srv.Client() }
	t.Cleanup(func() {
		aiAnthropicBaseURL, aiOpenAIBaseURL, aiHTTPClient, aiRetryWait = prevA, prevO, prevClient, prevWait
	})
	return srv
}

func sseWrite(w http.ResponseWriter, event, data string) {
	if event != "" {
		fmt.Fprintf(w, "event: %s\n", event)
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func testAnthropic() *anthropicProvider {
	return &anthropicProvider{base: aiAnthropicBaseURL, key: "sk-ant-test", model: "claude-test", client: aiHTTPClient(false)}
}

func testOpenAI() *openAIProvider {
	return &openAIProvider{base: aiOpenAIBaseURL, key: "sk-test", model: "gpt-test", label: "OpenAI", client: aiHTTPClient(false)}
}

func TestAnthropicPlainAnswerStreams(t *testing.T) {
	var gotHeaders http.Header
	var gotBody map[string]any
	var gotPath string
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		gotHeaders, gotPath = r.Header.Clone(), r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "text/event-stream")
		sseWrite(w, "message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-test","usage":{"input_tokens":12,"output_tokens":1}}}`)
		sseWrite(w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
		sseWrite(w, "ping", `{"type":"ping"}`)
		sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`)
		sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}`)
		sseWrite(w, "content_block_stop", `{"type":"content_block_stop","index":0}`)
		sseWrite(w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":3}}`)
		sseWrite(w, "message_stop", `{"type":"message_stop"}`)
	})
	var chunks []string
	reply, err := testAnthropic().Chat(context.Background(), aiChatRequest{
		System:    "be brief",
		Messages:  []aiWireMessage{{Role: "user", Text: "hi"}},
		MaxTokens: 1024,
	}, func(s string) { chunks = append(chunks, s) })
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(chunks, "|") != "Hello| world" {
		t.Fatalf("chunks: %q", chunks)
	}
	if reply.Text != "Hello world" || reply.TokensIn != 12 || reply.TokensOut != 3 {
		t.Fatalf("reply: %+v", reply)
	}
	if gotPath != "/v1/messages" {
		t.Fatalf("path %q", gotPath)
	}
	if gotHeaders.Get("x-api-key") != "sk-ant-test" || gotHeaders.Get("anthropic-version") != "2023-06-01" {
		t.Fatalf("headers: %v", gotHeaders)
	}
	if gotBody["stream"] != true || gotBody["max_tokens"] != float64(1024) || gotBody["system"] != "be brief" || gotBody["model"] != "claude-test" {
		t.Fatalf("body: %v", gotBody)
	}
}

func TestAnthropicToolUseIsAssembled(t *testing.T) {
	var bodies []map[string]any
	var mu sync.Mutex
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		bodies = append(bodies, body)
		n := len(bodies)
		mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		sseWrite(w, "message_start", `{"type":"message_start","message":{"id":"msg_1","role":"assistant","content":[],"usage":{"input_tokens":40,"output_tokens":1}}}`)
		if n == 1 {
			sseWrite(w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
			sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me look."}}`)
			sseWrite(w, "content_block_stop", `{"type":"content_block_stop","index":0}`)
			sseWrite(w, "content_block_start", `{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"search_bookmarks","input":{}}}`)
			sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}`)
			sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"que"}}`)
			sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"ry\":\"x\"}"}}`)
			sseWrite(w, "content_block_stop", `{"type":"content_block_stop","index":1}`)
			sseWrite(w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}`)
		} else {
			sseWrite(w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
			sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Found it."}}`)
			sseWrite(w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}`)
		}
		sseWrite(w, "message_stop", `{"type":"message_stop"}`)
	})
	p := testAnthropic()
	tools := []aiToolSpec{{Name: "search_bookmarks", Description: "search", Schema: map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}}}}
	msgs := []aiWireMessage{{Role: "user", Text: "find x"}}
	reply, err := p.Chat(context.Background(), aiChatRequest{Messages: msgs, Tools: tools, MaxTokens: 500}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(reply.ToolCalls) != 1 {
		t.Fatalf("calls: %+v", reply.ToolCalls)
	}
	call := reply.ToolCalls[0]
	if call.ID != "toolu_01" || call.Name != "search_bookmarks" || string(call.Arguments) != `{"query":"x"}` {
		t.Fatalf("call: %+v %s", call, call.Arguments)
	}
	if reply.Text != "Let me look." {
		t.Fatalf("text %q", reply.Text)
	}
	msgs = append(msgs,
		aiWireMessage{Role: "assistant", Text: reply.Text, ToolCalls: reply.ToolCalls},
		aiWireMessage{Role: "tool", ToolCallID: "toolu_01", Text: `[{"name":"x"}]`},
	)
	if _, err := p.Chat(context.Background(), aiChatRequest{Messages: msgs, Tools: tools, MaxTokens: 500}, nil); err != nil {
		t.Fatal(err)
	}
	sent := bodies[1]["messages"].([]any)
	if len(sent) != 3 {
		t.Fatalf("messages: %v", sent)
	}
	asst := sent[1].(map[string]any)
	blocks := asst["content"].([]any)
	if asst["role"] != "assistant" || len(blocks) != 2 || blocks[1].(map[string]any)["type"] != "tool_use" || blocks[1].(map[string]any)["id"] != "toolu_01" {
		t.Fatalf("assistant: %v", asst)
	}
	if in := blocks[1].(map[string]any)["input"].(map[string]any); in["query"] != "x" {
		t.Fatalf("tool_use input: %v", in)
	}
	last := sent[2].(map[string]any)
	results := last["content"].([]any)
	if last["role"] != "user" || len(results) != 1 {
		t.Fatalf("tool reply: %v", last)
	}
	block := results[0].(map[string]any)
	if block["type"] != "tool_result" || block["tool_use_id"] != "toolu_01" {
		t.Fatalf("tool_result: %v", block)
	}
	tool := bodies[0]["tools"].([]any)[0].(map[string]any)
	if tool["name"] != "search_bookmarks" || tool["input_schema"] == nil {
		t.Fatalf("tool: %v", tool)
	}
}

func TestAnthropicFoldsConsecutiveToolRepliesIntoOneUserMessage(t *testing.T) {
	var body map[string]any
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		sseWrite(w, "message_start", `{"type":"message_start","message":{"usage":{"input_tokens":1}}}`)
		sseWrite(w, "message_stop", `{"type":"message_stop"}`)
	})
	_, err := testAnthropic().Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{
		{Role: "user", Text: "q"},
		{Role: "assistant", ToolCalls: []aiToolCall{{ID: "a", Name: "list_tags"}, {ID: "b", Name: "list_pages", Arguments: json.RawMessage(`{}`)}}},
		{Role: "tool", ToolCallID: "a", Text: "1"},
		{Role: "tool", ToolCallID: "b", Text: "2"},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	sent := body["messages"].([]any)
	if len(sent) != 3 {
		t.Fatalf("messages: %v", sent)
	}
	results := sent[2].(map[string]any)["content"].([]any)
	if len(results) != 2 || results[1].(map[string]any)["tool_use_id"] != "b" {
		t.Fatalf("folded: %v", results)
	}
	// An assistant turn with only calls carries no empty text block.
	if blocks := sent[1].(map[string]any)["content"].([]any); len(blocks) != 2 {
		t.Fatalf("assistant blocks: %v", blocks)
	}
}

func TestOpenAIPlainAnswerAndUsage(t *testing.T) {
	var gotAuth, gotPath string
	var gotBody map[string]any
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotPath = r.Header.Get("Authorization"), r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "text/event-stream")
		sseWrite(w, "", `{"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"usage":null}`)
		sseWrite(w, "", `{"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}],"usage":null}`)
		sseWrite(w, "", `{"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}],"usage":null}`)
		sseWrite(w, "", `{"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":null}`)
		sseWrite(w, "", `{"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11}}`)
		sseWrite(w, "", `[DONE]`)
	})
	var chunks []string
	reply, err := testOpenAI().Chat(context.Background(), aiChatRequest{
		System:    "be brief",
		Messages:  []aiWireMessage{{Role: "user", Text: "hi"}},
		MaxTokens: 256,
	}, func(s string) { chunks = append(chunks, s) })
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(chunks, "|") != "Hello| world" || reply.Text != "Hello world" || reply.TokensIn != 9 || reply.TokensOut != 2 {
		t.Fatalf("reply %+v chunks %q", reply, chunks)
	}
	if gotPath != "/v1/chat/completions" || gotAuth != "Bearer sk-test" {
		t.Fatalf("path %q auth %q", gotPath, gotAuth)
	}
	if gotBody["stream"] != true || gotBody["stream_options"].(map[string]any)["include_usage"] != true {
		t.Fatalf("body: %v", gotBody)
	}
	// OpenAI's current models refuse max_tokens; they take max_completion_tokens.
	if gotBody["max_completion_tokens"] != float64(256) || gotBody["max_tokens"] != nil {
		t.Fatalf("token limit: %v", gotBody)
	}
	first := gotBody["messages"].([]any)[0].(map[string]any)
	if first["role"] != "system" || first["content"] != "be brief" {
		t.Fatalf("system first: %v", first)
	}
}

func TestOpenAIToolCallsMergeByIndex(t *testing.T) {
	var bodies []map[string]any
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies = append(bodies, body)
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_A","type":"function","function":{"name":"search_bookmarks","arguments":""}}]},"finish_reason":null}]}`)
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_B","type":"function","function":{"name":"list_tags","arguments":""}}]},"finish_reason":null}]}`)
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"que"}}]},"finish_reason":null}]}`)
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{}"}}]},"finish_reason":null}]}`)
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ry\":\"x\"}"}}]},"finish_reason":null}]}`)
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`)
		sseWrite(w, "", `{"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":15}}`)
		sseWrite(w, "", `[DONE]`)
	})
	p := testOpenAI()
	tools := []aiToolSpec{{Name: "search_bookmarks", Description: "s", Schema: map[string]any{"type": "object", "properties": map[string]any{}}}}
	msgs := []aiWireMessage{{Role: "user", Text: "q"}}
	reply, err := p.Chat(context.Background(), aiChatRequest{Messages: msgs, Tools: tools}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(reply.ToolCalls) != 2 {
		t.Fatalf("calls: %+v", reply.ToolCalls)
	}
	a, b := reply.ToolCalls[0], reply.ToolCalls[1]
	if a.ID != "call_A" || a.Name != "search_bookmarks" || string(a.Arguments) != `{"query":"x"}` {
		t.Fatalf("A: %+v %s", a, a.Arguments)
	}
	if b.ID != "call_B" || b.Name != "list_tags" || string(b.Arguments) != `{}` {
		t.Fatalf("B: %+v %s", b, b.Arguments)
	}
	if reply.TokensIn != 30 || reply.TokensOut != 15 {
		t.Fatalf("usage: %+v", reply)
	}
	tool := bodies[0]["tools"].([]any)[0].(map[string]any)
	if tool["type"] != "function" || tool["function"].(map[string]any)["parameters"] == nil {
		t.Fatalf("tool: %v", tool)
	}
	msgs = append(msgs,
		aiWireMessage{Role: "assistant", ToolCalls: reply.ToolCalls},
		aiWireMessage{Role: "tool", ToolCallID: "call_A", Text: "r1"},
		aiWireMessage{Role: "tool", ToolCallID: "call_B", Text: "r2"},
	)
	if _, err := p.Chat(context.Background(), aiChatRequest{Messages: msgs, Tools: tools}, nil); err != nil {
		t.Fatal(err)
	}
	sent := bodies[1]["messages"].([]any)
	if len(sent) != 4 {
		t.Fatalf("messages: %v", sent)
	}
	asst := sent[1].(map[string]any)
	calls := asst["tool_calls"].([]any)
	if len(calls) != 2 || calls[0].(map[string]any)["function"].(map[string]any)["arguments"] != `{"query":"x"}` {
		t.Fatalf("assistant: %v", asst)
	}
	if tr := sent[3].(map[string]any); tr["role"] != "tool" || tr["tool_call_id"] != "call_B" || tr["content"] != "r2" {
		t.Fatalf("tool reply: %v", tr)
	}
}

func TestCompatibleUsesTheGivenBaseAndNoKeyHeaderWhenEmpty(t *testing.T) {
	var gotPath string
	var hadAuth bool
	var gotBody map[string]any
	srv := aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_, hadAuth = r.Header["Authorization"]
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		// A home server that sends no usage chunk.
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}`)
		sseWrite(w, "", `[DONE]`)
	})
	p := &openAIProvider{base: srv.URL + "/ollama/v1", model: "llama3", label: "OpenAI-compatible", client: aiHTTPClient(true)}
	reply, err := p.Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "hi"}}, MaxTokens: 100}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/ollama/v1/chat/completions" || hadAuth {
		t.Fatalf("path %q auth %v", gotPath, hadAuth)
	}
	if reply.Text != "ok" || reply.TokensIn != 0 || reply.TokensOut != 0 {
		t.Fatalf("reply %+v", reply)
	}
	if gotBody["max_tokens"] != float64(100) || gotBody["model"] != "llama3" {
		t.Fatalf("body %v", gotBody)
	}

	// Through newAIProvider: the saved address, model and label.
	newTestHandlers(t)
	_ = saveAIKey(aiProviderCompatible, "k")
	np, err := newAIProvider(Settings{AIEnabled: true, AIProvider: aiProviderCompatible, AIBaseURL: srv.URL + "/v1", AIModel: "qwen"})
	if err != nil {
		t.Fatal(err)
	}
	op, ok := np.(*openAIProvider)
	if !ok || op.base != srv.URL+"/v1" || np.Label() != "OpenAI-compatible" || np.Model() != "qwen" || op.key != "k" {
		t.Fatalf("provider %#v", np)
	}
	if _, err := newAIProvider(Settings{}); !errors.Is(err, errAINotReady) {
		t.Fatalf("not ready: %v", err)
	}
	_ = saveAIKey(aiProviderAnthropic, "sk-ant")
	ap, err := newAIProvider(Settings{AIEnabled: true})
	if err != nil || ap.Label() != "Claude" || ap.Model() != aiDefaultModels[aiProviderAnthropic] {
		t.Fatalf("anthropic: %v %#v", err, ap)
	}
	_ = saveAIKey(aiProviderOpenAI, "sk-o")
	if op, err := newAIProvider(Settings{AIEnabled: true, AIProvider: aiProviderOpenAI}); err != nil || op.Label() != "OpenAI" || op.(*openAIProvider).base != aiOpenAIBaseURL {
		t.Fatalf("openai: %v %#v", err, op)
	}
}

func TestToolSchemasLeaveAnnotationsBehind(t *testing.T) {
	var specs []aiToolSpec
	for _, def := range mcpToolDefinitions(Settings{}) {
		name, _ := def["name"].(string)
		desc, _ := def["description"].(string)
		schema, _ := def["inputSchema"].(map[string]any)
		specs = append(specs, aiToolSpec{Name: name, Description: desc, Schema: schema})
	}
	specs = append(specs, aiToolSpec{Name: "bare", Description: "no schema"})
	for _, which := range []string{"anthropic", "openai"} {
		var raw []byte
		aiFake(t, func(w http.ResponseWriter, r *http.Request) {
			raw, _ = io.ReadAll(r.Body)
			sseWrite(w, "message_stop", `{"type":"message_stop"}`)
			sseWrite(w, "", `[DONE]`)
		})
		req := aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}, Tools: specs}
		var err error
		if which == "anthropic" {
			_, err = testAnthropic().Chat(context.Background(), req, nil)
		} else {
			_, err = testOpenAI().Chat(context.Background(), req, nil)
		}
		if err != nil {
			t.Fatalf("%s: %v", which, err)
		}
		body := string(raw)
		if strings.Contains(body, "readOnlyHint") || strings.Contains(body, "annotations") {
			t.Fatalf("%s sent annotations", which)
		}
		if !strings.Contains(body, `"name":"list_tags"`) || !strings.Contains(body, `"properties":{}`) {
			t.Fatalf("%s: list_tags schema missing", which)
		}
		if !strings.Contains(body, `"description":"no schema"`) {
			t.Fatalf("%s: bare tool missing", which)
		}
	}
	got := aiToolSchema(map[string]any{"properties": "junk", "required": []any{"q"}})
	if got["type"] != "object" || got["required"] == nil {
		t.Fatalf("schema: %v", got)
	}
	if _, ok := got["properties"].(map[string]any); !ok {
		t.Fatalf("properties: %v", got)
	}
}

func TestProviderErrorsNeverCarryTheBody(t *testing.T) {
	logs := captureLog(t)
	cases := []struct {
		status int
		body   string
		kind   string
	}{
		{401, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key sk-ant-SECRET-42 for: where are my bookmarks"}}`, "bad_key"},
		{404, `{"error":{"message":"The model does not exist; key sk-ant-SECRET-42; where are my bookmarks","type":"invalid_request_error","code":"model_not_found"}}`, "unknown_model"},
		{400, `{"error":{"message":"model sk-ant-SECRET-42 where are my bookmarks","type":"invalid_request_error","code":"model_not_found"}}`, "unknown_model"},
		{429, `{"type":"error","error":{"type":"rate_limit_error","message":"sk-ant-SECRET-42 where are my bookmarks"}}`, "rate_limited"},
		{500, `{"type":"error","error":{"type":"api_error","message":"sk-ant-SECRET-42 where are my bookmarks"}}`, "provider"},
		{400, `{"type":"error","error":{"type":"invalid_request_error","message":"messages: sk-ant-SECRET-42 where are my bookmarks"}}`, "bad_request"},
	}
	for _, c := range cases {
		for _, which := range []string{"anthropic", "openai"} {
			aiFake(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(c.status)
				_, _ = io.WriteString(w, c.body)
			})
			aiRetryWait = time.Millisecond
			req := aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "where are my bookmarks"}}}
			var err error
			if which == "anthropic" {
				_, err = testAnthropic().Chat(context.Background(), req, nil)
			} else {
				_, err = testOpenAI().Chat(context.Background(), req, nil)
			}
			var ae *aiError
			if !errors.As(err, &ae) || ae.Kind != c.kind {
				t.Fatalf("%s %d: %v", which, c.status, err)
			}
			if err.Error() != aiErrorText(c.kind, c.status) {
				t.Fatalf("%s %d: copy %q", which, c.status, err.Error())
			}
			if strings.Contains(err.Error(), "SECRET-42") || strings.Contains(err.Error(), "bookmarks") {
				t.Fatalf("%s %d: body leaked: %q", which, c.status, err.Error())
			}
		}
	}
	if strings.Contains(logs.String(), "SECRET-42") {
		t.Fatalf("log leaked: %q", logs.String())
	}
	want := map[string]string{
		"bad_key":       "The provider refused the key.",
		"unknown_model": "The provider does not know that model.",
		"rate_limited":  "The provider is rate limiting. Try again in a minute.",
		"unreachable":   "Could not reach the provider.",
		"timeout":       "The provider took too long to answer.",
		"too_large":     "The provider's answer was too large.",
		"bad_request":   "The provider refused the request (HTTP 400).",
	}
	for kind, text := range want {
		if got := (&aiError{Kind: kind, Status: 400}).Error(); got != text {
			t.Errorf("%s: %q", kind, got)
		}
	}
	if got := (&aiError{Kind: "provider", Status: 503}).Error(); got != "The provider had a problem (HTTP 503)." {
		t.Errorf("provider: %q", got)
	}
	// A stream that breaks off with an error event.
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		sseWrite(w, "message_start", `{"type":"message_start","message":{"usage":{"input_tokens":1}}}`)
		sseWrite(w, "error", `{"type":"error","error":{"type":"overloaded_error","message":"sk-ant-SECRET-42"}}`)
	})
	_, err := testAnthropic().Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "provider" || strings.Contains(err.Error(), "SECRET") {
		t.Fatalf("stream error: %v", err)
	}
}

func TestOneRetryOn429Then5xx(t *testing.T) {
	var n atomic.Int32
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		if n.Add(1) == 1 {
			w.WriteHeader(429)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"rate_limit_error"}}`)
			return
		}
		sseWrite(w, "message_start", `{"type":"message_start","message":{"usage":{"input_tokens":1}}}`)
		sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}`)
		sseWrite(w, "message_stop", `{"type":"message_stop"}`)
	})
	aiRetryWait = 10 * time.Millisecond
	req := aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}
	reply, err := testAnthropic().Chat(context.Background(), req, nil)
	if err != nil || reply.Text != "ok" || n.Load() != 2 {
		t.Fatalf("429 then 200: %v %+v requests=%d", err, reply, n.Load())
	}

	n.Store(0)
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		w.WriteHeader(503)
	})
	aiRetryWait = 10 * time.Millisecond
	_, err = testOpenAI().Chat(context.Background(), req, nil)
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "provider" || ae.Status != 503 || n.Load() != 2 {
		t.Fatalf("503 twice: %v requests=%d", err, n.Load())
	}

	n.Store(0)
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		w.WriteHeader(401)
	})
	aiRetryWait = 10 * time.Millisecond
	_, err = testAnthropic().Chat(context.Background(), req, nil)
	if !errors.As(err, &ae) || ae.Kind != "bad_key" || n.Load() != 1 {
		t.Fatalf("401: %v requests=%d", err, n.Load())
	}

	// Retry-After is honoured but capped.
	n.Store(0)
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		if n.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			return
		}
		sseWrite(w, "", `[DONE]`)
	})
	start := time.Now()
	if _, err := testOpenAI().Chat(context.Background(), req, nil); err != nil || n.Load() != 2 {
		t.Fatalf("retry-after: %v requests=%d", err, n.Load())
	}
	if d := time.Since(start); d < 900*time.Millisecond {
		t.Fatalf("Retry-After ignored: %v", d)
	}
}

func TestAHangingProviderHitsTheDeadline(t *testing.T) {
	var n atomic.Int32
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		// Reading the body lets the server notice the client hanging up.
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-time.After(2 * time.Second):
		case <-r.Context().Done():
		}
	})
	aiRetryWait = 10 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := testAnthropic().Chat(ctx, aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "timeout" {
		t.Fatalf("err: %v", err)
	}
	if d := time.Since(start); d > time.Second {
		t.Fatalf("took %v", d)
	}
	if n.Load() != 1 {
		t.Fatalf("a timeout was retried: %d", n.Load())
	}
	if aiTransportError(errors.New("dial tcp: connection refused sk-ant-SECRET")).Kind != "unreachable" {
		t.Fatal("refused is unreachable")
	}
}

func TestAnOversizedStreamIsCut(t *testing.T) {
	prev := aiMaxResponseBytes
	aiMaxResponseBytes = 1 << 10
	t.Cleanup(func() { aiMaxResponseBytes = prev })
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		chunk := `{"choices":[{"index":0,"delta":{"content":"` + strings.Repeat("a", 100) + `"}}]}`
		for i := 0; i < 50; i++ {
			sseWrite(w, "", chunk)
		}
		sseWrite(w, "", `[DONE]`)
	})
	_, err := testOpenAI().Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "too_large" {
		t.Fatalf("err: %v", err)
	}
	// Just under the cap is fine.
	err = aiReadSSE(strings.NewReader("data: "+strings.Repeat("b", 1000)+"\n\n"), func(event, data string) error { return nil })
	if err != nil {
		t.Fatalf("under cap: %v", err)
	}
}

func TestSSEReaderJoinsDataLinesAndHandlesCRLF(t *testing.T) {
	var got []string
	in := "event: a\r\ndata: one\r\ndata: two\r\n\r\n: comment\n\ndata:three\n"
	if err := aiReadSSE(strings.NewReader(in), func(event, data string) error {
		got = append(got, event+"="+data)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ";") != "a=one\ntwo;=three" {
		t.Fatalf("events: %q", got)
	}
}

// A home server such as Ollama takes no key: the assistant is ready without
// one, and the request carries no Authorization header. A query or fragment
// on the saved address stays out of the request path.
func TestCompatibleWithoutAKeyIsReadyAndSendsNoAuthorization(t *testing.T) {
	var gotPath, gotQuery string
	var hadAuth bool
	srv := aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery = r.URL.Path, r.URL.RawQuery
		_, hadAuth = r.Header["Authorization"]
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"content":"hi"}}]}`)
		sseWrite(w, "", `[DONE]`)
	})
	newTestHandlers(t)
	np, err := newAIProvider(Settings{AIEnabled: true, AIProvider: aiProviderCompatible, AIBaseURL: srv.URL + "/v1?x=1#frag", AIModel: "llama3"})
	if err != nil {
		t.Fatalf("keyless compatible: %v", err)
	}
	if op := np.(*openAIProvider); op.base != srv.URL+"/v1" || op.key != "" {
		t.Fatalf("base %q key %q", op.base, op.key)
	}
	reply, err := np.Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	if err != nil || reply.Text != "hi" {
		t.Fatalf("chat: %v %+v", err, reply)
	}
	if gotPath != "/v1/chat/completions" || gotQuery != "" || hadAuth {
		t.Fatalf("path %q query %q auth %v", gotPath, gotQuery, hadAuth)
	}
}

func TestAnthropicStreamCutBeforeMessageStopIsAnError(t *testing.T) {
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		sseWrite(w, "message_start", `{"type":"message_start","message":{"usage":{"input_tokens":5}}}`)
		sseWrite(w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
		sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Half an ans"}}`)
	})
	reply, err := testAnthropic().Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "provider" || reply.Text != "" {
		t.Fatalf("cut stream: %v %+v", err, reply)
	}
}

func TestOpenAIStreamCutBeforeDoneIsAnError(t *testing.T) {
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"content":"Half an ans"}}]}`)
	})
	req := aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}
	reply, err := testOpenAI().Chat(context.Background(), req, nil)
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "provider" || reply.Text != "" {
		t.Fatalf("openai cut stream: %v %+v", err, reply)
	}
	// A compatible server may end without [DONE]; that stays an answer.
	compat := testOpenAI()
	compat.label = "OpenAI-compatible"
	reply, err = compat.Chat(context.Background(), req, nil)
	if err != nil || reply.Text != "Half an ans" {
		t.Fatalf("compatible lenient: %v %+v", err, reply)
	}
}

func TestOpenAITruncatedToolArgumentsBecomeAnEmptyObject(t *testing.T) {
	var bodies [][]byte
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		bodies = append(bodies, raw)
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_A","type":"function","function":{"name":"search_bookmarks","arguments":"{\"query\":\"x"}}]}}]}`)
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}`)
		sseWrite(w, "", `[DONE]`)
	})
	p := testOpenAI()
	reply, err := p.Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	if err != nil || len(reply.ToolCalls) != 1 {
		t.Fatalf("reply: %v %+v", err, reply)
	}
	if c := reply.ToolCalls[0]; c.ID != "call_A" || string(c.Arguments) != `{}` {
		t.Fatalf("truncated call: %+v %s", c, c.Arguments)
	}
	// A hand-built bad call never reaches the wire as broken JSON either.
	_, err = p.Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{
		{Role: "user", Text: "q"},
		{Role: "assistant", ToolCalls: []aiToolCall{{ID: "call_A", Name: "search_bookmarks", Arguments: json.RawMessage(`{"query":"x`)}}},
		{Role: "tool", ToolCallID: "call_A", Text: "bad arguments"},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(bodies[1]), `"arguments":"{}"`) {
		t.Fatalf("resend: %s", bodies[1])
	}
}

func TestAnthropicTruncatedToolInputBecomesAnEmptyObject(t *testing.T) {
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		sseWrite(w, "message_start", `{"type":"message_start","message":{"usage":{"input_tokens":5}}}`)
		sseWrite(w, "content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"search_bookmarks","input":{}}}`)
		sseWrite(w, "content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\": \"x"}}`)
		sseWrite(w, "message_delta", `{"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":9}}`)
		sseWrite(w, "message_stop", `{"type":"message_stop"}`)
	})
	reply, err := testAnthropic().Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	if err != nil || len(reply.ToolCalls) != 1 || string(reply.ToolCalls[0].Arguments) != `{}` || reply.ToolCalls[0].ID != "toolu_1" {
		t.Fatalf("reply: %v %+v", err, reply)
	}
}

func TestOpenAIWholeCallsAtIndexZeroStaySeparate(t *testing.T) {
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_tags","arguments":"{}"}}]}}]}`)
		sseWrite(w, "", `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_2","type":"function","function":{"name":"search_bookmarks","arguments":"{\"query\":\"y\"}"}}]}}]}`)
		sseWrite(w, "", `[DONE]`)
	})
	reply, err := testOpenAI().Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	if err != nil || len(reply.ToolCalls) != 2 {
		t.Fatalf("calls: %v %+v", err, reply.ToolCalls)
	}
	a, b := reply.ToolCalls[0], reply.ToolCalls[1]
	if a.ID != "call_1" || a.Name != "list_tags" || string(a.Arguments) != `{}` || b.ID != "call_2" || b.Name != "search_bookmarks" || string(b.Arguments) != `{"query":"y"}` {
		t.Fatalf("calls: %+v %s / %+v %s", a, a.Arguments, b, b.Arguments)
	}
}

func TestAPlainJSONAnswerToAStreamRequestIsAProviderError(t *testing.T) {
	aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"hi"}}]}`)
	})
	compat := testOpenAI()
	compat.label = "OpenAI-compatible"
	reply, err := compat.Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "provider" || reply.Text != "" {
		t.Fatalf("plain json: %v %+v", err, reply)
	}
}

func TestTheOutboundLimiterIsRateLimitedNotUnreachable(t *testing.T) {
	aiFake(t, func(w http.ResponseWriter, r *http.Request) { t.Error("the request left") })
	limiter := newSlidingWindowLimiter(1, time.Minute)
	limiter.allow("global")
	aiHTTPClient = func(bool) *http.Client {
		return &http.Client{Transport: &rateLimitedTransport{base: http.DefaultTransport, limiter: limiter}}
	}
	_, err := testOpenAI().Chat(context.Background(), aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "q"}}}, nil)
	var ae *aiError
	if !errors.As(err, &ae) || ae.Kind != "rate_limited" {
		t.Fatalf("limiter: %v", err)
	}
}
