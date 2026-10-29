package app

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

// aiHandlerFake is an OpenAI-compatible server that streams a canned answer,
// or fails, and keeps every request body it was sent.
type aiHandlerFake struct {
	mu     sync.Mutex
	bodies []map[string]any
	fail   int           // answer this status with the Authorization header echoed
	delay  time.Duration // wait before answering
	text   []string
	srv    *httptest.Server
}

func (f *aiHandlerFake) requests() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.bodies)
}

func (f *aiHandlerFake) lastMessages() []any {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.bodies) == 0 {
		return nil
	}
	m, _ := f.bodies[len(f.bodies)-1]["messages"].([]any)
	return m
}

// newAskInstall returns handlers wired to a fake provider with the key
// sk-SECRET-42, the assistant on and the bookmarks group on.
func newAskInstall(t *testing.T) (*Handlers, *aiHandlerFake) {
	t.Helper()
	h := newMCPHandlers(t)
	seedMCPBookmarks(t, h)
	f := &aiHandlerFake{text: []string{"Hello", " there"}}
	f.srv = aiFake(t, func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		f.mu.Lock()
		f.bodies = append(f.bodies, body)
		fail, delay, text := f.fail, f.delay, f.text
		f.mu.Unlock()
		if delay > 0 {
			time.Sleep(delay)
		}
		if fail != 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(fail)
			_, _ = w.Write([]byte(`{"error":{"message":"bad auth ` + r.Header.Get("Authorization") + `"}}`))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, piece := range text {
			sseWrite(w, "", `{"choices":[{"index":0,"delta":{"content":"`+piece+`"}}]}`)
		}
		sseWrite(w, "", `{"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}`)
		sseWrite(w, "", `[DONE]`)
	})
	s := h.store.GetSettings()
	s.AIEnabled, s.AIProvider, s.AIBaseURL, s.AIModel = true, aiProviderCompatible, f.srv.URL, "m"
	s.MCPBookmarksWrite = true
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if err := saveAIKey(aiProviderCompatible, "sk-SECRET-42"); err != nil {
		t.Fatal(err)
	}
	return h, f
}

func aiRouter(h *Handlers) *mux.Router {
	r := mux.NewRouter()
	r.HandleFunc("/api/ai/status", h.AIStatusHandler).Methods("GET")
	r.HandleFunc("/api/ai/test", h.AITestHandler).Methods("POST")
	r.HandleFunc("/api/ai/ask", h.AIAskHandler).Methods("POST")
	r.HandleFunc("/api/ai/conversations", h.AIConversationsHandler).Methods("GET")
	r.HandleFunc("/api/ai/conversations", h.AIDeleteAllConversationsHandler).Methods("DELETE")
	r.HandleFunc("/api/ai/conversations/{id}", h.AIConversationHandler).Methods("GET")
	r.HandleFunc("/api/ai/conversations/{id}", h.AIDeleteConversationHandler).Methods("DELETE")
	r.HandleFunc("/api/ai/proposals/apply-all", h.AIApplyAllHandler).Methods("POST")
	r.HandleFunc("/api/ai/proposals/{id}/apply", h.AIApplyHandler).Methods("POST")
	r.HandleFunc("/api/ai/proposals/{id}/skip", h.AISkipHandler).Methods("POST")
	r.HandleFunc("/api/ai/key", h.AIKeyHandler).Methods("GET", "PUT", "DELETE")
	r.HandleFunc("/api/settings", h.GetSettings).Methods("GET")
	return r
}

func askDo(h *Handlers, method, target, body, token string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if token != "" {
		req.Header.Set("X-NextDash-Token", token)
	}
	aiRouter(h).ServeHTTP(rec, req)
	return rec
}

func ndjsonLines(t *testing.T, body string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("bad line %q: %v", line, err)
		}
		out = append(out, m)
	}
	return out
}

func TestAskStreamsAndSaves(t *testing.T) {
	h, f := newAskInstall(t)
	rec := askDo(h, "POST", "/api/ai/ask", `{"question":"  What is here?  "}`, "")
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/x-ndjson") {
		t.Fatalf("%d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("X-Accel-Buffering") != "no" {
		t.Fatalf("headers: %v", rec.Header())
	}
	lines := ndjsonLines(t, rec.Body.String())
	if len(lines) < 3 || lines[0]["type"] != "start" || lines[1]["type"] != "text" || lines[len(lines)-1]["type"] != "done" {
		t.Fatalf("lines: %v", lines)
	}
	done := lines[len(lines)-1]
	msg := done["message"].(map[string]any)
	if msg["tokensIn"].(float64) != 7 || msg["tokensOut"].(float64) != 3 || msg["text"] != "Hello there" {
		t.Fatalf("message: %v", msg)
	}
	convID := done["conversation"].(map[string]any)["id"].(string)

	list := askDo(h, "GET", "/api/ai/conversations", "", "")
	var sums []map[string]any
	_ = json.Unmarshal(list.Body.Bytes(), &sums)
	if len(sums) != 1 || sums[0]["title"] != "What is here?" || sums[0]["id"] != convID {
		t.Fatalf("list: %s", list.Body)
	}

	rec = askDo(h, "POST", "/api/ai/ask", `{"conversationId":"`+convID+`","question":"And more?"}`, "")
	if lines := ndjsonLines(t, rec.Body.String()); lines[0]["conversationId"] != convID {
		t.Fatalf("start: %v", lines[0])
	}
	msgs := f.lastMessages()
	if len(msgs) != 4 { // system + question, answer, question
		t.Fatalf("the provider saw %d messages: %v", len(msgs), msgs)
	}
	if msgs[1].(map[string]any)["content"] != "What is here?" || msgs[2].(map[string]any)["content"] != "Hello there" {
		t.Fatalf("history: %v", msgs)
	}
}

func TestAskIsRefusedWhenNotReady(t *testing.T) {
	h, f := newAskInstall(t)
	s := h.store.GetSettings()
	s.AIEnabled = false
	_ = h.store.SaveSettings(s)
	rec := askDo(h, "POST", "/api/ai/ask", `{"question":"hi"}`, "")
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), `"reason":"off"`) || f.requests() != 0 {
		t.Fatalf("off: %d %s (%d requests)", rec.Code, rec.Body, f.requests())
	}
	s.AIEnabled = true
	_ = h.store.SaveSettings(s)
	t.Setenv("NEXTDASH_DEMO", "1")
	rec = askDo(h, "POST", "/api/ai/ask", `{"question":"hi"}`, "")
	if rec.Code != 404 || f.requests() != 0 {
		t.Fatalf("demo: %d (%d requests)", rec.Code, f.requests())
	}
}

func TestAProviderErrorSavesNothing(t *testing.T) {
	h, f := newAskInstall(t)
	f.fail = 500
	rec := askDo(h, "POST", "/api/ai/ask", `{"question":"hi"}`, "")
	lines := ndjsonLines(t, rec.Body.String())
	last := lines[len(lines)-1]
	if last["type"] != "error" || last["error"] != "The provider had a problem (HTTP 500)." {
		t.Fatalf("lines: %v", lines)
	}
	if got := aiListConversations(""); len(got) != 0 {
		t.Fatalf("saved: %v", got)
	}
}

func TestTheKeyNeverLeaves(t *testing.T) {
	h, f := newAskInstall(t)
	f.fail = 401
	var bodies []string
	logs := captureLog(t)
	storeProposals(t, h, aiProposal{ID: "k1", Tool: "update_bookmark", Arguments: json.RawMessage(`{"url":"https://radarr.example/","note":"films"}`)})
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryMutate: true}})
	activity := captureActivityLogs(t, func() {
		for _, c := range [][3]string{
			{"GET", "/api/ai/status", ""}, {"GET", "/api/ai/key", ""}, {"POST", "/api/ai/test", ""},
			{"POST", "/api/ai/ask", `{"question":"hi"}`}, {"POST", "/api/ai/proposals/k1/apply", ""}, {"GET", "/api/ai/conversations", ""}, {"GET", "/api/settings", ""},
		} {
			bodies = append(bodies, askDo(h, c[0], c[1], c[2], "").Body.String())
		}
	})
	for _, b := range bodies {
		if strings.Contains(b, "SECRET-42") {
			t.Fatalf("a response holds the key: %s", b)
		}
	}
	if f.requests() < 2 {
		t.Fatalf("the provider was not reached (%d)", f.requests())
	}
	if len(activity) == 0 {
		t.Fatal("the assistant's calls left no activity lines to check")
	}
	if strings.Contains(logs.String(), "SECRET-42") || strings.Contains(strings.Join(activity, "\n"), "SECRET-42") {
		t.Fatal("a log holds the key")
	}
	if !strings.Contains(bodies[2], `"ok":false`) {
		t.Fatalf("test: %s", bodies[2])
	}
}

// storeProposals saves a turn holding the proposals and returns their ids.
func storeProposals(t *testing.T, h *Handlers, props ...aiProposal) {
	t.Helper()
	for i := range props {
		props[i].Status = "pending"
		props[i].Destructive = mcpToolIsDestructive(props[i].Tool)
	}
	if _, err := aiAppendTurn("", "q", aiMessage{Role: "assistant", Text: "a", Proposals: props}, h.store.GetSettings(), time.Now()); err != nil {
		t.Fatal(err)
	}
}

func applyInstall(t *testing.T) (*Handlers, int) {
	t.Helper()
	h, _ := newAskInstall(t)
	return h, h.store.GetPages()[0].ID
}

func TestApplyRunsTheRealHandlerAndLogsTheAssistant(t *testing.T) {
	h, page := applyInstall(t)
	storeProposals(t, h, aiProposal{ID: "p1", Tool: "update_bookmark", Arguments: json.RawMessage(`{"url":"https://radarr.example/","note":"films"}`)})
	var rec *httptest.ResponseRecorder
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryMutate: true}})
	lines := captureActivityLogs(t, func() {
		rec = askDo(h, "POST", "/api/ai/proposals/p1/apply", "", "")
	})
	var got aiProposal
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != 200 || got.Status != "applied" || got.Result == "" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if bm := bookmarkOnPage(h, page, "https://radarr.example/"); bm == nil || bm.Note != "films" {
		t.Fatalf("bookmark: %+v", bm)
	}
	found := false
	for _, l := range lines {
		if strings.Contains(l, `"source":"assistant"`) && strings.Contains(l, "bookmark.update") && !strings.Contains(l, `"client"`) {
			found = true
		}
	}
	if !found {
		t.Fatalf("activity: %v", lines)
	}
}

func TestApplyNeedsTheWriteToken(t *testing.T) {
	h, page := applyInstall(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	storeProposals(t, h, aiProposal{ID: "p1", Tool: "update_bookmark", Arguments: json.RawMessage(`{"url":"https://radarr.example/","note":"films"}`)})
	rec := askDo(h, "POST", "/api/ai/proposals/p1/apply", "", "")
	if p, _ := aiFindProposal("p1"); rec.Code != 401 || p.Status != "pending" {
		t.Fatalf("%d %s", rec.Code, p.Status)
	}
	if bm := bookmarkOnPage(h, page, "https://radarr.example/"); bm.Note == "films" {
		t.Fatal("changed without the token")
	}
	rec = askDo(h, "POST", "/api/ai/proposals/p1/apply", "", "tok")
	if p, _ := aiFindProposal("p1"); rec.Code != 200 || p.Status != "applied" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestApplyReChecksTheGroupSwitch(t *testing.T) {
	h, _ := applyInstall(t)
	storeProposals(t, h, aiProposal{ID: "p1", Tool: "update_bookmark", Arguments: json.RawMessage(`{"url":"https://radarr.example/","note":"films"}`)})
	s := h.store.GetSettings()
	s.MCPBookmarksWrite = false
	_ = h.store.SaveSettings(s)
	rec := askDo(h, "POST", "/api/ai/proposals/p1/apply", "", "")
	if p, _ := aiFindProposal("p1"); rec.Code != 409 || p.Status != "pending" || !strings.Contains(rec.Body.String(), "That group is switched off under MCP access.") {
		t.Fatalf("%d %s %s", rec.Code, rec.Body, p.Status)
	}
}

func TestAProposalIsAppliedOnce(t *testing.T) {
	h, page := applyInstall(t)
	storeProposals(t, h, aiProposal{ID: "p1", Tool: "create_category", Arguments: json.RawMessage(`{"page":` + itoa(int64(page)) + `,"name":"Fresh"}`)})
	before := len(h.store.GetCategoriesByPage(page))
	var wg sync.WaitGroup
	codes := make([]int, 2)
	bodies := make([]string, 2)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rec := askDo(h, "POST", "/api/ai/proposals/p1/apply", "", "")
			codes[i], bodies[i] = rec.Code, rec.Body.String()
		}(i)
	}
	wg.Wait()
	ok, conflict := 0, 0
	for i, c := range codes {
		switch c {
		case 200:
			ok++
		case 409:
			conflict++
			if !strings.Contains(bodies[i], "Already applied.") {
				t.Fatalf("409 body: %s", bodies[i])
			}
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("codes: %v", codes)
	}
	if after := len(h.store.GetCategoriesByPage(page)); after != before+1 {
		t.Fatalf("categories %d -> %d", before, after)
	}
}

func TestApplyAllSkipsDestructive(t *testing.T) {
	h, page := applyInstall(t)
	storeProposals(t, h,
		aiProposal{ID: "u1", Tool: "update_bookmark", Arguments: json.RawMessage(`{"url":"https://radarr.example/","note":"films"}`)},
		aiProposal{ID: "d1", Tool: "delete_bookmark", Arguments: json.RawMessage(`{"url":"https://sonarr.example/"}`)})
	rec := askDo(h, "POST", "/api/ai/proposals/apply-all", `{"ids":["u1","d1"]}`, "")
	var out struct {
		Results            []aiProposal `json:"results"`
		SkippedDestructive []string     `json:"skippedDestructive"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || len(out.Results) != 1 || out.Results[0].ID != "u1" || out.Results[0].Status != "applied" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if len(out.SkippedDestructive) != 1 || out.SkippedDestructive[0] != "d1" {
		t.Fatalf("skipped: %v", out.SkippedDestructive)
	}
	if bookmarkOnPage(h, page, "https://sonarr.example/") == nil {
		t.Fatal("the delete ran")
	}
	if p, _ := aiFindProposal("d1"); p.Status != "pending" {
		t.Fatalf("delete: %s", p.Status)
	}
}

func TestAFailedApplyCanBeRetriedOrSkipped(t *testing.T) {
	h, _ := applyInstall(t)
	storeProposals(t, h, aiProposal{ID: "m1", Tool: "move_bookmark", Arguments: json.RawMessage(`{"url":"https://radarr.example/","to_page":9999}`)})
	rec := askDo(h, "POST", "/api/ai/proposals/m1/apply", "", "")
	var got aiProposal
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != 200 || got.Status != "failed" || got.Error == "" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	// Failed can be tried again.
	if rec = askDo(h, "POST", "/api/ai/proposals/m1/apply", "", ""); !strings.Contains(rec.Body.String(), `"failed"`) {
		t.Fatalf("retry: %s", rec.Body)
	}
	rec = askDo(h, "POST", "/api/ai/proposals/m1/skip", "", "")
	if p, _ := aiFindProposal("m1"); rec.Code != 200 || p.Status != "skipped" {
		t.Fatalf("skip: %d %s", rec.Code, rec.Body)
	}
	rec = askDo(h, "POST", "/api/ai/proposals/m1/apply", "", "")
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "Skipped.") {
		t.Fatalf("apply after skip: %d %s", rec.Code, rec.Body)
	}
}

func TestAskOutlivesTheServerWriteTimeout(t *testing.T) {
	h, f := newAskInstall(t)
	f.delay = 1500 * time.Millisecond
	prev := aiHeartbeat
	aiHeartbeat = 200 * time.Millisecond
	t.Cleanup(func() { aiHeartbeat = prev })

	srv := httptest.NewUnstartedServer(requestLogging(gzipMiddleware(aiRouter(h))))
	srv.Config.WriteTimeout = 1 * time.Second
	srv.Start()
	t.Cleanup(srv.Close)

	req, _ := http.NewRequest("POST", srv.URL+"/api/ai/ask", strings.NewReader(`{"question":"slow"}`))
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	sawDone := false
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		if strings.Contains(sc.Text(), `"type":"done"`) {
			sawDone = true
		}
	}
	if !sawDone {
		t.Fatalf("no done line (scanner: %v)", sc.Err())
	}
}

func TestAssistantRoutesAreClosedInTheDemo(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "1")
	for _, c := range [][2]string{
		{"POST", "/api/ai/test"}, {"POST", "/api/ai/ask"}, {"DELETE", "/api/ai/conversations"}, {"DELETE", "/api/ai/conversations/abc"},
		{"POST", "/api/ai/proposals/abc/apply"}, {"POST", "/api/ai/proposals/abc/skip"}, {"POST", "/api/ai/proposals/apply-all"},
	} {
		if !demoWriteRefused(httptest.NewRequest(c[0], c[1], nil)) {
			t.Errorf("%s %s is open in the demo", c[0], c[1])
		}
	}
	h := newTestHandlers(t)
	for _, c := range [][2]string{{"GET", "/api/ai/status"}, {"GET", "/api/ai/conversations"}, {"POST", "/api/ai/test"}} {
		if rec := askDo(h, c[0], c[1], "", ""); rec.Code != 404 || !strings.Contains(rec.Body.String(), "The assistant is not available in the demo") {
			t.Errorf("%s %s: %d %s", c[0], c[1], rec.Code, rec.Body)
		}
	}
}

func TestAskAndTestNeedTheWriteToken(t *testing.T) {
	h, f := newAskInstall(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	for _, c := range [][2]string{{"/api/ai/ask", `{"question":"hi"}`}, {"/api/ai/test", ""}} {
		if rec := askDo(h, "POST", c[0], c[1], ""); rec.Code != 401 {
			t.Fatalf("%s without token: %d", c[0], rec.Code)
		}
	}
	if f.requests() != 0 {
		t.Fatalf("the provider saw %d requests without a token", f.requests())
	}
	if rec := askDo(h, "POST", "/api/ai/ask", `{"question":"hi"}`, "tok"); rec.Code != 200 {
		t.Fatalf("ask with token: %d %s", rec.Code, rec.Body)
	}
	if rec := askDo(h, "POST", "/api/ai/test", "", "tok"); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("test with token: %d %s", rec.Code, rec.Body)
	}
	if f.requests() != 2 {
		t.Fatalf("requests: %d", f.requests())
	}
}

func TestApplyAllRecomputesDestructive(t *testing.T) {
	h, page := applyInstall(t)
	// A restored record that lost its flag.
	if _, err := aiAppendTurn("", "q", aiMessage{Role: "assistant", Text: "a", Proposals: []aiProposal{
		{ID: "d9", Tool: "delete_bookmark", Status: "pending", Destructive: false, Arguments: json.RawMessage(`{"url":"https://sonarr.example/"}`)},
	}}, h.store.GetSettings(), time.Now()); err != nil {
		t.Fatal(err)
	}
	rec := askDo(h, "POST", "/api/ai/proposals/apply-all", `{"ids":["d9"]}`, "")
	if !strings.Contains(rec.Body.String(), `"skippedDestructive":["d9"]`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if bookmarkOnPage(h, page, "https://sonarr.example/") == nil {
		t.Fatal("the delete ran")
	}
}
