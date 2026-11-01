package app

import (
	"context"
	"fmt"
	"strings"
)

// The three event sources that raise a browser notification. Each one is a thin
// bridge: it decides whether the category is enabled, shapes the message, and
// hands off to the dispatcher. The decision of *whether* something happened
// stays with the subsystem that owns it.

// pushMonitorNotifications mirrors monitor down/recovery alerts to the browser.
//
// Deliberately driven by the same monitorNotification values the webhook
// receives, so the retry threshold and the "alert once per outage" rule are
// honoured here without being reimplemented.
func (h *Handlers) pushMonitorNotifications(ctx context.Context, notifications []monitorNotification) {
	if len(notifications) == 0 {
		return
	}
	settings := h.store.GetSettings()
	if !settings.PushNotifyEnabled || !settings.PushNotifyMonitor {
		return
	}

	for _, n := range notifications {
		name := strings.TrimSpace(n.Name)
		if name == "" {
			name = n.URL
		}

		msg := webPushMessage{
			Title: monitorNotificationTitle(n),
			Kind:  "monitor",
			// One tag per monitor, so a recovery replaces that monitor's outage
			// notification instead of leaving both on the lock screen.
			Tag:      "nextdash-monitor-" + pushSubscriptionID(n.URL),
			URL:      "/health",
			At:       n.At,
			Renotify: true,
		}
		switch {
		case n.Event == "up":
			msg.Body = name + " is reachable again."
		case n.Event == "cert-expiring" || n.Event == "domain-expiring":
			if n.Error != "" {
				msg.Body = n.Error + "."
			} else {
				msg.Body = "TLS certificate is expiring soon."
			}
		case n.Failures > 0:
			msg.Body = fmt.Sprintf("%s failed %d checks in a row.", name, n.Failures)
		default:
			msg.Body = name + " is not responding."
		}

		h.sendWebPushNotification(ctx, msg)
	}
}

func backupPushTitle(err error) string {
	if err != nil {
		return "nextDash backup failed"
	}
	return "nextDash backup created"
}

// pushAutoBackupResult reports the outcome of a scheduled backup.
//
// Only scheduled runs call this: a manual backup from the config page already
// shows its result on screen, and a push for an action the user just took is
// noise.
func (h *Handlers) pushAutoBackupResult(ctx context.Context, err error) {
	settings := h.store.GetSettings()
	if !settings.PushNotifyEnabled || !settings.PushNotifyBackup {
		return
	}
	// Only a failure is held and only a failure can pass the quiet hours as its
	// own kind; a success is not worth waking anyone for and is held with the rest.
	event, detail := "backup-ok", ""
	if err != nil {
		event, detail = "backup-failed", err.Error()
	}
	if h.quietGateBackup(monitorNotification{Event: event, Name: "nextDash backup", Error: detail,
		At: quietClock().UnixMilli(), Source: noticeSourceBackup,
		Title: backupPushTitle(err)}) {
		return
	}

	msg := webPushMessage{
		Kind: "backup",
		Tag:  "nextdash-backup",
		URL:  "/config",
	}
	if err != nil {
		msg.Title = "nextDash backup failed"
		msg.Body = err.Error()
		// A failed backup is worth interrupting for; a successful one is not.
		msg.Renotify = true
	} else {
		msg.Title = "nextDash backup created"
		msg.Body = "The scheduled backup completed successfully."
	}

	h.sendWebPushNotification(ctx, msg)
}

// newsPushMessage turns one round's news into a single notification: the item
// when one site has news, a count and two names when several do. It is false
// when there is nothing to say.
func newsPushMessage(news []watchNews, names map[string]string) (webPushMessage, bool) {
	if len(news) == 0 {
		return webPushMessage{}, false
	}
	name := func(key string) string {
		if n := strings.TrimSpace(names[key]); n != "" {
			return n
		}
		if host := hostOf(key); host != "" {
			return host
		}
		return key
	}
	msg := webPushMessage{Kind: "news", Tag: "nextdash-news", URL: "/?news=1"}
	if len(news) == 1 {
		msg.Title = name(news[0].BookmarkKey) + " has news"
		if len(news[0].Items) > 0 {
			msg.Body = news[0].Items[0].Title
		}
		return msg, true
	}
	msg.Title = fmt.Sprintf("%d sites have news", len(news))
	shown := []string{name(news[0].BookmarkKey), name(news[1].BookmarkKey)}
	msg.Body = strings.Join(shown, ", ")
	if rest := len(news) - 2; rest > 0 {
		msg.Body += fmt.Sprintf(" and %d more", rest)
	}
	return msg, true
}

// pushWatchNews announces a round's news to the browser, behind the master
// switch and the news category.
func (h *Handlers) pushWatchNews(ctx context.Context, news []watchNews) {
	settings := h.store.GetSettings()
	if !settings.PushNotifyEnabled || !settings.PushNotifyNews {
		return
	}
	// News is not worth waking anyone for: during the quiet hours it is
	// dropped (the dashboard still shows it) unless the reader allowed "news".
	if quietNow(settings, quietClock()) && !quietAllowSet(settings)[quietKindNews] {
		return
	}
	names := map[string]string{}
	for _, b := range h.store.GetAllBookmarks() {
		if key := canonicalBookmarkURLKey(b.URL); key != "" && names[key] == "" {
			names[key] = b.Name
		}
	}
	if msg, ok := newsPushMessage(news, names); ok {
		h.sendWebPushNotification(ctx, msg)
	}
}
