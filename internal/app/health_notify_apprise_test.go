package app

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

/*
Apprise: one channel, and everything Apprise can reach behind it -- mail,
Matrix, Signal and a hundred more. nextDash posts to a configuration key on
the user's own apprise-api and keeps none of those services' secrets itself.
*/

func TestFormatAppriseNotification(t *testing.T) {
	cases := []struct {
		name     string
		n        monitorNotification
		tag      string
		wantType string
	}{
		{"an outage is a failure", monitorNotification{Event: "down", Name: "Sonarr", Error: "connection refused"}, "", "failure"},
		{"a recovery is a success", monitorNotification{Event: "up", Name: "Sonarr"}, "admins", "success"},
		{"a certificate about to lapse is a warning", monitorNotification{Event: "cert-expiring", Name: "nas", DaysLeft: 5}, "", "warning"},
		{"a container that stopped is a failure", containerNotice("down", "sonarr", "sonarr stopped unexpectedly", "exit 137", time.Now()), "", "failure"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			payload, err := formatAppriseNotification(c.n, c.tag)
			if err != nil {
				t.Fatal(err)
			}
			if payload.contentType != "application/json" {
				t.Errorf("content type %q", payload.contentType)
			}
			var body map[string]any
			if err := json.Unmarshal(payload.body, &body); err != nil {
				t.Fatal(err)
			}
			if body["type"] != c.wantType || body["format"] != "text" {
				t.Errorf("type/format = %v/%v", body["type"], body["format"])
			}
			if body["title"] != monitorNotificationTitle(c.n) || body["body"] == "" {
				t.Errorf("title %q body %q", body["title"], body["body"])
			}
			if tag, has := body["tag"]; (c.tag == "" && has) || (c.tag != "" && tag != c.tag) {
				t.Errorf("tag = %v, want %q", tag, c.tag)
			}
		})
	}
}

func TestNormalizeMonitorNotifyPresetKnowsApprise(t *testing.T) {
	if got := normalizeMonitorNotifyPreset("Apprise"); got != "apprise" {
		t.Fatalf("got %q", got)
	}
}

// The test button sends through Apprise with the tag, and says what Apprise's
// own refusals mean rather than only their numbers.
func TestTestMonitorNotificationThroughApprise(t *testing.T) {
	var gotBody map[string]any
	var gotPath string
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(status)
	}))
	defer srv.Close()

	h, _ := healthRecheckTestHandlers(t, `{"monitorNotifyUrl":"`+srv.URL+`/notify/nextdash","monitorNotifyPreset":"apprise","monitorNotifyAppriseTag":" admins ","allowLocalBookmarks":true}`)

	rec := postTestNotification(t, h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if gotPath != "/notify/nextdash" || gotBody["tag"] != "admins" || gotBody["type"] != "failure" {
		t.Fatalf("path %q body %v", gotPath, gotBody)
	}

	for code, want := range map[int]string{
		http.StatusFailedDependency: "could not deliver",
		http.StatusNotFound:         "no configuration under that key",
	} {
		status = code
		rec := postTestNotification(t, h)
		if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), want) {
			t.Errorf("HTTP %d: got %d %q, want 502 saying %q", code, rec.Code, rec.Body.String(), want)
		}
	}
}
