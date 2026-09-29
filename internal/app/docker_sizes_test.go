package app

import (
	"testing"
	"time"
)

// Never measured: no size, and a measurement starts. Measured recently: the
// size, and none starts. Stale: the old size, and a new one starts once.
func TestDockerSizeOfMeasuresInTheBackground(t *testing.T) {
	measured := 0
	dockerSizesRefresh = func() { measured++ }
	t.Cleanup(func() { dockerSizesRefresh = startDockerSizesRefresh })
	resetDockerSizesCache()
	t.Cleanup(resetDockerSizesCache)
	now := time.Now()

	if got := dockerSizeOf("id-a", now); got != nil || measured != 1 {
		t.Fatalf("never measured: size %v, measured %d times", got, measured)
	}
	// A second read while that measurement runs does not start another.
	_ = dockerSizeOf("id-a", now)
	if measured != 1 {
		t.Fatalf("measured %d times while one was running", measured)
	}

	rememberDockerSizes(map[string]dockerContainerSize{"id-a": {RW: 12 << 20, RootFs: 540 << 20}}, now.Add(-time.Minute))
	got := dockerSizeOf("id-a", now)
	if got == nil || got.RW != 12<<20 || got.RootFs != 540<<20 || measured != 1 {
		t.Fatalf("fresh: size %v, measured %d times", got, measured)
	}
	if dockerSizeOf("id-unknown", now) != nil {
		t.Fatal("a container not in the measurement has no size")
	}

	rememberDockerSizes(map[string]dockerContainerSize{"id-a": {RW: 1, RootFs: 2}}, now.Add(-dockerSizesStale-time.Minute))
	got = dockerSizeOf("id-a", now)
	if got == nil || got.RW != 1 || measured != 2 {
		t.Fatalf("stale: size %v, measured %d times", got, measured)
	}
}
