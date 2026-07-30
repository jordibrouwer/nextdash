package main

import (
	"bytes"
	"context"
	"encoding/json"
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
}

// monitorNotification is a transition that cleared the alerting rules and should
// actually be sent.
type monitorNotification struct {
	Event  string `json:"event"` // "down" | "up"
	Name   string `json:"name"`
	URL    string `json:"url"`
	Status string `json:"status"` // "offline" | "online"
	Error  string `json:"error,omitempty"`
	At     int64  `json:"at"`
	// Failures is how many consecutive failed checks preceded a "down" event,
	// including the current one.
	Failures int `json:"failures,omitempty"`
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
	if strings.TrimSpace(settings.MonitorNotifyURL) == "" {
		return nil
	}
	threshold := clampMonitorNotifyRetries(settings.MonitorNotifyRetries)

	history := h.readAllHealthHistory()
	var pending []monitorNotification
	// Keys whose current outage alerted on this pass; the flag is persisted below
	// so later passes can see it.
	alerted := map[string]bool{}

	for _, t := range transitions {
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
			pending = append(pending, monitorNotification{
				Event:  "up",
				Name:   t.name,
				URL:    t.url,
				Status: "online",
				At:     t.at,
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

// dispatchMonitorNotifications posts each notification to the configured webhook.
//
// Best-effort by design: a failing webhook must never break a monitor run, so
// every error is logged and skipped rather than returned.
func (h *Handlers) dispatchMonitorNotifications(ctx context.Context, notifications []monitorNotification) {
	if len(notifications) == 0 {
		return
	}

	// Browser push and the webhook are independent sinks for the same decision:
	// either can be configured without the other, so this runs before the webhook
	// target check rather than inside it.
	h.pushMonitorNotifications(ctx, notifications)

	target := strings.TrimSpace(h.store.GetSettings().MonitorNotifyURL)
	if target == "" {
		return
	}
	// The webhook URL is user input, so it goes through exactly the same SSRF
	// rules as a bookmark ping: local targets are reachable only when the operator
	// has already allowed local bookmarks.
	allowLocal := h.allowLocalBookmarks()
	if err := validateHTTPURL(target, allowLocal); err != nil {
		log.Printf("health-notify: webhook URL rejected: %v", err)
		return
	}

	client := h.outboundHTTPClient(monitorNotifyTimeout, 3)
	for _, n := range notifications {
		h.postMonitorNotification(ctx, client, target, n)
	}
}

func (h *Handlers) postMonitorNotification(ctx context.Context, client *http.Client, target string, n monitorNotification) {
	body, err := json.Marshal(n)
	if err != nil {
		log.Printf("health-notify: failed to encode notification: %v", err)
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		log.Printf("health-notify: failed to build request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "nextDash-Monitor/1.0")
	// ntfy and similar plain-text services render the title/body headers; sending
	// them alongside the JSON payload keeps one webhook field useful for both.
	req.Header.Set("Title", monitorNotificationTitle(n))
	req.Header.Set("X-Title", monitorNotificationTitle(n))

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

func monitorNotificationTitle(n monitorNotification) string {
	name := strings.TrimSpace(n.Name)
	if name == "" {
		name = n.URL
	}
	if n.Event == "up" {
		return name + " is back online"
	}
	if n.Error != "" {
		return name + " is offline (" + n.Error + ")"
	}
	return name + " is offline"
}
