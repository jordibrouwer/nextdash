package main

import (
	"encoding/json"
	"net/url"
	"strings"
)

/*
Notification presets.

The raw JSON body dispatchMonitorNotifications posts by default is nextDash's
own shape — useful for a receiver someone wrote themselves, but Slack and
Discord silently ignore it (no error, nothing rendered) since neither expects
that field layout, and Telegram/Pushover are not "POST JSON to a URL" services
at all. Each formatter here turns one monitorNotification into the exact body
a specific service expects, so picking a preset in Config is the only step
between "webhook configured" and "message actually shows up".

Deliberately small: one pure function per service, no I/O, so every shape can
be asserted in a table-driven test without a fake HTTP server. The empty/
unknown preset keeps today's raw-JSON behaviour byte-for-byte, so an existing
webhook receiver built against the old shape needs no migration.
*/

// monitorNotifyPresets are the recognised values of Settings.MonitorNotifyPreset.
// Kept as a set (not just a switch default) so normalizeMonitorNotifyPreset can
// reject a stale or hand-edited value the same way clampMonitorNotifyRetries
// rejects an out-of-range one, rather than silently sending the wrong shape.
var monitorNotifyPresets = map[string]bool{
	"slack":    true,
	"discord":  true,
	"telegram": true,
	"gotify":   true,
	"ntfy":     true,
	"pushover": true,
}

// normalizeMonitorNotifyPreset keeps only a recognised preset; anything else
// (empty, a stale value from an older release, a typo from hand-edited JSON)
// falls back to "" — the raw-JSON default — rather than to a guess.
func normalizeMonitorNotifyPreset(preset string) string {
	preset = strings.ToLower(strings.TrimSpace(preset))
	if monitorNotifyPresets[preset] {
		return preset
	}
	return ""
}

// monitorNotifyCredentialMaxLen bounds the preset credential fields (Telegram
// chat ID, Pushover token and user key). Real values are short and fixed-width
// — a Pushover token or user key is 30 characters, a Telegram chat ID a
// handful of digits — but this is deliberately far more generous than that,
// the same way expectTextMaxLen is round rather than exact: it exists only to
// keep a hand-edited settings file from turning the field into storage for
// something else, not to validate the service's own format.
const monitorNotifyCredentialMaxLen = 200

// normalizeMonitorNotifyCredential trims a preset credential field and caps
// its length. Unlike normalizeMonitorNotifyPreset there is no fixed set to
// validate against — every service's token format is its own business — so
// this only guards against unbounded values reaching the settings file, the
// same trim-and-cap treatment every other user-editable Health field already
// gets (see ExpectText / expectTextMaxLen).
func normalizeMonitorNotifyCredential(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > monitorNotifyCredentialMaxLen {
		value = value[:monitorNotifyCredentialMaxLen]
	}
	return value
}

// pushoverEndpoint is fixed: Pushover has no user-chosen webhook URL, unlike
// every other preset here. Delivery is keyed on the app token and user key
// instead, both entered as their own settings.
const pushoverEndpoint = "https://api.pushover.net/1/messages.json"

// notificationPayload is what postMonitorNotification actually sends: a body,
// its content type, and any headers the shape needs beyond the usual ones.
// Presets differ in both body and headers (ntfy needs Title/X-Title, the rest
// do not), so a formatter returns both rather than the caller guessing which
// headers a given body implies.
type notificationPayload struct {
	body        []byte
	contentType string
	headers     map[string]string
}

// notifyColor is the shared red/green/amber used by the two presets whose
// chat clients render it for free (Discord embeds, Slack attachments). Kept
// in one place so the three colors read the same story everywhere: an outage
// is bad news, a recovery is good news, an expiring certificate is a warning,
// not yet a failure.
func notifyColor(n monitorNotification) (hex string, decimal int) {
	switch n.Event {
	case "up":
		return "#2eb886", 3066502 // green
	case "cert-expiring":
		return "#daa038", 14329912 // amber
	default:
		return "#e01e5a", 14431333 // red — "down" and anything unrecognised
	}
}

// formatMonitorNotification renders n for the given preset. Unknown or empty
// preset falls through to today's raw JSON, so this is additive: a preset
// picked in Config changes the shape, leaving it unset changes nothing.
func formatMonitorNotification(preset string, n monitorNotification, telegramChatID, pushoverToken, pushoverUserKey string) (notificationPayload, error) {
	switch preset {
	case "slack":
		return formatSlackNotification(n)
	case "discord":
		return formatDiscordNotification(n)
	case "telegram":
		return formatTelegramNotification(n, telegramChatID)
	case "gotify":
		return formatGotifyNotification(n)
	case "ntfy":
		return formatNtfyNotification(n)
	case "pushover":
		return formatPushoverNotification(n, pushoverToken, pushoverUserKey)
	default:
		return formatRawJSONNotification(n)
	}
}

// formatRawJSONNotification is today's exact behaviour: the notification's own
// JSON encoding, unchanged. Kept as an explicit formatter (rather than a
// special case in the caller) so every preset — including "no preset" — goes
// through the same formatMonitorNotification entry point.
func formatRawJSONNotification(n monitorNotification) (notificationPayload, error) {
	body, err := json.Marshal(n)
	if err != nil {
		return notificationPayload{}, err
	}
	return notificationPayload{body: body, contentType: "application/json"}, nil
}

// formatNtfyNotification sends the human sentence as a plain-text body. ntfy
// already renders the Title/X-Title headers nextDash sets on every request
// (see postMonitorNotification); posting the raw JSON body alongside them
// used to show the whole struct dump under the title, which this replaces
// with just the one line a reader actually wants.
/*
ntfyMessage is ntfy's JSON shape, which is what a notification has to be sent
as for it to carry buttons.

The plain-text form below works and can do nothing the reader can press. A
bookmark going down is a notification you want to act on, and acting on it
meant finding a laptop.
*/
type ntfyMessage struct {
	Topic    string       `json:"topic"`
	Title    string       `json:"title,omitempty"`
	Message  string       `json:"message"`
	Priority int          `json:"priority,omitempty"`
	Tags     []string     `json:"tags,omitempty"`
	Click    string       `json:"click,omitempty"`
	Actions  []ntfyAction `json:"actions,omitempty"`
}

// ntfyAction is one button. Only the "view" type is ever built here: an
// "http" action would have to carry whatever credential the request needs
// inside a notification that travels through someone else's ntfy server.
type ntfyAction struct {
	Action string `json:"action"`
	Label  string `json:"label"`
	URL    string `json:"url"`
	Clear  bool   `json:"clear,omitempty"`
}

/*
ntfyTopicFromURL splits a configured address into the server root to post to
and the topic to name in the body, or returns empty strings when it cannot.

The plain-text form posts the message to https://server/topic. JSON is posted
to the root with the topic in the body instead, so the topic has to be pulled
back out of the address the user already configured rather than asked for
again.

A nested path is left alone. It may well be a reverse-proxy prefix, and
guessing which segment is the topic would quietly publish to the wrong one.
*/
func ntfyTopicFromURL(raw string) (root, topic string) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", ""
	}
	parts := strings.FieldsFunc(parsed.Path, func(r rune) bool { return r == '/' })
	if len(parts) != 1 || parts[0] == "" {
		return "", ""
	}
	rootURL := *parsed
	rootURL.Path = "/"
	rootURL.RawQuery = ""
	rootURL.Fragment = ""
	return rootURL.String(), parts[0]
}

// ntfyPriority maps an event onto ntfy's 1-5 scale. A failure is raised above
// default so it breaks through a quiet-hours rule; a recovery is lowered below
// it, because good news at full volume is what trains people to mute a channel.
func ntfyPriority(event string) int {
	switch event {
	case "down":
		return 4
	case "up":
		return 2
	}
	return 3
}

// ntfyTags are rendered as emoji in front of the title by every ntfy client,
// which is the cheapest way to make the three kinds of message distinguishable
// at a glance on a lock screen.
func ntfyTags(event string) []string {
	switch event {
	case "down":
		return []string{"rotating_light"}
	case "up":
		return []string{"white_check_mark"}
	}
	return []string{"warning"}
}

/*
formatNtfyJSONNotification builds the same message as the plain-text form, plus
the buttons.

dashboardURL may be empty: nothing forces an install to know its own public
address, and a button pointing at a guess is worse than one that is not there,
so the buttons that need it are simply left off.
*/
func formatNtfyJSONNotification(n monitorNotification, topic, dashboardURL string) (notificationPayload, error) {
	message := n.Error
	if message == "" {
		message = monitorNotificationTitle(n)
	}
	body := ntfyMessage{
		Topic:    topic,
		Title:    monitorNotificationTitle(n),
		Message:  message,
		Priority: ntfyPriority(n.Event),
		Tags:     ntfyTags(n.Event),
	}
	if link := strings.TrimSpace(n.URL); link != "" {
		body.Actions = append(body.Actions, ntfyAction{
			Action: "view", Label: "Open link", URL: link, Clear: true,
		})
	}
	if dash := strings.TrimRight(strings.TrimSpace(dashboardURL), "/"); dash != "" {
		health := dash + "/#health"
		body.Click = health
		body.Actions = append(body.Actions, ntfyAction{
			Action: "view", Label: "Health", URL: health,
		})
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return notificationPayload{}, err
	}
	return notificationPayload{body: encoded, contentType: "application/json"}, nil
}

func formatNtfyNotification(n monitorNotification) (notificationPayload, error) {
	body := n.Error
	if body == "" {
		body = monitorNotificationTitle(n)
	}
	return notificationPayload{body: []byte(body), contentType: "text/plain; charset=utf-8"}, nil
}

// slackWebhookPayload is Slack's Incoming Webhook shape: "text" plus, when
// present, an attachment's left color bar.
type slackWebhookPayload struct {
	Text        string                   `json:"text"`
	Attachments []slackWebhookAttachment `json:"attachments"`
}

type slackWebhookAttachment struct {
	Color  string `json:"color"`
	Footer string `json:"footer,omitempty"`
}

// formatSlackNotification builds an Incoming Webhook payload. Everything
// outside this shape is ignored rather than rejected by Slack's receiver,
// which is why the current raw-JSON default produces nothing in a channel at
// all — there is no error to notice, the message is simply never rendered.
func formatSlackNotification(n monitorNotification) (notificationPayload, error) {
	color, _ := notifyColor(n)
	payload := slackWebhookPayload{
		Text: monitorNotificationTitle(n),
		Attachments: []slackWebhookAttachment{
			{Color: color, Footer: n.URL},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return notificationPayload{}, err
	}
	return notificationPayload{body: body, contentType: "application/json"}, nil
}

// discordWebhookPayload is Discord's webhook shape. Content sits at
// top-level; the embed's Color is a decimal int, not a hex string — an easy
// mistake to ship untested, so notifyColor's second return value is used
// as-is here rather than converted from the hex string.
type discordWebhookPayload struct {
	Embeds []discordEmbed `json:"embeds"`
}

type discordEmbed struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Color       int    `json:"color"`
}

// formatDiscordNotification builds a Discord webhook payload.
func formatDiscordNotification(n monitorNotification) (notificationPayload, error) {
	_, colorDecimal := notifyColor(n)
	payload := discordWebhookPayload{
		Embeds: []discordEmbed{
			{Title: monitorNotificationTitle(n), Description: n.Error, Color: colorDecimal},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return notificationPayload{}, err
	}
	return notificationPayload{body: body, contentType: "application/json"}, nil
}

// telegramSendMessagePayload is the Bot API's sendMessage body.
type telegramSendMessagePayload struct {
	ChatID string `json:"chat_id"`
	Text   string `json:"text"`
}

// formatTelegramNotification builds a Bot API sendMessage payload. Telegram is
// not a plain webhook: the configured URL must already be
// https://api.telegram.org/bot<TOKEN>/sendMessage, and the body additionally
// needs the chat to post into — the one piece of information a bot token
// alone does not carry.
func formatTelegramNotification(n monitorNotification, chatID string) (notificationPayload, error) {
	payload := telegramSendMessagePayload{
		ChatID: strings.TrimSpace(chatID),
		Text:   monitorNotificationTitle(n),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return notificationPayload{}, err
	}
	return notificationPayload{body: body, contentType: "application/json"}, nil
}

// gotifyMessagePayload is Gotify's message shape.
type gotifyMessagePayload struct {
	Title    string `json:"title"`
	Message  string `json:"message"`
	Priority int    `json:"priority"`
}

// formatGotifyNotification builds a Gotify message payload. priority 5 sits in
// Gotify's own "high" band without being its maximum (8, reserved for the
// most disruptive alerts) — this is a monitor alert, not a fire alarm.
func formatGotifyNotification(n monitorNotification) (notificationPayload, error) {
	title := monitorNotificationTitle(n)
	message := n.Error
	if message == "" {
		message = title
	}
	priority := 5
	if n.Event == "up" {
		priority = 2
	}
	payload := gotifyMessagePayload{Title: title, Message: message, Priority: priority}
	body, err := json.Marshal(payload)
	if err != nil {
		return notificationPayload{}, err
	}
	return notificationPayload{body: body, contentType: "application/json"}, nil
}

// formatPushoverNotification builds a form-encoded Pushover message — the one
// preset that is not JSON. priority 1 ("high") bypasses the recipient's quiet
// hours; reserved for an actual outage. A recovery and a certificate warning
// both use the default priority so a phone does not buzz insistently to
// report that nothing is currently wrong, or about something that can still
// wait a few days.
func formatPushoverNotification(n monitorNotification, token, userKey string) (notificationPayload, error) {
	token = strings.TrimSpace(token)
	userKey = strings.TrimSpace(userKey)
	title := monitorNotificationTitle(n)
	message := n.Error
	if message == "" {
		message = title
	}
	priority := "0"
	if n.Event == "down" {
		priority = "1"
	}
	form := url.Values{
		"token":    {token},
		"user":     {userKey},
		"title":    {title},
		"message":  {message},
		"priority": {priority},
	}
	return notificationPayload{
		body:        []byte(form.Encode()),
		contentType: "application/x-www-form-urlencoded",
	}, nil
}
