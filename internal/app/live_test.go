package app

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func shortLive(t *testing.T) {
	t.Helper()
	oldC, oldH := liveCoalesce, liveHeartbeat
	liveCoalesce, liveHeartbeat = 30*time.Millisecond, 50*time.Millisecond
	t.Cleanup(func() { liveCoalesce, liveHeartbeat = oldC, oldH })
}

func TestLiveBrokerCoalescesBurst(t *testing.T) {
	shortLive(t)
	b := newLiveBroker()
	ch, cancel, ok := b.Subscribe()
	if !ok {
		t.Fatal("subscribe refused")
	}
	defer cancel()
	for i := 0; i < 10; i++ {
		b.Publish("health")
	}
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("no delivery")
	}
	select {
	case <-ch:
		t.Fatal("second delivery for one burst")
	case <-time.After(120 * time.Millisecond):
	}
}

func TestLiveBrokerSlowSubscriberDoesNotBlock(t *testing.T) {
	shortLive(t)
	b := newLiveBroker()
	_, cancelSlow, _ := b.Subscribe() // never read
	defer cancelSlow()
	fast, cancelFast, _ := b.Subscribe()
	defer cancelFast()
	done := make(chan struct{})
	go func() {
		for i := 0; i < 20; i++ {
			b.Publish("health")
			time.Sleep(40 * time.Millisecond)
		}
		close(done)
	}()
	got := 0
loop:
	for {
		select {
		case <-fast:
			got++
		case <-done:
			break loop
		case <-time.After(3 * time.Second):
			t.Fatal("publisher blocked")
		}
	}
	if got == 0 {
		t.Fatal("fast subscriber got nothing")
	}
}

func TestLiveBrokerCapAndCancel(t *testing.T) {
	old := liveMaxSubscribers
	liveMaxSubscribers = 2
	defer func() { liveMaxSubscribers = old }()
	b := newLiveBroker()
	_, c1, ok1 := b.Subscribe()
	_, c2, ok2 := b.Subscribe()
	if !ok1 || !ok2 {
		t.Fatal("first two must fit")
	}
	if _, _, ok := b.Subscribe(); ok {
		t.Fatal("third must be refused")
	}
	c1()
	if _, c3, ok := b.Subscribe(); !ok {
		t.Fatal("cancel must free a slot")
	} else {
		c3()
	}
	c2()
	if b.subscribers() != 0 {
		t.Fatalf("leaked %d", b.subscribers())
	}
}

func TestLiveBrokerNilIsSafe(t *testing.T) {
	var b *liveBroker
	b.Publish("health")
	if _, _, ok := b.Subscribe(); ok {
		t.Fatal("nil broker must refuse")
	}
}

func TestLiveStreamEndToEnd(t *testing.T) {
	shortLive(t)
	t.Setenv("NEXTDASH_DEMO", "")
	h := &Handlers{live: newLiveBroker()}
	srv := httptest.NewServer(gzipMiddleware(http.HandlerFunc(h.LiveStream)))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL, nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close() // so a failing run does not hang srv.Close
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type %q", ct)
	}
	if resp.Header.Get("Content-Encoding") != "" {
		t.Fatal("stream must not be compressed")
	}
	lines := make(chan string, 64)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	want := func(sub string) {
		t.Helper()
		deadline := time.After(2 * time.Second)
		for {
			select {
			case l, ok := <-lines:
				if !ok {
					t.Fatalf("stream ended before %q", sub)
				}
				if strings.Contains(l, sub) {
					return
				}
			case <-deadline:
				t.Fatalf("no %q", sub)
			}
		}
	}
	want("event: hello")
	want(": hb")
	h.invalidateHealthReportCache()
	want("event: health")

	resp.Body.Close()
	deadline := time.Now().Add(2 * time.Second)
	for h.live.subscribers() != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if n := h.live.subscribers(); n != 0 {
		t.Fatalf("subscriber left after disconnect: %d", n)
	}
}

func TestLiveStreamRefusesAtCapAndInDemo(t *testing.T) {
	old := liveMaxSubscribers
	liveMaxSubscribers = 0
	defer func() { liveMaxSubscribers = old }()
	h := &Handlers{live: newLiveBroker()}
	t.Setenv("NEXTDASH_DEMO", "")
	rec := httptest.NewRecorder()
	h.LiveStream(rec, httptest.NewRequest("GET", "/api/live", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("cap: %d", rec.Code)
	}
	t.Setenv("NEXTDASH_DEMO", "1")
	rec = httptest.NewRecorder()
	h.LiveStream(rec, httptest.NewRequest("GET", "/api/live", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("demo: %d", rec.Code)
	}
}
