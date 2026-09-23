package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// newProbeCache is a metrics cache that never touches the host and whose clock
// the test moves by hand.
func newProbeCache(clock *time.Time) *systemMetricsCache {
	c := newSystemMetricsCache()
	c.now = func() time.Time { return *clock }
	c.readMemoryFn = func() MemoryMetrics { return MemoryMetrics{} }
	c.readDockerFn = func() DockerMetrics { return DockerMetrics{} }
	c.readDisksFn = func(mounts []string, _ map[string]string) DiskMetrics {
		return DiskMetrics{Readable: len(mounts)}
	}
	return c
}

/*
The disks reading is cached per set of mounts, and the set comes from the query
string -- so the key is chosen by whoever is asking.

Nothing evicted, and the route carries no token, so a loop over
?want=disks&mounts=<random> added one permanent map entry per request until the
process ran out of memory. The cache is a cache; it is allowed to forget.
*/
func TestDisksCacheDoesNotGrowWithoutBound(t *testing.T) {
	clock := time.Now()
	c := newProbeCache(&clock)

	for i := 0; i < metricsCacheMaxEntries*20; i++ {
		c.Get([]string{"disks"}, []string{fmt.Sprintf("/mnt/probe-%d", i)}, nil)
		// Each asked for a moment later, the way a flood of requests arrives.
		clock = clock.Add(time.Millisecond)
	}

	c.mu.Lock()
	size := len(c.entries)
	c.mu.Unlock()
	if size > metricsCacheMaxEntries {
		t.Errorf("cache holds %d entries after %d distinct requests, cap is %d",
			size, metricsCacheMaxEntries*20, metricsCacheMaxEntries)
	}
}

// Forgetting must not cost the tiles their shared reading: what a dashboard
// actually asks for -- the same few mounts, several times inside the floor --
// is still answered once.
func TestDisksCacheStillSharesOneReadingWithinTheFloor(t *testing.T) {
	clock := time.Now()
	c := newProbeCache(&clock)
	reads := 0
	c.readDisksFn = func(mounts []string, _ map[string]string) DiskMetrics {
		reads++
		return DiskMetrics{Readable: len(mounts)}
	}

	for i := 0; i < 5; i++ {
		c.Get([]string{"disks"}, []string{"/mnt/user", "/mnt/cache"}, nil)
	}
	if reads != 1 {
		t.Errorf("read the disks %d times inside one floor, want 1", reads)
	}

	clock = clock.Add(metricsDiskFloor + time.Second)
	c.Get([]string{"disks"}, []string{"/mnt/user", "/mnt/cache"}, nil)
	if reads != 2 {
		t.Errorf("read the disks %d times across the floor, want 2", reads)
	}
}

/*
One request cannot ask for a thousand disks either.

The mounts are statfs calls made while the cache holds its lock, so a long list
is both a stall for every other caller and the thing that fills the cache
fastest. A dashboard asks about the disks a machine has.
*/
func TestSystemMetricsHandlerCapsTheMountsItAccepts(t *testing.T) {
	h := &Handlers{}
	asked := 0
	original := systemCache
	clock := time.Now()
	systemCache = newProbeCache(&clock)
	systemCache.readDisksFn = func(mounts []string, _ map[string]string) DiskMetrics {
		asked = len(mounts)
		return DiskMetrics{Readable: len(mounts)}
	}
	t.Cleanup(func() { systemCache = original })

	query := "/api/system/metrics?want=disks&mounts="
	for i := 0; i < systemMetricsMaxMounts*4; i++ {
		if i > 0 {
			query += ","
		}
		query += fmt.Sprintf("/mnt/probe-%d", i)
	}

	rec := httptest.NewRecorder()
	h.SystemMetricsHandler(rec, httptest.NewRequest(http.MethodGet, query, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if asked > systemMetricsMaxMounts {
		t.Errorf("read %d mounts from one request, cap is %d", asked, systemMetricsMaxMounts)
	}
}

/*
One slow source must not stop every other reading.

Get held the cache mutex for its whole body, and then called out through it: a
statfs per mount, which the file's own comment says can block on a spun-down
array disk, and an HTTP round trip to the Docker socket with a five second
timeout. So one request asking about a sleeping disk stalled every other
request, including the ones that only wanted the processor.
*/
func TestASlowSourceDoesNotBlockTheOthers(t *testing.T) {
	clock := time.Now()
	c := newProbeCache(&clock)

	reading := make(chan struct{})
	release := make(chan struct{})
	c.readDisksFn = func(mounts []string, _ map[string]string) DiskMetrics {
		close(reading)
		<-release
		return DiskMetrics{Readable: len(mounts)}
	}

	go c.Get([]string{"disks"}, []string{"/mnt/slow"}, nil)
	<-reading // the disk read has begun and is going nowhere

	answered := make(chan SystemMetrics, 1)
	go func() { answered <- c.Get([]string{"cpu"}, nil, nil) }()

	select {
	case <-answered:
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("asking for the processor waited on a disk that had not answered")
	}
	close(release)
}

/*
And two callers asking the same question at the same moment still pay for one
reading between them.

That is what the cache is for, and it is the property the lock used to provide
for free. Taking the lock off the read has to keep it deliberately.
*/
func TestConcurrentAsksForOneSourceShareOneReading(t *testing.T) {
	clock := time.Now()
	c := newProbeCache(&clock)

	var reads int32
	reading := make(chan struct{})
	release := make(chan struct{})
	c.readDisksFn = func(mounts []string, _ map[string]string) DiskMetrics {
		if atomic.AddInt32(&reads, 1) == 1 {
			close(reading)
		}
		<-release
		return DiskMetrics{Readable: len(mounts)}
	}

	const askers = 8
	var wg sync.WaitGroup
	for i := 0; i < askers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out := c.Get([]string{"disks"}, []string{"/mnt/user"}, nil)
			if out.Disks == nil {
				t.Error("a caller waiting on someone else's reading got nothing")
			}
		}()
	}

	<-reading
	// Everyone else has had time to arrive and find the read already running.
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()

	if got := atomic.LoadInt32(&reads); got != 1 {
		t.Errorf("%d callers caused %d readings, want 1", askers, got)
	}
}
