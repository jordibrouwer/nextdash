package app

import (
	"context"
	"net/http"
	"strconv"
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

// The machine's own series have a limit, and one silent for a day makes room:
// a disk renamed at a reboot does not keep a new disk from being recorded.
func TestGlancesSilentMachineSeriesMakeRoom(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t0 := time.Now().Add(-48 * time.Hour).UnixMilli()
	full := func(id string) *glancesHost {
		hs := newGlancesHost(id)
		readings := map[string]float64{}
		for i := 0; i < glancesMaxSeries; i++ {
			readings["disk:sd"+strconv.Itoa(i)+":read"] = 1
		}
		hs.record(t0, readings)
		return hs
	}

	soon := full("soon")
	soon.record(t0+3600*1000, map[string]float64{"disk:new:read": 1})
	if len(soon.seriesNames()) != glancesMaxSeries || containsName(soon.seriesNames(), "disk:new:read") {
		t.Errorf("an hour of silence made room: %d series", len(soon.seriesNames()))
	}

	later := full("later")
	later.record(t0+25*3600*1000, map[string]float64{"disk:new:read": 1})
	if !containsName(later.seriesNames(), "disk:new:read") {
		t.Error("a new disk got no series while silent ones held every place")
	}
	if len(later.seriesNames()) != glancesMaxSeries {
		t.Errorf("%d series, want the limit", len(later.seriesNames()))
	}
}

func containsName(names []string, want string) bool {
	for _, name := range names {
		if name == want {
			return true
		}
	}
	return false
}

// A machine with more processors than get a series is weighed by all of them.
func TestGlancesLoadCountsEveryCore(t *testing.T) {
	h, _, _ := glancesViewSetup(t)
	glancesWipe()
	mainHost().cores.Store(0)
	h.glancesSampleOnce(context.Background())
	if got := mainHost().cores.Load(); got != 12 {
		t.Errorf("cores after a beat: %d, want the 12 the host reports", got)
	}

	now := time.Now()
	snaps := map[string]glancesSnap{}
	for i := 0; i < glancesMaxCores; i++ {
		snaps["core:"+strconv.Itoa(i)] = glancesSnap{}
	}
	var load []glancesPoint
	for i := 0; i < 10; i++ {
		load = append(load, glancesPoint{float64(now.Add(-time.Duration(10-i) * time.Hour).UnixMilli()), 40})
	}
	snaps["load1"] = glancesSnap{Coarse: load}
	info := glancesComputeLoad(snaps, now.Add(-24*time.Hour).UnixMilli(), now, 64)
	if info == nil || info.Cores != 64 || info.OverShare != 0 {
		t.Errorf("a load of 40 on 64 processors: %+v", info)
	}
	if info := glancesComputeLoad(snaps, now.Add(-24*time.Hour).UnixMilli(), now, 0); info == nil || info.Cores != glancesMaxCores {
		t.Errorf("without a count the series are counted: %+v", info)
	}
}

