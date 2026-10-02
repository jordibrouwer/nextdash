package app

import (
	"encoding/json"
	"testing"
	"time"
)

func TestUnraidWatcherFirstLookSendsNothing(t *testing.T) {
	w := newUnraidWatcher()
	a := &UnraidArrayView{Started: true, State: "STARTED", Disks: []UnraidDiskView{{Name: "disk5", Errors: 3}}}
	n := &UnraidNotificationsView{Items: []UnraidNotificationView{{ID: "n1", Importance: "alert", Subject: "Disk 5 has read errors"}}}
	if got := w.observe(a, &UnraidParityView{}, n, time.Now()); len(got) != 0 {
		t.Fatalf("baseline sent %v", got)
	}
}

func TestUnraidWatcherSignals(t *testing.T) {
	w := newUnraidWatcher()
	now := time.Now()
	w.observe(&UnraidArrayView{Started: true, State: "STARTED", Disks: []UnraidDiskView{{Name: "disk5", Errors: 0}}},
		&UnraidParityView{Running: true}, &UnraidNotificationsView{}, now)

	got := w.observe(
		&UnraidArrayView{Started: false, State: "STOPPED", Disks: []UnraidDiskView{{Name: "disk5", Errors: 3}}},
		&UnraidParityView{Running: false, Last: &UnraidParityRun{Errors: 12}},
		&UnraidNotificationsView{Items: []UnraidNotificationView{
			{ID: "n1", Importance: "alert", Subject: "Disk 5 has read errors"},
			{ID: "n2", Importance: "warning", Subject: "Docker image disk 82% full"}}},
		now.Add(time.Minute))
	want := map[string]bool{"array-stopped": false, "parity-errors": false, "disk-errors": false, "unraid-alert": false}
	for _, n := range got {
		if _, ok := want[n.Event]; !ok {
			t.Fatalf("unexpected event %q", n.Event)
		}
		want[n.Event] = true
		if n.Source != "unraid" {
			t.Fatalf("source = %q", n.Source)
		}
	}
	for ev, seen := range want {
		if !seen {
			t.Errorf("%s not sent", ev)
		}
	}
	again := w.observe(
		&UnraidArrayView{Started: false, State: "STOPPED", Disks: []UnraidDiskView{{Name: "disk5", Errors: 3}}},
		&UnraidParityView{Last: &UnraidParityRun{Errors: 12}},
		&UnraidNotificationsView{Items: []UnraidNotificationView{{ID: "n1", Importance: "alert"}}},
		now.Add(2*time.Minute))
	if len(again) != 0 {
		t.Fatalf("repeated: %v", again)
	}
}

// A section that could not be read (nil) must not look like a change.
func TestUnraidWatcherMissingAreaIsNotAChange(t *testing.T) {
	w := newUnraidWatcher()
	now := time.Now()
	w.observe(&UnraidArrayView{Started: true}, &UnraidParityView{Running: true}, &UnraidNotificationsView{}, now)
	if got := w.observe(nil, nil, nil, now.Add(time.Minute)); len(got) != 0 {
		t.Fatalf("unreadable looks sent %v", got)
	}
}

// The receivers take a Title and any event; an Unraid notice must come out as
// its Title, as a warning, the same way a container notice does.
func TestUnraidNoticeRendersThroughAppriseAndNtfy(t *testing.T) {
	n := unraidNotice("unraid-alert", "Disk 5 has read errors", "", time.Now())

	payload, err := formatAppriseNotification(n, "")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(payload.body, &body); err != nil {
		t.Fatal(err)
	}
	if body["title"] != "Disk 5 has read errors" || body["type"] != "warning" {
		t.Errorf("apprise title/type = %v/%v", body["title"], body["type"])
	}

	payload, err = formatNtfyJSONNotification(n, "alerts", "")
	if err != nil {
		t.Fatal(err)
	}
	var msg ntfyMessage
	if err := json.Unmarshal(payload.body, &msg); err != nil {
		t.Fatal(err)
	}
	if msg.Title != "Disk 5 has read errors" || msg.Priority != 3 || len(msg.Tags) != 1 || msg.Tags[0] != "warning" {
		t.Errorf("ntfy = %+v", msg)
	}
}
