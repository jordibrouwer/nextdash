package app

import (
	"testing"
	"time"
)

// The list endpoint carries no start time, only Docker's own "Up 3 days".
// Read back into a time, it is coarse -- a day is a day -- but it orders
// containers by how long they have run, which is what the widget sorts on.
func TestDockerStartedFromStatus(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	cases := map[string]time.Duration{
		"Up Less than a second":        0,
		"Up 1 second":                  time.Second,
		"Up 42 seconds (healthy)":      42 * time.Second,
		"Up About a minute":            time.Minute,
		"Up 12 minutes":                12 * time.Minute,
		"Up About an hour (unhealthy)": time.Hour,
		"Up 5 hours (Paused)":          5 * time.Hour,
		"Up 3 days":                    3 * 24 * time.Hour,
		"Up 2 weeks":                   14 * 24 * time.Hour,
		"Up 4 months":                  4 * 30 * 24 * time.Hour,
		"Up 1 year":                    365 * 24 * time.Hour,
	}
	for status, ago := range cases {
		if got, want := dockerStartedFromStatus(status, now), now.Add(-ago).Unix(); got != want {
			t.Errorf("%q: got %d, want %d", status, got, want)
		}
	}
	// Not running, or a shape Docker does not write: no start time at all.
	for _, status := range []string{"Exited (0) 2 hours ago", "Created", "", "Up", "Up soon"} {
		if got := dockerStartedFromStatus(status, now); got != 0 {
			t.Errorf("%q: got %d, want 0", status, got)
		}
	}
}

// The container list's settings are narrowed like every widget's: a choice
// outside its list is dropped rather than stored and silently ignored.
func TestContainersWidgetConfigIsNarrowed(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeContainers, map[string]any{
		"show": "all", "sort": "uptime-long", "detail": "tag", "click": "webui", "rows": 8,
		"refreshSeconds": 60,
	})
	for key, want := range map[string]any{
		"show": "all", "sort": "uptime-long", "detail": "tag", "click": "webui", "rows": 8, "refreshSeconds": 60,
	} {
		if clean[key] != want {
			t.Errorf("%s = %v, want %v", key, clean[key], want)
		}
	}
	bad := sanitizeWidgetConfig(WidgetTypeContainers, map[string]any{"sort": "random", "click": "shell"})
	if _, ok := bad["sort"]; ok {
		t.Errorf("an unknown sort was kept: %v", bad)
	}
	if _, ok := bad["click"]; ok {
		t.Errorf("an unknown click target was kept: %v", bad)
	}
}
