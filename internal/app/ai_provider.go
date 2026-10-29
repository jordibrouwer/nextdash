package app

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// The in-app assistant talks to one of three model providers. Everything a
// provider says back on failure stays here: the caller only ever sees an
// aiError, whose text is fixed copy, because an error body can echo the key
// or the user's question.

type aiToolSpec struct {
	Name, Description string
	Schema            map[string]any
}

type aiToolCall struct {
	ID, Name  string
	Arguments json.RawMessage
}

type aiWireMessage struct {
	Role       string // "user" | "assistant" | "tool"
	Text       string
	ToolCalls  []aiToolCall // assistant only
	ToolCallID string       // tool only
}

type aiChatRequest struct {
	System    string
	Messages  []aiWireMessage
	Tools     []aiToolSpec
	MaxTokens int
}

type aiChatReply struct {
	Text                string
	ToolCalls           []aiToolCall
	TokensIn, TokensOut int
}

type aiProvider interface {
	Chat(ctx context.Context, req aiChatRequest, onText func(string)) (aiChatReply, error)
	Label() string // "Claude", "OpenAI", "OpenAI-compatible"
	Model() string
}

type aiError struct {
	Kind   string
	Status int
}

func (e *aiError) Error() string { return aiErrorText(e.Kind, e.Status) }

func aiErrorText(kind string, status int) string {
	switch kind {
	case "bad_key":
		return "The provider refused the key."
	case "unknown_model":
		return "The provider does not know that model."
	case "rate_limited":
		return "The provider is rate limiting. Try again in a minute."
	case "unreachable":
		return "Could not reach the provider."
	case "timeout":
		return "The provider took too long to answer."
	case "too_large":
		return "The provider's answer was too large."
	case "bad_request":
		return "The provider refused the request (HTTP 400)."
	}
	return fmt.Sprintf("The provider had a problem (HTTP %d).", status)
}

var errAINotReady = errors.New("the assistant is not set up")

const (
	aiClientTimeout     = 120 * time.Second
	aiDefaultMaxTokens  = 4096
	aiErrorBodyMaxBytes = 16 << 10
	aiRetryAfterCap     = 5 * time.Second
)

var (
	aiAnthropicBaseURL = "https://api.anthropic.com"
	aiOpenAIBaseURL    = "https://api.openai.com/v1"
	aiRetryWait        = 2 * time.Second
	// A var so the oversize test can lower it.
	aiMaxResponseBytes int64 = 4 << 20
	aiHTTPClient             = func(allowLocal bool) *http.Client {
		return newOutboundHTTPClientWithHeaderTimeout(allowLocal, aiClientTimeout, 90*time.Second, 0)
	}
)

func newAIProvider(s Settings) (aiProvider, error) {
	if ok, _ := aiReady(s); !ok {
		return nil, errAINotReady
	}
	p := aiProviderOf(s)
	key, model := aiKeyFor(p), aiModelOf(s)
	switch p {
	case aiProviderOpenAI:
		return &openAIProvider{base: aiOpenAIBaseURL, key: key, model: model, label: "OpenAI", client: aiHTTPClient(false)}, nil
	case aiProviderCompatible:
		// Home servers such as Ollama live on the LAN or loopback.
		base := strings.TrimRight(strings.TrimSpace(s.AIBaseURL), "/")
		return &openAIProvider{base: base, key: key, model: model, label: "OpenAI-compatible", client: aiHTTPClient(true)}, nil
	}
	return &anthropicProvider{base: aiAnthropicBaseURL, key: key, model: model, client: aiHTTPClient(false)}, nil
}

// aiClassify turns a status and the error body's type or code into a kind.
func aiClassify(status int, errType string) string {
	errType = strings.ToLower(errType)
	switch {
	case status == 401 || status == 403:
		return "bad_key"
	case status == 404, status == 400 && strings.Contains(errType, "model"):
		return "unknown_model"
	case status == 429:
		return "rate_limited"
	case status == 400 || status == 422:
		return "bad_request"
	}
	return "provider"
}

// aiErrorType reads error.type and error.code from an error body, and nothing
// else. Anthropic sets type; OpenAI sets code (a string, or null) and type.
func aiErrorType(body io.Reader) string {
	data, _ := io.ReadAll(io.LimitReader(body, aiErrorBodyMaxBytes))
	var parsed struct {
		Error struct {
			Type string          `json:"type"`
			Code json.RawMessage `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(data, &parsed) != nil {
		return ""
	}
	var code string
	_ = json.Unmarshal(parsed.Error.Code, &code)
	return strings.TrimSpace(parsed.Error.Type + " " + code)
}

// aiTransportError keeps the kind of a transport failure and drops its text,
// which can carry the address and more.
func aiTransportError(err error) *aiError {
	var ae *aiError
	if errors.As(err, &ae) {
		return ae
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &aiError{Kind: "timeout"}
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return &aiError{Kind: "timeout"}
	}
	return &aiError{Kind: "unreachable"}
}

// aiDo sends a request, retrying once on 429 or 5xx before any of the body is
// read. A non-2xx answer comes back as an *aiError.
func aiDo(ctx context.Context, client *http.Client, build func() (*http.Request, error)) (*http.Response, error) {
	for attempt := 0; ; attempt++ {
		req, err := build()
		if err != nil {
			return nil, &aiError{Kind: "bad_request", Status: 400}
		}
		resp, err := client.Do(req.WithContext(ctx))
		if err != nil {
			// Never retried: a timeout already took its full time, and a host
			// that does not answer will not answer two seconds later either.
			return nil, aiTransportError(err)
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return resp, nil
		}
		retryable := resp.StatusCode == 429 || resp.StatusCode >= 500
		if retryable && attempt == 0 {
			wait := aiRetryWait
			if secs, err := strconv.Atoi(strings.TrimSpace(resp.Header.Get("Retry-After"))); err == nil && secs > 0 {
				wait = time.Duration(secs) * time.Second
				if wait > aiRetryAfterCap {
					wait = aiRetryAfterCap
				}
			}
			drainAndCloseResponse(resp)
			select {
			case <-time.After(wait):
				continue
			case <-ctx.Done():
				return nil, aiTransportError(ctx.Err())
			}
		}
		errType := aiErrorType(resp.Body)
		drainAndCloseResponse(resp)
		return nil, &aiError{Kind: aiClassify(resp.StatusCode, errType), Status: resp.StatusCode}
	}
}

// aiCapReader fails once more than max bytes have come through.
type aiCapReader struct {
	r    io.Reader
	left int64
}

func (c *aiCapReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.left -= int64(n)
	if c.left < 0 {
		return n, &aiError{Kind: "too_large"}
	}
	return n, err
}

// errAIStreamDone lets an event handler end the stream early and cleanly.
var errAIStreamDone = errors.New("stream done")

// aiReadSSE reads a server-sent event stream: event: and data: lines, a blank
// line ends an event. More than aiMaxResponseBytes is too_large.
func aiReadSSE(body io.Reader, onEvent func(event, data string) error) error {
	limited := io.LimitReader(body, aiMaxResponseBytes+1)
	reader := bufio.NewReader(&aiCapReader{r: limited, left: aiMaxResponseBytes})
	var event string
	var data []string
	dispatch := func() error {
		if len(data) == 0 {
			event = ""
			return nil
		}
		err := onEvent(event, strings.Join(data, "\n"))
		event, data = "", nil
		return err
	}
	for {
		line, readErr := reader.ReadString('\n')
		if readErr != nil && readErr != io.EOF {
			return aiTransportError(readErr)
		}
		line = strings.TrimRight(line, "\r\n")
		var err error
		switch {
		case line == "":
			err = dispatch()
		case strings.HasPrefix(line, ":"):
		default:
			field, value, _ := strings.Cut(line, ":")
			value = strings.TrimPrefix(value, " ")
			switch field {
			case "event":
				event = value
			case "data":
				data = append(data, value)
			}
		}
		if err == nil && readErr == io.EOF {
			err = dispatch()
		}
		if errors.Is(err, errAIStreamDone) {
			return nil
		}
		if err != nil {
			return err
		}
		if readErr == io.EOF {
			return nil
		}
	}
}

// aiToolSchema guarantees an object schema with a properties map, which both
// providers require, and drops nothing else.
func aiToolSchema(schema map[string]any) map[string]any {
	out := make(map[string]any, len(schema)+2)
	for k, v := range schema {
		out[k] = v
	}
	out["type"] = "object"
	if _, ok := out["properties"].(map[string]any); !ok {
		out["properties"] = map[string]any{}
	}
	return out
}

func aiArgumentsOrEmpty(raw string) json.RawMessage {
	if strings.TrimSpace(raw) == "" {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(raw)
}

func aiMaxTokensOf(req aiChatRequest) int {
	if req.MaxTokens <= 0 {
		return aiDefaultMaxTokens
	}
	return req.MaxTokens
}
