package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// A reading is only a point once there is one before it: CPU is a share of
// the time between two readings, and one-shot stats carry no previous one.
func TestStatsHistoryNeedsTwoReadingsForAPoint(t *testing.T) {
	h := newDockerStatsHistory()
	now := time.Unix(1_800_000_000, 0)
	h.record("a", now, dockerStatsTotals{CPU: 1000, System: 10_000, Online: 2, MemUsed: 50})
	if got := h.points("a"); len(got) != 0 {
		t.Fatalf("first reading made %d points", len(got))
	}
	h.record("a", now.Add(30*time.Second), dockerStatsTotals{CPU: 1500, System: 20_000, Online: 2, MemUsed: 60})
	got := h.points("a")
	if len(got) != 1 {
		t.Fatalf("got %d points, want 1", len(got))
	}
	// 500 of 10000 system ticks, on two cores: 10 %.
	if got[0].CPU != 10 || got[0].Mem != 60 || got[0].T != now.Add(30*time.Second).UnixMilli() {
		t.Errorf("point = %+v", got[0])
	}
}

// An hour, and no more: older points fall off as new ones arrive.
func TestStatsHistoryKeepsTheLastHour(t *testing.T) {
	h := newDockerStatsHistory()
	start := time.Unix(1_800_000_000, 0)
	for i := 0; i <= 150; i++ {
		h.record("a", start.Add(time.Duration(i)*30*time.Second),
			dockerStatsTotals{CPU: uint64(i * 100), System: uint64(i * 1000), Online: 1, MemUsed: uint64(i)})
	}
	got := h.points("a")
	last := start.Add(150 * 30 * time.Second)
	if len(got) == 0 || got[len(got)-1].T != last.UnixMilli() {
		t.Fatalf("newest point missing: %+v", got[len(got)-1])
	}
	if first := time.UnixMilli(got[0].T); last.Sub(first) > time.Hour {
		t.Errorf("kept %v of history", last.Sub(first))
	}
	if len(got) > dockerStatsHistoryMaxPoints {
		t.Errorf("kept %d points", len(got))
	}
}

// A container that stopped, or went, stops having a history.
func TestStatsHistoryForgetsWhatIsNoLongerRunning(t *testing.T) {
	h := newDockerStatsHistory()
	now := time.Unix(1_800_000_000, 0)
	for _, id := range []string{"a", "b"} {
		h.record(id, now, dockerStatsTotals{CPU: 1, System: 10, Online: 1})
		h.record(id, now.Add(time.Minute), dockerStatsTotals{CPU: 2, System: 20, Online: 1})
	}
	h.keepOnly(map[string]bool{"a": true})
	if len(h.points("a")) != 1 || len(h.points("b")) != 0 {
		t.Errorf("a=%d b=%d", len(h.points("a")), len(h.points("b")))
	}
}

type fakeStatsSource struct {
	list     []dockerContainerSummary
	inFlight atomic.Int32
	peak     atomic.Int32
	mu       sync.Mutex
	asked    []string
}

func (f *fakeStatsSource) listContainers(context.Context) ([]dockerContainerSummary, error) {
	return f.list, nil
}

func (f *fakeStatsSource) statsTotals(_ context.Context, id string) (dockerStatsTotals, error) {
	n := f.inFlight.Add(1)
	for {
		p := f.peak.Load()
		if n <= p || f.peak.CompareAndSwap(p, n) {
			break
		}
	}
	time.Sleep(5 * time.Millisecond)
	f.inFlight.Add(-1)
	f.mu.Lock()
	f.asked = append(f.asked, id)
	f.mu.Unlock()
	return dockerStatsTotals{CPU: 1, System: 1, Online: 1}, nil
}

// Every running container is read, never more than four at once, and a
// stopped one is not read at all.
func TestSampleReadsEveryRunningContainerFourAtATime(t *testing.T) {
	src := &fakeStatsSource{}
	for i := 0; i < 20; i++ {
		src.list = append(src.list, dockerContainerSummary{ID: string(rune('a' + i)), State: "running"})
	}
	src.list = append(src.list, dockerContainerSummary{ID: "stopped", State: "exited"})
	sampleDockerStats(context.Background(), src, newDockerStatsHistory(), time.Now())
	if len(src.asked) != 20 {
		t.Errorf("read %d containers, want 20", len(src.asked))
	}
	for _, id := range src.asked {
		if id == "stopped" {
			t.Error("a stopped container was read")
		}
	}
	if p := src.peak.Load(); p > dockerStatsConcurrency {
		t.Errorf("%d reads at once", p)
	}
}

// The whole path: the sampler reads the fake daemon with one-shot stats, and
// the stats route hands back what it kept -- or says the setting is off.
func TestStatsRouteReturnsTheSampledHour(t *testing.T) {
	f := startFakeDocker(t)
	id := strings.Repeat("e", 64)
	f.add(fakeContainer{ID: id, Name: "web", State: "running", Status: "Up 2 hours"})
	h := dockerTestHandlers(t)
	dockerStatsStore.reset()
	t.Cleanup(dockerStatsStore.reset)

	h.sampleDockerStatsOnce()
	h.sampleDockerStatsOnce()
	if !f.called("GET /containers/" + id + "/stats?stream=false&one-shot=true") {
		t.Fatalf("no one-shot read; calls: %v", f.calls)
	}

	get := func() map[string]any {
		rec := httptest.NewRecorder()
		newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers/web/stats?history=1", nil))
		var body map[string]any
		_ = json.NewDecoder(rec.Body).Decode(&body)
		return body
	}
	body := get()
	if body["historyEnabled"] != true || len(body["history"].([]any)) != 1 {
		t.Fatalf("body = %v", body)
	}

	settings := h.store.GetSettings()
	settings.DockerStatsHistory = false
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	h.sampleDockerStatsOnce()
	body = get()
	if body["historyEnabled"] != false || len(body["history"].([]any)) != 0 {
		t.Fatalf("switched off, body = %v", body)
	}
}

// The list hands each running container its latest sampled CPU and memory, so
// the table can show them without a stats call per row; a stopped container
// has none, and with the sampler off the list says so and carries none.
func TestContainerListCarriesLatestUsage(t *testing.T) {
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("e", 64), Name: "web", State: "running", Status: "Up 2 hours"})
	f.add(fakeContainer{ID: strings.Repeat("f", 64), Name: "off", State: "exited", Status: "Exited (0) 1 hour ago"})
	h := dockerTestHandlers(t)
	dockerStatsStore.reset()
	t.Cleanup(dockerStatsStore.reset)
	h.sampleDockerStatsOnce()
	h.sampleDockerStatsOnce()

	list := func() (bool, map[string]dockerViewContainer) {
		rec := httptest.NewRecorder()
		newDockerTestRouter(h).ServeHTTP(rec, httptest.NewRequest("GET", "/api/docker/containers", nil))
		var body struct {
			UsageEnabled bool                  `json:"usageEnabled"`
			Containers   []dockerViewContainer `json:"containers"`
		}
		_ = json.NewDecoder(rec.Body).Decode(&body)
		byName := map[string]dockerViewContainer{}
		for _, c := range body.Containers {
			byName[c.Name] = c
		}
		return body.UsageEnabled, byName
	}
	enabled, got := list()
	if !enabled || got["web"].Usage == nil || got["web"].Usage.Mem == 0 || got["off"].Usage != nil {
		t.Fatalf("enabled = %v, web = %+v, off = %+v", enabled, got["web"].Usage, got["off"].Usage)
	}

	settings := h.store.GetSettings()
	settings.DockerStatsHistory = false
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	h.sampleDockerStatsOnce()
	enabled, got = list()
	if enabled || got["web"].Usage != nil {
		t.Fatalf("switched off: enabled = %v, web = %+v", enabled, got["web"].Usage)
	}
}

// Network and disk become bytes a second between two readings; a counter that
// went down (the container restarted) is no traffic, not a negative rate.
func TestDockerStatsHistoryRates(t *testing.T) {
	h := newDockerStatsHistory()
	now := time.Now()
	h.record("a", now, dockerStatsTotals{NetRx: 1000, NetTx: 500, DiskRead: 0, DiskWrite: 3000})
	h.record("a", now.Add(10*time.Second), dockerStatsTotals{NetRx: 11_000, NetTx: 1500, DiskRead: 2000, DiskWrite: 1000})
	got := h.points("a")
	if len(got) != 1 {
		t.Fatalf("points = %+v", got)
	}
	p := got[0]
	if p.NetIn != 1000 || p.NetOut != 100 || p.DiskRead != 200 || p.DiskWrite != 0 {
		t.Fatalf("rates = %+v", p)
	}
}

// The daemon's figures: every interface, and both spellings of the ops.
func TestDockerStatsRawIOTotals(t *testing.T) {
	var raw dockerStatsRaw
	if err := json.Unmarshal([]byte(`{"networks":{"eth0":{"rx_bytes":10,"tx_bytes":1},"eth1":{"rx_bytes":5,"tx_bytes":2}},
		"blkio_stats":{"io_service_bytes_recursive":[{"op":"Read","value":7},{"op":"write","value":9},{"op":"Total","value":16}]}}`), &raw); err != nil {
		t.Fatal(err)
	}
	if rx, tx := raw.netTotals(); rx != 15 || tx != 3 {
		t.Fatalf("net = %d %d", rx, tx)
	}
	if r, w := raw.diskTotals(); r != 7 || w != 9 {
		t.Fatalf("disk = %d %d", r, w)
	}
}
