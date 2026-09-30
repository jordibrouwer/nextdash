package app

import (
	"fmt"
	"sync"
	"time"
)

/*
A notice when a container runs hot for a while: CPU above a share of every
core, or memory above a share of its limit (the host's memory when it has
none), for every sample in the last few minutes -- and one when it has come
back under.

It reads the stats sampler's hour (docker_stats_history.go), so it needs
"Keep the last hour of CPU and memory" on; with that off there is nothing to
read and nothing is sent. One notice per spell: a container stays "hot" until
a sample comes in under both lines. Notices go where the container notices
go, and the same mutes apply.
*/

var (
	dockerCPUAlertChoices     = map[int]bool{50: true, 70: true, 80: true, 90: true, 95: true}
	dockerMemAlertChoices     = map[int]bool{70: true, 80: true, 90: true, 95: true}
	dockerUsageMinutesChoices = map[int]bool{5: true, 10: true, 15: true, 30: true}
)

// dockerUsageWatch remembers which containers were told about, by name, so a
// spell is told once and its end told after it.
type dockerUsageWatch struct {
	mu  sync.Mutex
	hot map[string]bool
}

var dockerUsageWatchState = &dockerUsageWatch{hot: map[string]bool{}}

// dockerUsageVerdict: whether the points of the last window are all over a
// line, and which, or whether the newest is under both.
func dockerUsageVerdict(points []dockerStatsPoint, now time.Time, window time.Duration, cpuLine, memLine float64) (over string, peak float64, under bool) {
	if len(points) == 0 {
		return "", 0, false
	}
	last := points[len(points)-1]
	under = last.cpuShare < cpuLine && last.memShare < memLine
	cutoff := now.Add(-window).UnixMilli()
	inWindow := []dockerStatsPoint{}
	for _, p := range points {
		if p.T >= cutoff {
			inWindow = append(inWindow, p)
		}
	}
	// The window has to be covered: one sample every interval, all of it.
	need := int(window/dockerStatsInterval) - 1
	if len(inWindow) < need || len(inWindow) == 0 || inWindow[0].T > cutoff+dockerStatsInterval.Milliseconds()*2 {
		return "", 0, under
	}
	allCPU, allMem := true, true
	cpuPeak, memPeak := 0.0, 0.0
	for _, p := range inWindow {
		allCPU = allCPU && p.cpuShare >= cpuLine
		allMem = allMem && p.memShare >= memLine
		cpuPeak = max(cpuPeak, p.cpuShare)
		memPeak = max(memPeak, p.memShare)
	}
	switch {
	case allMem:
		return "mem", memPeak, false
	case allCPU:
		return "cpu", cpuPeak, false
	}
	return "", 0, under
}

// checkDockerUsage turns the sampler's latest hour into notices: a container
// over a line for the whole window, and one that was and is back under.
func (h *Handlers) checkDockerUsage(list []dockerContainerSummary, now time.Time) []monitorNotification {
	settings := h.store.GetSettings()
	w := dockerUsageWatchState
	w.mu.Lock()
	defer w.mu.Unlock()
	if !settings.DockerUsageAlerts || !settings.DockerStatsHistory {
		w.hot = map[string]bool{}
		return nil
	}
	window := time.Duration(settings.DockerUsageAlertMinutes) * time.Minute
	out := []monitorNotification{}
	seen := map[string]bool{}
	for _, c := range list {
		if c.State != "running" {
			continue
		}
		name := c.name()
		seen[name] = true
		if !h.dockerNotifyAllowed(name, c.ID) {
			delete(w.hot, name)
			continue
		}
		over, peak, under := dockerUsageVerdict(dockerStatsStore.points(c.ID), now, window,
			float64(settings.DockerCPUAlertPercent), float64(settings.DockerMemAlertPercent))
		switch {
		case over != "" && !w.hot[name]:
			w.hot[name] = true
			what, line := "CPU", settings.DockerCPUAlertPercent
			if over == "mem" {
				what, line = "memory", settings.DockerMemAlertPercent
			}
			out = append(out, containerNotice("down", name,
				fmt.Sprintf("%s uses %.0f %% %s", name, peak, what),
				fmt.Sprintf("above %d %% for %d minutes", line, settings.DockerUsageAlertMinutes), now))
		case under && w.hot[name]:
			delete(w.hot, name)
			out = append(out, containerNotice("up", name, name+" is back to normal use", "", now))
		}
	}
	// A container that stopped or went away ends its spell without a notice:
	// the stop has its own.
	for name := range w.hot {
		if !seen[name] {
			delete(w.hot, name)
		}
	}
	return out
}
