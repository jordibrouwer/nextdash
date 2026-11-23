package app

import (
	"fmt"
	"net/http"
	"time"
)

/*
GET /api/live: one server-sent-events stream per open dashboard tab.

It says "health changed" (see live_broker.go) so the badge and the bell can
refresh at once instead of at their next poll. The poll stays as a fallback:
the browser slows it while this stream is connected and speeds it up again
when the stream drops.

Reads need no write token, so a plain EventSource works here -- unlike the
docker log stream, which sits behind the token's header.

The server's read and write deadlines would end a stream after 30 and 60
seconds; both are cleared for this request. A heartbeat comment keeps a quiet
stream open through a reverse proxy that closes silent responses. The demo
has no monitors, so it answers 404 and the browser keeps polling.
*/

// liveHeartbeat keeps a quiet stream alive; most proxies close one that says
// nothing for a minute.
var liveHeartbeat = 25 * time.Second

func (h *Handlers) LiveStream(w http.ResponseWriter, r *http.Request) {
	if demoMode() {
		http.NotFound(w, r)
		return
	}
	events, cancel, ok := h.live.Subscribe()
	if !ok {
		http.Error(w, "too many live streams", http.StatusServiceUnavailable)
		return
	}
	defer cancel()

	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	hd := w.Header()
	hd.Set("Content-Type", "text/event-stream")
	hd.Set("Cache-Control", "no-store")
	hd.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	write := func(format string, args ...any) bool {
		if _, err := fmt.Fprintf(w, format, args...); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	if !write("retry: 10000\nevent: hello\ndata: {}\n\n") {
		return
	}

	tick := time.NewTicker(liveHeartbeat)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-events:
			if !write("event: %s\ndata: {}\n\n", ev) {
				return
			}
		case <-tick.C:
			if !write(": hb\n\n") {
				return
			}
		}
	}
}
