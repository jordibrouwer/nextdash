package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func readProgressLines(t *testing.T, body string) []dockerProgressEvent {
	t.Helper()
	var out []dockerProgressEvent
	for _, line := range strings.Split(strings.TrimSpace(body), "\n") {
		var ev dockerProgressEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			t.Fatalf("not an event: %q (%v)", line, err)
		}
		out = append(out, ev)
	}
	return out
}

func progressSteps(events []dockerProgressEvent) string {
	var steps []string
	for _, ev := range events {
		if ev.Type == "step" {
			steps = append(steps, ev.Step+":"+ev.State)
		}
	}
	return strings.Join(steps, " ")
}

// The steps arrive in the order the recreate takes them, and the last line
// is what the plain route would have answered.
func TestDockerUpdateStreamsItsSteps(t *testing.T) {
	recreateFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	router := newDockerTestRouter(dockerTestHandlers(t))
	rec := dockerPost(router, "/api/docker/containers/sonarr/update?stream=1")
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/x-ndjson") {
		t.Fatalf("code = %d type = %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	events := readProgressLines(t, rec.Body.String())
	want := "check:start check:done pull:start pull:done compare:start compare:done stop:start stop:done " +
		"rename:start rename:done create:start create:done connect:start connect:done start:start start:done remove:start remove:done"
	if got := progressSteps(events); got != want {
		t.Fatalf("steps:\n got %s\nwant %s", got, want)
	}
	last := events[len(events)-1]
	if last.Type != "result" || last.Status != 200 || !strings.Contains(string(last.Body), `"phase":"done"`) {
		t.Fatalf("last line = %+v body = %s", last, last.Body)
	}
}

// A failure says where, puts the old container back, and the result line
// carries the status and reason the plain route would have sent.
func TestDockerUpdateStreamShowsRollback(t *testing.T) {
	f, _, _, _ := recreateFixture(t)
	f.failCreate = true
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	router := newDockerTestRouter(dockerTestHandlers(t))
	rec := dockerPost(router, "/api/docker/containers/sonarr/update?stream=1")
	events := readProgressLines(t, rec.Body.String())
	got := progressSteps(events)
	if !strings.Contains(got, "create:fail restore:start restore:done") {
		t.Fatalf("steps = %s", got)
	}
	last := events[len(events)-1]
	if last.Type != "result" || !strings.Contains(string(last.Body), `"phase":"rolled-back"`) {
		t.Fatalf("last line = %+v body = %s", last, last.Body)
	}
}

// Without ?stream=1 the route answers as it always did.
func TestDockerUpdateWithoutStreamIsPlain(t *testing.T) {
	recreateFixture(t)
	t.Setenv("NEXTDASH_DOCKER_CONTROL", "1")
	router := newDockerTestRouter(dockerTestHandlers(t))
	rec := dockerPost(router, "/api/docker/containers/sonarr/update")
	if strings.Contains(rec.Body.String(), `"type":"step"`) {
		t.Fatalf("plain answer carries steps: %s", rec.Body)
	}
}
