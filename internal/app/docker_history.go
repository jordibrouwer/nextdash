package app

import (
	"net/http"
	"sort"
	"time"
)

/*
The fleet's last thirty days in one read, for Config -> Statistics -> Server.

Nothing new is stored: the events are the timeline the drawer already shows per
container (docker-events.json, thirty days), the updates are the update history
(docker-update-history.json), and the disk figures are the last measurement the
Containers tile keeps. The drawer asks per container; the statistics want every
container at once, and asking the drawer's route once per container would cost
a daemon lookup each for nothing it needs.
*/

type dockerHistoryEvent struct {
	Container string `json:"container"`
	dockerTimelineEntry
}

type dockerHistoryResponse struct {
	Events  []dockerHistoryEvent       `json:"events"`
	Updates []dockerUpdateHistoryEntry `json:"updates"`
	// Disk is the last measurement, or nil before the first; DiskAt is when.
	Disk   *dockerDiskTotals `json:"disk"`
	DiskAt int64             `json:"diskAt,omitempty"`
	Days   int               `json:"days"`
}

// names is every container the timeline holds anything for.
func (t *dockerTimeline) names() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.loadLocked()
	out := make([]string, 0, len(t.data))
	for name := range t.data {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// dockerDiskTotalsCached is the last disk measurement and when it was taken,
// starting a new one when it is stale, exactly as the tile's figure does.
func dockerDiskTotalsCached(now time.Time) (*dockerDiskTotals, int64) {
	if reclaimable, _ := dockerReclaimable(now); reclaimable < 0 {
		return nil, 0
	}
	dockerDiskCache.mu.Lock()
	defer dockerDiskCache.mu.Unlock()
	if dockerDiskCache.totals == nil {
		return nil, 0
	}
	t := *dockerDiskCache.totals
	return &t, dockerDiskCache.at.UnixMilli()
}

func buildDockerHistory(now time.Time) dockerHistoryResponse {
	cutoff := now.Add(-dockerTimelineMaxAge).UnixMilli()
	out := dockerHistoryResponse{
		Events:  []dockerHistoryEvent{},
		Updates: []dockerUpdateHistoryEntry{},
		Days:    int(dockerTimelineMaxAge / (24 * time.Hour)),
	}
	for _, name := range dockerTimelines.names() {
		// Folded like the drawer: a restart loop is one event, not forty.
		for _, e := range foldDockerRestartLoops(dockerTimelines.forContainer(name)) {
			if e.At >= cutoff {
				out.Events = append(out.Events, dockerHistoryEvent{Container: name, dockerTimelineEntry: e})
			}
		}
	}
	sort.SliceStable(out.Events, func(i, j int) bool { return out.Events[i].At > out.Events[j].At })

	dockerUpdateHistoryMu.Lock()
	all, err := readDockerUpdateHistory()
	dockerUpdateHistoryMu.Unlock()
	if err != nil {
		logWarn(logComponentMutate, "the update history could not be read: %v", err)
	}
	for i := len(all) - 1; i >= 0; i-- {
		if all[i].At >= cutoff {
			out.Updates = append(out.Updates, all[i])
		}
	}
	return out
}

// DockerHistoryHandler answers GET /api/docker/history. Read-only, and like the
// timeline route nothing in it is secret.
func (h *Handlers) DockerHistoryHandler(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	out := buildDockerHistory(now)
	if _, reason := newDockerAPI(); reason == "" {
		out.Disk, out.DiskAt = dockerDiskTotalsCached(now)
	}
	writeJSON(w, out)
}
