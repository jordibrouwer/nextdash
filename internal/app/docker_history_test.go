package app

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

// The history route gathers every container's events, newest first and with
// restart loops folded as the drawer folds them, and the updates of the last
// thirty days; an update older than that stays out.
func TestDockerHistoryRoute(t *testing.T) {
	startFakeDocker(t)
	h := dockerTestHandlers(t)
	now := time.Now()
	ms := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	tl := newDockerTimeline()
	tl.add("web", dockerTimelineEntry{At: ms(5 * time.Hour), Kind: "start"})
	for i := 0; i < 3; i++ {
		at := time.Duration(i) * time.Minute
		tl.add("web", dockerTimelineEntry{At: ms(4*time.Hour - at), Kind: "crash", Detail: "exit code 1"})
		tl.add("web", dockerTimelineEntry{At: ms(4*time.Hour - at - 2*time.Second), Kind: "start"})
	}
	tl.add("db", dockerTimelineEntry{At: ms(time.Hour), Kind: "unhealthy"})
	if err := tl.flush(); err != nil {
		t.Fatal(err)
	}
	dockerTimelines = newDockerTimeline()
	t.Cleanup(func() { dockerTimelines = newDockerTimeline() })
	for _, e := range []dockerUpdateHistoryEntry{
		{At: ms(40 * 24 * time.Hour), Kind: "update", Container: "web", FromVersion: "0.9", ToVersion: "1.0"},
		{At: ms(2 * time.Hour), Kind: "update", Container: "web", FromVersion: "1.0", ToVersion: "1.1"},
	} {
		if err := appendDockerUpdateHistory(e); err != nil {
			t.Fatal(err)
		}
	}

	rec := httptest.NewRecorder()
	newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/history", nil))
	var body dockerHistoryResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || rec.Code != 200 {
		t.Fatalf("%d %v %s", rec.Code, err, rec.Body)
	}
	var got []string
	for _, e := range body.Events {
		got = append(got, e.Container+":"+e.Kind)
	}
	want := []string{"db:unhealthy", "web:restart-loop", "web:start"}
	if len(got) != len(want) {
		t.Fatalf("events = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("events = %v, want %v", got, want)
		}
	}
	if len(body.Updates) != 1 || body.Updates[0].ToVersion != "1.1" {
		t.Fatalf("updates = %+v, want only the one inside thirty days", body.Updates)
	}
	if body.Days != 30 {
		t.Fatalf("days = %d", body.Days)
	}
}
