package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

/*
A timeline per container: started, stopped, crashed, unhealthy and healthy
again, paused -- and, from the update history, updated and rolled back.

Docker keeps a few hundred events of its own, and on a host with healthchecks
their execs use those up within the hour. So the notifier, which reads every
event anyway (docker_notify.go), writes the ones that mean something here,
whatever the notices are set to. Kept by container name, so a container that
an update recreated keeps its history; a hundred entries each, none older than
thirty days, written in batches on the notifier's tick rather than per event.

The route folds a run of crash-and-restart cycles into one line and merges in
the update history, newest first.
*/

const (
	dockerTimelinePerContainer = 100
	dockerTimelineMaxAge       = 30 * 24 * time.Hour
	dockerTimelineLoopMin      = 3
)

type dockerTimelineEntry struct {
	At     int64  `json:"at"`   // unix milliseconds
	Kind   string `json:"kind"` // start stop exit crash unhealthy healthy pause unpause update rollback restart-loop
	Detail string `json:"detail,omitempty"`
	Count  int    `json:"count,omitempty"` // restart-loop: how many cycles
}

type dockerTimeline struct {
	mu     sync.Mutex
	data   map[string][]dockerTimelineEntry
	dirty  bool
	loaded bool
}

func newDockerTimeline() *dockerTimeline {
	return &dockerTimeline{data: map[string][]dockerTimelineEntry{}}
}

// dockerTimelines is the one timeline the notifier writes and the route reads.
var dockerTimelines = newDockerTimeline()

func dockerTimelineFilePath() string {
	return filepath.Join(ResolveDataDir(), "docker-events.json")
}

func (t *dockerTimeline) loadLocked() {
	if t.loaded {
		return
	}
	t.loaded = true
	raw, err := os.ReadFile(dockerTimelineFilePath())
	if err != nil {
		return
	}
	var stored map[string][]dockerTimelineEntry
	if json.Unmarshal(raw, &stored) == nil {
		for name, entries := range stored {
			t.data[name] = append(entries, t.data[name]...)
		}
	}
	t.pruneLocked(time.Now())
}

func (t *dockerTimeline) pruneLocked(now time.Time) {
	cutoff := now.Add(-dockerTimelineMaxAge).UnixMilli()
	for name, entries := range t.data {
		kept := entries[:0]
		for _, e := range entries {
			if e.At >= cutoff {
				kept = append(kept, e)
			}
		}
		if len(kept) > dockerTimelinePerContainer {
			kept = kept[len(kept)-dockerTimelinePerContainer:]
		}
		if len(kept) == 0 {
			delete(t.data, name)
		} else {
			t.data[name] = kept
		}
	}
}

func (t *dockerTimeline) add(name string, e dockerTimelineEntry) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.loadLocked()
	t.data[name] = append(t.data[name], e)
	t.pruneLocked(time.Now())
	t.dirty = true
}

// flush writes what was added since the last write, if anything was.
func (t *dockerTimeline) flush() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.loadLocked()
	if !t.dirty {
		return nil
	}
	t.dirty = false
	return writeIndentJSONFile(dockerTimelineFilePath(), t.data)
}

// countSince counts the entries of the given kinds, across every container,
// at or after since.
func (t *dockerTimeline) countSince(since time.Time, kinds ...string) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.loadLocked()
	want := map[string]bool{}
	for _, k := range kinds {
		want[k] = true
	}
	n := 0
	cutoff := since.UnixMilli()
	for _, entries := range t.data {
		for _, e := range entries {
			if e.At >= cutoff && want[e.Kind] {
				n++
			}
		}
	}
	return n
}

// forContainer is one container's recorded events, oldest first.
func (t *dockerTimeline) forContainer(name string) []dockerTimelineEntry {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.loadLocked()
	return append([]dockerTimelineEntry{}, t.data[name]...)
}

// foldDockerRestartLoops turns a run of crash-then-start cycles (each crash
// within ten minutes of the one before, each start within the restart grace)
// into one restart-loop entry, once the run is long enough to be one.
func foldDockerRestartLoops(in []dockerTimelineEntry) []dockerTimelineEntry {
	out := []dockerTimelineEntry{}
	for i := 0; i < len(in); {
		j := i
		var cycles []dockerTimelineEntry
		for j+1 < len(in) && in[j].Kind == "crash" && in[j+1].Kind == "start" &&
			in[j+1].At-in[j].At <= dockerNotifyRestartGrace.Milliseconds() &&
			(len(cycles) == 0 || in[j].At-cycles[len(cycles)-1].At <= dockerNotifyLoopWindow.Milliseconds()) {
			cycles = append(cycles, in[j])
			j += 2
		}
		if len(cycles) >= dockerTimelineLoopMin {
			first, last := cycles[0], cycles[len(cycles)-1]
			minutes := (last.At - first.At) / time.Minute.Milliseconds()
			detail := fmt.Sprintf("%d times in %d min", len(cycles), minutes)
			if last.Detail != "" {
				detail += ", last " + last.Detail
			}
			out = append(out, dockerTimelineEntry{At: last.At, Kind: "restart-loop", Detail: detail, Count: len(cycles)})
			i = j
			continue
		}
		out = append(out, in[i])
		i++
	}
	return out
}

// dockerTimelineFor is what the drawer shows: recorded events and updates,
// loops folded, newest first.
func dockerTimelineFor(name string) []dockerTimelineEntry {
	entries := foldDockerRestartLoops(dockerTimelines.forContainer(name))
	for _, u := range dockerUpdateHistoryFor(name) {
		short := func(id string) string { return shortImageID(id) }
		from, to := u.FromVersion, u.ToVersion
		if from == "" {
			from = short(u.FromImageID)
		}
		if to == "" {
			to = short(u.ToImageID)
		}
		entries = append(entries, dockerTimelineEntry{At: u.At, Kind: u.Kind, Detail: from + " → " + to})
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].At > entries[j].At })
	if len(entries) > dockerTimelinePerContainer {
		entries = entries[:dockerTimelinePerContainer]
	}
	return entries
}

// DockerContainerTimelineHandler answers one container's timeline. Read-only
// and nothing secret in it, like the list.
func (h *Handlers) DockerContainerTimelineHandler(w http.ResponseWriter, r *http.Request) {
	_, c, ok := h.dockerTarget(w, r)
	if !ok {
		return
	}
	writeJSON(w, map[string]any{"entries": dockerTimelineFor(c.name())})
}

/* ── Recording, from the notifier's events ─────────────────────────────── */

// recordTimeline and recordDie are called by containerNotifier.event with its
// lock held; they only append, so they never wait on the notifier.
func (n *containerNotifier) recordTimeline(name string, w *containerWatch, action string, now time.Time) {
	if n.timeline == nil {
		return
	}
	add := func(kind string) {
		n.timeline.add(name, dockerTimelineEntry{At: now.UnixMilli(), Kind: kind})
	}
	switch {
	case action == "start" || action == "pause" || action == "unpause":
		add(action)
	case strings.HasPrefix(action, "health_status:"):
		state := strings.TrimSpace(strings.TrimPrefix(action, "health_status:"))
		if (state == "unhealthy" || state == "healthy") && state != w.lastHealth {
			// The first healthy of a container that was never unhealthy is
			// its healthcheck starting, not news.
			if state == "unhealthy" || w.lastHealth == "unhealthy" {
				add(state)
			}
			w.lastHealth = state
		}
	}
}

// recordDie writes a die down as what it was: stopped by nextDash, stopped by
// someone (a stop's kill came first), exited on its own with 0, or crashed.
func (n *containerNotifier) recordDie(name string, w *containerWatch, ev dockerEvent, now time.Time, deliberate bool) {
	if n.timeline == nil {
		return
	}
	code := ev.Actor.Attributes["exitCode"]
	e := dockerTimelineEntry{At: now.UnixMilli()}
	until, ours := n.expected[name]
	switch {
	case ours && !now.After(until):
		e.Kind, e.Detail = "stop", "by nextDash"
	case deliberate:
		e.Kind, e.Detail = "stop", exitDetail(code, false)
	case code == "0":
		e.Kind, e.Detail = "exit", exitDetail(code, false)
	default:
		e.Kind, e.Detail = "crash", exitDetail(code, !w.oomAt.IsZero() && now.Sub(w.oomAt) <= dockerNotifyExpectWindow)
	}
	n.timeline.add(name, e)
}
