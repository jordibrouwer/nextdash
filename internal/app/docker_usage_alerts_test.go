package app

import (
	"strings"
	"testing"
	"time"
)

func usagePoints(now time.Time, n int, cpu, mem float64) []dockerStatsPoint {
	out := []dockerStatsPoint{}
	for i := n - 1; i >= 0; i-- {
		out = append(out, dockerStatsPoint{T: now.Add(-time.Duration(i) * dockerStatsInterval).UnixMilli(), cpuShare: cpu, memShare: mem})
	}
	return out
}

// Over a line for every sample of the window is a verdict; one sample under
// it, or too short a history to cover the window, is not.
func TestDockerUsageVerdict(t *testing.T) {
	now := time.Now()
	window := 10 * time.Minute
	if over, peak, _ := dockerUsageVerdict(usagePoints(now, 21, 95, 10), now, window, 90, 90); over != "cpu" || peak != 95 {
		t.Fatalf("hot CPU = %q %v", over, peak)
	}
	if over, _, _ := dockerUsageVerdict(usagePoints(now, 21, 10, 92), now, window, 90, 90); over != "mem" {
		t.Fatalf("hot memory = %q", over)
	}
	dip := usagePoints(now, 21, 95, 10)
	dip[10].cpuShare = 40
	if over, _, _ := dockerUsageVerdict(dip, now, window, 90, 90); over != "" {
		t.Fatalf("a dip in the window: %q", over)
	}
	if over, _, _ := dockerUsageVerdict(usagePoints(now, 6, 95, 10), now, window, 90, 90); over != "" {
		t.Fatalf("three minutes of history cannot cover ten: %q", over)
	}
	if _, _, under := dockerUsageVerdict(usagePoints(now, 3, 20, 20), now, window, 90, 90); !under {
		t.Fatal("under both lines")
	}
}

// A spell is told once, and its end once; switched off tells nothing.
func TestDockerUsageAlertsTellOnceAndRecover(t *testing.T) {
	h := dockerTestHandlers(t)
	dockerUsageWatchState.hot = map[string]bool{}
	dockerStatsStore.reset()
	t.Cleanup(dockerStatsStore.reset)
	now := time.Now()
	id := strings.Repeat("a", 64)
	var c dockerContainerSummary
	c.ID, c.Names, c.State = id, []string{"/sonarr"}, "running"
	list := []dockerContainerSummary{c}

	dockerStatsStore.mu.Lock()
	dockerStatsStore.series[id] = usagePoints(now, 21, 97, 10)
	dockerStatsStore.mu.Unlock()
	got := h.checkDockerUsage(list, now)
	if len(got) != 1 || got[0].Event != "down" || !strings.Contains(got[0].Title, "97 % CPU") {
		t.Fatalf("first = %+v", got)
	}
	if again := h.checkDockerUsage(list, now.Add(dockerStatsInterval)); len(again) != 0 {
		t.Fatalf("told twice: %+v", again)
	}
	dockerStatsStore.mu.Lock()
	dockerStatsStore.series[id] = append(dockerStatsStore.series[id], dockerStatsPoint{T: now.Add(time.Minute).UnixMilli(), cpuShare: 5, memShare: 10})
	dockerStatsStore.mu.Unlock()
	back := h.checkDockerUsage(list, now.Add(time.Minute))
	if len(back) != 1 || back[0].Event != "up" {
		t.Fatalf("recovery = %+v", back)
	}

	settings := h.store.GetSettings()
	settings.DockerUsageAlerts = false
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	dockerStatsStore.mu.Lock()
	dockerStatsStore.series[id] = usagePoints(now, 21, 97, 10)
	dockerStatsStore.mu.Unlock()
	if off := h.checkDockerUsage(list, now); len(off) != 0 {
		t.Fatalf("switched off: %+v", off)
	}
}
