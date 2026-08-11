package main

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
		case n.Event == "cert-expiring":
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
