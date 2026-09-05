package app

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCountContainers(t *testing.T) {
	payload := `[
		{"Id":"a","Names":["/web"],"State":"running","Status":"Up 4 minutes (healthy)"},
		{"Id":"b","Names":["/db"],"State":"running","Status":"Up 2 days"},
		{"Id":"c","Names":["/old"],"State":"exited","Status":"Exited (0) 3 days ago"},
		{"Id":"d","Names":["/held"],"State":"paused","Status":"Up 5 hours (Paused)"}
	]`
	got, err := countContainers(strings.NewReader(payload))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Running != 2 {
		t.Fatalf("running = %d, want 2", got.Running)
	}
	if got.Total != 4 {
		t.Fatalf("total = %d, want 4", got.Total)
	}
	if got.Stopped != 1 || got.Paused != 1 {
		t.Fatalf("stopped = %d, paused = %d, want 1 and 1", got.Stopped, got.Paused)
	}
}

/*
A failed healthcheck is the figure that matters at a glance, and Docker reports
it only inside the human-readable Status text -- "Up 4 minutes (unhealthy)".
A container can be running and useless at the same time, which no count of
running containers can show.
*/
func TestCountContainersFindsUnhealthy(t *testing.T) {
	payload := `[
		{"Id":"a","Names":["/web"],"State":"running","Status":"Up 4 minutes (unhealthy)"},
		{"Id":"b","Names":["/db"],"State":"running","Status":"Up 2 days (healthy)"},
		{"Id":"c","Names":["/cache"],"State":"running","Status":"Up 9 minutes"}
	]`
	got, _ := countContainers(strings.NewReader(payload))

	if got.Unhealthy != 1 {
		t.Fatalf("unhealthy = %d, want 1", got.Unhealthy)
	}
	if len(got.UnhealthyNames) != 1 || got.UnhealthyNames[0] != "web" {
		t.Fatalf("names = %v, want [web] -- without the leading slash", got.UnhealthyNames)
	}
	// A container with no healthcheck at all is not unhealthy, it is unknown.
	if got.Running != 3 {
		t.Fatalf("running = %d, want 3", got.Running)
	}
}

/*
Something restarted minutes ago while everything else has run for days is the
shape of a crashloop, and it is invisible in any count.
*/
func TestCountContainersFindsRecentlyRestarted(t *testing.T) {
	now := time.Now().Unix()
	payload := `[
		{"Id":"a","Names":["/flapping"],"State":"running","Status":"Up 3 minutes","Created":` +
		strconv.FormatInt(now-120, 10) + `},
		{"Id":"b","Names":["/steady"],"State":"running","Status":"Up 2 days","Created":` +
		strconv.FormatInt(now-200000, 10) + `}
	]`
	got, _ := countContainers(strings.NewReader(payload))

	if len(got.RestartedNames) != 1 || got.RestartedNames[0] != "flapping" {
		t.Fatalf("restarted = %v, want [flapping]", got.RestartedNames)
	}
}

// A stopped container is not "recently restarted" however new it is.
func TestCountContainersIgnoresStoppedWhenLookingForRestarts(t *testing.T) {
	now := time.Now().Unix()
	payload := `[{"Id":"a","Names":["/new"],"State":"exited","Status":"Exited (1) 1 minute ago","Created":` +
		strconv.FormatInt(now-60, 10) + `}]`
	got, _ := countContainers(strings.NewReader(payload))
	if len(got.RestartedNames) != 0 {
		t.Fatalf("restarted = %v, want none", got.RestartedNames)
	}
}

/*
The dial path is the part that cannot be checked by reading it: a stub daemon on
a real unix socket proves the client reaches one with stdlib alone.
*/
func TestDockerClientReachesUnixSocket(t *testing.T) {
	// Not t.TempDir(): a unix socket path is capped around 104 bytes and the
	// per-test temp directory alone is longer than that on macOS, which made
	// this skip on the very machine it was written to reassure.
	dir, err := os.MkdirTemp("", "nd")
	if err != nil {
		t.Fatalf("temp dir: %v", err)
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "d.sock")

	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Skipf("unix sockets unavailable here: %v", err)
	}
	defer listener.Close()

	server := &httptest.Server{
		Listener: listener,
		Config: &http.Server{Handler: http.HandlerFunc(
			func(w http.ResponseWriter, r *http.Request) {
				if strings.Contains(r.URL.Path, "/containers/json") {
					json.NewEncoder(w).Encode([]map[string]any{
						{"Id": "a", "Names": []string{"/web"}, "State": "running", "Status": "Up 1 hour"},
						{"Id": "b", "Names": []string{"/old"}, "State": "exited", "Status": "Exited (0)"},
					})
					return
				}
				if strings.Contains(r.URL.Path, "/info") {
					json.NewEncoder(w).Encode(map[string]any{"Images": 19})
					return
				}
				http.NotFound(w, r)
			})},
	}
	server.Start()
	defer server.Close()

	t.Setenv("NEXTDASH_DOCKER_SOCKET", socket)
	got := readDocker()
	if !got.Available {
		t.Fatalf("expected available, got reason %q", got.Reason)
	}
	if got.Running != 1 || got.Total != 2 {
		t.Fatalf("running=%d total=%d, want 1 and 2", got.Running, got.Total)
	}
	if got.Images != 19 {
		t.Fatalf("images = %d, want 19", got.Images)
	}
}

// No socket configured is the default, and it is not an error state.
func TestDockerUnavailableWithoutSocket(t *testing.T) {
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	got := readDocker()
	if got.Available {
		t.Fatal("expected unavailable with no socket configured")
	}
	if got.Reason != reasonNoDockerSocket {
		t.Fatalf("reason = %q, want %q", got.Reason, reasonNoDockerSocket)
	}
}

/*
A configured socket that is not there says so rather than reporting nought
containers, which would read as "everything you run has disappeared".
*/
func TestDockerUnavailableWhenSocketMissing(t *testing.T) {
	t.Setenv("NEXTDASH_DOCKER_SOCKET", filepath.Join(t.TempDir(), "absent.sock"))
	got := readDocker()
	if got.Available {
		t.Fatal("expected unavailable for a missing socket")
	}
	if got.Total != 0 {
		t.Fatal("an unavailable source must not report counts")
	}
}
