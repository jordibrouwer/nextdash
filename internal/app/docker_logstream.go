package app

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
A followed container log, for the logs window.

The daemon answers /logs?follow=1 with a stream that stays open while the
container runs: each write is a frame (8-byte header naming stdout or stderr,
then the payload), unless the container has a TTY, in which case it is the raw
terminal output. Frames and lines do not line up, so each stream keeps its own
unfinished line until the rest arrives.

The route hands that on as NDJSON -- one {"t","s","m"} object per line -- so
the browser can read it with fetch() and a stream reader. Not EventSource:
that cannot send the write token's header, and this route sits behind it like
/logs does.
*/

// dockerLogLineMax caps one line; a container that prints a whole file on one
// line should not make the window hold it.
const dockerLogLineMax = 16 << 10

// dockerLogHeartbeat keeps a quiet stream open through a reverse proxy, most
// of which close a response that says nothing for a minute.
var dockerLogHeartbeat = 25 * time.Second

// dockerLogSince is a unix timestamp, with the fraction Docker allows.
var dockerLogSince = regexp.MustCompile(`^\d{1,12}(\.\d{1,9})?$`)

type dockerLogLine struct {
	T string `json:"t"` // the daemon's RFC 3339 timestamp
	S string `json:"s"` // "out" or "err"
	M string `json:"m"`
}

// readDockerLogFrames reads a log stream until it ends, calling emit for each
// complete line and flush after each read, so a line reaches the browser as
// soon as the daemon sends it. Lines carry the daemon's timestamp in front.
func readDockerLogFrames(r io.Reader, tty bool, emit func(dockerLogLine), flush func()) error {
	partial := map[string]*bytes.Buffer{"out": {}, "err": {}}
	lineOut := func(stream string, raw []byte) {
		text := strings.TrimRight(string(raw), "\r")
		t, m, ok := strings.Cut(text, " ")
		if !ok {
			t, m = "", text
		}
		emit(dockerLogLine{T: t, S: stream, M: capRunes(m, dockerLogLineMax)})
	}
	take := func(stream string, payload []byte) {
		buf := partial[stream]
		for len(payload) > 0 {
			i := bytes.IndexByte(payload, '\n')
			if i < 0 {
				buf.Write(payload)
				break
			}
			buf.Write(payload[:i])
			lineOut(stream, buf.Bytes())
			buf.Reset()
			payload = payload[i+1:]
		}
		// A line with no end in sight is let go at a cap rather than held
		// without limit; the rest follows as a line of its own.
		if buf.Len() > 4*dockerLogLineMax {
			lineOut(stream, buf.Bytes())
			buf.Reset()
		}
	}
	finish := func() {
		for _, s := range []string{"out", "err"} {
			if partial[s].Len() > 0 {
				lineOut(s, partial[s].Bytes())
				partial[s].Reset()
			}
		}
		flush()
	}

	if tty {
		chunk := make([]byte, 32<<10)
		for {
			n, err := r.Read(chunk)
			if n > 0 {
				take("out", chunk[:n])
				flush()
			}
			if err != nil {
				finish()
				if err == io.EOF {
					return nil
				}
				return err
			}
		}
	}

	header := make([]byte, 8)
	for {
		if _, err := io.ReadFull(r, header); err != nil {
			finish()
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return nil
			}
			return err
		}
		size := int64(binary.BigEndian.Uint32(header[4:]))
		payload, err := io.ReadAll(io.LimitReader(r, size))
		stream := "out"
		if header[0] == 2 {
			stream = "err"
		}
		take(stream, payload)
		flush()
		if err != nil {
			finish()
			return err
		}
	}
}

// logsFollow opens the followed log. It uses the client without the read
// deadline: the request's context is what ends it.
func (d *dockerAPI) logsFollow(ctx context.Context, id string, tail int, since string) (io.ReadCloser, error) {
	q := url.Values{}
	q.Set("follow", "1")
	q.Set("stdout", "1")
	q.Set("stderr", "1")
	q.Set("timestamps", "1")
	q.Set("tail", strconv.Itoa(tail))
	if since != "" {
		q.Set("since", since)
	}
	resp, err := d.forActions().do(ctx, http.MethodGet, "/containers/"+url.PathEscape(id)+"/logs?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	return resp.Body, nil
}

// dockerLogTail reads ?tail= the way both log routes do: 1-1000, 200 when
// missing or junk.
func dockerLogTail(r *http.Request) int {
	tail, err := strconv.Atoi(r.URL.Query().Get("tail"))
	if err != nil || tail <= 0 {
		return 200
	}
	if tail > 1000 {
		return 1000
	}
	return tail
}

// DockerContainerLogStreamHandler follows a container's log as NDJSON until
// the container stops or the browser lets go.
//
// Behind the write token, like /logs: logs print keys as readily as env does.
func (h *Handlers) DockerContainerLogStreamHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	api, c, ok := h.dockerTarget(w, r)
	if !ok {
		return
	}
	in, err := api.inspectContainer(r.Context(), c.ID)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	since := r.URL.Query().Get("since")
	if !dockerLogSince.MatchString(since) {
		since = ""
	}
	body, err := api.logsFollow(r.Context(), c.ID, dockerLogTail(r), since)
	if err != nil {
		writeDockerError(w, err)
		return
	}
	defer body.Close()

	// The server's read and write timeouts are for ordinary requests; this
	// one lasts as long as someone watches.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	var mu sync.Mutex
	enc := json.NewEncoder(w)
	flush := func() { _ = rc.Flush() }
	emit := func(l dockerLogLine) {
		mu.Lock()
		_ = enc.Encode(l)
		mu.Unlock()
	}
	flushLocked := func() {
		mu.Lock()
		flush()
		mu.Unlock()
	}
	flushLocked()

	done := make(chan struct{})
	defer close(done)
	go func() {
		tick := time.NewTicker(dockerLogHeartbeat)
		defer tick.Stop()
		for {
			select {
			case <-done:
				return
			case <-r.Context().Done():
				return
			case <-tick.C:
				mu.Lock()
				_, _ = w.Write([]byte("\n"))
				flush()
				mu.Unlock()
			}
		}
	}()
	_ = readDockerLogFrames(body, in.Config.Tty, emit, flushLocked)
}
