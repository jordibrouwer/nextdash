package app

import (
	"context"
	"fmt"
	"strings"
	"time"
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

// newsNotifyNotice is the one-message-per-round sentence for the alert target:
// "Site: title" for one site, "N sites have news: A, B" for several.
func newsNotifyNotice(news []watchNews, names map[string]string, now time.Time) (monitorNotification, bool) {
	msg, ok := newsPushMessage(news, names)
	if !ok {
		return monitorNotification{}, false
	}
	title := msg.Title
	if len(news) == 1 {
		title = strings.TrimSuffix(msg.Title, " has news")
		if msg.Body != "" {
			title += ": " + msg.Body
		}
	} else {
		title += ": " + msg.Body
	}
	return monitorNotification{
		Event: "news", Name: "Watched feeds", Status: "online",
		Title: title, At: now.UnixMilli(), Source: "news",
	}, true
}

// emitFeedNewsWebhooks sends one feed.news event per feed with news and says
// how many deliveries it started. Webhooks
// are machine integrations and stay outside the quiet hours (notify_quiet.go);
// the endpoint's own event list is the only gate. No summaries leave the app.
func emitFeedNewsWebhooks(news []watchNews, names, urls map[string]string) int {
	if !webhooksConfigured() {
		return 0
	}
	sent := 0
	for _, n := range news {
		items := make([]map[string]any, 0, len(n.Items))
		for _, it := range n.Items {
			items = append(items, map[string]any{"title": it.Title, "link": it.Link, "publishedAt": it.PublishedAt})
		}
		site := strings.TrimSpace(names[n.BookmarkKey])
		if site == "" {
			site = hostOf(n.BookmarkKey)
		}
		sent += emitWebhookEvent(webhookEventFeedNews, map[string]any{
			"site": site, "bookmarkUrl": urls[n.BookmarkKey], "feedUrl": n.FeedURL, "items": items,
		})
	}
	return sent
}

// pushWatchNews announces a round's news: to subscribed webhooks, to the
// browser behind the master switch and the news category, and to the alert
// target when that is switched on.
func (h *Handlers) pushWatchNews(ctx context.Context, news []watchNews) {
	// A muted feed counts on the dashboard but never calls.
	loud := make([]watchNews, 0, len(news))
	for _, n := range news {
		if !n.Muted {
			loud = append(loud, n)
		}
	}
	if news = loud; len(news) == 0 {
		return
	}
	names := map[string]string{}
	urls := map[string]string{}
	for _, b := range h.store.GetAllBookmarks() {
		if key := canonicalBookmarkURLKey(b.URL); key != "" && names[key] == "" {
			names[key] = b.Name
			urls[key] = b.URL
		}
	}
	// What went out is counted for the statistics, whatever the gates below.
	var pushed, targeted int
	hooked := emitFeedNewsWebhooks(news, names, urls)
	defer func() { h.recordFeedNotify(pushed, hooked, targeted) }()

	settings := h.store.GetSettings()
	// News is not worth waking anyone for: during the quiet hours it is
	// dropped (the dashboard still shows it) unless the reader allowed "news".
	if quietNow(settings, quietClock()) && !quietAllowSet(settings)[quietKindNews] {
		return
	}
	if settings.PushNotifyEnabled && settings.PushNotifyNews {
		if msg, ok := newsPushMessage(news, names); ok {
			pushed = h.sendWebPushNotification(ctx, msg)
		}
	}
	if settings.NotifyNewsTarget {
		if n, ok := newsNotifyNotice(news, names, time.Now()); ok {
			targeted = h.postMonitorTarget(ctx, []monitorNotification{n})
		}
	}
}
