package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

/*
Reminders on bookmarks.

A bookmark can carry RemindAt, a time the reader chose to be reminded of the
link. The bell shows the row from the bookmarks themselves, so it needs nothing
from here; this file is the part that works while the dashboard is closed: once
a minute it finds the reminders that are due and pushes them, once.

The push is a courtesy on top of the bell row, never the only copy. A push that
cannot be sent (no device subscribed, push off, the push service down) still
marks the reminder as sent, because the row stays in the bell until the reader
answers it, and retrying a push for days would only be noise.
*/

const (
	// reminderTickEvery is how often due reminders are looked for. A minute is
	// the finest a time can be chosen at, so it is also the latest a push is.
	reminderTickEvery = time.Minute
	// reminderStaleAfter is how late a reminder can be and still be pushed. One
	// older than this is a leftover (a restored backup, a server that was off
	// for a week): it is marked as handled without a push, and the bell still
	// shows it.
	reminderStaleAfter = 7 * 24 * time.Hour
	// reminderPushListMax is how many names a combined push spells out.
	reminderPushListMax = 3
)

// dueReminder is a reminder whose time has come and whose push has not gone.
type dueReminder struct {
	PageID int
	Name   string
	URL    string
	Stale  bool
}

// reminderPushMessage is the push for the reminders due now: one for a single
// bookmark, one combined message for several, so a morning with five of them is
// one buzz rather than five.
func reminderPushMessage(due []dueReminder, now time.Time) (webPushMessage, bool) {
	var fresh []dueReminder
	for _, d := range due {
		if !d.Stale {
			fresh = append(fresh, d)
		}
	}
	if len(fresh) == 0 {
		return webPushMessage{}, false
	}
	msg := webPushMessage{Kind: "reminder", URL: "/", At: now.UnixMilli(), Renotify: true}
	name := func(d dueReminder) string {
		if n := strings.TrimSpace(d.Name); n != "" {
			return n
		}
		if host := hostOf(canonicalBookmarkURLKey(d.URL)); host != "" {
			return host
		}
		return d.URL
	}
	if len(fresh) == 1 {
		msg.Title = "Reminder: " + name(fresh[0])
		msg.Tag = "nextdash-reminder"
		return msg, true
	}
	msg.Title = fmt.Sprintf("%d reminders", len(fresh))
	msg.Tag = "nextdash-reminder"
	shown := make([]string, 0, reminderPushListMax)
	for i, d := range fresh {
		if i == reminderPushListMax {
			break
		}
		shown = append(shown, name(d))
	}
	msg.Body = strings.Join(shown, ", ")
	if rest := len(fresh) - len(shown); rest > 0 {
		msg.Body += fmt.Sprintf(" and %d more", rest)
	}
	return msg, true
}

// markDueReminders walks every page and sets RemindSentAt on the reminders that
// are due at now, in one pass per page inside the store lock, and returns what
// it marked. Marking comes first and the push second, the same order the digest
// keeps: a failed send is not retried.
func (h *Handlers) markDueReminders(now time.Time) []dueReminder {
	var due []dueReminder
	nowMs := now.UnixMilli()
	staleMs := reminderStaleAfter.Milliseconds()
	// Only the pages that have something due are written: a page write wakes
	// every open tab, and most ticks of a busy install find nothing.
	duePages := map[int]bool{}
	for _, b := range h.store.GetAllBookmarks() {
		if b.RemindAt > 0 && b.RemindAt <= nowMs && b.RemindSentAt == 0 {
			duePages[b.PageID] = true
		}
	}
	for _, page := range h.store.GetPages() {
		if !duePages[page.ID] {
			continue
		}
		var marked []dueReminder
		err := h.store.MutateBookmarksOnPage(page.ID, func(current []Bookmark) ([]Bookmark, error) {
			for i := range current {
				b := &current[i]
				if b.RemindAt <= 0 || b.RemindAt > nowMs || b.RemindSentAt != 0 {
					continue
				}
				b.RemindSentAt = nowMs
				marked = append(marked, dueReminder{
					PageID: page.ID, Name: b.Name, URL: b.URL,
					Stale: nowMs-b.RemindAt > staleMs,
				})
			}
			return current, nil
		})
		if err != nil {
			logWarn(logComponentNotify, "reminders on page %d could not be marked as sent (%v)", page.ID, err)
			continue
		}
		due = append(due, marked...)
	}
	return due
}

// reminderPending is whether any bookmark has a reminder waiting for its push.
// It reads without writing, so a tick on an install with no reminders costs a
// pass over the bookmarks in memory and no file write.
func (h *Handlers) reminderPending(nowMs int64) bool {
	for _, b := range h.store.GetAllBookmarks() {
		if b.RemindAt > 0 && b.RemindAt <= nowMs && b.RemindSentAt == 0 {
			return true
		}
	}
	return false
}

func (h *Handlers) reminderTick(ctx context.Context, now time.Time) {
	settings := h.store.GetSettings()
	// Held, not dropped: the reminder stays unsent, and the first tick after
	// the quiet hours end pushes it.
	if quietNow(settings, now) {
		return
	}
	if !h.reminderPending(now.UnixMilli()) {
		return
	}
	due := h.markDueReminders(now)
	if len(due) == 0 {
		return
	}
	logActivity(activityCategoryMutate, "reminder.due", map[string]any{"count": len(due)}, "bookmark reminders due")
	if !settings.PushNotifyEnabled || !settings.PushNotifyReminders {
		return
	}
	if msg, ok := reminderPushMessage(due, now); ok {
		h.sendWebPushNotification(ctx, msg)
	}
}

// StartReminderScheduler pushes the reminders of bookmarks as they come due.
func (h *Handlers) StartReminderScheduler(stop <-chan struct{}) {
	go func() {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go func() { <-stop; cancel() }()
		ticker := time.NewTicker(reminderTickEvery)
		defer ticker.Stop()
		h.reminderTick(ctx, quietClock())
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.reminderTick(ctx, quietClock())
			}
		}
	}()
}

// RemindersDue answers GET /api/reminders/due: the bookmarks whose reminder time
// has come, oldest first, for the bell. The dashboard does not always hold
// every page's bookmarks (it loads them when something needs them), and a
// reminder on another page must reach the bell all the same.
func (h *Handlers) RemindersDue(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	type row struct {
		Name     string `json:"name"`
		URL      string `json:"url"`
		PageID   int    `json:"pageId"`
		RemindAt int64  `json:"remindAt"`
	}
	nowMs := time.Now().UnixMilli()
	out := []row{}
	for _, b := range h.store.GetAllBookmarks() {
		if b.RemindAt > 0 && b.RemindAt <= nowMs {
			out = append(out, row{Name: b.Name, URL: b.URL, PageID: b.PageID, RemindAt: b.RemindAt})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RemindAt < out[j].RemindAt })
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(out)
}
