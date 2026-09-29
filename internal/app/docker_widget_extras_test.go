package app

import (
	"strings"
	"testing"
	"time"
)

// The Containers tile's newer figures: updates as the reader sees them (a
// skipped or held one does not count), what Disk last found reclaimable, the
// incidents of the last day, and the three busiest containers by CPU.
func TestDockerMetricsExtras(t *testing.T) {
	startFakeDocker(t)
	dockerTestHandlers(t)
	now := time.Now()

	seedDockerUpdates(t, dockerUpdateStore{
		Images: map[string]*dockerImageUpdate{
			"a:1": {Status: "available", RemoteDigest: "r1"},
			"b:1": {Status: "available", RemoteDigest: "r2"},
			"c:1": {Status: "available", RemoteDigest: "r3"},
		},
		Skipped: map[string]string{"b:1": "r2"},
		Held:    map[string]bool{"c:1": true},
	})

	dockerTimelines = newDockerTimeline()
	t.Cleanup(func() { dockerTimelines = newDockerTimeline() })
	dockerTimelines.add("web", dockerTimelineEntry{At: now.Add(-2 * time.Hour).UnixMilli(), Kind: "crash"})
	dockerTimelines.add("web", dockerTimelineEntry{At: now.Add(-time.Hour).UnixMilli(), Kind: "unhealthy"})
	dockerTimelines.add("web", dockerTimelineEntry{At: now.Add(-time.Hour).UnixMilli(), Kind: "start"})
	dockerTimelines.add("db", dockerTimelineEntry{At: now.Add(-30 * time.Hour).UnixMilli(), Kind: "crash"})

	dockerStatsStore.reset()
	t.Cleanup(dockerStatsStore.reset)
	for i, id := range []string{"id-a", "id-b", "id-c", "id-d"} {
		dockerStatsStore.mu.Lock()
		dockerStatsStore.series[id] = []dockerStatsPoint{{T: now.UnixMilli(), CPU: float64(10 * (i + 1)), Mem: 1}}
		dockerStatsStore.mu.Unlock()
	}

	measured := 0
	dockerDiskRefresh = func() { measured++ }
	t.Cleanup(func() { dockerDiskRefresh = startDockerDiskRefresh })
	resetDockerDiskCache()
	t.Cleanup(resetDockerDiskCache)

	running := []dockerRunningRef{{ID: "id-a", Name: "alpha"}, {ID: "id-b", Name: "bravo"}, {ID: "id-c", Name: "charlie"}, {ID: "id-d", Name: "delta"}}
	// Counted per container, as the view counts: a:1's update counts, b:1's
	// is skipped and c:1's held; d:1 is current as a tag, but "delta" still
	// runs the image before it -- pulled, not recreated -- and counts.
	var m DockerMetrics
	m.containers = []dockerContainerSummary{
		{ID: "id-a", Names: []string{"/alpha"}, Image: "a:1", ImageID: "sha256:a"},
		{ID: "id-b", Names: []string{"/bravo"}, Image: "b:1", ImageID: "sha256:b"},
		{ID: "id-c", Names: []string{"/charlie"}, Image: "c:1", ImageID: "sha256:c"},
		{ID: "id-d", Names: []string{"/delta"}, Image: "d:1", ImageID: "sha256:d-old"},
	}
	m.tagIDs = map[string]string{dockerTagKey("a:1"): "sha256:a", dockerTagKey("d:1"): "sha256:d-new"}
	fillDockerExtras(&m, running, now)
	if m.Updates != 2 {
		t.Fatalf("updates = %d, want 2 (alpha, and delta left behind by its tag; skipped and held do not count)", m.Updates)
	}
	if m.Incidents24h != 2 {
		t.Fatalf("incidents = %d, want 2", m.Incidents24h)
	}
	var top []string
	for _, c := range m.TopCPU {
		top = append(top, c.Name)
	}
	if strings.Join(top, ",") != "delta,charlie,bravo" {
		t.Fatalf("top cpu = %v", m.TopCPU)
	}
	if m.Reclaimable != -1 || measured != 1 {
		t.Fatalf("never measured: reclaimable = %d, measured %d times", m.Reclaimable, measured)
	}

	// Measured an hour ago: shown, and not measured again.
	rememberDockerDisk(dockerDiskTotals{Reclaimable: 5 << 20}, now.Add(-time.Hour))
	m = DockerMetrics{}
	fillDockerExtras(&m, running, now)
	if m.Reclaimable != 5<<20 || m.ReclaimableAt == 0 || measured != 1 {
		t.Fatalf("fresh: reclaimable = %d at %d, measured %d", m.Reclaimable, m.ReclaimableAt, measured)
	}
	// Seven hours old: still shown, and a new measurement is started.
	rememberDockerDisk(dockerDiskTotals{Reclaimable: 7 << 20}, now.Add(-7*time.Hour))
	m = DockerMetrics{}
	fillDockerExtras(&m, running, now)
	if m.Reclaimable != 7<<20 || measured != 2 {
		t.Fatalf("stale: reclaimable = %d, measured %d", m.Reclaimable, measured)
	}
}
