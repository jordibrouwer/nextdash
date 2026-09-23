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
	CPU    *CPUMetrics    `json:"cpu,omitempty"`
	Memory *MemoryMetrics `json:"memory,omitempty"`
	Disks  *DiskMetrics   `json:"disks,omitempty"`
	Docker *DockerMetrics `json:"docker,omitempty"`
}

// The shortest interval at which re-reading says anything new. A tile may beat
// faster than this; the cache simply hands it the same answer.
const metricsFloor = time.Second

// Free space does not move the way a processor does, and statfs on a
// spun-down array disk can block -- so this source is read less often
// however fast a tile asks.
const metricsDiskFloor = 5 * time.Second

// Two calls to the daemon per reading, and a container list does not change
// from one second to the next.
const metricsDockerFloor = 2 * time.Second

type cachedMetric struct {
	at    time.Time
	value any
}

/*
metricReading is one source being read right now.

Callers that arrive while it is in flight wait on done rather than starting a
second read of the same thing -- which is the property the old code got for
free by holding the mutex across the read, and the reason taking the read out
from under the mutex has to say so explicitly.
*/
type metricReading struct {
	done  chan struct{}
	value any
}

type systemMetricsCache struct {
	mu       sync.Mutex
	entries  map[string]cachedMetric
	inflight map[string]*metricReading
	sampler  *cpuSampler

	// Swappable so the cache can be exercised without touching the host.
	now          func() time.Time
	readMemoryFn func() MemoryMetrics
	readDisksFn  func([]string, map[string]string) DiskMetrics
	readDockerFn func() DockerMetrics
}

func newSystemMetricsCache() *systemMetricsCache {
	return &systemMetricsCache{
		entries:      map[string]cachedMetric{},
		inflight:     map[string]*metricReading{},
		sampler:      newCPUSampler(),
		now:          time.Now,
		readMemoryFn: readMemory,
		readDisksFn:  readDisks,
		readDockerFn: readDocker,
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

/*
metricsCacheMaxEntries is how many readings the cache will hold at once.

Three of the four sources have one key each. The disks reading has one per set
of mounts asked for, and that set arrives in the query string of a route with no
token in front of it -- so without a ceiling the map grew by one permanent entry
per distinct request, for as long as anyone cared to keep asking.

Generous against real use: a dashboard has a handful of disk tiles, and the
entry a tile wants is the one written most recently, which is the last thing
pruning takes.
*/
const metricsCacheMaxEntries = 32

// A reading older than this is of no use to anyone: every floor in this file is
// far shorter, so it can only ever be handed out as stale.
const metricsCacheStaleAfter = time.Minute

func (c *systemMetricsCache) store(key string, value any) {
	c.pruneLocked(key)
	c.entries[key] = cachedMetric{at: c.now(), value: value}
}

/*
pruneLocked makes room for one more entry. Called with the mutex held.

Stale first, because those answer nobody. If that is not enough, the oldest
goes: the cache's whole purpose is that several tiles asking the same question
inside one floor share a reading, and the least recently written entry is the
one least likely to be asked again inside its floor.
*/
func (c *systemMetricsCache) pruneLocked(incoming string) {
	if len(c.entries) < metricsCacheMaxEntries {
		return
	}
	if _, exists := c.entries[incoming]; exists {
		// Replacing one, not adding one.
		return
	}

	now := c.now()
	for key, entry := range c.entries {
		if now.Sub(entry.at) >= metricsCacheStaleAfter {
			delete(c.entries, key)
		}
	}

	for len(c.entries) >= metricsCacheMaxEntries {
		oldestKey := ""
		var oldestAt time.Time
		for key, entry := range c.entries {
			if oldestKey == "" || entry.at.Before(oldestAt) {
				oldestKey, oldestAt = key, entry.at
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.entries, oldestKey)
	}
}

/*
value answers for one source: from the cache when it is fresh, otherwise by
reading it -- once, however many callers are asking.

The read happens with the mutex released. It used to happen while Get held it
for its whole body, and what is behind these functions is a statfs per mount
(which can block on a spun-down array disk) and an HTTP round trip to the Docker
socket with a five second timeout. One request asking about a sleeping disk
therefore stalled every other request, including the ones that only wanted the
processor.

Letting go of the lock would ordinarily mean several callers reading the same
source at once, which is the one thing this cache exists to prevent -- so the
first caller claims the key and the rest wait on its answer.
*/
func (c *systemMetricsCache) value(key string, floor time.Duration, read func() any) any {
	c.mu.Lock()
	if cached, ok := c.fresh(key, floor); ok {
		c.mu.Unlock()
		return cached
	}
	if pending, ok := c.inflight[key]; ok {
		c.mu.Unlock()
		<-pending.done
		return pending.value
	}
	pending := &metricReading{done: make(chan struct{})}
	c.inflight[key] = pending
	c.mu.Unlock()

	value := read()

	c.mu.Lock()
	pending.value = value
	c.store(key, value)
	delete(c.inflight, key)
	c.mu.Unlock()
	// Closing after the write, so every waiter sees the value it waited for.
	close(pending.done)
	return value
}

// Get reads the named sources, sharing one reading per source per floor.
// A name that is not a source is ignored rather than refused: an unknown name
// is not an error, it is simply nothing to report.
func (c *systemMetricsCache) Get(want []string, mounts []string, labels map[string]string) SystemMetrics {
	out := SystemMetrics{}
	for _, source := range want {
		switch source {
		case "cpu":
			value := c.value("cpu", metricsFloor, func() any { return c.sampler.Read() }).(CPUMetrics)
			out.CPU = &value
		case "memory":
			value := c.value("memory", metricsFloor, func() any { return c.readMemoryFn() }).(MemoryMetrics)
			out.Memory = &value
		case "docker":
			value := c.value("docker", metricsDockerFloor, func() any { return c.readDockerFn() }).(DockerMetrics)
			out.Docker = &value
		case "disks":
			// Keyed by the mounts asked for: two tiles watching different
			// disks are two readings, not one answer serving both.
			key := "disks:" + strings.Join(mounts, ",")
			value := c.value(key, metricsDiskFloor, func() any { return c.readDisksFn(mounts, labels) }).(DiskMetrics)
			out.Disks = &value
		}
		// Anything else is ignored: an unknown name is not an error, it is
		// simply not a source.
	}
	return out
}
