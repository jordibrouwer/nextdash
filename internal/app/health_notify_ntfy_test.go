package app

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

/*
ntfy's JSON shape, which is the only one that can carry buttons.

The plain-text form worked and could do nothing the reader can press. A
monitored bookmark going down is a notification you want to act on, and until
now acting on it meant finding a laptop.
*/
func TestNtfyTopicIsTakenOutOfTheConfiguredAddress(t *testing.T) {
	for address, want := range map[string][2]string{
		"https://ntfy.sh/my-topic":    {"https://ntfy.sh/", "my-topic"},
		"http://nas.lan:8080/alerts":  {"http://nas.lan:8080/", "alerts"},
		"https://ntfy.example.com/x/": {"https://ntfy.example.com/", "x"},
		// No topic, or a nested path that could be a proxy prefix: guessing
		// which segment is the topic would post to the wrong place.
		"https://ntfy.sh":                {"", ""},
		"https://ntfy.sh/":               {"", ""},
		"https://proxy.example/ntfy/top": {"", ""},
		"not a url":                      {"", ""},
	} {
		root, topic := ntfyTopicFromURL(address)
		if root != want[0] || topic != want[1] {
			t.Errorf("%s -> (%q, %q), want (%q, %q)", address, root, topic, want[0], want[1])
		}
	}
}

func TestNtfyJSONCarriesButtonsAndPriority(t *testing.T) {
	notification := monitorNotification{
		Event: "down", Name: "Sonarr", URL: "https://sonarr.example/",
		Status: "offline", Error: "connection refused",
	}
	payload, err := formatNtfyJSONNotification(notification, "alerts", "https://dash.example")
	if err != nil {
		t.Fatal(err)
	}
	if payload.contentType != "application/json" {
		t.Fatalf("content type = %q", payload.contentType)
	}

	var message ntfyMessage
	if err := json.Unmarshal(payload.body, &message); err != nil {
		t.Fatal(err)
	}
	if message.Topic != "alerts" {
		t.Errorf("topic = %q", message.Topic)
	}
	// Down is high priority: a bookmark that stopped answering is the whole
	// reason for the alert.
	if message.Priority != 4 {
		t.Errorf("priority = %d, want 4 for a failure", message.Priority)
	}
	if len(message.Actions) != 2 {
		t.Fatalf("got %d buttons: %+v", len(message.Actions), message.Actions)
	}
	if message.Actions[0].URL != "https://sonarr.example/" {
		t.Errorf("the first button does not open the failing link: %q", message.Actions[0].URL)
	}
	if !strings.Contains(message.Actions[1].URL, "#health") {
		t.Errorf("the second button does not reach the health view: %q", message.Actions[1].URL)
	}
	// Every button is a view: an http action would have to carry a token
	// through a notification that travels over someone else's server.
	for _, action := range message.Actions {
		if action.Action != "view" {
			t.Errorf("a button of type %q would need a credential", action.Action)
		}
	}
}

/*
Good news at full volume trains people to silence the channel.
*/
func TestNtfyRecoveryIsQuieterThanAFailure(t *testing.T) {
	if down, up := ntfyPriority("down"), ntfyPriority("up"); up >= down {
		t.Errorf("recovery is priority %d and a failure %d", up, down)
	}
	if ntfyPriority("cert-expiring") != 3 {
		t.Errorf("an expiring certificate is not the default priority")
	}
}

/*
A button that leads nowhere is worse than one that is not there.

Nothing forces an install to know its own public address, so the buttons that
would need it are left off rather than pointing at a guess.
*/
func TestNtfyLeavesOutButtonsItCannotPointAt(t *testing.T) {
	message := decodeNtfy(t, monitorNotification{Event: "down", Name: "X", URL: "https://x.example/"}, "t", "")
	if len(message.Actions) != 1 {
		t.Fatalf("got %d buttons with no dashboard address: %+v", len(message.Actions), message.Actions)
	}
	if message.Click != "" {
		t.Errorf("tapping the notification leads to %q", message.Click)
	}

	// And a notification about nothing in particular carries no link button.
	bare := decodeNtfy(t, monitorNotification{Event: "down", Name: "X"}, "t", "")
	if len(bare.Actions) != 0 {
		t.Errorf("invented a button: %+v", bare.Actions)
	}
}

func decodeNtfy(t *testing.T, n monitorNotification, topic, dash string) ntfyMessage {
	t.Helper()
	payload, err := formatNtfyJSONNotification(n, topic, dash)
	if err != nil {
		t.Fatal(err)
	}
	var message ntfyMessage
	if err := json.Unmarshal(payload.body, &message); err != nil {
		t.Fatal(err)
	}
	return message
}

/*
The whole path: a configured topic address becomes a JSON post to the root.

And the title headers come off -- they are how the plain-text form carries a
title, and ntfy refuses a request that sets both.
*/
func TestNtfyRequestPostsJSONToTheRoot(t *testing.T) {
	settings := Settings{
		MonitorNotifyPreset:       "ntfy",
		MonitorNotifyDashboardURL: "https://dash.example",
	}
	notification := monitorNotification{Event: "down", Name: "Sonarr", URL: "https://sonarr.example/"}

	req, err := buildMonitorNotificationRequest(context.Background(),
		"https://ntfy.sh/my-topic", settings, notification)
	if err != nil {
		t.Fatal(err)
	}
	if req.URL.String() != "https://ntfy.sh/" {
		t.Errorf("posted to %s, want the server root", req.URL)
	}
	if got := req.Header.Get("Content-Type"); got != "application/json" {
		t.Errorf("content type = %q", got)
	}
	if req.Header.Get("Title") != "" || req.Header.Get("X-Title") != "" {
		t.Error("a title header was set alongside the JSON title field")
	}
	body, _ := io.ReadAll(req.Body)
	if !strings.Contains(string(body), `"topic":"my-topic"`) {
		t.Errorf("the topic did not move into the body: %s", body)
	}
}

/*
An address this cannot take apart still works.

Someone behind a proxy prefix, or pointing at a server root, keeps the
plain-text form that has always been sent rather than getting nothing.
*/
func TestAnUnsplittableNtfyAddressKeepsThePlainForm(t *testing.T) {
	settings := Settings{MonitorNotifyPreset: "ntfy"}
	req, err := buildMonitorNotificationRequest(context.Background(),
		"https://proxy.example/ntfy/topic", settings,
		monitorNotification{Event: "down", Name: "X", Error: "boom"})
	if err != nil {
		t.Fatal(err)
	}
	if req.URL.String() != "https://proxy.example/ntfy/topic" {
		t.Errorf("the configured address was rewritten to %s", req.URL)
	}
	if !strings.HasPrefix(req.Header.Get("Content-Type"), "text/plain") {
		t.Errorf("content type = %q, want the plain-text form", req.Header.Get("Content-Type"))
	}
	// The title header is how that form carries a title, so it stays.
	if req.Header.Get("Title") == "" {
		t.Error("the plain-text form lost its title header")
	}
}
