package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

/*
What an update is doing, while it does it.

An update is a pull and nine calls to the daemon, and can take minutes. The
page used to guess the phase with a timer. Now dockerRecreate reports each step
as it starts and ends, and a few lines from the pull, to a sink it finds on the
context. Without one -- the nightly auto-update, the tests -- nothing is sent.

The action route streams those events as NDJSON when asked (?stream=1). The
last line is the answer the route would have sent anyway, status and body, so
the page handles a streamed update exactly as it handled the plain one.
*/

// dockerProgressEvent is one line of the stream. Step is a fixed key the page
// translates; Text is for the log and stays as the daemon said it.
type dockerProgressEvent struct {
	Type   string          `json:"type"` // step | log | result
	Step   string          `json:"step,omitempty"`
	State  string          `json:"state,omitempty"` // start | done | skip | fail
	Text   string          `json:"text,omitempty"`
	At     int64           `json:"at"`
	Status int             `json:"status,omitempty"`
	Body   json.RawMessage `json:"body,omitempty"`
}

type dockerProgressKey struct{}

type dockerProgressFunc func(dockerProgressEvent)

func withDockerProgress(ctx context.Context, fn dockerProgressFunc) context.Context {
	return context.WithValue(ctx, dockerProgressKey{}, fn)
}

func dockerProgressEmit(ctx context.Context, ev dockerProgressEvent) {
	fn, _ := ctx.Value(dockerProgressKey{}).(dockerProgressFunc)
	if fn == nil {
		return
	}
	ev.At = time.Now().UnixMilli()
	fn(ev)
}

func dockerStep(ctx context.Context, step, state string) {
	dockerProgressEmit(ctx, dockerProgressEvent{Type: "step", Step: step, State: state})
}

func dockerLog(ctx context.Context, format string, args ...any) {
	dockerProgressEmit(ctx, dockerProgressEvent{Type: "log", Text: fmt.Sprintf(format, args...)})
}

// dockerPullTracker turns the daemon's pull stream into a handful of log
// lines: one per layer that finishes, not one per progress tick.
type dockerPullTracker struct {
	layers map[string]bool // id -> complete
}

func (p *dockerPullTracker) line(ctx context.Context, status, id string) {
	if p.layers == nil {
		p.layers = map[string]bool{}
	}
	switch status {
	case "Pulling fs layer", "Waiting", "Already exists":
		if _, seen := p.layers[id]; !seen {
			p.layers[id] = status == "Already exists"
		}
	case "Pull complete":
		p.layers[id] = true
		done := 0
		for _, ok := range p.layers {
			if ok {
				done++
			}
		}
		dockerLog(ctx, "layer %s complete (%d/%d)", id, done, len(p.layers))
	default:
		// "Digest: sha256:…" and "Status: Downloaded newer image for …" say
		// what came of it; the rest is per-byte noise.
		if len(status) > 7 && (status[:7] == "Digest:" || status[:7] == "Status:") {
			dockerLog(ctx, "%s", status)
		}
	}
}

// dockerCaptureWriter holds a route's answer so it can go out as the
// stream's last line instead of as the response itself.
type dockerCaptureWriter struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (c *dockerCaptureWriter) Header() http.Header         { return c.header }
func (c *dockerCaptureWriter) Write(b []byte) (int, error) { return c.body.Write(b) }
func (c *dockerCaptureWriter) WriteHeader(code int) {
	if c.status == 0 {
		c.status = code
	}
}

// dockerProgressStream starts an NDJSON answer on w and returns the sink for
// the events and a function that sends the captured answer as the last line.
func dockerProgressStream(w http.ResponseWriter) (dockerProgressFunc, *dockerCaptureWriter, func()) {
	rc := http.NewResponseController(w)
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_ = rc.Flush()

	var mu sync.Mutex
	enc := json.NewEncoder(w)
	emit := func(ev dockerProgressEvent) {
		mu.Lock()
		defer mu.Unlock()
		_ = enc.Encode(ev)
		_ = rc.Flush()
	}
	capture := &dockerCaptureWriter{header: http.Header{}}
	finish := func() {
		status := capture.status
		if status == 0 {
			status = http.StatusOK
		}
		body := bytes.TrimSpace(capture.body.Bytes())
		if !json.Valid(body) {
			body, _ = json.Marshal(map[string]string{"message": string(body)})
		}
		emit(dockerProgressEvent{Type: "result", Status: status, Body: body, At: time.Now().UnixMilli()})
	}
	return emit, capture, finish
}
