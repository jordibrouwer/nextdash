package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

/*
The assistant's tool loop.

The model is offered the read-only MCP tools and one tool of its own,
propose_changes. Read tools run in-process through mcpCallTool, the same path
an MCP client takes, with the request marked as the assistant's. Write tools are
never callable: the model can only propose them, the proposals are checked
against the tool's schema and switch, and the person applies them with a click.
*/

const (
	aiMaxRounds       = 8
	aiMaxCalls        = 20
	aiMaxOutputTokens = 2048
	aiToolResultMax   = 16 << 10 // bytes of the JSON text sent on
	aiHistoryTurns    = 20       // earlier messages sent along
)

// A var so the deadline test can shorten it.
var aiTurnDeadline = 120 * time.Second

const aiCutMarker = "…(cut)"

type aiProposal struct {
	ID          string          `json:"id"`
	Tool        string          `json:"tool"`
	Arguments   json.RawMessage `json:"arguments"`
	Reason      string          `json:"reason"`
	Destructive bool            `json:"destructive"`
	Status      string          `json:"status"` // pending, applying, applied, failed, skipped
	Error       string          `json:"error"`
	Result      string          `json:"result"`
}

type aiToolSummary struct {
	Name  string `json:"name"`
	Bytes int    `json:"bytes"`
}

type aiTurnEvent struct {
	Type  string `json:"type"` // "text" or "tool"
	Text  string `json:"text"`
	Group string `json:"group"`
}

type aiTurnResult struct {
	Text      string          `json:"text"`
	Tools     []aiToolSummary `json:"tools"`
	Proposals []aiProposal    `json:"proposals"`
	TokensIn  int             `json:"tokensIn"`
	TokensOut int             `json:"tokensOut"`
	Limit     string          `json:"limit"` // "", rounds, calls, deadline
}

const aiSystemFixedLine = "You can look things up with the tools. You cannot change anything yourself: to suggest a change, call propose_changes, and the person applies it with a click."

// aiSystemPrompt carries the date, the page names and the fixed line, and
// nothing else from the data: everything else the model has to look up.
func aiSystemPrompt(now time.Time, pages []Page) string {
	var names []string
	for _, p := range pages {
		if p.Hidden {
			continue
		}
		if name := strings.TrimSpace(p.Name); name != "" {
			names = append(names, name)
		}
	}
	var b strings.Builder
	b.WriteString("You are the assistant inside nextDash, a self-hosted dashboard of bookmarks.\n")
	b.WriteString("Today is " + now.Format("Monday 2006-01-02") + ".\n")
	if len(names) > 0 {
		b.WriteString("The pages are: " + strings.Join(names, ", ") + ".\n")
	}
	b.WriteString(aiSystemFixedLine)
	return b.String()
}

const aiProposeChangesTool = "propose_changes"

// aiOfferedTools is every enabled read tool plus propose_changes, whose
// description names the write tools the switches currently allow.
func aiOfferedTools(s Settings) []aiToolSpec {
	var out []aiToolSpec
	var writes []string
	for _, def := range mcpToolDefinitions(s) {
		name, _ := def["name"].(string)
		if mcpToolIsWrite(def) {
			writes = append(writes, aiDescribeWriteTool(def))
			continue
		}
		desc, _ := def["description"].(string)
		schema, _ := def["inputSchema"].(map[string]any)
		out = append(out, aiToolSpec{Name: name, Description: desc, Schema: schema})
	}
	desc := "Suggest changes. Nothing changes until the person applies a change with a click, so describe each one plainly in reason. " +
		"Each change names one tool and gives that tool's arguments. The tools you can name now:\n" + strings.Join(writes, "\n")
	out = append(out, aiToolSpec{
		Name:        aiProposeChangesTool,
		Description: desc,
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"changes": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"tool":      map[string]any{"type": "string", "description": "The tool that makes the change."},
							"arguments": map[string]any{"type": "object", "description": "That tool's arguments."},
							"reason":    map[string]any{"type": "string", "description": "Why, in one sentence for the person."},
						},
						"required": []string{"tool", "arguments", "reason"},
					},
				},
			},
			"required": []string{"changes"},
		},
	})
	return out
}

// aiDescribeWriteTool is one line for the propose_changes description: the
// name, what it does and its arguments, since the model cannot call it to
// find out.
func aiDescribeWriteTool(def map[string]any) string {
	name, _ := def["name"].(string)
	desc, _ := def["description"].(string)
	schema, _ := def["inputSchema"].(map[string]any)
	props, _ := schema["properties"].(map[string]any)
	required := map[string]bool{}
	for _, r := range aiStringList(schema["required"]) {
		required[r] = true
	}
	keys := make([]string, 0, len(props))
	for k := range props {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var args []string
	for _, k := range keys {
		prop, _ := props[k].(map[string]any)
		typ, _ := prop["type"].(string)
		arg := k + " (" + typ
		if required[k] {
			arg += ", required"
		}
		if allowed := aiStringList(prop["enum"]); len(allowed) > 0 {
			arg += ", one of " + strings.Join(allowed, "/")
		}
		args = append(args, arg+")")
	}
	return "- " + name + ": " + desc + " Arguments: " + strings.Join(args, ", ") + "."
}

var aiLimitLines = map[string]string{
	"rounds":   fmt.Sprintf("I stopped here: it took more than %d rounds of looking things up.", aiMaxRounds),
	"calls":    fmt.Sprintf("I stopped here: it took more than %d lookups.", aiMaxCalls),
	"deadline": "I stopped here: it took longer than two minutes.",
}

/*
aiRunTurn answers one question.

A provider error returns (aiTurnResult{}, err) and the caller saves nothing. A
cancelled context (the panel closed) returns the context's error rather than
the provider's "could not reach" copy, and the turn's own deadline running out
during a model call is the timeout kind. A limit reached between calls ends the
turn with what was said so far and a line saying why.
*/
func (h *Handlers) aiRunTurn(ctx context.Context, r *http.Request, p aiProvider, history []aiWireMessage, question string, emit func(aiTurnEvent)) (aiTurnResult, error) {
	ctx, cancel := context.WithTimeout(ctx, aiTurnDeadline)
	defer cancel()
	if emit == nil {
		emit = func(aiTurnEvent) {}
	}

	offered := aiOfferedTools(h.store.GetSettings())
	offeredSet := map[string]bool{}
	for _, t := range offered {
		offeredSet[t.Name] = true
	}
	req := aiChatRequest{
		System:    aiSystemPrompt(time.Now(), h.store.GetPages()),
		Messages:  append(aiTrimHistory(history), aiWireMessage{Role: "user", Text: question}),
		Tools:     offered,
		MaxTokens: aiMaxOutputTokens,
	}
	toolReq := aiAssistantRequest(r.WithContext(ctx))

	var res aiTurnResult
	var text strings.Builder
	calls := 0
	for round := 1; ; round++ {
		if err := ctx.Err(); err != nil {
			if errors.Is(err, context.Canceled) {
				return aiTurnResult{}, err
			}
			res.Limit = "deadline"
			break
		}
		roundStarted := false
		reply, err := p.Chat(ctx, req, func(delta string) {
			if delta == "" {
				return
			}
			if !roundStarted && text.Len() > 0 {
				text.WriteString("\n\n")
				emit(aiTurnEvent{Type: "text", Text: "\n\n"})
			}
			roundStarted = true
			text.WriteString(delta)
			emit(aiTurnEvent{Type: "text", Text: delta})
		})
		if err != nil {
			// The transport calls a cancelled request "unreachable"; the
			// context knows better.
			if ctxErr := ctx.Err(); ctxErr != nil {
				if errors.Is(ctxErr, context.Canceled) {
					return aiTurnResult{}, ctxErr
				}
				return aiTurnResult{}, &aiError{Kind: "timeout"}
			}
			return aiTurnResult{}, err
		}
		// A provider that answers without streaming still has its text kept.
		if !roundStarted && reply.Text != "" {
			if text.Len() > 0 {
				text.WriteString("\n\n")
			}
			text.WriteString(reply.Text)
		}
		res.TokensIn += reply.TokensIn
		res.TokensOut += reply.TokensOut
		if len(reply.ToolCalls) == 0 {
			break
		}

		req.Messages = append(req.Messages, aiWireMessage{Role: "assistant", Text: reply.Text, ToolCalls: reply.ToolCalls})
		for _, call := range reply.ToolCalls {
			calls++
			var out string
			switch {
			case calls > aiMaxCalls:
				res.Limit = "calls"
				out = aiJSONText(map[string]any{"error": "Too many lookups for one question."})
			case call.Name == aiProposeChangesTool:
				accepted, told := h.aiCheckProposals(h.store.GetSettings(), call.Arguments)
				res.Proposals = append(res.Proposals, accepted...)
				out = aiJSONText(told)
			case !offeredSet[call.Name]:
				out = aiJSONText(map[string]any{"error": "Unknown tool: " + call.Name + ". Only the tools you were given can be called."})
			default:
				emit(aiTurnEvent{Type: "tool", Group: mcpToolGroup(call.Name)})
				out = h.aiRunTool(toolReq, call)
				res.Tools = append(res.Tools, aiToolSummary{Name: call.Name, Bytes: len(out)})
			}
			req.Messages = append(req.Messages, aiWireMessage{Role: "tool", ToolCallID: call.ID, Text: out})
		}
		if res.Limit != "" {
			break
		}
		if round >= aiMaxRounds {
			res.Limit = "rounds"
			break
		}
	}

	res.Text = text.String()
	if line := aiLimitLines[res.Limit]; line != "" {
		if res.Text != "" {
			res.Text += "\n\n"
		}
		res.Text += line
	}
	return res, nil
}

// aiRunTool runs one read tool through the MCP path and returns the text sent
// on to the model. A refusal (switch, token) goes on as-is and is not retried.
func (h *Handlers) aiRunTool(r *http.Request, call aiToolCall) string {
	args := call.Arguments
	if len(args) == 0 {
		args = json.RawMessage("{}")
	}
	params, _ := json.Marshal(map[string]any{"name": call.Name, "arguments": args})
	result, rpcErr := h.mcpCallTool(r, params)
	var out string
	if rpcErr != nil {
		out = aiJSONText(map[string]any{"error": rpcErr.Message})
	} else if content, ok := result["content"].([]map[string]any); ok && len(content) > 0 {
		out, _ = content[0]["text"].(string)
	}
	return aiCutText(out, aiToolResultMax)
}

// aiCutText keeps at most max bytes, on a character boundary, and says so.
func aiCutText(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + aiCutMarker
}

func aiJSONText(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"error":"could not encode the result"}`
	}
	return string(b)
}

// aiTrimHistory keeps the last aiHistoryTurns messages, starting at a user
// message so a tool result never arrives without the call it answers.
func aiTrimHistory(history []aiWireMessage) []aiWireMessage {
	if len(history) > aiHistoryTurns {
		history = history[len(history)-aiHistoryTurns:]
	}
	for len(history) > 0 && history[0].Role != "user" {
		history = history[1:]
	}
	return append([]aiWireMessage(nil), history...)
}

/*
aiCheckProposals checks what the model proposed and keeps the valid changes as
pending proposals. Nothing the model says is trusted: the tool must be a write
tool (by its annotations), its group must be on, and the arguments must pass
the tool's own inputSchema. What was rejected, and why, is the tool result the
model gets back, once, so it can correct.
*/
func (h *Handlers) aiCheckProposals(s Settings, args json.RawMessage) (accepted []aiProposal, toolResult map[string]any) {
	rejected := []map[string]any{}
	var body struct {
		Changes []struct {
			Tool      string          `json:"tool"`
			Arguments json.RawMessage `json:"arguments"`
			Reason    string          `json:"reason"`
		} `json:"changes"`
	}
	if err := json.Unmarshal(args, &body); err != nil {
		rejected = append(rejected, map[string]any{"tool": aiProposeChangesTool, "reason": "the arguments must be an object with a changes list"})
		return nil, map[string]any{"stored": 0, "rejected": rejected}
	}

	defs := map[string]map[string]any{}
	for _, def := range mcpAllToolDefinitions() {
		name, _ := def["name"].(string)
		defs[name] = def
	}
	for _, change := range body.Changes {
		def, known := defs[change.Tool]
		reason := ""
		switch {
		case !known:
			reason = "unknown tool"
		case !mcpToolIsWrite(def):
			reason = "not a change"
		case !mcpGroupEnabled(s, mcpToolGroup(change.Tool)):
			reason = "that group is switched off"
		default:
			schema, _ := def["inputSchema"].(map[string]any)
			if err := aiValidateArgs(schema, change.Arguments); err != nil {
				reason = err.Error()
			}
		}
		if reason != "" {
			rejected = append(rejected, map[string]any{"tool": change.Tool, "reason": reason})
			continue
		}
		arguments := change.Arguments
		if len(arguments) == 0 || string(arguments) == "null" {
			arguments = json.RawMessage("{}")
		}
		accepted = append(accepted, aiProposal{
			ID:          aiProposalID(),
			Tool:        change.Tool,
			Arguments:   arguments,
			Reason:      change.Reason,
			Destructive: mcpToolIsDestructive(change.Tool),
			Status:      "pending",
		})
	}
	return accepted, map[string]any{"stored": len(accepted), "rejected": rejected}
}

func aiProposalID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
