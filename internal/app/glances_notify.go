package app

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

/*
Notices about the Glances host, per kind of incident.

An incident (glances_incidents.go) opens after a few readings past a red line
and closes after a few within it, so the hysteresis is already there: a notice
is sent when one opens and again when it closes, never per reading. Which kinds
may raise one is Config → Glances; every kind starts off. The notices go the
way the others do -- quiet hours, browser push, the alert channel -- with the
source "glances".
*/

// glancesNotifyKinds are the incident kinds a notice can be switched on for.
// A swap incident is part of "mem".
var glancesNotifyKinds = []string{"down", "cpu", "mem", "disk", "temp"}

func normalizeGlancesNotify(kinds []string) []string {
	known := map[string]bool{}
	for _, k := range glancesNotifyKinds {
		known[k] = true
	}
	seen := map[string]bool{}
	out := []string{}
	for _, k := range kinds {
		k = strings.ToLower(strings.TrimSpace(k))
		if known[k] && !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	return out
}

func glancesNotifyKind(incidentKind string) string {
	if incidentKind == "swap" {
		return "mem"
	}
	return incidentKind
}

func (c GlancesConfig) notifies(incidentKind string) bool {
	kind := glancesNotifyKind(incidentKind)
	for _, k := range c.Notify {
		if k == kind {
			return true
		}
	}
	return false
}

// glancesNoticeHost names the machine in a notice: the host's name in Config.
func glancesNoticeHost(cfg GlancesConfig) string {
	// Two hosts without a name would be one reading to the push tag and the quiet hours.
	if strings.TrimSpace(cfg.Name) == "" && cfg.ID != glancesMainID {
		return "Glances (" + cfg.ID + ")"
	}
	return glancesHostName(cfg)
}

// glancesNoticeCooldown is how long after announcing a reading went high the
// same reading may be announced again: one hovering at its red line opens and
// closes an incident over and over, and each pair is not worth a push.
const glancesNoticeCooldown = 10 * time.Minute

// glancesNoticeMemory is what a host has announced.
type glancesNoticeMemory struct {
	sync.Mutex
	lastOpen map[string]time.Time
	muted    map[string]bool
}

// allow says whether this event is announced. An opening within the cooldown
// of the last one is not, and neither is the closing that belongs to it.
func (m *glancesNoticeMemory) allow(ev GlancesIncidentEvent, now time.Time) bool {
	key := ev.Incident.Kind + "\x00" + ev.Incident.Subject
	m.Lock()
	defer m.Unlock()
	if m.lastOpen == nil {
		m.lastOpen, m.muted = map[string]time.Time{}, map[string]bool{}
	}
	switch {
	case ev.Opened:
		if last, ok := m.lastOpen[key]; ok && now.Sub(last) < glancesNoticeCooldown {
			m.muted[key] = true
			return false
		}
		m.lastOpen[key] = now
		delete(m.muted, key)
		return true
	default:
		if m.muted[key] {
			delete(m.muted, key)
			return false
		}
		return true
	}
}

// glancesNoticeFor is the message for an incident that opened or closed.
func glancesNoticeFor(cfg GlancesConfig, ev GlancesIncidentEvent) monitorNotification {
	in := ev.Incident
	host := glancesNoticeHost(cfg)
	what := map[string]string{
		"cpu": "Processor", "mem": "Memory", "swap": "Swap", "disk": "Disk", "temp": "Temperature",
	}[in.Kind]
	subject := strings.TrimSpace(in.Subject)
	name := what
	if subject != "" {
		name = what + " " + subject
	}
	n := monitorNotification{Name: host + " " + name, Source: noticeSourceGlances}
	if in.Kind == "down" {
		n.Name = host
	}
	n.Host = cfg.ID
	at := time.Now().UnixMilli()
	switch {
	case ev.Lost:
		// Nothing is read any more: the alert that was sent is no longer the truth, and is replaced.
		n.Event, n.Status, n.At = "up", "warning", at
		n.Title = fmt.Sprintf("%s: %s is no longer being read", host, strings.TrimSpace(name))
	case in.Kind == "down" && ev.Opened:
		n.Event, n.Status, n.Title, n.At = "down", "offline", host+" is not answering", in.Start
	case in.Kind == "down":
		n.Event, n.Status, n.Title, n.At = "up", "online", host+" answers again", at
		if in.End > in.Start {
			n.Error = "away for " + formatOutageDuration(in.End-in.Start)
		}
	case ev.Opened:
		n.Event, n.Status, n.At = "down", "warning", in.Start
		n.Title = fmt.Sprintf("%s: %s is high", host, strings.TrimSpace(name))
		if in.Peak > 0 {
			n.Error = fmt.Sprintf("peak %d", int(in.Peak+0.5))
		}
	default:
		n.Event, n.Status, n.At = "up", "online", at
		n.Title = fmt.Sprintf("%s: %s is back to normal", host, strings.TrimSpace(name))
		if in.End > in.Start {
			n.Error = "lasted " + formatOutageDuration(in.End-in.Start)
		}
	}
	return n
}

// glancesNotify sends a notice for each incident event whose kind is switched on.
func (h *Handlers) glancesNotify(ctx context.Context, cfg GlancesConfig, events []GlancesIncidentEvent) {
	var notices []monitorNotification
	hs := glancesHostByID(cfg.ID)
	for _, ev := range events {
		if cfg.notifies(ev.Incident.Kind) && (ev.Lost || hs.notices.allow(ev, time.Now())) {
			notices = append(notices, glancesNoticeFor(cfg, ev))
		}
	}
	if len(notices) == 0 {
		return
	}
	h.dispatchGlancesNotices(ctx, notices)
}

func (h *Handlers) dispatchGlancesNotices(ctx context.Context, notices []monitorNotification) {
	for _, n := range notices {
		logActivity(activityCategoryMutate, "glances.notice", map[string]any{"event": n.Event}, n.Title+notifyDetailSuffix(n.Error))
	}
	notices = h.quietGate(noticeSourceGlances, notices, nil)
	if len(notices) == 0 {
		return
	}
	settings := h.store.GetSettings()
	if settings.PushNotifyEnabled && settings.PushNotifyGlances {
		for _, n := range notices {
			h.sendWebPushNotification(ctx, webPushMessage{
				Title: n.Title, Body: n.Error, Kind: "glances",
				// One tag per reading, so its recovery replaces its alert.
				Tag: glancesPushTag(n), URL: glancesPushURL(n), At: n.At, Renotify: n.Event == "down",
			})
		}
	}
	h.postMonitorTarget(ctx, notices)
}

func glancesPushTag(n monitorNotification) string {
	return "nextdash-glances-" + pushSubscriptionID(n.Name)
}

// glancesPushURL opens the host the notice is about.
func glancesPushURL(n monitorNotification) string {
	if n.Host == "" || n.Host == glancesMainID {
		return "/#glances/insights"
	}
	return "/#glances/insights?host=" + n.Host
}
