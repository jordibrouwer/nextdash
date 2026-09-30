package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// A long alert is shortened to fit, rather than failing encryption -- which
// was read as a dead subscription and removed every device.
func TestFitPushPayloadShortensALongAlert(t *testing.T) {
	msg := webPushMessage{
		Title: "https://" + strings.Repeat("a", 300) + ".example/ is down",
		Body:  strings.Repeat("<&> connection refused ", 400),
		URL:   "https://dash.example/#health",
	}
	payload, err := fitPushPayload(msg)
	if err != nil {
		t.Fatalf("fit: %v", err)
	}
	if len(payload) > pushMaxPayload {
		t.Fatalf("payload = %d bytes, max %d", len(payload), pushMaxPayload)
	}
	if !utf8.Valid(payload) {
		t.Fatalf("shortened payload is not valid UTF-8")
	}
	p256dh, auth, _, _ := newTestSubscriptionKeys(t)
	if _, err := encryptPushPayload(p256dh, auth, payload); err != nil {
		t.Fatalf("the fitted payload still fails to encrypt: %v", err)
	}
}
