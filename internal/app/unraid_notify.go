package app

import (
	"context"
	"fmt"
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
	diskErrors    map[string]int64
	alertIDs      map[string]bool
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
		if !first && w.parityRunning && !p.Running && p.Last != nil && p.Last.Errors > 0 {
			out = append(out, unraidNotice("parity-errors",
				fmt.Sprintf("Parity check finished with %d errors", p.Last.Errors), "", now))
		}
		w.parityRunning = p.Running
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
	h.postMonitorTarget(ctx, collapseContainerNotices(notices))
}

// StartUnraidWatcher looks at the active server once a minute while its alert
// switch is on, and sends what changed through the alert channels.
func (h *Handlers) StartUnraidWatcher(stop <-chan struct{}) {
	w := newUnraidWatcher()
	go func() {
		ticker := time.NewTicker(unraidWatchEvery)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
			}
			srv, ok := activeUnraidServer(h.store.GetSettings())
			if !ok || !srv.Notify {
				continue
			}
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
			h.dispatchUnraidNotices(ctx, w.observe(a, p, n, time.Now()))
			cancel()
		}
	}()
}
