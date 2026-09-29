package app

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func dockerFrame(stream byte, payload string) []byte {
	h := make([]byte, 8)
	h[0] = stream
	binary.BigEndian.PutUint32(h[4:], uint32(len(payload)))
	return append(h, payload...)
}

// Frames and lines do not line up: a frame can end mid-line or carry several
// lines, and each stream keeps its own unfinished line until the rest arrives.
func TestReadDockerLogFramesSplitsLinesPerStream(t *testing.T) {
	var buf bytes.Buffer
	buf.Write(dockerFrame(1, "2026-09-29T10:00:00.1Z first\n2026-09-29T10:00:00.2Z sec"))
	buf.Write(dockerFrame(2, "2026-09-29T10:00:00.3Z oops\n"))
	buf.Write(dockerFrame(1, "ond\n"))
	buf.Write(dockerFrame(1, "2026-09-29T10:00:00.4Z "+strings.Repeat("x", dockerLogLineMax+50)+"\n"))
	buf.Write(dockerFrame(1, "2026-09-29T10:00:00.5Z no newline at the end"))
	var got []dockerLogLine
	if err := readDockerLogFrames(&buf, false, func(l dockerLogLine) { got = append(got, l) }, func() {}); err != nil {
		t.Fatal(err)
	}
	want := []dockerLogLine{
		{T: "2026-09-29T10:00:00.1Z", S: "out", M: "first"},
		{T: "2026-09-29T10:00:00.3Z", S: "err", M: "oops"},
		{T: "2026-09-29T10:00:00.2Z", S: "out", M: "second"},
	}
	if len(got) != 5 {
		t.Fatalf("got %d lines: %+v", len(got), got)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("line %d = %+v, want %+v", i, got[i], w)
		}
	}
	if len([]rune(got[3].M)) != dockerLogLineMax {
		t.Errorf("long line kept %d runes", len([]rune(got[3].M)))
	}
	if got[4].M != "no newline at the end" {
		t.Errorf("last partial line = %+v", got[4])
	}
}

// A TTY container's log is the raw terminal output: no frame headers, and all
// of it counts as stdout.
func TestReadDockerLogFramesTTY(t *testing.T) {
	in := strings.NewReader("2026-09-29T10:00:00Z one\r\n2026-09-29T10:00:01Z two\n")
	var got []dockerLogLine
	_ = readDockerLogFrames(in, true, func(l dockerLogLine) { got = append(got, l) }, func() {})
	if len(got) != 2 || got[0].M != "one" || got[1].S != "out" || got[1].T != "2026-09-29T10:00:01Z" {
		t.Fatalf("got %+v", got)
	}
}

func readNDJSON(t *testing.T, body string) []dockerLogLine {
	t.Helper()
	var out []dockerLogLine
	sc := bufio.NewScanner(strings.NewReader(body))
	for sc.Scan() {
		if strings.TrimSpace(sc.Text()) == "" {
			continue
		}
		var l dockerLogLine
		if err := json.Unmarshal(sc.Bytes(), &l); err != nil {
			t.Fatalf("line %q: %v", sc.Text(), err)
		}
		out = append(out, l)
	}
	return out
}

// The stream route follows with timestamps, clamps tail as /logs does, passes
// since through only when it is a timestamp, and answers NDJSON, one object per
// line with its stream.
func TestDockerLogStreamRoute(t *testing.T) {
	f := startFakeDocker(t)
	id := strings.Repeat("c", 64)
	f.add(fakeContainer{ID: id, Name: "web", State: "exited", Logs: []string{"hello"}, ErrLogs: []string{"bad thing"}})
	router := newDockerTestRouter(dockerTestHandlers(t))

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/web/logs/stream?tail=99999&since=1790000000.5", nil))
	if ct := rec.Header().Get("Content-Type"); ct != "application/x-ndjson" {
		t.Fatalf("content type = %q", ct)
	}
	if !f.called("GET /containers/" + id + "/logs?follow=1&since=1790000000.5&stderr=1&stdout=1&tail=1000&timestamps=1") {
		t.Fatalf("calls = %v", f.calls)
	}
	got := readNDJSON(t, rec.Body.String())
	if len(got) != 2 || got[0].M != "hello" || got[0].S != "out" || got[1].S != "err" || got[0].T != "2026-09-29T10:00:00.000000000Z" {
		t.Fatalf("got %+v", got)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/web/logs/stream?since=yesterday", nil))
	if !f.called("GET /containers/" + id + "/logs?follow=1&stderr=1&stdout=1&tail=200&timestamps=1") {
		t.Fatalf("junk since must be dropped; calls = %v", f.calls)
	}
}

// The server's own read and write timeouts would cut a followed log off; the
// route lifts them for itself, through the app's middleware.
func TestDockerLogStreamOutlivesServerTimeouts(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("d", 64), Name: "web", State: "running", Logs: []string{"early"},
		FollowLate: "late", FollowDelay: 700 * time.Millisecond})
	srv := httptest.NewUnstartedServer(requestLogging(gzipMiddleware(securityHeaders(newDockerTestRouter(dockerTestHandlers(t))))))
	srv.Config.ReadTimeout = 250 * time.Millisecond
	srv.Config.WriteTimeout = 250 * time.Millisecond
	srv.Start()
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/api/docker/containers/web/logs/stream", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Content-Encoding") != "" {
		t.Fatalf("a live stream must not be gzipped")
	}
	var body bytes.Buffer
	_, _ = body.ReadFrom(resp.Body)
	got := readNDJSON(t, body.String())
	if len(got) != 2 || got[1].M != "late" {
		t.Fatalf("got %+v -- the stream was cut before the late line", got)
	}
}
