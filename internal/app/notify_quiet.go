package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

/*
Quiet hours and reminders.

A message about a service that restarted at 03:12 is worth nothing to anyone who
is asleep, and a message that is not read is worse than none, because the
reader learns to ignore the channel. So during the quiet hours a notice is held
rather than sent, and when they end one summary says what still plays and what
recovered on its own. A storm that goes on gets a reminder, not a second alarm.

The gate sits in front of the four places that raise notices (monitors,
containers, Unraid, backups), not inside the two sinks they share. A notice is
held as the notice it was, so the summary can be built from what actually
happened; a sink only ever sees a message and cannot tell a held one from a new
one. A test counts the callers of both sinks, so a fifth that skips the gate
fails the build.

Outgoing JSON webhooks (Config -> Webhooks) are deliberately outside it. They
are machine integrations that want the raw event whatever the hour.

Order of precedence: a muted bookmark or container never raises a notice at all;
a maintenance window drops it (expected downtime); the quiet hours hold it.
*/

const (
	noticeSourceMonitor   = "monitor"
	noticeSourceContainer = "container"
	noticeSourceUnraid    = "unraid"
	noticeSourceBackup    = "backup"

	// quietHeldMax bounds the file. Past it the oldest entry for a name is
	// dropped, which loses a repeat and never the last word on a name.
	quietHeldMax = 200
	// quietOpenMax and quietOpenMaxAge bound the register of open alerts. An
	// alert nobody has answered for a week is not going to be reminded about.
	quietOpenMax    = 500
	quietOpenMaxAge = 7 * 24 * time.Hour

	quietTickEvery = time.Minute

	// Reminder bounds. The interval list is the one the config offers.
	defaultRemindAfterMinutes = 60
	minRemindAfterMinutes     = 5
	maxRemindAfterMinutes     = 24 * 60
	defaultRemindMax          = 3
	maxRemindMax              = 5
)

// The kinds of notice that pass the quiet hours when they are listed.
const (
	quietKindCertExpired    = "cert-expired"
	quietKindMassOutage     = "mass-outage"
	quietKindBackupFailed   = "backup-failed"
	quietKindContainerCrash = "container-crash"
)

// quietKinds is every kind the config may list, in the order it shows them.
var quietKinds = []string{quietKindCertExpired, quietKindMassOutage, quietKindBackupFailed, quietKindContainerCrash}

// quietAllowDefault is what passes when the reader has not chosen. A container
// crash is not in it: most of them are a restart someone can read in the
// morning, and whoever wants them at night can add the kind.
var quietAllowDefault = []string{quietKindCertExpired, quietKindMassOutage, quietKindBackupFailed}

// quietClock is the clock the gate reads. A variable so a test can set it.
var quietClock = time.Now

// normalizeQuietSettings brings the quiet-hour and reminder settings into the
// shape the rest of the code may assume. Called wherever the maintenance
// windows are, on the way in and on the way out of the store.
func normalizeQuietSettings(s *Settings) {
	s.QuietHours = normalizeMaintenanceWindows(s.QuietHours)
	if s.QuietHoursAllow != nil {
		out := make([]string, 0, len(s.QuietHoursAllow))
		seen := map[string]bool{}
		for _, kind := range s.QuietHoursAllow {
			kind = strings.TrimSpace(kind)
			if seen[kind] || !containsString(quietKinds, kind) {
				continue
			}
			seen[kind] = true
			out = append(out, kind)
		}
		s.QuietHoursAllow = out
	}
	if s.RemindAfterMinutes <= 0 {
		s.RemindAfterMinutes = defaultRemindAfterMinutes
	}
	s.RemindAfterMinutes = clampInt(s.RemindAfterMinutes, minRemindAfterMinutes, maxRemindAfterMinutes)
	if s.RemindMax <= 0 {
		s.RemindMax = defaultRemindMax
	}
	s.RemindMax = clampInt(s.RemindMax, 1, maxRemindMax)
}

// quietLocation is the zone the quiet hours were typed in: the one the
// maintenance windows use, else the server's own.
func quietLocation(s Settings) *time.Location {
	if tz := s.MaintenanceTimeZone; tz != "" {
		if loc, err := time.LoadLocation(tz); err == nil {
			return loc
		}
	}
	return time.Local
}

// quietNow reports whether the quiet hours are open at t.
func quietNow(s Settings, t time.Time) bool {
	if !s.QuietHoursEnabled || len(s.QuietHours) == 0 {
		return false
	}
	return inMaintenanceWindow(s.QuietHours, t.In(quietLocation(s)))
}

// quietEndsAt is when the window open at t closes, found by stepping forward;
// zero when none is open, or when it does not close within two days (a
// window that wraps every day of the week would never).
func quietEndsAt(s Settings, t time.Time) time.Time {
	if !quietNow(s, t) {
		return time.Time{}
	}
	// The zone once, not per step: time.LoadLocation reads the zone file each
	// time, and quietNow per minute read it up to 2880 times a request.
	loc := quietLocation(s)
	const step = time.Minute
	limit := t.Add(48 * time.Hour)
	for at := t.Truncate(step).Add(step); at.Before(limit); at = at.Add(step) {
		if !inMaintenanceWindow(s.QuietHours, at.In(loc)) {
			return at
		}
	}
	return time.Time{}
}

func quietAllowSet(s Settings) map[string]bool {
	list := s.QuietHoursAllow
	if list == nil {
		list = quietAllowDefault
	}
	set := make(map[string]bool, len(list))
	for _, kind := range list {
		set[kind] = true
	}
	return set
}

// noticeKinds names the quiet-hour kinds a single notice belongs to. Derived
// from the notice, not stored beside it, so no source has to remember to label
// what it raises.
func noticeKinds(n monitorNotification) []string {
	var kinds []string
	if n.Event == "cert-expiring" && n.DaysLeft <= 0 {
		kinds = append(kinds, quietKindCertExpired)
	}
	if n.Source == noticeSourceBackup && n.Event == "backup-failed" {
		kinds = append(kinds, quietKindBackupFailed)
	}
	if n.Source == noticeSourceContainer && n.Event == "down" {
		kinds = append(kinds, quietKindContainerCrash)
	}
	return kinds
}

// quietHolds reports whether a single notice is held at t.
func quietHolds(s Settings, n monitorNotification, t time.Time) bool {
	if !quietNow(s, t) {
		return false
	}
	allow := quietAllowSet(s)
	for _, kind := range noticeKinds(n) {
		if allow[kind] {
			return false
		}
	}
	return true
}

/*
heldNotice is a notice that was kept back, with where it would have gone.

Push and Webhook say which sinks would have carried it when it was held, so the
summary does not tell a phone about containers when only monitors push, nor an
alert channel about a backup (which never had one).
*/
type heldNotice struct {
	Source  string              `json:"source"`
	Notice  monitorNotification `json:"notice"`
	HeldAt  int64               `json:"heldAt"`
	Push    bool                `json:"push,omitempty"`
	Webhook bool                `json:"webhook,omitempty"`
}

type heldFile struct {
	Held []heldNotice `json:"held"`
}

// openAlert is an outage that was announced and has not been answered.
type openAlert struct {
	Key    string `json:"key"`
	Source string `json:"source"`
	Name   string `json:"name"`
	URL    string `json:"url,omitempty"`
	Since  int64  `json:"since"`
	// LastAt is the last time anyone was told: the alert, or a reminder.
	LastAt int64 `json:"lastAt"`
	Count  int   `json:"count,omitempty"`
}

type openFile struct {
	Open []openAlert `json:"open"`
}

var quietMu sync.Mutex

func notifyHeldFilePath() string { return filepath.Join(ResolveDataDir(), "notify-held.json") }
func notifyOpenFilePath() string { return filepath.Join(ResolveDataDir(), "notify-open.json") }

func readHeldFile() heldFile {
	var f heldFile
	if data, err := os.ReadFile(notifyHeldFilePath()); err == nil {
		_ = json.Unmarshal(data, &f)
	}
	return f
}

func writeHeldFile(f heldFile) {
	if len(f.Held) == 0 {
		_ = os.Remove(notifyHeldFilePath())
		return
	}
	if err := writeCompactJSONFile(notifyHeldFilePath(), f); err != nil {
		logWarn(logComponentNotify, "held notices could not be saved: %v", err)
	}
}

func readOpenFile() openFile {
	var f openFile
	if data, err := os.ReadFile(notifyOpenFilePath()); err == nil {
		_ = json.Unmarshal(data, &f)
	}
	return f
}

func writeOpenFile(f openFile) {
	if len(f.Open) == 0 {
		_ = os.Remove(notifyOpenFilePath())
		return
	}
	if err := writeCompactJSONFile(notifyOpenFilePath(), f); err != nil {
		logWarn(logComponentNotify, "open alerts could not be saved: %v", err)
	}
}

// noticeKey identifies what a notice is about, for the register and for the
// summary: a monitor by its canonical address, anything else by its name.
func noticeKey(source string, n monitorNotification) string {
	if source == noticeSourceMonitor {
		if key := canonicalBookmarkURLKey(n.URL); key != "" {
			return source + ":" + key
		}
	}
	return source + ":" + strings.TrimSpace(n.Name)
}

// quietGate decides what of a round's notices goes out now. The rest is held
// for the summary. The caller sends only what comes back.
//
// digest is the collapse the source applies to a burst. A round that would
// collapse is a mass outage: it passes whole when that kind is allowed, and is
// held whole when it is not, so the summary can list the names the digest hid.
func (h *Handlers) quietGate(source string, notices []monitorNotification, digest func([]monitorNotification) []monitorNotification) []monitorNotification {
	if len(notices) == 0 {
		return notices
	}
	settings := h.store.GetSettings()
	now := quietClock()
	if !quietNow(settings, now) {
		return notices
	}

	burst := digest != nil && len(digest(notices)) < len(notices)
	var pass, hold []monitorNotification
	if burst {
		if quietAllowSet(settings)[quietKindMassOutage] {
			return notices
		}
		hold = notices
	} else {
		for _, n := range notices {
			if quietHolds(settings, n, now) {
				hold = append(hold, n)
			} else {
				pass = append(pass, n)
			}
		}
	}
	h.holdNotices(source, hold, settings, now)
	return pass
}

// quietGateBackup is the gate for the one source that is a push and nothing
// else, and has no burst to collapse.
func (h *Handlers) quietGateBackup(n monitorNotification) bool {
	settings := h.store.GetSettings()
	now := quietClock()
	if !quietHolds(settings, n, now) {
		return false
	}
	h.holdNotices(noticeSourceBackup, []monitorNotification{n}, settings, now)
	return true
}

// sinkFlags says which sinks would have carried a notice from this source.
func sinkFlags(source string, s Settings) (push, webhook bool) {
	switch source {
	case noticeSourceMonitor:
		push = s.PushNotifyEnabled && s.PushNotifyMonitor
	case noticeSourceContainer:
		push = s.PushNotifyEnabled && s.PushNotifyContainers
	case noticeSourceUnraid:
		push = s.PushNotifyEnabled
	case noticeSourceBackup:
		push = s.PushNotifyEnabled && s.PushNotifyBackup
	}
	if source != noticeSourceBackup {
		_, webhook = monitorNotifyTarget(s)
	}
	return push, webhook
}

func (h *Handlers) holdNotices(source string, notices []monitorNotification, s Settings, now time.Time) {
	if len(notices) == 0 {
		return
	}
	push, webhook := sinkFlags(source, s)
	quietMu.Lock()
	defer quietMu.Unlock()
	file := readHeldFile()
	for _, n := range notices {
		file.Held = append(file.Held, heldNotice{Source: source, Notice: n, HeldAt: now.UnixMilli(), Push: push, Webhook: webhook})
	}
	file.Held = trimHeld(file.Held)
	writeHeldFile(file)
	logActivity(activityCategoryMutate, "notify.held", map[string]any{"source": source, "count": len(notices)},
		fmt.Sprintf("%d held for the quiet hours", len(notices)))
}

// trimHeld keeps the file under quietHeldMax by dropping, oldest first, an
// entry whose name has a newer one: the last word on every name survives.
func trimHeld(held []heldNotice) []heldNotice {
	for len(held) > quietHeldMax {
		newest := map[string]int{}
		for i, e := range held {
			newest[noticeKey(e.Source, e.Notice)] = i
		}
		dropped := false
		for i, e := range held {
			if newest[noticeKey(e.Source, e.Notice)] != i {
				held = append(held[:i], held[i+1:]...)
				dropped = true
				break
			}
		}
		if !dropped {
			held = held[1:]
		}
	}
	return held
}

// trackOpenAlerts keeps the register of announced outages current: a down opens
// one, an up closes it. Done on the raw notices, before the gate and before any
// collapse, so an outage held for the quiet hours is still being counted.
func (h *Handlers) trackOpenAlerts(source string, notices []monitorNotification) {
	if len(notices) == 0 || (source != noticeSourceMonitor && source != noticeSourceContainer) {
		return
	}
	quietMu.Lock()
	defer quietMu.Unlock()
	file := readOpenFile()
	changed := false
	for _, n := range notices {
		key := noticeKey(source, n)
		at := -1
		for i, alert := range file.Open {
			if alert.Key == key {
				at = i
				break
			}
		}
		switch n.Event {
		case "down":
			if at < 0 {
				file.Open = append(file.Open, openAlert{Key: key, Source: source, Name: n.Name, URL: n.URL, Since: n.At, LastAt: n.At})
				changed = true
			}
		case "up":
			if at >= 0 {
				file.Open = append(file.Open[:at], file.Open[at+1:]...)
				changed = true
			}
		}
	}
	if changed {
		file.Open = trimOpen(file.Open, quietClock())
		writeOpenFile(file)
	}
}

func trimOpen(open []openAlert, now time.Time) []openAlert {
	cutoff := now.Add(-quietOpenMaxAge).UnixMilli()
	out := open[:0]
	for _, alert := range open {
		if alert.Since >= cutoff {
			out = append(out, alert)
		}
	}
	if len(out) > quietOpenMax {
		out = out[len(out)-quietOpenMax:]
	}
	return out
}

// quietSummary builds the one message that ends the quiet hours: what still
// plays and what recovered. The last held event for a name is the one that
// counts. A name whose last event is a down is still down; one whose last is an
// up came back by itself.
type quietSummary struct {
	Still     []string
	Recovered []string
	Other     []string
	StillKeys map[string]bool
}

func summariseHeld(held []heldNotice) quietSummary {
	last := map[string]heldNotice{}
	var order []string
	for _, e := range held {
		key := noticeKey(e.Source, e.Notice)
		if _, seen := last[key]; !seen {
			order = append(order, key)
		}
		last[key] = e
	}
	sum := quietSummary{StillKeys: map[string]bool{}}
	for _, key := range order {
		e := last[key]
		name := strings.TrimSpace(e.Notice.Name)
		if name == "" {
			name = e.Notice.URL
		}
		switch e.Notice.Event {
		case "down":
			sum.Still = append(sum.Still, name)
			sum.StillKeys[key] = true
		case "up":
			sum.Recovered = append(sum.Recovered, name)
		default:
			sum.Other = append(sum.Other, monitorNotificationTitle(e.Notice))
		}
	}
	return sum
}

func joinCapped(names []string, limit int) string {
	if len(names) <= limit {
		return strings.Join(names, ", ")
	}
	return strings.Join(names[:limit], ", ") + fmt.Sprintf(" and %d more", len(names)-limit)
}

// quietDigestNotice turns a summary into the notice both sinks carry.
func quietDigestNotice(sum quietSummary, now time.Time) monitorNotification {
	var parts, lines []string
	if n := len(sum.Still); n > 0 {
		parts = append(parts, fmt.Sprintf("%d still down", n))
		lines = append(lines, "Still down: "+joinCapped(sum.Still, 6)+".")
	}
	if n := len(sum.Recovered); n > 0 {
		parts = append(parts, fmt.Sprintf("%d recovered", n))
		lines = append(lines, "Recovered: "+joinCapped(sum.Recovered, 6)+".")
	}
	if n := len(sum.Other); n > 0 {
		parts = append(parts, fmt.Sprintf("%d other", n))
		lines = append(lines, "Also: "+joinCapped(sum.Other, 4)+".")
	}
	return monitorNotification{
		Event: "quiet-digest", Name: "Quiet hours", Status: "warning",
		Title:  "Quiet hours are over: " + strings.Join(parts, ", "),
		Error:  strings.Join(lines, " "),
		At:     now.UnixMilli(),
		Source: "quiet",
	}
}

// flushHeld sends what the quiet hours kept: the notice itself when there is
// only one, else one summary per sink. Called when the hours end or the
// feature is switched off, and on the first tick after a restart.
func (h *Handlers) flushHeld(ctx context.Context, now time.Time) {
	quietMu.Lock()
	file := readHeldFile()
	if len(file.Held) == 0 {
		quietMu.Unlock()
		return
	}
	// Emptied before sending: a send that fails is not retried, because
	// retrying a summary for an hour that is already over only makes a second one.
	writeHeldFile(heldFile{})
	quietMu.Unlock()

	var pushes, hooks []heldNotice
	for _, e := range file.Held {
		if e.Push {
			pushes = append(pushes, e)
		}
		if e.Webhook {
			hooks = append(hooks, e)
		}
	}
	if len(pushes) > 0 {
		h.sendHeldPush(ctx, pushes, now)
	}
	if len(hooks) > 0 {
		h.sendHeldWebhook(ctx, hooks, now)
	}

	// Everything still down was just reported, so its next reminder is a full
	// interval away rather than due the same minute.
	sum := summariseHeld(file.Held)
	quietMu.Lock()
	open := readOpenFile()
	for i := range open.Open {
		if sum.StillKeys[open.Open[i].Key] {
			open.Open[i].LastAt = now.UnixMilli()
		}
	}
	writeOpenFile(open)
	quietMu.Unlock()
	logActivity(activityCategoryMutate, "notify.flushed", map[string]any{"count": len(file.Held)},
		fmt.Sprintf("%d held notices sent after the quiet hours", len(file.Held)))
}

func (h *Handlers) sendHeldWebhook(ctx context.Context, held []heldNotice, now time.Time) {
	if len(held) == 1 {
		h.postMonitorTarget(ctx, []monitorNotification{held[0].Notice})
		return
	}
	notices := make([]heldNotice, len(held))
	copy(notices, held)
	h.postMonitorTarget(ctx, []monitorNotification{quietDigestNotice(summariseHeld(notices), now)})
}

func (h *Handlers) sendHeldPush(ctx context.Context, held []heldNotice, now time.Time) {
	if len(held) == 1 {
		h.pushNoticeDirect(ctx, held[0].Source, held[0].Notice)
		return
	}
	n := quietDigestNotice(summariseHeld(held), now)
	h.sendWebPushNotification(ctx, webPushMessage{
		Title: n.Title, Body: n.Error, Kind: "quiet", Tag: "nextdash-quiet-digest", URL: "/health", At: n.At,
	})
}

// pushNoticeDirect pushes one notice the way its source would have, with that
// source's tag so it replaces the notice it follows on the phone. Used for what
// the gate held and for reminders; the sources' own paths do not go through it.
func (h *Handlers) pushNoticeDirect(ctx context.Context, source string, n monitorNotification) {
	settings := h.store.GetSettings()
	if push, _ := sinkFlags(source, settings); !push {
		return
	}
	msg := webPushMessage{
		Title: monitorNotificationTitle(n), Body: n.Error, Kind: source, At: n.At,
		Renotify: n.Event == "down" || n.Event == "reminder" || n.Event == "backup-failed",
	}
	switch source {
	case noticeSourceMonitor:
		msg.Tag, msg.URL = "nextdash-monitor-"+pushSubscriptionID(n.URL), "/health"
	case noticeSourceContainer:
		msg.Tag, msg.URL = "nextdash-container-"+n.Name, "/#docker"
	case noticeSourceUnraid:
		msg.Tag, msg.URL = unraidPushTag(n), "/#docker"
	case noticeSourceBackup:
		msg.Tag, msg.URL = "nextdash-backup", "/config"
	}
	h.sendWebPushNotification(ctx, msg)
}

// openAlertWanted answers, per open alert, whether it may still be reminded
// about: a monitor that is still a monitored, unmuted bookmark somewhere, a
// container whose notices are on and not muted.
func (h *Handlers) openAlertWanted() func(openAlert) bool {
	monitored := map[string]bool{}
	for _, bm := range h.store.GetAllBookmarks() {
		if bm.Monitor && !bm.NotifyMuted {
			if key := canonicalBookmarkURLKey(bm.URL); key != "" {
				monitored[noticeSourceMonitor+":"+key] = true
			}
		}
	}
	return func(alert openAlert) bool {
		switch alert.Source {
		case noticeSourceMonitor:
			return monitored[alert.Key]
		case noticeSourceContainer:
			return h.dockerNotifyAllowed(alert.Name, "")
		}
		return true
	}
}

// reminderNotice is the message for an outage that is still going.
func reminderNotice(alert openAlert, now time.Time) monitorNotification {
	since := formatOutageDuration(now.UnixMilli() - alert.Since)
	title := alert.Name + " is still down"
	if alert.Source == noticeSourceContainer {
		title = alert.Name + " still has a problem"
	}
	if since != "" {
		title += " after " + since
	}
	return monitorNotification{
		Event: "reminder", Name: alert.Name, URL: alert.URL, Status: "offline",
		Title: title, At: now.UnixMilli(), Source: alert.Source,
	}
}

// sendReminders sends one reminder per open alert that is due. Never during the
// quiet hours: the summary that ends them carries what is still down, and
// flushHeld pushes each reminder a full interval away.
func (h *Handlers) sendReminders(ctx context.Context, now time.Time) {
	settings := h.store.GetSettings()
	if !settings.RemindersEnabled || quietNow(settings, now) {
		return
	}
	interval := time.Duration(settings.RemindAfterMinutes) * time.Minute

	wanted := h.openAlertWanted()
	quietMu.Lock()
	file := readOpenFile()
	var due []openAlert
	kept := file.Open[:0]
	dropped := false
	for _, alert := range file.Open {
		// Muted, no longer monitored or gone since it opened: its "up" will
		// never come, so the register lets it go instead of reminding about it.
		if !wanted(alert) {
			dropped = true
			continue
		}
		if alert.Count < settings.RemindMax && now.Sub(time.UnixMilli(alert.LastAt)) >= interval {
			alert.Count++
			alert.LastAt = now.UnixMilli()
			due = append(due, alert)
		}
		kept = append(kept, alert)
	}
	file.Open = kept
	if len(due) > 0 || dropped {
		writeOpenFile(file)
	}
	quietMu.Unlock()

	for _, alert := range due {
		n := reminderNotice(alert, now)
		logActivity(activityCategoryMutate, "notify.reminder", map[string]any{"name": alert.Name, "count": alert.Count},
			n.Title)
		h.pushNoticeDirect(ctx, alert.Source, n)
		h.postMonitorTarget(ctx, []monitorNotification{n})
	}
}

// quietTick is one pass of the scheduler.
func (h *Handlers) quietTick(ctx context.Context) {
	now := quietClock()
	settings := h.store.GetSettings()
	if !quietNow(settings, now) {
		h.flushHeld(ctx, now)
	}
	h.sendReminders(ctx, now)
}

// StartQuietHoursScheduler runs the tick until stop is closed. It reads the
// files rather than keeping state, so a restart in the middle of the quiet
// hours loses nothing and the first tick after them sends the summary.
func (h *Handlers) StartQuietHoursScheduler(stop <-chan struct{}) {
	go func() {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go func() {
			<-stop
			cancel()
		}()
		ticker := time.NewTicker(quietTickEvery)
		defer ticker.Stop()
		h.quietTick(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.quietTick(ctx)
			}
		}
	}()
}

// QuietStatus answers GET /api/notify/quiet: whether the hours are open now,
// when they close, and how much is waiting. For the line under the settings.
func (h *Handlers) QuietStatus(w http.ResponseWriter, r *http.Request) {
	settings := h.store.GetSettings()
	now := quietClock()
	quietMu.Lock()
	held := len(readHeldFile().Held)
	open := len(readOpenFile().Open)
	quietMu.Unlock()

	zone := "server time"
	if settings.MaintenanceTimeZone != "" {
		zone = settings.MaintenanceTimeZone
	}
	status := map[string]any{
		"enabled": settings.QuietHoursEnabled,
		"quiet":   quietNow(settings, now),
		"held":    held,
		"open":    open,
		"zone":    zone,
	}
	if end := quietEndsAt(settings, now); !end.IsZero() {
		status["endsAt"] = end.UnixMilli()
		status["endsAtLocal"] = end.In(quietLocation(settings)).Format("15:04")
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(status)
}
