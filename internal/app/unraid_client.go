package app

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

/*
One GraphQL request to the Unraid API, without a GraphQL library: a POST of
{"query": ...} with the key in x-api-key. Read only by construction -- nothing
here sends a mutation, and the queries are built in unraid_schema.go.

GraphQL answers 200 with "errors" beside "data" when one field is refused, and
refuses the whole query when a field does not exist. The first is kept as
field errors so the rest of the answer still draws; the second is a
validation error, which unraid_schema.go prevents by asking the schema first.
*/

const (
	unraidTimeout   = 8 * time.Second
	unraidMaxAnswer = 1 << 20
)

var (
	errUnraidUnauthorized = errors.New("unraid: the API key was refused")
	errUnraidRateLimited  = errors.New("unraid: too many requests")
	errUnraidNoAPI        = errors.New("unraid: no API at this address (Unraid 7.2 or the Unraid Connect plugin is needed)")
)

type unraidValidationError struct{ Message string }

func (e unraidValidationError) Error() string { return "unraid: query refused: " + e.Message }

type unraidFieldError struct {
	Path    []string
	Code    string
	Message string
}

func (e unraidFieldError) Forbidden() bool {
	return e.Code == "FORBIDDEN" || strings.Contains(strings.ToLower(e.Message), "forbidden")
}

var unraidAreaComment = regexp.MustCompile(`^#\s*area:\s*([a-z]+)`)

func unraidQuery(ctx context.Context, srv UnraidServer, key, query string, allowLocal bool) (json.RawMessage, []unraidFieldError, error) {
	if dir := os.Getenv("NEXTDASH_UNRAID_FIXTURE"); dir != "" {
		return unraidFixtureAnswer(dir, query)
	}
	body, _ := json.Marshal(map[string]any{"query": query})
	ctx, cancel := context.WithTimeout(ctx, unraidTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, srv.BaseURL+"/graphql", bytes.NewReader(body))
	if err != nil {
		return nil, nil, fmt.Errorf("unraid: bad address")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-api-key", key)

	transport := newSSRFSafeTransportWithHeaderTimeout(allowLocal, 5*time.Second, unraidTimeout)
	if srv.InsecureTLS {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // the reader's own switch, for a self-signed Unraid certificate
	}
	client := &http.Client{
		Transport: transport,
		// A redirect from /graphql is a login page or another host; neither is an answer.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("unraid: %s", unraidTransportReason(err))
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, unraidMaxAnswer+1))
	if err != nil {
		return nil, nil, fmt.Errorf("unraid: the answer could not be read")
	}
	if len(raw) > unraidMaxAnswer {
		return nil, nil, fmt.Errorf("unraid: the answer is larger than 1 MB")
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return nil, nil, errUnraidUnauthorized
	case resp.StatusCode == http.StatusTooManyRequests:
		return nil, nil, errUnraidRateLimited
	case resp.StatusCode == http.StatusNotFound || (resp.StatusCode >= 300 && resp.StatusCode < 400):
		return nil, nil, errUnraidNoAPI
	}
	return decodeUnraidAnswer(resp.StatusCode, raw)
}

func decodeUnraidAnswer(status int, raw []byte) (json.RawMessage, []unraidFieldError, error) {
	var answer struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message    string `json:"message"`
			Path       []any  `json:"path"`
			Extensions struct {
				Code string `json:"code"`
			} `json:"extensions"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return nil, nil, fmt.Errorf("unraid: HTTP %d, not a GraphQL answer", status)
	}
	var fieldErrs []unraidFieldError
	for _, e := range answer.Errors {
		if len(e.Path) == 0 {
			if e.Extensions.Code == "UNAUTHENTICATED" {
				return nil, nil, errUnraidUnauthorized
			}
			return nil, nil, unraidValidationError{Message: e.Message}
		}
		path := make([]string, 0, len(e.Path))
		for _, p := range e.Path {
			path = append(path, fmt.Sprint(p))
		}
		fieldErrs = append(fieldErrs, unraidFieldError{Path: path, Code: e.Extensions.Code, Message: e.Message})
	}
	if status >= 400 && len(answer.Data) == 0 {
		return nil, nil, fmt.Errorf("unraid: HTTP %d", status)
	}
	return answer.Data, fieldErrs, nil
}

func unraidTransportReason(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "certificate"):
		return "the TLS certificate was not accepted (switch on \"Accept a self-signed certificate\")"
	case strings.Contains(msg, "refused"):
		return "the connection was refused"
	case strings.Contains(msg, "deadline") || strings.Contains(msg, "Timeout"):
		return "no answer within 8 seconds"
	case strings.Contains(msg, "disallowed IP"):
		return "local addresses are not allowed (Config → Bookmarks → allow local addresses)"
	}
	return "the server could not be reached"
}

func unraidFixtureAnswer(dir, query string) (json.RawMessage, []unraidFieldError, error) {
	m := unraidAreaComment.FindStringSubmatch(strings.TrimSpace(query))
	if m == nil {
		return nil, nil, fmt.Errorf("unraid fixture: query has no area comment")
	}
	raw, err := os.ReadFile(filepath.Join(dir, m[1]+".json"))
	if err != nil {
		return nil, nil, errUnraidNoAPI
	}
	return decodeUnraidAnswer(200, raw)
}
