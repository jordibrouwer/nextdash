package app

import (
	"context"
	"net/url"
	"sync"
	"time"
)

/*
The last hour of CPU and memory per running container, for the two charts on
the drawer's Resources tab.

Docker keeps no history of its own, so nextDash reads every running container
on a tick and keeps what it read in memory: an hour, then it falls off, and a
restart starts over. Nothing is written to disk -- a chart of the last hour has
no use for a reading from yesterday.

Each read asks for one-shot stats. Without it Docker holds the request for a
second to take a second reading of its own and work out the CPU share; with
it the answer is immediate, and the share is worked out here from the previous
reading, which this store keeps anyway. Four at a time is not a cap on how many
are read -- all of them are -- but on how hard the daemon is asked at once.

Config -> Containers can switch it off; then nothing is read and nothing kept.
*/

const (
	dockerStatsInterval         = 30 * time.Second
	dockerStatsConcurrency      = 4
	dockerStatsHistoryWindow    = time.Hour
	dockerStatsHistoryMaxPoints = 120
)

// dockerStatsTotals is one raw reading: running totals, not rates.
type dockerStatsTotals struct {
	CPU, System       uint64
	Online            int
	MemUsed, MemLimit uint64
}

type dockerStatsPoint struct {
	T   int64   `json:"t"` // unix milliseconds
	CPU float64 `json:"cpu"`
	Mem uint64  `json:"mem"`
}

// dockerStatsStore is the one history, shared by the sampler and the stats route.
var dockerStatsStore = newDockerStatsHistory()

type dockerStatsHistory struct {
	mu     sync.Mutex
	series map[string][]dockerStatsPoint
	prev   map[string]dockerStatsTotals
}

func newDockerStatsHistory() *dockerStatsHistory {
	return &dockerStatsHistory{series: map[string][]dockerStatsPoint{}, prev: map[string]dockerStatsTotals{}}
}

func (h *dockerStatsHistory) record(id string, now time.Time, t dockerStatsTotals) {
	h.mu.Lock()
	defer h.mu.Unlock()
	prev, had := h.prev[id]
	h.prev[id] = t
	if !had {
		return
	}
	point := dockerStatsPoint{T: now.UnixMilli(), Mem: t.MemUsed}
	cpuDelta := float64(t.CPU) - float64(prev.CPU)
	sysDelta := float64(t.System) - float64(prev.System)
	if cpuDelta > 0 && sysDelta > 0 {
		online := t.Online
		if online == 0 {
			online = 1
		}
		point.CPU = cpuDelta / sysDelta * float64(online) * 100
	}
	series := append(h.series[id], point)
	cutoff := now.Add(-dockerStatsHistoryWindow).UnixMilli()
	drop := 0
	for drop < len(series) && series[drop].T < cutoff {
		drop++
	}
	if len(series)-drop > dockerStatsHistoryMaxPoints {
		drop = len(series) - dockerStatsHistoryMaxPoints
	}
	h.series[id] = append([]dockerStatsPoint(nil), series[drop:]...)
}

func (h *dockerStatsHistory) points(id string) []dockerStatsPoint {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]dockerStatsPoint{}, h.series[id]...)
}

// keepOnly forgets every container not in ids: stopped, removed or recreated.
func (h *dockerStatsHistory) keepOnly(ids map[string]bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id := range h.prev {
		if !ids[id] {
			delete(h.prev, id)
			delete(h.series, id)
		}
	}
}

func (h *dockerStatsHistory) reset() {
	h.keepOnly(nil)
}

type dockerStatsSource interface {
	listContainers(ctx context.Context) ([]dockerContainerSummary, error)
	statsTotals(ctx context.Context, id string) (dockerStatsTotals, error)
}

// sampleDockerStats reads every running container once, four at a time.
func sampleDockerStats(ctx context.Context, src dockerStatsSource, hist *dockerStatsHistory, now time.Time) {
	list, err := src.listContainers(ctx)
	if err != nil {
		return
	}
	running := map[string]bool{}
	for _, c := range list {
		if c.State == "running" {
			running[c.ID] = true
		}
	}
	hist.keepOnly(running)
	sem := make(chan struct{}, dockerStatsConcurrency)
	var wg sync.WaitGroup
	for id := range running {
		wg.Add(1)
		sem <- struct{}{}
		go func(id string) {
			defer wg.Done()
			defer func() { <-sem }()
			totals, err := src.statsTotals(ctx, id)
			if err == nil {
				hist.record(id, now, totals)
			}
		}(id)
	}
	wg.Wait()
}

// statsTotals asks for one reading without Docker's own second one.
func (d *dockerAPI) statsTotals(ctx context.Context, id string) (dockerStatsTotals, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var raw dockerStatsRaw
	if err := d.getJSON(ctx, "/containers/"+url.PathEscape(id)+"/stats?stream=false&one-shot=true", &raw); err != nil {
		return dockerStatsTotals{}, err
	}
	return dockerStatsTotals{
		CPU: raw.CPU.Usage.Total, System: raw.CPU.System, Online: raw.CPU.Online,
		MemUsed: raw.memoryUsed(), MemLimit: raw.Mem.Limit,
	}, nil
}

// StartDockerStatsSampler reads on a tick and lets the setting decide, so
// switching it needs no restart. A sweep that runs long delays the next tick
// rather than overlapping it: the ticker drops what it cannot deliver.
func (h *Handlers) StartDockerStatsSampler(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(dockerStatsInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				h.sampleDockerStatsOnce()
			}
		}
	}()
}

func (h *Handlers) sampleDockerStatsOnce() {
	if !h.store.GetSettings().DockerStatsHistory {
		dockerStatsStore.reset()
		return
	}
	api, _ := newDockerAPI()
	if api == nil {
		dockerStatsStore.reset()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), dockerStatsInterval)
	defer cancel()
	sampleDockerStats(ctx, api, dockerStatsStore, time.Now())
}
