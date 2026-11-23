package app

import (
	"testing"
	"time"
)

func liveDockerEv(action, name string) dockerEvent {
	var ev dockerEvent
	ev.Type, ev.Action = "container", action
	ev.Actor.ID = "abc"
	ev.Actor.Attributes = map[string]string{"name": name}
	return ev
}

// Which daemon events are a container's state moving. exec and attach are
// not; a health verdict is; nextDash's own helper container is not.
func TestDockerEventChangesState(t *testing.T) {
	for _, a := range []string{"create", "start", "stop", "die", "pause", "unpause", "destroy", "rename", "oom", "restart", "health_status: unhealthy", "health_status: healthy"} {
		if !dockerEventChangesState(liveDockerEv(a, "sonarr")) {
			t.Errorf("%q should count", a)
		}
	}
	for _, a := range []string{"exec_create: sh", "exec_start: sh", "attach", "resize", "top", "kill", "export"} {
		if dockerEventChangesState(liveDockerEv(a, "sonarr")) {
			t.Errorf("%q should not count", a)
		}
	}
	net := liveDockerEv("start", "x")
	net.Type = "network"
	if dockerEventChangesState(net) {
		t.Error("a network event is not a container's state")
	}
	if dockerEventChangesState(liveDockerEv("start", "")) {
		t.Error("an event with no name has nothing to refetch")
	}
	helper := liveDockerEv("die", "nextdash-du")
	helper.Actor.Attributes[dockerBindMeasureLabel] = "1"
	if dockerEventChangesState(helper) {
		t.Error("nextDash's own helper must not ping")
	}
}

// A stack coming up is a burst of events and one ping; "docker" and "health"
// are separate events and neither swallows the other.
func TestPublishDockerChangeCoalescesAndIsItsOwnEvent(t *testing.T) {
	shortLive(t)
	h := &Handlers{live: newLiveBroker()}
	ch, cancel, ok := h.live.Subscribe()
	if !ok {
		t.Fatal("subscribe refused")
	}
	defer cancel()
	for i := 0; i < 10; i++ {
		h.publishDockerChange(liveDockerEv("start", "sonarr"))
		h.publishDockerChange(liveDockerEv("exec_create: sh", "sonarr")) // not a change
	}
	select {
	case ev := <-ch:
		if ev != "docker" {
			t.Fatalf("event %q, want docker", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("no delivery")
	}
	select {
	case ev := <-ch:
		t.Fatalf("a second delivery for one burst: %q", ev)
	case <-time.After(120 * time.Millisecond):
	}
	h.live.Publish("health")
	h.publishDockerChange(liveDockerEv("die", "sonarr"))
	got := map[string]bool{}
	for i := 0; i < 2; i++ {
		select {
		case ev := <-ch:
			got[ev] = true
		case <-time.After(time.Second):
			t.Fatalf("only %v arrived", got)
		}
	}
	if !got["health"] || !got["docker"] {
		t.Fatalf("got %v, want both", got)
	}
}

// Events that are not state changes ping nobody.
func TestPublishDockerChangeIgnoresNoise(t *testing.T) {
	shortLive(t)
	h := &Handlers{live: newLiveBroker()}
	ch, cancel, _ := h.live.Subscribe()
	defer cancel()
	h.publishDockerChange(liveDockerEv("exec_start: sh", "sonarr"))
	h.publishDockerChange(liveDockerEv("attach", "sonarr"))
	select {
	case ev := <-ch:
		t.Fatalf("noise pinged %q", ev)
	case <-time.After(120 * time.Millisecond):
	}
	var nilH *Handlers
	nilH.publishDockerChange(liveDockerEv("start", "sonarr")) // safe
}
