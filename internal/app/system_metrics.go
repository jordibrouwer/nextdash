package app

import (
	"strings"
	"sync"
	"time"
)

/*
One endpoint for the system sources.

Widgets polling separately would be one request per tile per beat and one copy
of the availability logic each. One endpoint answers with only what was asked
for, and one cache underneath means several tiles on the same source share a
read rather than multiplying it.

Built for the four sources the design names; the CPU is the first of them.
*/

// SystemMetrics is the endpoint's answer. Every field is omitted unless it was
// asked for, so a tile that wants the processor does not make the server read
// anything else.
type SystemMetrics struct {
	CPU   *CPUMetrics  `json:"cpu,omitempty"`
	Disks *DiskMetrics `json:"disks,omitempty"`
}

// The shortest interval at which re-reading says anything new. A tile may beat
// faster than this; the cache simply hands it the same answer.
const metricsFloor = time.Second

// Free space does not move the way a processor does, and statfs on a
// spun-down array disk can block -- so this source is read less often
// however fast a tile asks.
const metricsDiskFloor = 5 * time.Second

type cachedMetric struct {
	at    time.Time
	value any
}

type systemMetricsCache struct {
	mu      sync.Mutex
	entries map[string]cachedMetric
	sampler *cpuSampler

	// Swappable so the cache can be exercised without touching the host.
	now         func() time.Time
	readDisksFn func([]string, map[string]string) DiskMetrics
}

func newSystemMetricsCache() *systemMetricsCache {
	return &systemMetricsCache{
		entries:     map[string]cachedMetric{},
		sampler:     newCPUSampler(),
		now:         time.Now,
		readDisksFn: readDisks,
	}
}

var systemCache = newSystemMetricsCache()

func (c *systemMetricsCache) fresh(key string, floor time.Duration) (any, bool) {
	entry, ok := c.entries[key]
	if !ok || c.now().Sub(entry.at) >= floor {
		return nil, false
	}
	return entry.value, true
}

func (c *systemMetricsCache) store(key string, value any) {
	c.entries[key] = cachedMetric{at: c.now(), value: value}
}

// Get reads the named sources, sharing one reading per source per floor.
// A name that is not a source is ignored rather than refused: an unknown name
// is not an error, it is simply nothing to report.
func (c *systemMetricsCache) Get(want []string, mounts []string, labels map[string]string) SystemMetrics {
	c.mu.Lock()
	defer c.mu.Unlock()

	out := SystemMetrics{}
	for _, source := range want {
		switch source {
		case "cpu":
			if v, ok := c.fresh("cpu", metricsFloor); ok {
				value := v.(CPUMetrics)
				out.CPU = &value
				continue
			}
			value := c.sampler.Read()
			c.store("cpu", value)
			out.CPU = &value
		case "disks":
			// Keyed by the mounts asked for: two tiles watching different
			// disks are two readings, not one answer serving both.
			key := "disks:" + strings.Join(mounts, ",")
			if v, ok := c.fresh(key, metricsDiskFloor); ok {
				value := v.(DiskMetrics)
				out.Disks = &value
				continue
			}
			value := c.readDisksFn(mounts, labels)
			c.store(key, value)
			out.Disks = &value
		}
		// Anything else is ignored: an unknown name is not an error, it is
		// simply not a source.
	}
	return out
}
