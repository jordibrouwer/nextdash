package app

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

const (
	// defaultMonitorNotifyRetries is how many consecutive failed checks must pile
	// up before an alert goes out. This is Uptime Kuma's "Retries": it turns a
	// single blip into silence and a real outage into one message.
	defaultMonitorNotifyRetries = 3
	minMonitorNotifyRetries     = 1
	maxMonitorNotifyRetries     = 10
	monitorNotifyTimeout        = 8 * time.Second
)

func clampMonitorNotifyRetries(retries int) int {
	if retries <= 0 {
		return defaultMonitorNotifyRetries
	}
	if retries < minMonitorNotifyRetries {
		return minMonitorNotifyRetries
	}
	if retries > maxMonitorNotifyRetries {
		return maxMonitorNotifyRetries
	}
	return retries
}

// monitorTransition is one monitor's result for the current run.
type monitorTransition struct {
	key    string
	name   string
	url    string
	up     bool
	reason string
	at     int64
	// muted suppresses this bookmark's alerts without suppressing its check:
	// the sample is still recorded and the row still reads as down, only the
	// outbound message is held back.
	muted bool
}

// monitorNotification is a transition that cleared the alerting rules and should
// actually be sent.
type monitorNotification struct {
	Event  string `json:"event"` // "down" | "up" | "cert-expiring"
	Name   string `json:"name"`
	URL    string `json:"url"`
	Status string `json:"status"` // "offline" | "online" | "warning"
	Error  string `json:"error,omitempty"`
	At     int64  `json:"at"`
	// Failures is how many consecutive failed checks preceded a "down" event,
	// including the current one.
	Failures int `json:"failures,omitempty"`
	// DaysLeft is set on "cert-expiring" only: whole days until the certificate
	// for this host stops being valid.
	DaysLeft int `json:"daysLeft,omitempty"`
	// DownSince, DurationMs and DownChecks are set on "up" only: when the outage
	// began, how long it lasted, and how many failed checks it took.
	//
	// A recovery message used to carry the name, the URL and the time and
	// nothing else, so "X is back online" left the reader with the one question
	// a recovery raises — was it five minutes or five hours. The history needed
	// for it is already read on this pass to count trailing failures.
	DownSince  int64 `json:"downSince,omitempty"`
	DurationMs int64 `json:"durationMs,omitempty"`
	DownChecks int   `json:"downChecks,omitempty"`
}

// certExpiryNotifications turns crossed thresholds into notifications, reusing
// the monitor's sinks rather than adding a parallel delivery path — a webhook
// already configured for outages is the same place someone wants to hear that a
// certificate is about to take those sites down.
func certExpiryNotifications(certs []HostCertificate, now time.Time) []monitorNotification {
	out := make([]monitorNotification, 0, len(certs))
	for _, cert := range certs {
		days := certDaysLeft(cert.ExpiresAt, now)
		reason := fmt.Sprintf("TLS certificate expires in %d days", days)
		if days < 0 {
			reason = "TLS certificate has expired"
		} else if days == 0 {
			reason = "TLS certificate expires today"
		}
		out = append(out, monitorNotification{
			Event:    "cert-expiring",
			Name:     cert.Host,
			URL:      "https://" + cert.Host,
			Status:   "warning",
			Error:    reason,
			At:       now.UnixMilli(),
			DaysLeft: days,
		})
	}
	return out
}

// trailingFailures counts consecutive failed samples at the end of the history.
func trailingFailures(samples []HealthSample) int {
	count := 0
	for i := len(samples) - 1; i >= 0; i-- {
		if samples[i].Up {
			break
		}
		count++
	}
	return count
}

// currentOutageAlerted reports whether the outage still in progress at the end of
// the history has already produced a "down" alert.
func currentOutageAlerted(samples []HealthSample) bool {
	for i := len(samples) - 1; i >= 0; i-- {
		if samples[i].Up {
			return false
		}
		if samples[i].Alerted {
			return true
		}
	}
	return false
}

// lastSampleUp reports the most recent known state, and whether any state exists.
func lastSampleUp(samples []HealthSample) (up bool, ok bool) {
	if len(samples) == 0 {
		return false, false
	}
	return samples[len(samples)-1].Up, true
}

// pendingMonitorNotifications decides which transitions deserve a message.
//
// Must be called *before* this round's samples are appended: the stored history
// is the "previous" state that the current result is compared against, which is
// also what makes the retry counting survive a restart without extra bookkeeping.
//
// Rules:
//   - down: fires on the check where consecutive failures reach the threshold,
//     and only on that check, so a long outage alerts once rather than every tick.
//   - up: fires only when the previous state was down *and* an alert had already
//     been sent, so a blip that never alerted does not produce a lone recovery.
func (h *Handlers) pendingMonitorNotifications(transitions []monitorTransition) []monitorNotification {
	if len(transitions) == 0 {
		return nil
	}
	settings := h.store.GetSettings()
	// Gate on the sinks dispatchMonitorNotifications actually uses, not on the
	// webhook URL. Pushover is configured with a token and user key against a
	// fixed endpoint and never sets MonitorNotifyURL, and browser push is an
	// independent sink -- so the old check silently produced no notifications at
	// all for either, while "send test alert" (which bypasses this) still worked
	// and made the setup look correct.
	_, webhookConfigured := monitorNotifyTarget(settings)
	pushConfigured := settings.PushNotifyEnabled && settings.PushNotifyMonitor
	if !webhookConfigured && !pushConfigured {
		return nil
	}
	threshold := clampMonitorNotifyRetries(settings.MonitorNotifyRetries)

	history := h.readAllHealthHistory()
	var pending []monitorNotification
	// Keys whose current outage alerted on this pass; the flag is persisted below
	// so later passes can see it.
	alerted := map[string]bool{}

	for _, t := range transitions {
		// A muted bookmark is checked and recorded like any other; only the
		// message is withheld. Skipped before the alert bookkeeping below rather
		// than filtered out of the result, so a muted outage never stamps its
		// sample as alerted — otherwise un-muting mid-outage would find the
		// outage already "handled" and stay silent until the next one.
		if t.muted {
			continue
		}

		prior := history[t.key]
		priorFailures := trailingFailures(prior)
		prevUp, hadState := lastSampleUp(prior)

		if !t.up {
			failures := priorFailures + 1
			// Fire once the outage has reached the threshold and has not alerted yet.
			// The count is compared with ">=" rather than "==" because this is not the
			// only writer of samples: a manual re-check or a bulk retest during an
			// outage also appends failures, which under an equality test would step the
			// counter straight over the threshold and silence the outage for good.
			// "Have we alerted?" is therefore read from the recorded flag instead of
			// being inferred from the count.
			if failures >= threshold && !currentOutageAlerted(prior) {
				pending = append(pending, monitorNotification{
					Event:    "down",
					Name:     t.name,
					URL:      t.url,
					Status:   "offline",
					Error:    t.reason,
					At:       t.at,
					Failures: failures,
				})
				alerted[t.key] = true
			}
			continue
		}

		// Recovery: only meaningful if the outage actually alerted, so a blip never
		// produces a lone "back online". Older histories predate the flag, so a
		// sufficiently long outage still counts as alerted.
		if hadState && !prevUp && (currentOutageAlerted(prior) || priorFailures >= threshold) {
			// How long it was down, from the same history the failure count above
			// was read from: the first sample of the trailing failure run is where
			// the outage began.
			downSince := int64(0)
			if priorFailures > 0 && priorFailures <= len(prior) {
				downSince = prior[len(prior)-priorFailures].T
			}
			duration := int64(0)
			if downSince > 0 && t.at > downSince {
				duration = t.at - downSince
			}
			pending = append(pending, monitorNotification{
				Event:      "up",
				Name:       t.name,
				URL:        t.url,
				Status:     "online",
				At:         t.at,
				DownSince:  downSince,
				DurationMs: duration,
				DownChecks: priorFailures,
			})
		}
	}

	h.markOutagesAlerted(alerted)
	return pending
}

// markOutagesAlerted stamps the newest stored sample of each key as the one that
// raised the alert. Called right after the decision so that the "already
// alerted" state survives a restart and is not re-derived from a failure count
// that manual re-checks and bulk retests also contribute to.
func (h *Handlers) markOutagesAlerted(keys map[string]bool) {
	if len(keys) == 0 {
		return
	}

	h.healthHistoryMu.Lock()
	defer h.healthHistoryMu.Unlock()

	history := readHealthHistoryFile()
	changed := false
	for key := range keys {
		samples := history.Samples[key]
		if len(samples) == 0 {
			continue
		}
		// The alert was decided against the stored history, so the outage's newest
		// stored sample is the one to stamp. This round's own sample is appended
		// afterwards and inherits the state through currentOutageAlerted.
		if last := &samples[len(samples)-1]; !last.Up && !last.Alerted {
			last.Alerted = true
			changed = true
		}
	}
	if !changed {
		return
	}
	history.GeneratedAt = time.Now().UnixMilli()
	if err := writeHealthHistoryFile(history); err != nil {
		log.Printf("health-notify: failed to record alert state: %v", err)
	}
}

// monitorNotifyTarget resolves where a notification actually gets posted.
//
// Every preset except Pushover sends to the operator's own configured URL —
// that is what makes it a webhook. Pushover has no such URL: delivery is keyed
// on the app token and user key instead, so its target is always the fixed
// Pushover endpoint, and "is anything configured" means "are both of those
// set" rather than "is a URL set".
func monitorNotifyTarget(settings Settings) (target string, configured bool) {
	if settings.MonitorNotifyPreset == "pushover" {
		token := strings.TrimSpace(settings.MonitorNotifyPushoverToken)
		userKey := strings.TrimSpace(settings.MonitorNotifyPushoverUserKey)
		return pushoverEndpoint, token != "" && userKey != ""
	}
	target = strings.TrimSpace(settings.MonitorNotifyURL)
	return target, target != ""
}

// dispatchMonitorNotifications posts each notification to the configured webhook.
//
// Best-effort by design: a failing webhook must never break a monitor run, so
// every error is logged and skipped rather than returned.
func (h *Handlers) dispatchMonitorNotifications(ctx context.Context, notifications []monitorNotification) {
	if len(notifications) == 0 {
		return
	}

	// Outgoing webhooks get the events before the collapse below, and whether or
	// not a notify target is configured at all. The collapse exists so a chat
	// channel is not flooded and a rate limit not tripped; a receiver reading
	// JSON has neither problem, and would rather have the bookmark that failed
	// than a summary saying five of them did.
	for _, n := range notifications {
		switch n.Event {
		case "down":
			emitWebhookEvent(webhookEventHealthDown, monitorNotificationFields(n))
		case "up":
			emitWebhookEvent(webhookEventHealthUp, monitorNotificationFields(n))
		}
	}

	// One upstream failing takes every bookmark behind it down in the same
	// sweep. Collapsed here, at the single point both sinks pass through, so the
	// webhook and the browser both get the summary rather than one of them
	// getting the burst.
	notifications = collapseMonitorNotifications(notifications)

	// Browser push and the webhook are independent sinks for the same decision:
	// either can be configured without the other, so this runs before the webhook
	// target check rather than inside it.
	h.pushMonitorNotifications(ctx, notifications)

	settings := h.store.GetSettings()
	target, configured := monitorNotifyTarget(settings)
	if !configured {
		return
	}
	// The target is user input for every preset but Pushover (a fixed,
	// nextDash-chosen endpoint, not something the operator typed in), so it
	// goes through the same SSRF rules as a bookmark ping: local targets are
	// reachable only when the operator has already allowed local bookmarks.
	if settings.MonitorNotifyPreset != "pushover" {
		allowLocal := h.allowLocalBookmarks()
		if err := validateHTTPURL(target, allowLocal); err != nil {
			log.Printf("health-notify: webhook URL rejected: %v", err)
			return
		}
	}

	client := h.outboundHTTPClient(monitorNotifyTimeout, 3)
	for _, n := range notifications {
		h.postMonitorNotification(ctx, client, target, settings, n)
	}
}

// buildMonitorNotificationRequest formats n for settings' preset and builds
// the request that would deliver it. Shared by the fire-and-forget dispatch
// path and the synchronous test-send path, so the two can never drift apart
// on headers or content type.
func buildMonitorNotificationRequest(ctx context.Context, target string, settings Settings, n monitorNotification) (*http.Request, error) {
	var payload notificationPayload
	var err error
	// ntfy only carries buttons in its JSON form, which is posted to the server
	// root with the topic in the body. When the configured address cannot be
	// split that way the plain-text form that has always been sent still goes
	// out, rather than nothing.
	if settings.MonitorNotifyPreset == "ntfy" {
		if root, topic := ntfyTopicFromURL(target); topic != "" {
			payload, err = formatNtfyJSONNotification(n, topic, settings.MonitorNotifyDashboardURL)
			if err == nil {
				target = root
			}
		}
	}
	if payload.body == nil {
		payload, err = formatMonitorNotification(
			settings.MonitorNotifyPreset, n,
			settings.MonitorNotifyTelegramChatID,
			settings.MonitorNotifyPushoverToken, settings.MonitorNotifyPushoverUserKey,
		)
	}
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(payload.body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", payload.contentType)
	req.Header.Set("User-Agent", "nextDash-Monitor/1.0")
	for k, v := range payload.headers {
		req.Header.Set(k, v)
	}
	// ntfy and the raw-JSON default render/accept these; the other presets
	// ignore unrecognised headers, so setting them unconditionally costs
	// nothing and keeps this one line simple rather than preset-gated.
	// The JSON form carries its own title field, and ntfy rejects a request that
	// sets both.
	if settings.MonitorNotifyPreset == "" ||
		(settings.MonitorNotifyPreset == "ntfy" && payload.contentType != "application/json") {
		req.Header.Set("Title", monitorNotificationTitle(n))
		req.Header.Set("X-Title", monitorNotificationTitle(n))
	}
	return req, nil
}

func (h *Handlers) postMonitorNotification(ctx context.Context, client *http.Client, target string, settings Settings, n monitorNotification) {
	req, err := buildMonitorNotificationRequest(ctx, target, settings, n)
	if err != nil {
		log.Printf("health-notify: failed to encode notification: %v", err)
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("health-notify: post failed for %s: %v", n.URL, err)
		return
	}
	defer drainAndCloseResponse(resp)
	if resp.StatusCode >= 400 {
		log.Printf("health-notify: webhook returned HTTP %d for %s", resp.StatusCode, n.URL)
	}
}

// monitorDigestThreshold is how many notifications one round may carry before
// they are collapsed into a single summary.
//
// Set at four because the burst this guards against has a characteristic shape:
// one upstream failing — a host, a reverse proxy, the local network — takes
// every bookmark behind it down in the same sweep. Alerting per bookmark then
// posts a dozen near-identical messages within a second, which is precisely the
// pattern Slack and Telegram rate-limit, so the alerts that matter get dropped
// by the service rather than delivered.
//
// Below the threshold the individual messages are strictly better: they name
// the bookmark and its error. The digest is the fallback for the case where
// per-bookmark detail is unreadable anyway.
const monitorDigestThreshold = 4

// collapseMonitorNotifications reduces a round's notifications to what should
// actually be posted.
//
// Under the threshold, or when the round is a mix of event kinds, the list is
// returned unchanged: a digest that says "3 events" while one was a recovery
// and one a certificate warning is less informative than the three messages it
// replaced. Only a run of same-event alerts — the burst shape — is collapsed.
//
// Pure so the threshold logic can be tested without a webhook.
func collapseMonitorNotifications(notifications []monitorNotification) []monitorNotification {
	// The threshold check below already implies a non-empty slice, but the
	// indexing that follows should not depend on a tuning constant staying
	// above zero to be memory-safe.
	if len(notifications) == 0 || len(notifications) < monitorDigestThreshold {
		return notifications
	}
	event := notifications[0].Event
	for _, n := range notifications[1:] {
		if n.Event != event {
			return notifications
		}
	}
	// Certificate warnings are already deduplicated per host and arrive on a
	// threshold crossing, not on a sweep, so a run of them is not the burst this
	// exists to flatten.
	if event == "cert-expiring" {
		return notifications
	}

	names := make([]string, 0, len(notifications))
	for _, n := range notifications {
		name := strings.TrimSpace(n.Name)
		if name == "" {
			name = n.URL
		}
		names = append(names, name)
	}
	// The first few by name, then a count: enough to recognise which corner of
	// the collection went down without a message that scrolls. Clamped rather
	// than assumed to be in range, so lowering monitorDigestThreshold cannot
	// turn a tuning change into a slice-bounds panic.
	shown := 3
	if shown > len(names) {
		shown = len(names)
	}
	summary := strings.Join(names[:shown], ", ")
	if rest := len(names) - shown; rest > 0 {
		summary += fmt.Sprintf(" and %d more", rest)
	}

	digest := monitorNotification{
		Event:  event,
		Name:   fmt.Sprintf("%d bookmarks", len(notifications)),
		URL:    notifications[0].URL,
		Status: notifications[0].Status,
		Error:  summary,
		At:     notifications[0].At,
	}
	// Failures is deliberately left zero: one bookmark's consecutive-failure
	// count presented as the group's would be a number nobody can act on.
	return []monitorNotification{digest}
}

// formatOutageDuration renders a downtime span the way a person says it: whole
// minutes under an hour, hours and minutes under a day, days and hours above.
// Empty for a zero or negative span, so a caller can leave the phrase out
// entirely rather than print "after 0m".
func formatOutageDuration(ms int64) string {
	if ms <= 0 {
		return ""
	}
	d := time.Duration(ms) * time.Millisecond
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		hours := int(d.Hours())
		minutes := int(d.Minutes()) - hours*60
		if minutes == 0 {
			return fmt.Sprintf("%dh", hours)
		}
		return fmt.Sprintf("%dh %dm", hours, minutes)
	default:
		days := int(d.Hours()) / 24
		hours := int(d.Hours()) % 24
		if hours == 0 {
			return fmt.Sprintf("%dd", days)
		}
		return fmt.Sprintf("%dd %dh", days, hours)
	}
}

func monitorNotificationTitle(n monitorNotification) string {
	name := strings.TrimSpace(n.Name)
	if name == "" {
		name = n.URL
	}
	switch n.Event {
	case "up":
		// How long it was gone, because that is the first thing anyone asks of a
		// recovery message and the only thing it could not answer.
		if d := formatOutageDuration(n.DurationMs); d != "" {
			return name + " is back online after " + d
		}
		return name + " is back online"
	case "cert-expiring":
		// Not an outage: saying "offline" here would be actively wrong, since the
		// host is answering fine — only its certificate is running out.
		if n.Error != "" {
			return name + ": " + n.Error
		}
		return name + ": TLS certificate expiring soon"
	}
	if n.Error != "" {
		return name + " is offline (" + n.Error + ")"
	}
	return name + " is offline"
}

// TestMonitorNotification sends one synthetic "down" notification through the
// currently saved alert settings — the same formatter and the same target
// dispatchMonitorNotifications would use for a real outage.
//
// This exists because delivery failures are otherwise silent: a malformed
// Discord embed or a wrong Telegram chat ID only ever produces a server log
// line the operator never sees (postMonitorNotification only logs non-2xx
// responses). For a feature whose entire job is "tell me when something
// breaks," a webhook that itself fails quietly is the worst failure mode —
// this surfaces that at setup time instead of during a real outage.
func (h *Handlers) TestMonitorNotification(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	settings := h.store.GetSettings()
	target, configured := monitorNotifyTarget(settings)
	if !configured {
		http.Error(w, "No alert service is configured yet", http.StatusBadRequest)
		return
	}
	if settings.MonitorNotifyPreset != "pushover" {
		allowLocal := h.allowLocalBookmarks()
		if err := validateHTTPURL(target, allowLocal); err != nil {
			http.Error(w, "Webhook URL rejected: "+err.Error(), http.StatusBadRequest)
			return
		}
	}

	n := monitorNotification{
		Event:  "down",
		Name:   "Test alert",
		URL:    "https://example.com",
		Status: "offline",
		Error:  "This is a test alert from nextDash",
		At:     time.Now().UnixMilli(),
	}

	client := h.outboundHTTPClient(monitorNotifyTimeout, 3)
	code, err := h.sendTestMonitorNotification(r.Context(), client, target, settings, n)
	if err != nil {
		http.Error(w, "Failed to send test alert: "+err.Error(), http.StatusBadGateway)
		return
	}
	if code >= 400 {
		http.Error(w, fmt.Sprintf("The service rejected the test alert (HTTP %d)", code), http.StatusBadGateway)
		return
	}

	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, `{"status":"sent"}`)
}

// sendTestMonitorNotification mirrors postMonitorNotification but returns the
// response status instead of only logging it, since a synchronous test needs
// to report success or failure back to the person who clicked the button.
func (h *Handlers) sendTestMonitorNotification(ctx context.Context, client *http.Client, target string, settings Settings, n monitorNotification) (int, error) {
	req, err := buildMonitorNotificationRequest(ctx, target, settings, n)
	if err != nil {
		return 0, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer drainAndCloseResponse(resp)
	return resp.StatusCode, nil
}
