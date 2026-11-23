package app

import (
	"testing"
	"time"
)

func TestUnraidEventsAreKeptWithTheAlertSwitchOff(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	now := time.Now()
	recordUnraidEvents([]monitorNotification{
		{Event: "array-stopped", Title: "The Unraid array stopped", Error: "state STOPPED", At: now.UnixMilli()},
	}, now)
	got := unraidEventsSince(now.Add(-time.Hour))
	if len(got) != 1 || got[0].Event != "array-stopped" || got[0].Detail != "state STOPPED" {
		t.Fatalf("got %+v", got)
	}
}

func TestUnraidEventsKeepTheNewestAndDropTheOld(t *testing.T) {
	now := time.Now()
	var in []unraidEvent
	in = append(in, unraidEvent{At: now.Add(-31 * 24 * time.Hour).UnixMilli(), Event: "old"})
	for i := 0; i < unraidEventsMax+20; i++ {
		in = append(in, unraidEvent{At: now.Add(-time.Duration(i) * time.Minute).UnixMilli(), Event: "alert"})
	}
	out := pruneUnraidEvents(in, now)
	if len(out) != unraidEventsMax {
		t.Fatalf("kept %d, want %d", len(out), unraidEventsMax)
	}
	for _, e := range out {
		if e.Event == "old" {
			t.Fatal("an event older than thirty days was kept")
		}
	}
	if out[0].At > out[len(out)-1].At {
		t.Fatal("not oldest first")
	}
}
