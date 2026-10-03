package app

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

/*
Unraid's own alerts, and what nextDash sees change between two looks.

Only importance ALERT is passed on: Unraid already tells its owner about
warnings, and a warning on the tile is enough. Three things Unraid does not
say in one line are derived here: the array stopped, a parity check finished
with errors, a disk's error count went up. The first look at each area only
remembers, so a restart of nextDash never replays the server's whole history,
and an area that could not be read yet is baselined when it first can.
*/

const unraidWatchEvery = 60 * time.Second

type unraidWatcher struct {
	mu            sync.Mutex
	seenArray     bool
	seenParity    bool
	seenNotes     bool
	started       bool
	parityRunning bool
	// parityStarted is when this watcher first saw the current check run;
	// parityAwaiting is set from the moment it stopped until its result is
	// found in the history (Unraid 7.3 clears the status's error count when
	// a check completes, and writes the run to the history at its end).
	parityStarted  time.Time
	parityAwaiting time.Time
	diskErrors     map[string]int64
	alertIDs       map[string]bool
}

func newUnraidWatcher() *unraidWatcher {
	return &unraidWatcher{diskErrors: map[string]int64{}, alertIDs: map[string]bool{}}
}

func unraidNotice(event, title, detail string, now time.Time) monitorNotification {
	return monitorNotification{Event: event, Name: "Unraid", Status: "warning", Error: detail,
		At: now.UnixMilli(), Title: title, Source: "unraid"}
}

func (w *unraidWatcher) observe(a *UnraidArrayView, p *UnraidParityView, n *UnraidNotificationsView, now time.Time) []monitorNotification {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []monitorNotification

	if a != nil {
		first := !w.seenArray
		w.seenArray = true
		if !first && w.started && !a.Started {
			out = append(out, unraidNotice("array-stopped", "The Unraid array stopped", "state "+a.State, now))
		}
		w.started = a.Started
		for _, d := range a.Disks {
			if prev, ok := w.diskErrors[d.Name]; !first && ok && d.Errors > prev {
				out = append(out, unraidNotice("disk-errors", fmt.Sprintf("%s has %d errors", d.Name, d.Errors),
					fmt.Sprintf("up from %d", prev), now))
			}
			w.diskErrors[d.Name] = d.Errors
		}
	}
	if p != nil {
		first := !w.seenParity
		w.seenParity = true
		if p.Running && !w.parityRunning {
			w.parityStarted = now
		}
		if !first && w.parityRunning && !p.Running {
			w.parityAwaiting = now
		}
		w.parityRunning = p.Running
		if !w.parityAwaiting.IsZero() && !p.Running {
			if errs, done := parityRunErrors(p, w.parityStarted, now.Sub(w.parityAwaiting)); done {
				w.parityAwaiting = time.Time{}
				if errs > 0 {
					out = append(out, unraidNotice("parity-errors",
						fmt.Sprintf("Parity check finished with %d errors", errs), "", now))
				}
			}
		}
	}
	if n != nil {
		first := !w.seenNotes
		w.seenNotes = true
		for _, item := range n.Items {
			if item.Importance != "alert" || w.alertIDs[item.ID] {
				continue
			}
			w.alertIDs[item.ID] = true
			if !first {
				out = append(out, unraidNotice("unraid-alert", item.Subject, "", now))
			}
		}
	}
	return out
}

// unraidParityResultWait is how long a finished check may take to appear in
// the history before the status's own count is the only answer left.
const unraidParityResultWait = 30 * time.Minute

/*
parityRunErrors finds the error count of the check that just stopped.

The run is the history entry dated at or after the moment it was first seen
running (Unraid dates an entry at its end). Until that entry appears the
answer waits; the status's own count settles it early when it is non-zero
(older Unraid versions keep it there), and after unraidParityResultWait it is
all there is. done reports whether the question is settled.
*/
func parityRunErrors(p *UnraidParityView, started time.Time, waited time.Duration) (errs int64, done bool) {
	if !started.IsZero() {
		for _, run := range p.History {
			at, err := time.Parse(time.RFC3339, run.Date)
			if err == nil && !at.Before(started.Add(-time.Minute)) {
				return run.Errors, true
			}
		}
	}
	if p.Errors > 0 {
		return p.Errors, true
	}
	return 0, waited >= unraidParityResultWait
}

// pickUnraidWatcher decides which watcher a tick uses. Anything that is not
// "the same server, still switched on" -- another address, the alert switch
// off, the server disabled or gone -- gets a fresh one, so the next look only
// remembers and one server's history is never replayed as another's news.
func pickUnraidWatcher(w *unraidWatcher, lastBase string, srv UnraidServer, ok bool) (*unraidWatcher, string, bool) {
	if !ok || !srv.Notify {
		return newUnraidWatcher(), "", false
	}
	if w == nil || srv.BaseURL != lastBase {
		return newUnraidWatcher(), srv.BaseURL, true
	}
	return w, lastBase, true
}

const unraidDigestListCap = 10

// collapseUnraidNotices bundles a burst the way Health does: at the digest
// threshold the notices become one, with the titles in its body.
func collapseUnraidNotices(notices []monitorNotification) []monitorNotification {
	if len(notices) < monitorDigestThreshold {
		return notices
	}
	titles := make([]string, 0, unraidDigestListCap)
	for i, n := range notices {
		if i == unraidDigestListCap {
			break
		}
		titles = append(titles, n.Title)
	}
	body := strings.Join(titles, "; ")
	if rest := len(notices) - len(titles); rest > 0 {
		body += fmt.Sprintf(" and %d more", rest)
	}
	return []monitorNotification{{
		Event: "unraid-digest", Name: "Unraid", Status: "warning", Error: body,
		At: notices[0].At, Title: fmt.Sprintf("%d Unraid alerts", len(notices)), Source: "unraid",
	}}
}

func (h *Handlers) dispatchUnraidNotices(ctx context.Context, notices []monitorNotification) {
	if len(notices) == 0 {
		return
	}
	for _, n := range notices {
		logActivity(activityCategoryMutate, "unraid.notice", map[string]any{"event": n.Event}, n.Title+notifyDetailSuffix(n.Error))
	}
	settings := h.store.GetSettings()
	if settings.PushNotifyEnabled {
		for _, n := range notices {
			h.sendWebPushNotification(ctx, webPushMessage{Title: n.Title, Body: n.Error, Kind: "unraid",
				Tag: "nextdash-unraid-" + n.Event, At: n.At})
		}
	}
	h.postMonitorTarget(ctx, collapseUnraidNotices(notices))
}

// StartUnraidWatcher looks at the active server once a minute while its alert
// switch is on, and sends what changed through the alert channels.
func (h *Handlers) StartUnraidWatcher(stop <-chan struct{}) {
	go func() {
		w := newUnraidWatcher()
		lastBase := ""
		ticker := time.NewTicker(unraidWatchEvery)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
			}
			srv, ok := activeUnraidServer(h.store.GetSettings())
			var active bool
			w, lastBase, active = pickUnraidWatcher(w, lastBase, srv, ok)
			if !active {
				continue
			}
			h.unraidWatchTick(w)
		}
	}()
}

// unraidWatchTick is one look. A panic in it is logged and the next tick goes
// on: this runs for the life of the process.
func (h *Handlers) unraidWatchTick(w *unraidWatcher) {
	defer func() {
		if r := recover(); r != nil {
			logWarn(logComponentNotify, "an Unraid look failed and was skipped: %v", r)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	var a *UnraidArrayView
	var p *UnraidParityView
	var n *UnraidNotificationsView
	if r := h.unraidArea(ctx, "array"); r.Status == "ok" {
		if v, ok := r.Data.(UnraidArrayView); ok {
			a = &v
		}
	}
	if r := h.unraidArea(ctx, "parity"); r.Status == "ok" {
		if v, ok := r.Data.(UnraidParityView); ok {
			p = &v
		}
	}
	if r := h.unraidArea(ctx, "notifications"); r.Status == "ok" {
		if v, ok := r.Data.(UnraidNotificationsView); ok {
			n = &v
		}
	}
	cancel()
	notices := w.observe(a, p, n, time.Now())
	// Its own budget: a slow server must not leave the alert, already
	// remembered as seen, with nothing to be sent on.
	dctx, dcancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer dcancel()
	h.dispatchUnraidNotices(dctx, notices)
}
