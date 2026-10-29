package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gorilla/mux"
)

/*
The assistant's routes.

Asking streams NDJSON: one line per event, so the panel can show text as it
arrives. Applying a proposal goes through the same in-process MCP path the
assistant's read tools use, marked as the assistant's, so the browser's own
handlers do the work and the activity log names the assistant.

Nothing here answers the key, and a provider's error body never gets past the
provider layer: what the person sees is fixed copy.
*/

const (
	aiAskBodyMax     = 64 << 10
	aiQuestionMax    = 4000
	aiDemoRefusal    = "The assistant is not available in the demo"
	aiGroupOffLine   = "That group is switched off under MCP access."
	aiAppliedLine    = "Already applied."
	aiSkippedLine    = "Skipped."
	aiNotEnabledLine = "The assistant is switched off."
)

// aiHeartbeat keeps a quiet stream alive through proxies. A var for tests.
var aiHeartbeat = 15 * time.Second

var aiProviderLabels = map[string]string{
	aiProviderAnthropic:  "Claude",
	aiProviderOpenAI:     "OpenAI",
	aiProviderCompatible: "OpenAI-compatible",
}

var aiNotReadyLines = map[string]string{
	"off":        aiNotEnabledLine,
	"no-key":     "No API key is stored for this provider.",
	"no-address": "The server address is missing.",
	"no-model":   "The model name is missing.",
	"demo":       aiDemoRefusal,
}

func aiNotReadyText(reason string) string {
	if t := aiNotReadyLines[reason]; t != "" {
		return t
	}
	return "The assistant is not set up."
}

// aiDemoClosed answers the demo's 404 and reports whether it did.
func aiDemoClosed(w http.ResponseWriter) bool {
	if demoMode() {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, aiDemoRefusal, http.StatusNotFound)
		return true
	}
	return false
}

func aiWriteJSONStatus(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func aiErrorOf(err error) (kind, text string) {
	var ae *aiError
	if errors.As(err, &ae) {
		return ae.Kind, ae.Error()
	}
	return "unknown", "The assistant had a problem."
}

func (h *Handlers) AIStatusHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) {
		return
	}
	s := h.store.GetSettings()
	ready, reason := aiReady(s)
	aiWriteJSONStatus(w, http.StatusOK, map[string]any{
		"ready":    ready,
		"reason":   reason,
		"provider": aiProviderOf(s),
		"label":    aiProviderLabels[aiProviderOf(s)],
		"model":    aiModelOf(s),
		"keySet":   aiKeysSet(),
	})
}

func (h *Handlers) AITestHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) || !h.requireWriteAccess(w, r) {
		return
	}
	s := h.store.GetSettings()
	if ready, reason := aiReady(s); !ready {
		aiWriteJSONStatus(w, http.StatusOK, map[string]any{"ok": false, "error": aiNotReadyText(reason), "kind": "not-ready", "reason": reason})
		return
	}
	p, err := newAIProvider(s)
	if err != nil {
		aiWriteJSONStatus(w, http.StatusOK, map[string]any{"ok": false, "error": aiNotReadyText(""), "kind": "not-ready"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	_, err = p.Chat(ctx, aiChatRequest{Messages: []aiWireMessage{{Role: "user", Text: "ping"}}, MaxTokens: 1}, nil)
	if err != nil {
		kind, text := aiErrorOf(err)
		if ctx.Err() != nil && !errors.Is(ctx.Err(), context.Canceled) {
			kind, text = "timeout", aiErrorText("timeout", 0)
		}
		aiWriteJSONStatus(w, http.StatusOK, map[string]any{"ok": false, "error": text, "kind": kind})
		return
	}
	aiWriteJSONStatus(w, http.StatusOK, map[string]any{"ok": true, "label": p.Label(), "model": p.Model()})
}

// aiStreamWriter writes NDJSON lines and heartbeats under one mutex.
type aiStreamWriter struct {
	mu  sync.Mutex
	w   http.ResponseWriter
	rc  *http.ResponseController
	enc *json.Encoder
}

func (s *aiStreamWriter) line(v any) {
	s.mu.Lock()
	_ = s.enc.Encode(v)
	_ = s.rc.Flush()
	s.mu.Unlock()
}

func (s *aiStreamWriter) beat() {
	s.mu.Lock()
	_, _ = s.w.Write([]byte("\n"))
	_ = s.rc.Flush()
	s.mu.Unlock()
}

func (h *Handlers) AIAskHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) || !h.requireWriteAccess(w, r) {
		return
	}
	var body struct {
		ConversationID string `json:"conversationId"`
		Question       string `json:"question"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, aiAskBodyMax)).Decode(&body); err != nil {
		aiWriteJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "Invalid request body"})
		return
	}
	question := strings.TrimSpace(body.Question)
	if n := utf8.RuneCountInString(question); n < 1 || n > aiQuestionMax {
		aiWriteJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "A question is 1 to 4000 characters."})
		return
	}
	s := h.store.GetSettings()
	if ready, reason := aiReady(s); !ready {
		aiWriteJSONStatus(w, http.StatusConflict, map[string]any{"error": aiNotReadyText(reason), "reason": reason})
		return
	}
	var history []aiWireMessage
	if body.ConversationID != "" {
		conv, ok := aiGetConversation(body.ConversationID)
		if !ok {
			aiWriteJSONStatus(w, http.StatusNotFound, map[string]any{"error": "That conversation no longer exists."})
			return
		}
		for _, m := range conv.Messages {
			if (m.Role == "user" || m.Role == "assistant") && m.Text != "" {
				history = append(history, aiWireMessage{Role: m.Role, Text: m.Text})
			}
		}
	}
	p, err := newAIProvider(s)
	if err != nil {
		aiWriteJSONStatus(w, http.StatusConflict, map[string]any{"error": aiNotReadyText(""), "reason": "off"})
		return
	}

	// The server's write timeout is for ordinary requests; a turn may take
	// two minutes.
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(aiTurnDeadline + 30*time.Second))
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	out := &aiStreamWriter{w: w, rc: rc, enc: json.NewEncoder(w)}
	out.line(map[string]any{"type": "start", "conversationId": body.ConversationID})

	// The heartbeat must be gone before the handler returns: the writer is
	// not ours after that.
	var wg sync.WaitGroup
	defer wg.Wait()
	done := make(chan struct{})
	defer close(done)
	wg.Add(1)
	go func() {
		defer wg.Done()
		tick := time.NewTicker(aiHeartbeat)
		defer tick.Stop()
		for {
			select {
			case <-done:
				return
			case <-r.Context().Done():
				return
			case <-tick.C:
				out.beat()
			}
		}
	}()

	var emitted strings.Builder
	res, err := h.aiRunTurn(r.Context(), r, p, history, question, func(e aiTurnEvent) {
		switch e.Type {
		case "text":
			emitted.WriteString(e.Text)
			out.line(map[string]any{"type": "text", "text": e.Text})
		case "tool":
			out.line(map[string]any{"type": "tool", "group": e.Group})
		}
	})
	if r.Context().Err() != nil {
		// The panel closed: nothing to say, nothing to save.
		return
	}
	if err != nil {
		_, text := aiErrorOf(err)
		out.line(map[string]any{"type": "error", "error": text})
		return
	}
	// Text that was not streamed (a provider that answers in one piece, or
	// the line that says a limit was reached) goes out once, at the end.
	if full := res.Text; full != emitted.String() {
		rest := full
		if strings.HasPrefix(full, emitted.String()) {
			rest = full[emitted.Len():]
		}
		if rest != "" {
			out.line(map[string]any{"type": "text", "text": rest})
		}
	}
	for i := range res.Proposals {
		res.Proposals[i].Status = "pending"
	}
	conv, err := aiAppendTurn(body.ConversationID, question, aiMessage{
		Role: "assistant", Text: res.Text, Tools: res.Tools, Proposals: res.Proposals,
		Provider: aiProviderOf(s), Model: p.Model(), TokensIn: res.TokensIn, TokensOut: res.TokensOut,
	}, s, time.Now())
	if err != nil {
		if errors.Is(err, errAIConversationGone) {
			out.line(map[string]any{"type": "error", "error": "That conversation no longer exists."})
		} else {
			out.line(map[string]any{"type": "error", "error": "Could not save the conversation."})
		}
		return
	}
	out.line(map[string]any{
		"type":         "done",
		"conversation": map[string]any{"id": conv.ID, "title": conv.Title},
		"message":      conv.Messages[len(conv.Messages)-1],
	})
}

func (h *Handlers) AIConversationsHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) {
		return
	}
	aiWriteJSONStatus(w, http.StatusOK, aiListConversations(r.URL.Query().Get("q")))
}

func (h *Handlers) AIConversationHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) {
		return
	}
	conv, ok := aiGetConversation(mux.Vars(r)["id"])
	if !ok {
		aiWriteJSONStatus(w, http.StatusNotFound, map[string]any{"error": "That conversation no longer exists."})
		return
	}
	aiWriteJSONStatus(w, http.StatusOK, conv)
}

func (h *Handlers) AIDeleteConversationHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) || !h.requireWriteAccess(w, r) {
		return
	}
	found, err := aiDeleteConversation(mux.Vars(r)["id"])
	if err != nil {
		aiWriteJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": "Could not delete the conversation."})
		return
	}
	if !found {
		aiWriteJSONStatus(w, http.StatusNotFound, map[string]any{"error": "That conversation no longer exists."})
		return
	}
	aiWriteJSONStatus(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handlers) AIDeleteAllConversationsHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) || !h.requireWriteAccess(w, r) {
		return
	}
	if err := aiDeleteAllConversations(); err != nil {
		aiWriteJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": "Could not delete the conversations."})
		return
	}
	aiWriteJSONStatus(w, http.StatusOK, map[string]any{"ok": true})
}

// aiExtendForContainerAction gives a container action the long write deadline
// MCPHandler gives it: an update pulls an image and can run for minutes.
func aiExtendForContainerAction(w http.ResponseWriter, id string) {
	if p, ok := aiFindProposal(id); ok && p.Tool == "container_action" {
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(dockerActionTimeout + time.Minute))
	}
}

// aiApplyProposal claims a proposal, runs its tool as the assistant and
// records how it went. It returns the proposal as stored, an HTTP status and,
// for a refusal, the text. The claim is exclusive: only one caller moves a
// proposal from pending or failed to applying.
func (h *Handlers) aiApplyProposal(r *http.Request, id string) (aiProposal, int, string) {
	s := h.store.GetSettings()
	if !s.AIEnabled {
		return aiProposal{}, http.StatusConflict, aiNotEnabledLine
	}
	prop, ok := aiFindProposal(id)
	if !ok {
		return aiProposal{}, http.StatusNotFound, "That proposal no longer exists."
	}
	if !mcpGroupEnabled(s, mcpToolGroup(prop.Tool)) {
		return prop, http.StatusConflict, aiGroupOffLine
	}
	claim := prop
	claim.Status, claim.Error, claim.Result = "applying", "", ""
	prev, claimed, err := aiUpdateProposal(id, []string{"pending", "failed"}, claim)
	if err != nil {
		return prev, http.StatusInternalServerError, "Could not save the proposal."
	}
	if !claimed {
		switch prev.Status {
		case "":
			return aiProposal{}, http.StatusNotFound, "That proposal no longer exists."
		case "skipped":
			return prev, http.StatusConflict, aiSkippedLine
		}
		return prev, http.StatusConflict, aiAppliedLine
	}

	args := prop.Arguments
	if len(args) == 0 {
		args = json.RawMessage("{}")
	}
	params, _ := json.Marshal(map[string]any{"name": prop.Tool, "arguments": args})
	result, rpcErr := h.mcpCallTool(aiAssistantRequest(r), params)

	final := prop
	final.Status, final.Error, final.Result = "applied", "", "Done"
	switch {
	case rpcErr != nil:
		final.Status, final.Error, final.Result = "failed", rpcErr.Message, ""
	case result["isError"] == true:
		msg := "The change could not be made."
		if payload, _ := result["structuredContent"].(map[string]any); payload != nil {
			if e, _ := payload["error"].(string); e != "" {
				msg = e
			}
		}
		final.Status, final.Error, final.Result = "failed", msg, ""
	default:
		payload, _ := result["structuredContent"].(map[string]any)
		for _, key := range []string{"name", "url", "container"} {
			if v, _ := payload[key].(string); v != "" {
				final.Result = v
				break
			}
		}
	}
	_, _, err = aiUpdateProposal(id, []string{"applying"}, final)
	if err != nil {
		return final, http.StatusInternalServerError, "The change was made, but the proposal could not be saved."
	}
	return final, http.StatusOK, ""
}

func (h *Handlers) AIApplyHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) || !h.requireWriteAccess(w, r) {
		return
	}
	id := mux.Vars(r)["id"]
	aiExtendForContainerAction(w, id)
	prop, status, text := h.aiApplyProposal(r, id)
	if text != "" {
		aiWriteJSONStatus(w, status, map[string]any{"error": text})
		return
	}
	aiWriteJSONStatus(w, http.StatusOK, prop)
}

func (h *Handlers) AISkipHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) || !h.requireWriteAccess(w, r) {
		return
	}
	id := mux.Vars(r)["id"]
	skipped, ok := aiFindProposal(id)
	if !ok {
		aiWriteJSONStatus(w, http.StatusNotFound, map[string]any{"error": "That proposal no longer exists."})
		return
	}
	skipped.Status, skipped.Error, skipped.Result = "skipped", "", ""
	prev, claimed, err := aiUpdateProposal(id, []string{"pending", "failed"}, skipped)
	if err != nil {
		aiWriteJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": "Could not save the proposal."})
		return
	}
	if !claimed {
		text := aiAppliedLine
		if prev.Status == "skipped" {
			text = aiSkippedLine
		}
		aiWriteJSONStatus(w, http.StatusConflict, map[string]any{"error": text})
		return
	}
	aiWriteJSONStatus(w, http.StatusOK, skipped)
}

func (h *Handlers) AIApplyAllHandler(w http.ResponseWriter, r *http.Request) {
	if aiDemoClosed(w) || !h.requireWriteAccess(w, r) {
		return
	}
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, aiAskBodyMax)).Decode(&body); err != nil {
		aiWriteJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "Invalid request body"})
		return
	}
	if !h.store.GetSettings().AIEnabled {
		aiWriteJSONStatus(w, http.StatusConflict, map[string]any{"error": aiNotEnabledLine})
		return
	}
	for _, id := range body.IDs {
		if p, ok := aiFindProposal(id); ok && p.Tool == "container_action" {
			_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(time.Duration(len(body.IDs)) * (dockerActionTimeout + time.Minute)))
			break
		}
	}
	results := []aiProposal{}
	skippedDestructive := []string{}
	for _, id := range body.IDs {
		if p, ok := aiFindProposal(id); ok && (p.Destructive || mcpToolIsDestructive(p.Tool)) {
			skippedDestructive = append(skippedDestructive, id)
			continue
		}
		prop, _, _ := h.aiApplyProposal(r, id)
		if prop.ID != "" {
			results = append(results, prop)
		}
	}
	aiWriteJSONStatus(w, http.StatusOK, map[string]any{"results": results, "skippedDestructive": skippedDestructive})
}
