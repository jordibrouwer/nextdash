package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// anthropicProvider speaks the Messages API, streaming.
type anthropicProvider struct {
	base, key, model string
	client           *http.Client
}

func (p *anthropicProvider) Label() string { return "Claude" }
func (p *anthropicProvider) Model() string { return p.model }

func (p *anthropicProvider) requestBody(req aiChatRequest) ([]byte, error) {
	body := map[string]any{
		"model":      p.model,
		"max_tokens": aiMaxTokensOf(req),
		"messages":   anthropicMessages(req.Messages),
		"stream":     true,
	}
	if req.System != "" {
		body["system"] = req.System
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{
				"name":         t.Name,
				"description":  t.Description,
				"input_schema": aiToolSchema(t.Schema),
			})
		}
		body["tools"] = tools
	}
	return json.Marshal(body)
}

// anthropicMessages folds consecutive tool replies into one user message of
// tool_result blocks, and turns an assistant's calls into tool_use blocks.
func anthropicMessages(msgs []aiWireMessage) []map[string]any {
	out := []map[string]any{}
	var results []map[string]any
	flush := func() {
		if len(results) > 0 {
			out = append(out, map[string]any{"role": "user", "content": results})
			results = nil
		}
	}
	for _, m := range msgs {
		if m.Role == "tool" {
			results = append(results, map[string]any{
				"type":        "tool_result",
				"tool_use_id": m.ToolCallID,
				"content":     m.Text,
			})
			continue
		}
		flush()
		blocks := []map[string]any{}
		if strings.TrimSpace(m.Text) != "" {
			blocks = append(blocks, map[string]any{"type": "text", "text": m.Text})
		}
		if m.Role == "assistant" {
			for _, c := range m.ToolCalls {
				input := c.Arguments
				if !json.Valid(input) || !bytes.HasPrefix(bytes.TrimSpace(input), []byte("{")) {
					input = json.RawMessage(`{}`)
				}
				blocks = append(blocks, map[string]any{"type": "tool_use", "id": c.ID, "name": c.Name, "input": input})
			}
		}
		if len(blocks) == 0 {
			// The API refuses an empty text block.
			continue
		}
		role := "user"
		if m.Role == "assistant" {
			role = "assistant"
		}
		out = append(out, map[string]any{"role": role, "content": blocks})
	}
	flush()
	return out
}

type anthropicEvent struct {
	Type    string `json:"type"`
	Index   int    `json:"index"`
	Message struct {
		Usage struct {
			InputTokens int `json:"input_tokens"`
		} `json:"usage"`
	} `json:"message"`
	ContentBlock struct {
		Type string `json:"type"`
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"content_block"`
	Delta struct {
		Type        string `json:"type"`
		Text        string `json:"text"`
		PartialJSON string `json:"partial_json"`
	} `json:"delta"`
	Usage struct {
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
	Error struct {
		Type string `json:"type"`
	} `json:"error"`
}

func (p *anthropicProvider) Chat(ctx context.Context, req aiChatRequest, onText func(string)) (aiChatReply, error) {
	payload, err := p.requestBody(req)
	if err != nil {
		return aiChatReply{}, &aiError{Kind: "bad_request", Status: 400}
	}
	resp, err := aiDo(ctx, p.client, func() (*http.Request, error) {
		r, err := http.NewRequest(http.MethodPost, p.base+"/v1/messages", bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		r.Header.Set("x-api-key", p.key)
		r.Header.Set("anthropic-version", "2023-06-01")
		r.Header.Set("content-type", "application/json")
		r.Header.Set("accept", "text/event-stream")
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
	var order []int
	finished := false
	err = aiReadSSE(resp.Body, func(event, data string) error {
		var ev anthropicEvent
		if json.Unmarshal([]byte(data), &ev) != nil {
			return nil
		}
		if ev.Type == "" {
			ev.Type = event
		}
		switch ev.Type {
		case "message_start":
			reply.TokensIn = ev.Message.Usage.InputTokens
		case "content_block_start":
			if ev.ContentBlock.Type == "tool_use" {
				calls[ev.Index] = &pending{id: ev.ContentBlock.ID, name: ev.ContentBlock.Name}
				order = append(order, ev.Index)
			}
		case "content_block_delta":
			switch ev.Delta.Type {
			case "text_delta":
				text.WriteString(ev.Delta.Text)
				if onText != nil && ev.Delta.Text != "" {
					onText(ev.Delta.Text)
				}
			case "input_json_delta":
				if c := calls[ev.Index]; c != nil {
					c.args.WriteString(ev.Delta.PartialJSON)
				}
			}
		case "message_delta":
			reply.TokensOut = ev.Usage.OutputTokens
		case "message_stop":
			finished = true
			return errAIStreamDone
		case "error":
			status := 500
			if ev.Error.Type == "overloaded_error" {
				status = 529
			}
			return &aiError{Kind: "provider", Status: status}
		}
		return nil
	})
	if err != nil {
		return aiChatReply{}, aiTransportError(err)
	}
	if !finished {
		return aiChatReply{}, aiStreamCut()
	}
	reply.Text = text.String()
	for _, i := range order {
		c := calls[i]
		reply.ToolCalls = append(reply.ToolCalls, aiToolCall{ID: c.id, Name: c.name, Arguments: aiArgumentsOrEmpty(c.args.String())})
	}
	return reply, nil
}
