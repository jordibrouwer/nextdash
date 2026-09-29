package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

/*
Notices about containers: one stopped unexpectedly, keeps restarting, or turned
unhealthy -- and, for each of those that was told, that it recovered.

The daemon's event stream says what happened as it happens, which a poll of the
list cannot: a crash the restart policy fixes within seconds never shows in a
list read every half minute, and a list cannot tell a crash from a stop someone
asked for. Docker's own stop sends kill, then die, then stop; a crash sends die
alone. So a die counts only when no kill or stop came just before it and no
action of nextDash's own was running on that container.

A die is not told at once: a restart policy may bring the container straight
back, and then it is one cycle of a possible loop rather than a stop. Three
such cycles in ten minutes are a loop, told once; ten quiet minutes end it.

The decisions live in containerNotifier, a state machine fed events and a
clock, so they are tested without a daemon. Notices go where the Health
monitors' alerts go -- the webhook and its presets -- and to browser push under
their own category.
*/

const (
	dockerNotifyExpectWindow = 10 * time.Second // an own action ending this close before a die makes it deliberate
	dockerNotifyStopWindow   = 5 * time.Minute  // a stop's kill this close before a die makes it deliberate: grace periods run long
	dockerNotifyRestartGrace = 30 * time.Second // a start this soon after a die makes it a restart, not a stop
	dockerNotifyLoopWindow   = 10 * time.Minute
	dockerNotifyLoopCount    = 3
	dockerNotifyTickEvery    = 5 * time.Second
)

// dockerEvent is one line of GET /events.
type dockerEvent struct {
	Type   string `json:"Type"`
	Action string `json:"Action"`
	Actor  struct {
		ID         string            `json:"ID"`
		Attributes map[string]string `json:"Attributes"`
	} `json:"Actor"`
}

type containerWatch struct {
	lastKill   time.Time
	oomAt      time.Time
	dieAt      time.Time // a die not yet explained by a start
	dieCode    string
	dieOOM     bool
	cycles     []time.Time // dies followed by a start, within the loop window
	lastCycle  time.Time
	lastCode   string
	id         string
	toldStop   bool
	toldLoop   bool
	toldHealth bool
}

type containerNotifier struct {
	mu       sync.Mutex
	watch    map[string]*containerWatch
	expected map[string]time.Time // until when a die is nextDash's own doing
}

func newContainerNotifier() *containerNotifier {
	return &containerNotifier{watch: map[string]*containerWatch{}, expected: map[string]time.Time{}}
}

// dockerNotifications is the one notifier the watcher and the actions share.
var dockerNotifications = newContainerNotifier()

// expect marks a container nextDash is stopping, restarting or replacing,
// until the given time.
func (n *containerNotifier) expect(name string, until time.Time) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.expected[name] = until
}

// dockerStopSignal: a kill that ends the container -- the SIGTERM of a stop,
// the SIGKILL after its grace period -- rather than a HUP asking it to reload.
func dockerStopSignal(sig string) bool {
	switch strings.TrimPrefix(strings.ToUpper(sig), "SIG") {
	case "", "15", "TERM", "9", "KILL":
		return true
	}
	return false
}

func (n *containerNotifier) get(name string) *containerWatch {
	w := n.watch[name]
	if w == nil {
		w = &containerWatch{}
		n.watch[name] = w
	}
	return w
}

func containerNotice(event, name, title, detail string, now time.Time) monitorNotification {
	status := "offline"
	if event == "up" {
		status = "online"
	}
	return monitorNotification{Event: event, Name: name, Status: status, Error: detail, At: now.UnixMilli(),
		Title: title, Source: "container"}
}

func exitDetail(code string, oom bool) string {
	detail := ""
	if code != "" {
		detail = "exit code " + code
	}
	if oom {
		if detail != "" {
			return "out of memory (" + detail + ")"
		}
		return "out of memory"
	}
	return detail
}

// event feeds one daemon event in; allowed says whether a container may raise
// notices at all (the switch, muted, hidden, nextDash's own).
func (n *containerNotifier) event(ev dockerEvent, now time.Time, allowed func(name, id string) bool) []monitorNotification {
	if ev.Type != "" && ev.Type != "container" {
		return nil
	}
	name := ev.Actor.Attributes["name"]
	if name == "" {
		return nil
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	w := n.get(name)
	w.id = ev.Actor.ID
	ok := allowed(name, ev.Actor.ID)
	var out []monitorNotification

	switch action := ev.Action; {
	case action == "stop" || (action == "kill" && dockerStopSignal(ev.Actor.Attributes["signal"])):
		w.lastKill = now
	case action == "oom":
		w.oomAt = now
	case action == "die":
		deliberate := now.Sub(w.lastKill) <= dockerNotifyStopWindow
		if until, ok := n.expected[name]; ok && !now.After(until) {
			deliberate = true
		}
		if deliberate {
			w.dieAt = time.Time{}
			return nil
		}
		w.dieAt = now
		w.dieCode = ev.Actor.Attributes["exitCode"]
		w.dieOOM = !w.oomAt.IsZero() && now.Sub(w.oomAt) <= dockerNotifyExpectWindow
	case action == "start":
		// The stop is over; a die from here on is not part of it.
		w.lastKill = time.Time{}
		if w.toldStop {
			w.toldStop = false
			if ok {
				out = append(out, containerNotice("up", name, name+" is running again", "", now))
			}
		}
		if !w.dieAt.IsZero() && now.Sub(w.dieAt) <= dockerNotifyRestartGrace {
			// One cycle of crash and restart.
			w.cycles = append(w.cycles, w.dieAt)
			w.lastCycle, w.lastCode = w.dieAt, w.dieCode
			kept := w.cycles[:0]
			for _, t := range w.cycles {
				if now.Sub(t) <= dockerNotifyLoopWindow {
					kept = append(kept, t)
				}
			}
			w.cycles = kept
			if !w.toldLoop && len(w.cycles) >= dockerNotifyLoopCount && ok {
				w.toldLoop = true
				out = append(out, containerNotice("down", name, name+" keeps restarting",
					fmt.Sprintf("restarted %d times in 10 minutes (last %s)", len(w.cycles), exitDetail(w.dieCode, w.dieOOM)), now))
			}
		}
		w.dieAt = time.Time{}
	case strings.HasPrefix(action, "health_status:"):
		switch strings.TrimSpace(strings.TrimPrefix(action, "health_status:")) {
		case "unhealthy":
			if !w.toldHealth && ok {
				w.toldHealth = true
				out = append(out, containerNotice("down", name, name+" is unhealthy", "its healthcheck is failing", now))
			}
		case "healthy":
			if w.toldHealth {
				w.toldHealth = false
				if ok {
					out = append(out, containerNotice("up", name, name+" is healthy again", "", now))
				}
			}
		}
	case action == "destroy":
		delete(n.watch, name)
	}
	return out
}

// tick settles what only time can: a die that no start followed, and a loop
// that has gone quiet.
func (n *containerNotifier) tick(now time.Time, allowed func(name, id string) bool) []monitorNotification {
	n.mu.Lock()
	defer n.mu.Unlock()
	var out []monitorNotification
	for name, w := range n.watch {
		ok := allowed(name, w.id)
		if !w.dieAt.IsZero() && now.Sub(w.dieAt) > dockerNotifyRestartGrace {
			// Exit 0 is a container that finished its work: a one-shot job,
			// not a crash. Only a loop of them is told.
			finished := w.dieCode == "0" && !w.dieOOM
			if ok && !w.toldStop && !finished {
				w.toldStop = true
				out = append(out, containerNotice("down", name, name+" stopped unexpectedly", exitDetail(w.dieCode, w.dieOOM), now))
			}
			w.dieAt = time.Time{}
		}
		if w.toldLoop && w.dieAt.IsZero() && !w.toldStop && now.Sub(w.lastCycle) >= dockerNotifyLoopWindow {
			w.toldLoop = false
			w.cycles = nil
			if ok {
				out = append(out, containerNotice("up", name, name+" is stable again", "running for 10 minutes without a restart", now))
			}
		}
	}
	for name, until := range n.expected {
		if now.After(until) {
			delete(n.expected, name)
		}
	}
	return out
}

/* ── Where notices go ──────────────────────────────────────────────────── */

// dockerNotifyAllowed: the switch is on, and the container is not muted,
// hidden, or nextDash itself.
func (h *Handlers) dockerNotifyAllowed(name, id string) bool {
	settings := h.store.GetSettings()
	if !settings.DockerNotify {
		return false
	}
	for _, muted := range settings.DockerNotifyMuted {
		if muted == name {
			return false
		}
	}
	if dockerHiddenSet()[name] {
		return false
	}
	return id == "" || !isDockerSelf(id, dockerSelfID())
}

func (h *Handlers) dispatchContainerNotices(ctx context.Context, notices []monitorNotification) {
	if len(notices) == 0 {
		return
	}
	for _, n := range notices {
		logActivity(activityCategoryMutate, "docker.notice", map[string]any{"container": n.Name, "event": n.Event},
			n.Title+notifyDetailSuffix(n.Error))
	}
	settings := h.store.GetSettings()
	if settings.PushNotifyEnabled && settings.PushNotifyContainers {
		for _, n := range notices {
			h.sendWebPushNotification(ctx, webPushMessage{
				Title: n.Title, Body: n.Error, Kind: "container",
				// One tag per container, so its recovery replaces its alert.
				Tag: "nextdash-container-" + n.Name, URL: "/#docker/" + url.PathEscape(n.Name),
				At: n.At, Renotify: n.Event == "down",
			})
		}
	}
	h.postMonitorTarget(ctx, notices)
}

func notifyDetailSuffix(detail string) string {
	if detail == "" {
		return ""
	}
	return " (" + detail + ")"
}

/* ── The watcher ───────────────────────────────────────────────────────── */

// streamEvents follows GET /events for containers until the stream ends.
func (d *dockerAPI) streamEvents(ctx context.Context, fn func(dockerEvent)) error {
	filters, _ := json.Marshal(map[string][]string{"type": {"container"}})
	resp, err := d.forActions().do(ctx, http.MethodGet, "/events?filters="+url.QueryEscape(string(filters)), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	dec := json.NewDecoder(resp.Body)
	for {
		var ev dockerEvent
		if err := dec.Decode(&ev); err != nil {
			return err
		}
		fn(ev)
	}
}

// watchDockerEventsOnce is one connection: events in, notices out, with the
// clock ticking beside it, until the stream or ctx ends.
func (h *Handlers) watchDockerEventsOnce(ctx context.Context, api *dockerAPI, n *containerNotifier) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		t := time.NewTicker(dockerNotifyTickEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				h.dispatchContainerNotices(ctx, n.tick(now, h.dockerNotifyAllowed))
			}
		}
	}()
	return api.streamEvents(ctx, func(ev dockerEvent) {
		h.dispatchContainerNotices(ctx, n.event(ev, time.Now(), h.dockerNotifyAllowed))
	})
}

// StartDockerNotifier keeps one event stream open while there is a socket,
// reconnecting with a growing pause when the daemon goes away.
func (h *Handlers) StartDockerNotifier(stop <-chan struct{}) {
	go func() {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go func() {
			<-stop
			cancel()
		}()
		backoff := 2 * time.Second
		for ctx.Err() == nil {
			api, _ := newDockerAPI()
			if api == nil {
				backoff = time.Minute
			} else {
				started := time.Now()
				err := h.watchDockerEventsOnce(ctx, api, dockerNotifications)
				if ctx.Err() != nil {
					return
				}
				if time.Since(started) > time.Minute {
					backoff = 2 * time.Second
				}
				logWarn(logComponentMutate, "the container event stream ended (%v); reconnecting in %s", err, backoff)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < time.Minute {
				backoff *= 2
			}
		}
	}()
}
