package app

import (
	"context"
	"sync"
	"time"
)

/*
Container sizes: what each container wrote (its writable layer) and what it
takes together with its image, the two figures `docker ps -s` shows.

The daemon works them out by walking every container's layer, which on a big
host takes seconds, so the list route never asks for them itself. The last
measurement is kept by container id and rides along with the list and the
detail; one older than dockerSizesStale starts a new one in the background,
and the rows show the old figures meanwhile, or none before the first. The
Disk tab's /system/df read carries the same figures and refreshes them too.
*/
const (
	dockerSizesStale   = 30 * time.Minute
	dockerSizesTimeout = 60 * time.Second
	// dockerSizesRetry is the wait after a measurement starts before another
	// may. A failed one left the cache as stale as before, and every list poll
	// (every few seconds, and per row) started the next: on the slow hosts
	// where it times out, the daemon was walking every layer without a pause.
	dockerSizesRetry = 5 * time.Minute
)

type dockerContainerSize struct {
	// RW is what the container wrote on top of its image.
	RW int64 `json:"rw"`
	// RootFs is RW plus the image, the "virtual" size.
	RootFs int64 `json:"rootFs"`
}

var dockerSizesCache struct {
	mu        sync.Mutex
	byID      map[string]dockerContainerSize
	at        time.Time
	tried     time.Time
	measuring bool
}

func rememberDockerSizes(byID map[string]dockerContainerSize, at time.Time) {
	dockerSizesCache.mu.Lock()
	defer dockerSizesCache.mu.Unlock()
	dockerSizesCache.byID = byID
	dockerSizesCache.at = at
	dockerSizesCache.measuring = false
}

func resetDockerSizesCache() {
	dockerSizesCache.mu.Lock()
	defer dockerSizesCache.mu.Unlock()
	dockerSizesCache.byID = nil
	dockerSizesCache.at = time.Time{}
	dockerSizesCache.tried = time.Time{}
	dockerSizesCache.measuring = false
}

// dockerSizesRefresh starts a background measurement; a variable so a test
// can see it asked for without a daemon doing the work.
var dockerSizesRefresh = startDockerSizesRefresh

func startDockerSizesRefresh() {
	go func() {
		defer func() {
			dockerSizesCache.mu.Lock()
			dockerSizesCache.measuring = false
			dockerSizesCache.mu.Unlock()
		}()
		api, _ := newDockerAPI()
		if api == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), dockerSizesTimeout)
		defer cancel()
		if err := measureDockerSizes(ctx, api); err != nil {
			logWarn(logComponentMutate, "the container sizes could not be measured: %v", err)
		}
	}()
}

func measureDockerSizes(ctx context.Context, api *dockerAPI) error {
	var list []struct {
		ID         string `json:"Id"`
		SizeRw     int64  `json:"SizeRw"`
		SizeRootFs int64  `json:"SizeRootFs"`
	}
	// The action client: its timeout is for work that takes a while, and the
	// list client's would cut this off on exactly the hosts that need it.
	if err := api.forActions().getJSON(ctx, "/containers/json?all=1&size=1", &list); err != nil {
		return err
	}
	byID := make(map[string]dockerContainerSize, len(list))
	for _, c := range list {
		byID[c.ID] = dockerContainerSize{RW: c.SizeRw, RootFs: c.SizeRootFs}
	}
	rememberDockerSizes(byID, time.Now())
	return nil
}

// dockerSizeOf is a container's last measured size, nil before its first,
// starting a new measurement when the last one is stale.
func dockerSizeOf(id string, now time.Time) *dockerContainerSize {
	dockerSizesCache.mu.Lock()
	defer dockerSizesCache.mu.Unlock()
	due := dockerSizesCache.byID == nil || now.Sub(dockerSizesCache.at) > dockerSizesStale
	if due && !dockerSizesCache.measuring && now.Sub(dockerSizesCache.tried) >= dockerSizesRetry {
		dockerSizesCache.measuring = true
		dockerSizesCache.tried = now
		dockerSizesRefresh()
	}
	size, ok := dockerSizesCache.byID[id]
	if !ok {
		return nil
	}
	return &size
}
