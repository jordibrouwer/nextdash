package main

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func TestNormalizeMonitorNotifyPreset(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"slack", "slack"},
		{"Discord", "discord"},
		{"  telegram  ", "telegram"},
		{"gotify", "gotify"},
		{"ntfy", "ntfy"},
		{"pushover", "pushover"},
		{"webhook-that-no-longer-exists", ""},
		{"PUSHOVER", "pushover"},
	}
	for _, c := range cases {
		if got := normalizeMonitorNotifyPreset(c.in); got != c.want {
			t.Errorf("normalizeMonitorNotifyPreset(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeMonitorNotifyCredential(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty stays empty", "", ""},
		{"trims whitespace", "  123456789  ", "123456789"},
		{"a real-looking value is untouched", strings.Repeat("a", 30), strings.Repeat("a", 30)},
		{"caps at the max length", strings.Repeat("x", 500), strings.Repeat("x", monitorNotifyCredentialMaxLen)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := normalizeMonitorNotifyCredential(c.in)
			if got != c.want {
				t.Errorf("normalizeMonitorNotifyCredential(%d chars) = %d chars, want %d chars",
					len(c.in), len(got), len(c.want))
			}
			if len(got) > monitorNotifyCredentialMaxLen {
				t.Errorf("result is %d chars, want at most %d", len(got), monitorNotifyCredentialMaxLen)
			}
		})
	}
}

// The credential cap has to survive a real save/load round trip, not just the
// pure function: normalizeMonitorNotifyCredential is wired into both
// FileStore.GetSettings (the read path, matching how MonitorNotifyPreset was
// already normalized) and the /api/settings handler (the write path) — a
// hand-edited settings file or a malformed request could otherwise store an
// arbitrarily large value with nothing to catch it before it reaches disk.
func TestMonitorNotifyCredentialsAreCappedOnSaveAndLoad(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	store := NewStore()

	settings := store.GetSettings()
	settings.MonitorNotifyTelegramChatID = "  " + strings.Repeat("1", 500) + "  "
	settings.MonitorNotifyPushoverToken = strings.Repeat("a", 500)
	settings.MonitorNotifyPushoverUserKey = strings.Repeat("b", 500)
	if err := store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	got := store.GetSettings()
	for name, value := range map[string]string{
		"MonitorNotifyTelegramChatID":  got.MonitorNotifyTelegramChatID,
		"MonitorNotifyPushoverToken":   got.MonitorNotifyPushoverToken,
		"MonitorNotifyPushoverUserKey": got.MonitorNotifyPushoverUserKey,
	} {
		if len(value) != monitorNotifyCredentialMaxLen {
			t.Errorf("%s round-tripped as %d chars, want exactly %d (capped, no surrounding whitespace)",
				name, len(value), monitorNotifyCredentialMaxLen)
		}
	}
}

func TestFormatRawJSONNotificationMatchesStructTags(t *testing.T) {
	n := monitorNotification{Event: "down", Name: "Example", URL: "https://example.com", Status: "offline", Error: "HTTP 500", At: 1000, Failures: 3}
	payload, err := formatMonitorNotification("", n, "", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if payload.contentType != "application/json" {
		t.Errorf("contentType = %q, want application/json", payload.contentType)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload.body, &decoded); err != nil {
		t.Fatalf("body is not valid JSON: %v\nbody: %s", err, payload.body)
	}
	if decoded["event"] != "down" || decoded["name"] != "Example" {
		t.Errorf("decoded = %v, missing expected raw fields", decoded)
	}
}

func TestFormatSlackNotification(t *testing.T) {
	n := monitorNotification{Event: "down", Name: "Example", URL: "https://example.com", Error: "HTTP 500"}
	payload, err := formatMonitorNotification("slack", n, "", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if payload.contentType != "application/json" {
		t.Errorf("contentType = %q, want application/json", payload.contentType)
	}
	var decoded slackWebhookPayload
	if err := json.Unmarshal(payload.body, &decoded); err != nil {
		t.Fatalf("body is not valid JSON: %v\nbody: %s", err, payload.body)
	}
	if !strings.Contains(decoded.Text, "Example") || !strings.Contains(decoded.Text, "offline") {
		t.Errorf("text = %q, want it to name the bookmark and say offline", decoded.Text)
	}
	if len(decoded.Attachments) != 1 || decoded.Attachments[0].Color != "#e01e5a" {
		t.Errorf("attachments = %+v, want one red attachment for a down event", decoded.Attachments)
	}

	up, err := formatMonitorNotification("slack", monitorNotification{Event: "up", Name: "Example"}, "", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var upDecoded slackWebhookPayload
	if err := json.Unmarshal(up.body, &upDecoded); err != nil {
		t.Fatalf("up body is not valid JSON: %v", err)
	}
	if upDecoded.Attachments[0].Color != "#2eb886" {
		t.Errorf("up color = %q, want green (#2eb886)", upDecoded.Attachments[0].Color)
	}
}

func TestFormatDiscordNotificationUsesDecimalColor(t *testing.T) {
	// Discord's embed color is a decimal int, not a hex string — the exact
	// mistake that is easy to ship untested, so this asserts the real numeric
	// values rather than just "is present".
	cases := []struct {
		event string
		want  int
	}{
		{"down", 14431333},
		{"up", 3066502},
		{"cert-expiring", 14329912},
	}
	for _, c := range cases {
		payload, err := formatMonitorNotification("discord", monitorNotification{Event: c.event, Name: "Example"}, "", "", "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var decoded discordWebhookPayload
		if err := json.Unmarshal(payload.body, &decoded); err != nil {
			t.Fatalf("body is not valid JSON: %v\nbody: %s", err, payload.body)
		}
		if len(decoded.Embeds) != 1 {
			t.Fatalf("event=%s: embeds = %+v, want exactly one", c.event, decoded.Embeds)
		}
		if decoded.Embeds[0].Color != c.want {
			t.Errorf("event=%s: color = %d, want %d", c.event, decoded.Embeds[0].Color, c.want)
		}
	}
}

func TestFormatTelegramNotificationCarriesChatID(t *testing.T) {
	n := monitorNotification{Event: "down", Name: "Example", Error: "HTTP 500"}
	payload, err := formatMonitorNotification("telegram", n, "123456789", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var decoded telegramSendMessagePayload
	if err := json.Unmarshal(payload.body, &decoded); err != nil {
		t.Fatalf("body is not valid JSON: %v\nbody: %s", err, payload.body)
	}
	if decoded.ChatID != "123456789" {
		t.Errorf("chat_id = %q, want the configured chat ID", decoded.ChatID)
	}
	if !strings.Contains(decoded.Text, "Example") {
		t.Errorf("text = %q, want it to name the bookmark", decoded.Text)
	}
}

func TestFormatGotifyNotificationPriority(t *testing.T) {
	down, err := formatMonitorNotification("gotify", monitorNotification{Event: "down", Name: "Example", Error: "HTTP 500"}, "", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var decodedDown gotifyMessagePayload
	if err := json.Unmarshal(down.body, &decodedDown); err != nil {
		t.Fatalf("body is not valid JSON: %v", err)
	}
	if decodedDown.Priority != 5 {
		t.Errorf("down priority = %d, want 5", decodedDown.Priority)
	}
	if decodedDown.Message != "HTTP 500" {
		t.Errorf("message = %q, want the error detail", decodedDown.Message)
	}

	up, err := formatMonitorNotification("gotify", monitorNotification{Event: "up", Name: "Example"}, "", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var decodedUp gotifyMessagePayload
	if err := json.Unmarshal(up.body, &decodedUp); err != nil {
		t.Fatalf("body is not valid JSON: %v", err)
	}
	if decodedUp.Priority != 2 {
		t.Errorf("up priority = %d, want 2", decodedUp.Priority)
	}
}

func TestFormatNtfyNotificationIsPlainText(t *testing.T) {
	n := monitorNotification{Event: "down", Name: "Example", Error: "HTTP 500"}
	payload, err := formatMonitorNotification("ntfy", n, "", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(payload.contentType, "text/plain") {
		t.Errorf("contentType = %q, want text/plain", payload.contentType)
	}
	if string(payload.body) != "HTTP 500" {
		t.Errorf("body = %q, want the bare error detail", payload.body)
	}
	// json.Unmarshal into a struct pointer succeeding on a plain sentence would
	// mean this accidentally stayed JSON — assert it does NOT parse as an object.
	var probe map[string]any
	if err := json.Unmarshal(payload.body, &probe); err == nil {
		t.Errorf("body parsed as JSON object %v, want plain text", probe)
	}
}

func TestFormatPushoverNotificationIsFormEncoded(t *testing.T) {
	down := monitorNotification{Event: "down", Name: "Example", Error: "HTTP 500"}
	payload, err := formatMonitorNotification("pushover", down, "", "app-token-123", "user-key-456")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if payload.contentType != "application/x-www-form-urlencoded" {
		t.Errorf("contentType = %q, want application/x-www-form-urlencoded", payload.contentType)
	}
	values, err := url.ParseQuery(string(payload.body))
	if err != nil {
		t.Fatalf("body did not parse as form data: %v\nbody: %s", err, payload.body)
	}
	if values.Get("token") != "app-token-123" {
		t.Errorf("token = %q, want app-token-123", values.Get("token"))
	}
	if values.Get("user") != "user-key-456" {
		t.Errorf("user = %q, want user-key-456", values.Get("user"))
	}
	if values.Get("priority") != "1" {
		t.Errorf("down priority = %q, want 1 (bypasses quiet hours for an actual outage)", values.Get("priority"))
	}

	up := monitorNotification{Event: "up", Name: "Example"}
	upPayload, err := formatMonitorNotification("pushover", up, "", "app-token-123", "user-key-456")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	upValues, err := url.ParseQuery(string(upPayload.body))
	if err != nil {
		t.Fatalf("up body did not parse as form data: %v", err)
	}
	if upValues.Get("priority") != "0" {
		t.Errorf("up priority = %q, want 0 (a recovery should not bypass quiet hours)", upValues.Get("priority"))
	}

	certExpiring := monitorNotification{Event: "cert-expiring", Name: "example.com", Error: "TLS certificate expires in 7 days"}
	certPayload, err := formatMonitorNotification("pushover", certExpiring, "", "app-token-123", "user-key-456")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	certValues, err := url.ParseQuery(string(certPayload.body))
	if err != nil {
		t.Fatalf("cert body did not parse as form data: %v", err)
	}
	if certValues.Get("priority") != "0" {
		t.Errorf("cert-expiring priority = %q, want 0 — a certificate warning should not be as urgent as an outage", certValues.Get("priority"))
	}
}

func TestMonitorNotifyTargetResolvesPerPreset(t *testing.T) {
	// Every preset but Pushover uses the operator's own URL.
	settings := Settings{MonitorNotifyURL: "https://hooks.example.com/x", MonitorNotifyPreset: "slack"}
	target, configured := monitorNotifyTarget(settings)
	if !configured || target != "https://hooks.example.com/x" {
		t.Errorf("slack: target=%q configured=%v, want the configured URL", target, configured)
	}

	// Pushover ignores MonitorNotifyURL entirely and always targets the fixed
	// endpoint, but only once both credentials are set.
	noCreds := Settings{MonitorNotifyPreset: "pushover", MonitorNotifyURL: "https://hooks.example.com/x"}
	if _, configured := monitorNotifyTarget(noCreds); configured {
		t.Error("pushover with no token/user key should not be considered configured")
	}

	oneCred := Settings{MonitorNotifyPreset: "pushover", MonitorNotifyPushoverToken: "tok"}
	if _, configured := monitorNotifyTarget(oneCred); configured {
		t.Error("pushover with only a token (no user key) should not be considered configured")
	}

	bothCreds := Settings{
		MonitorNotifyPreset:          "pushover",
		MonitorNotifyPushoverToken:   "tok",
		MonitorNotifyPushoverUserKey: "user",
		MonitorNotifyURL:             "https://this-must-be-ignored.example.com",
	}
	target, configured = monitorNotifyTarget(bothCreds)
	if !configured {
		t.Error("pushover with both credentials should be considered configured")
	}
	if target != pushoverEndpoint {
		t.Errorf("pushover target = %q, want the fixed endpoint %q (MonitorNotifyURL must be ignored)", target, pushoverEndpoint)
	}
}
