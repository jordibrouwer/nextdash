package app

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"
)

// A host removed and added again under the same name is started once more, and
// once only: the old loop's end must not stop the new one, which would end, stop
// the next, and so on for as long as nextDash runs.
func TestGlancesReaddedHostStartsOnce(t *testing.T) {
	h := hostsSetup(t)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://a.lan:61208"}`)
	hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"NAS","server":"http://nas.lan:61208"}`)

	var mu sync.Mutex
	starts := map[string]int{}
	previous := glancesHostLoop
	// A loop that is slow to go, as one finishing a beat is.
	glancesHostLoop = func(_ *Handlers, ctx context.Context, hs *glancesHost) {
		mu.Lock()
		starts[hs.id]++
		mu.Unlock()
		<-ctx.Done()
		time.Sleep(150 * time.Millisecond)
	}
	t.Cleanup(func() { glancesHostLoop = previous })
	nasStarts := func() int {
		mu.Lock()
		defer mu.Unlock()
		return starts["nas"]
	}

	stop := make(chan struct{})
	done := h.StartGlancesSampler(stop)
	defer func() { close(stop); <-done }()
	deadline := time.Now().Add(2 * time.Second)
	for nasStarts() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if nasStarts() != 1 {
		t.Fatalf("nas started %d times", nasStarts())
	}

	if err := glancesRemoveHost("nas"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(40 * time.Millisecond)
	if cfg, err := glancesAddHost("NAS"); err != nil || cfg.ID != "nas" {
		t.Fatalf("add again: %+v %v", cfg, err)
	}
	glancesWakeSampler()
	time.Sleep(1200 * time.Millisecond)
	if got := nasStarts(); got != 2 {
		t.Errorf("nas started %d times after one removal and one add, want 2", got)
	}
}

