package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
)

// openAIProvider speaks chat completions, streaming. It serves OpenAI itself
// and any server that copies the API (Ollama, LM Studio, vLLM, OpenRouter).
type openAIProvider struct {
	base, key, model, label string
	client                  *http.Client
}

func (p *openAIProvider) Label() string { return p.label }
func (p *openAIProvider) Model() string { return p.model }

func (p *openAIProvider) requestBody(req aiChatRequest) ([]byte, error) {
	msgs := []map[string]any{}
	if req.System != "" {
		msgs = append(msgs, map[string]any{"role": "system", "content": req.System})
	}
	for _, m := range req.Messages {
		switch m.Role {
		case "tool":
			msgs = append(msgs, map[string]any{"role": "tool", "tool_call_id": m.ToolCallID, "content": m.Text})
		case "assistant":
			msg := map[string]any{"role": "assistant", "content": m.Text}
			if len(m.ToolCalls) > 0 {
				calls := make([]map[string]any, 0, len(m.ToolCalls))
				for _, c := range m.ToolCalls {
					calls = append(calls, map[string]any{
						"id":       c.ID,
						"type":     "function",
						"function": map[string]any{"name": c.Name, "arguments": string(aiArgumentsOrEmpty(string(c.Arguments)))},
					})
				}
				msg["tool_calls"] = calls
				if m.Text == "" {
					msg["content"] = nil
				}
			}
			msgs = append(msgs, msg)
		default:
			msgs = append(msgs, map[string]any{"role": "user", "content": m.Text})
		}
	}
	body := map[string]any{
		"model":          p.model,
		"messages":       msgs,
		"stream":         true,
		"stream_options": map[string]any{"include_usage": true},
	}
	// OpenAI deprecated max_tokens and its current models refuse it; servers
	// that copy the API mostly know only max_tokens.
	if p.label == "OpenAI" {
		body["max_completion_tokens"] = aiMaxTokensOf(req)
	} else {
		body["max_tokens"] = aiMaxTokensOf(req)
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        t.Name,
					"description": t.Description,
					"parameters":  aiToolSchema(t.Schema),
				},
			})
		}
		body["tools"] = tools
	}
	return json.Marshal(body)
}

type openAIChunk struct {
	Choices []struct {
		Delta struct {
			Content   *string `json:"content"`
			ToolCalls []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
	Error json.RawMessage `json:"error"`
}

func (p *openAIProvider) Chat(ctx context.Context, req aiChatRequest, onText func(string)) (aiChatReply, error) {
	payload, err := p.requestBody(req)
	if err != nil {
		return aiChatReply{}, &aiError{Kind: "bad_request", Status: 400}
	}
	resp, err := aiDo(ctx, p.client, func() (*http.Request, error) {
		r, err := http.NewRequest(http.MethodPost, p.base+"/chat/completions", bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		if p.key != "" {
			r.Header.Set("Authorization", "Bearer "+p.key)
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept", "text/event-stream")
		return r, nil
	})
	if err != nil {
		return aiChatReply{}, err
	}
	defer drainAndCloseResponse(resp)

	var reply aiChatReply
	var text strings.Builder
	type pending struct {
		id, name string
		args     strings.Builder
	}
	calls := map[int]*pending{}
	err = aiReadSSE(resp.Body, func(_, data string) error {
		if strings.TrimSpace(data) == "[DONE]" {
			return errAIStreamDone
		}
		var chunk openAIChunk
		if json.Unmarshal([]byte(data), &chunk) != nil {
			return nil
		}
		if len(chunk.Error) > 0 && string(chunk.Error) != "null" {
			return &aiError{Kind: "provider", Status: 500}
		}
		if chunk.Usage != nil {
			reply.TokensIn = chunk.Usage.PromptTokens
			reply.TokensOut = chunk.Usage.CompletionTokens
		}
		if len(chunk.Choices) == 0 {
			return nil
		}
		delta := chunk.Choices[0].Delta
		if delta.Content != nil && *delta.Content != "" {
			text.WriteString(*delta.Content)
			if onText != nil {
				onText(*delta.Content)
			}
		}
		for _, tc := range delta.ToolCalls {
			c := calls[tc.Index]
			if c == nil {
				c = &pending{}
				calls[tc.Index] = c
			}
			if c.id == "" {
				c.id = tc.ID
			}
			if c.name == "" {
				c.name = tc.Function.Name
			}
			c.args.WriteString(tc.Function.Arguments)
		}
		return nil
	})
	if err != nil {
		return aiChatReply{}, aiTransportError(err)
	}
	reply.Text = text.String()
	indexes := make([]int, 0, len(calls))
	for i := range calls {
		indexes = append(indexes, i)
	}
	sort.Ints(indexes)
	for _, i := range indexes {
		c := calls[i]
		reply.ToolCalls = append(reply.ToolCalls, aiToolCall{ID: c.id, Name: c.name, Arguments: aiArgumentsOrEmpty(c.args.String())})
	}
	return reply, nil
}
