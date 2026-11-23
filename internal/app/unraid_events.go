package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

/*
What the Unraid watcher saw, kept for the timeline.

The watcher used to say what it found and forget it: a notice went out through
the alert channels and was gone, so the timeline had nothing of Unraid to show
beside a container that went down. Now every notice is written here first,
whether or not the alert switch is on and whatever the quiet hours hold back.
The file is small: five hundred entries at most, none older than thirty days.
*/

const (
	unraidEventsMax    = 500
	unraidEventsMaxAge = 30 * 24 * time.Hour
)

type unraidEvent struct {
	At     int64  `json:"at"`    // unix milliseconds
	Event  string `json:"event"` // array-stopped, disk-errors, parity-errors, alert ...
	Title  string `json:"title"`
	Detail string `json:"detail,omitempty"`
}

var unraidEventsMu sync.Mutex

func unraidEventsFilePath() string {
	return filepath.Join(ResolveDataDir(), "unraid-events.json")
}

func readUnraidEvents() []unraidEvent {
	raw, err := os.ReadFile(unraidEventsFilePath())
	if err != nil {
		return nil
	}
	var out struct {
		Entries []unraidEvent `json:"entries"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return nil
	}
	return out.Entries
}

// pruneUnraidEvents keeps what is young enough and the newest few, oldest first.
func pruneUnraidEvents(in []unraidEvent, now time.Time) []unraidEvent {
	cutoff := now.Add(-unraidEventsMaxAge).UnixMilli()
	kept := make([]unraidEvent, 0, len(in))
	for _, e := range in {
		if e.At >= cutoff {
			kept = append(kept, e)
		}
	}
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].At < kept[j].At })
	if len(kept) > unraidEventsMax {
		kept = kept[len(kept)-unraidEventsMax:]
	}
	return kept
}

// recordUnraidEvents appends what the watcher found. A write that fails is
// logged and dropped: the timeline is a convenience, never a reason to stop
// the alerts behind it.
func recordUnraidEvents(notices []monitorNotification, now time.Time) {
	if len(notices) == 0 {
		return
	}
	unraidEventsMu.Lock()
	defer unraidEventsMu.Unlock()
	all := readUnraidEvents()
	for _, n := range notices {
		at := n.At
		if at == 0 {
			at = now.UnixMilli()
		}
		all = append(all, unraidEvent{At: at, Event: n.Event, Title: n.Title, Detail: n.Error})
	}
	if err := writeIndentJSONFile(unraidEventsFilePath(), map[string]any{"entries": pruneUnraidEvents(all, now)}); err != nil {
		logWarn(logComponentNotify, "the Unraid events could not be written: %v", err)
	}
}

// unraidEventsSince is the recorded events at or after since, oldest first.
func unraidEventsSince(since time.Time) []unraidEvent {
	unraidEventsMu.Lock()
	all := readUnraidEvents()
	unraidEventsMu.Unlock()
	out := []unraidEvent{}
	for _, e := range all {
		if e.At >= since.UnixMilli() {
			out = append(out, e)
		}
	}
	return out
}
