package app

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func timelineKinds(entries []dockerTimelineEntry) string {
	var out []string
	for _, e := range entries {
		k := e.Kind
		if e.Detail != "" {
			k += "(" + e.Detail + ")"
		}
		out = append(out, k)
	}
	return strings.Join(out, " ")
}

// What the notifier sees is written down whatever the notices say: a stop
// someone asked for, a crash with its exit code, health changes (once each),
// pauses -- and not the healthcheck's exec noise.
func TestDockerTimelineRecordsEvents(t *testing.T) {
	tl := newDockerTimeline()
	n := newContainerNotifier()
	n.timeline = tl
	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	no := func(string, string) bool { return false } // notices off: recording goes on
	step := func(d time.Duration, action string, attrs ...string) {
		now = now.Add(d)
		n.event(dockerEv(action, "web", attrs...), now, no)
	}
	step(0, "kill", "signal", "15")
	step(time.Second, "die", "exitCode", "0")
	step(0, "stop")
	step(time.Minute, "start")
	// A healthcheck coming up healthy is its start, not a recovery.
	step(time.Second, "health_status: healthy")
	step(time.Second, "exec_start: /bin/sh -c curl localhost")
	step(time.Second, "health_status: unhealthy")
	step(time.Second, "health_status: unhealthy")
	step(time.Second, "health_status: healthy")
	step(time.Second, "oom")
	step(0, "die", "exitCode", "137")
	step(time.Minute, "start")
	step(time.Second, "pause")
	step(time.Second, "unpause")
	n.expect("web", now.Add(time.Minute))
	step(time.Second, "die", "exitCode", "0")

	got := timelineKinds(tl.forContainer("web"))
	want := "stop(exit code 0) start unhealthy healthy crash(out of memory (exit code 137)) start pause unpause stop(by nextDash)"
	if got != want {
		t.Fatalf("timeline\n got %s\nwant %s", got, want)
	}
}

// A hundred entries a container, none older than thirty days, and what was
// written survives a restart of nextDash.
func TestDockerTimelineBoundsAndPersists(t *testing.T) {
	startFakeDocker(t)
	dockerTestHandlers(t) // a fresh data dir
	tl := newDockerTimeline()
	now := time.Now()
	tl.add("old", dockerTimelineEntry{At: now.Add(-40 * 24 * time.Hour).UnixMilli(), Kind: "start"})
	for i := 0; i < 130; i++ {
		tl.add("web", dockerTimelineEntry{At: now.Add(time.Duration(i) * time.Second).UnixMilli(), Kind: "start"})
	}
	if err := tl.flush(); err != nil {
		t.Fatal(err)
	}
	again := newDockerTimeline()
	if n := len(again.forContainer("web")); n != dockerTimelinePerContainer {
		t.Fatalf("kept %d, want %d", n, dockerTimelinePerContainer)
	}
	if n := len(again.forContainer("old")); n != 0 {
		t.Fatalf("an entry older than thirty days survived")
	}
}

// The route merges the recorded events with the update history, newest
// first, and folds a run of crash-and-restart cycles into one line.
func TestDockerTimelineRoute(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "web", State: "running"})
	h := dockerTestHandlers(t)
	base := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	ms := func(d time.Duration) int64 { return base.Add(d).UnixMilli() }
	tl := newDockerTimeline()
	tl.add("web", dockerTimelineEntry{At: ms(0), Kind: "start"})
	for i := 0; i < 4; i++ {
		at := time.Duration(i) * time.Minute
		tl.add("web", dockerTimelineEntry{At: ms(time.Hour + at), Kind: "crash", Detail: "exit code 1"})
		tl.add("web", dockerTimelineEntry{At: ms(time.Hour + at + 2*time.Second), Kind: "start"})
	}
	if err := tl.flush(); err != nil {
		t.Fatal(err)
	}
	dockerTimelines = newDockerTimeline()
	t.Cleanup(func() { dockerTimelines = newDockerTimeline() })
	if err := appendDockerUpdateHistory(dockerUpdateHistoryEntry{At: ms(2 * time.Hour), Kind: "update", Container: "web",
		FromImageID: "sha256:a", ToImageID: "sha256:b", FromVersion: "1.0", ToVersion: "1.1"}); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/web/timeline", nil))
	var body struct {
		Entries []dockerTimelineEntry `json:"entries"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || rec.Code != 200 {
		t.Fatalf("%d %v %s", rec.Code, err, rec.Body)
	}
	got := timelineKinds(body.Entries)
	want := "update(1.0 → 1.1) restart-loop(4 times in 3 min, last exit code 1) start"
	if got != want {
		t.Fatalf("route\n got %s\nwant %s", got, want)
	}
	if body.Entries[1].Count != 4 {
		t.Fatalf("loop = %+v", body.Entries[1])
	}
}

// A start counts as a restart only after something else in the container's
// history, and only inside the window.
func TestDockerTimelineRestartsSince(t *testing.T) {
	tl := newDockerTimeline()
	tl.loaded = true
	now := time.Now()
	at := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	tl.data["sonarr"] = []dockerTimelineEntry{
		{At: at(30 * time.Hour), Kind: "start"},
		{At: at(29 * time.Hour), Kind: "crash"},
		{At: at(29 * time.Hour), Kind: "start"}, // before the window
		{At: at(3 * time.Hour), Kind: "crash"},
		{At: at(3 * time.Hour), Kind: "start"},
		{At: at(1 * time.Hour), Kind: "stop"},
		{At: at(1 * time.Hour), Kind: "start"},
	}
	tl.data["fresh"] = []dockerTimelineEntry{{At: at(time.Hour), Kind: "start"}}
	if got := tl.restartsSince("sonarr", now.Add(-24*time.Hour)); got != 2 {
		t.Fatalf("sonarr = %d, want 2", got)
	}
	if got := tl.restartsSince("fresh", now.Add(-24*time.Hour)); got != 0 {
		t.Fatalf("a first start is not a restart: %d", got)
	}
}
