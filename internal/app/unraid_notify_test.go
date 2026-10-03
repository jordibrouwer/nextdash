package app

import (
	"encoding/json"
	"fmt"
	"strings"
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
		&UnraidParityView{Running: false, Errors: 12, Last: &UnraidParityRun{Errors: 12}},
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

// A section that could not be read (nil) must not look like a change, and
// must not use up the baseline: when it first can be read it only remembers.
func TestUnraidWatcherMissingAreaIsNotAChange(t *testing.T) {
	w := newUnraidWatcher()
	now := time.Now()
	if got := w.observe(nil, nil, nil, now); len(got) != 0 {
		t.Fatalf("unreadable look sent %v", got)
	}
	got := w.observe(
		&UnraidArrayView{Started: false, State: "STOPPED", Disks: []UnraidDiskView{{Name: "disk5", Errors: 3}}},
		&UnraidParityView{Last: &UnraidParityRun{Errors: 12}},
		&UnraidNotificationsView{Items: []UnraidNotificationView{{ID: "n1", Importance: "alert", Subject: "Disk 5 has read errors"}}},
		now.Add(time.Minute))
	if len(got) != 0 {
		t.Fatalf("first readable look sent %v", got)
	}
}

// Another server, a switch turned off and on, a server disabled and enabled:
// each starts from a fresh baseline, so one server's history is never replayed.
func TestUnraidWatcherStartsFreshPerServer(t *testing.T) {
	on := func(base string) UnraidServer { return UnraidServer{BaseURL: base, Enabled: true, Notify: true} }
	now := time.Now()
	busy := func() (*UnraidArrayView, *UnraidParityView, *UnraidNotificationsView) {
		return &UnraidArrayView{Started: true, Disks: []UnraidDiskView{{Name: "disk9", Errors: 7}}},
			&UnraidParityView{}, &UnraidNotificationsView{Items: []UnraidNotificationView{{ID: "b1", Importance: "alert", Subject: "B is unwell"}}}
	}

	w, base, active := pickUnraidWatcher(nil, "", on("https://a"), true)
	if !active {
		t.Fatal("A should be watched")
	}
	w.observe(&UnraidArrayView{Started: true}, &UnraidParityView{}, &UnraidNotificationsView{}, now)
	same, base2, _ := pickUnraidWatcher(w, base, on("https://a"), true)
	if same != w || base2 != base {
		t.Fatal("the same server must keep its watcher")
	}

	w2, base, _ := pickUnraidWatcher(w, base, on("https://b"), true)
	if w2 == w {
		t.Fatal("a changed address kept the old watcher")
	}
	if got := observeBusy(w2, busy, now); len(got) != 0 {
		t.Fatalf("B's first tick sent %v", got)
	}

	// Switched off, then on again: fresh.
	off, base, active := pickUnraidWatcher(w2, base, UnraidServer{BaseURL: "https://b", Enabled: true}, true)
	if active || off == w2 || base != "" {
		t.Fatalf("off: active=%v same=%v base=%q", active, off == w2, base)
	}
	w3, _, active := pickUnraidWatcher(off, base, on("https://b"), true)
	if !active || w3 == w2 {
		t.Fatal("back on kept the old watcher")
	}
	if got := observeBusy(w3, busy, now); len(got) != 0 {
		t.Fatalf("after off/on sent %v", got)
	}

	// No server at all.
	if gone, base, active := pickUnraidWatcher(w3, "https://b", UnraidServer{}, false); active || gone == w3 || base != "" {
		t.Fatal("no server must reset")
	}
}

func observeBusy(w *unraidWatcher, busy func() (*UnraidArrayView, *UnraidParityView, *UnraidNotificationsView), now time.Time) []monitorNotification {
	a, p, n := busy()
	return w.observe(a, p, n, now)
}

func TestUnraidDigestBundlesAFewAlertsIntoOne(t *testing.T) {
	now := time.Now()
	var four []monitorNotification
	for _, d := range []string{"disk1", "disk2", "disk3", "disk4"} {
		four = append(four, unraidNotice("disk-errors", d+" has 3 errors", "up from 0", now))
	}
	got := collapseUnraidNotices(four)
	if len(got) != 1 {
		t.Fatalf("got %d notices", len(got))
	}
	d := got[0]
	if d.Title != "4 Unraid alerts" || d.Event != "unraid-digest" || d.Source != "unraid" {
		t.Errorf("digest = %+v", d)
	}
	for _, name := range []string{"disk1", "disk2", "disk3", "disk4"} {
		if !strings.Contains(d.Error, name) {
			t.Errorf("body %q lacks %s", d.Error, name)
		}
	}

	if got := collapseUnraidNotices(four[:3]); len(got) != 3 {
		t.Errorf("under the threshold changed: %d", len(got))
	}

	var many []monitorNotification
	for i := 0; i < 14; i++ {
		many = append(many, unraidNotice("unraid-alert", fmt.Sprintf("alert %d", i), "", now))
	}
	body := collapseUnraidNotices(many)[0].Error
	if !strings.Contains(body, "and 4 more") || strings.Contains(body, "alert 12") {
		t.Errorf("body not capped: %q", body)
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

// The run that just finished is in the check's own status; the newest history
// entry can still be the run before it. The alert counts this run's errors.
func TestUnraidWatcherParityCountsThisRun(t *testing.T) {
	now := time.Now()
	finish := func(p UnraidParityView) []monitorNotification {
		w := newUnraidWatcher()
		w.observe(nil, &UnraidParityView{Running: true}, nil, now)
		return w.observe(nil, &p, nil, now.Add(time.Minute))
	}
	if got := finish(UnraidParityView{Errors: 0, Last: &UnraidParityRun{Errors: 12}}); len(got) != 0 {
		t.Fatalf("a clean run alerted with the previous run's errors: %+v", got)
	}
	got := finish(UnraidParityView{Errors: 5, Last: &UnraidParityRun{Errors: 0}})
	if len(got) != 1 || got[0].Event != "parity-errors" || !strings.Contains(got[0].Title, "5 errors") {
		t.Fatalf("got %+v", got)
	}
}

// Unraid 7.3 clears the status's error count when a check completes and
// writes the run to the history, dated at its end (recorded from a real
// server). The alert reads that entry -- and waits for it when it is late.
func TestUnraidWatcherParityReadsTheRunFromHistory(t *testing.T) {
	start := time.Date(2026, 10, 2, 4, 0, 0, 0, time.UTC)
	before := UnraidParityRun{Date: "2026-09-03T12:22:09.000Z", Errors: 7}
	thisRun := func(errs int64) UnraidParityRun {
		return UnraidParityRun{Date: "2026-10-03T12:42:14.000Z", Errors: errs}
	}
	running := func(w *unraidWatcher) {
		w.observe(nil, &UnraidParityView{}, nil, start.Add(-time.Hour))
		w.observe(nil, &UnraidParityView{Running: true}, nil, start)
	}

	w := newUnraidWatcher()
	running(w)
	got := w.observe(nil, &UnraidParityView{History: []UnraidParityRun{thisRun(3), before}}, nil, start.Add(33*time.Hour))
	if len(got) != 1 || !strings.Contains(got[0].Title, "3 errors") {
		t.Fatalf("this run's 3 errors: got %+v", got)
	}

	w = newUnraidWatcher()
	running(w)
	if got := w.observe(nil, &UnraidParityView{History: []UnraidParityRun{thisRun(0), before}}, nil, start.Add(33*time.Hour)); len(got) != 0 {
		t.Fatalf("a clean run alerted with an older run's errors: %+v", got)
	}

	w = newUnraidWatcher()
	running(w)
	if got := w.observe(nil, &UnraidParityView{History: []UnraidParityRun{before}}, nil, start.Add(33*time.Hour)); len(got) != 0 {
		t.Fatalf("alerted before the run was in the history: %+v", got)
	}
	got = w.observe(nil, &UnraidParityView{History: []UnraidParityRun{thisRun(2), before}}, nil, start.Add(33*time.Hour+time.Minute))
	if len(got) != 1 || !strings.Contains(got[0].Title, "2 errors") {
		t.Fatalf("the late entry: got %+v", got)
	}
	if got := w.observe(nil, &UnraidParityView{History: []UnraidParityRun{thisRun(2), before}}, nil, start.Add(33*time.Hour+2*time.Minute)); len(got) != 0 {
		t.Fatalf("sent twice: %+v", got)
	}
}
