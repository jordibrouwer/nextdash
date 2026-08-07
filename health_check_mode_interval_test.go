package main

import "testing"

// The check-mode endpoint carries an optional cadence so the health view can
// change how often a monitor runs without a trip through the bookmark editor.
//
// The rules it has to keep: an explicit value wins, an omitted one leaves the
// bookmark's own interval alone, out-of-range values are clamped rather than
// rejected, and the modes without a cadence never store one.

func TestApplyCheckModeUsesRequestedInterval(t *testing.T) {
	bm := Bookmark{}
	applyCheckMode(&bm, checkModeMonitor, 30)
	if bm.MonitorIntervalMinutes != 30 {
		t.Errorf("interval = %d, want 30", bm.MonitorIntervalMinutes)
	}
	if !bm.Monitor || bm.CheckStatus {
		t.Errorf("mode flags wrong: monitor=%v checkStatus=%v", bm.Monitor, bm.CheckStatus)
	}
}

// Zero means "not specified". A caller changing only the mode must not silently
// reset a cadence someone chose deliberately.
func TestApplyCheckModeKeepsExistingIntervalWhenUnspecified(t *testing.T) {
	bm := Bookmark{Monitor: true, MonitorIntervalMinutes: 360}
	applyCheckMode(&bm, checkModeMonitor, 0)
	if bm.MonitorIntervalMinutes != 360 {
		t.Errorf("interval = %d, want 360 (unchanged)", bm.MonitorIntervalMinutes)
	}
}

// A bookmark that never had one still gets the default written out explicitly.
func TestApplyCheckModeFillsDefaultIntervalWhenUnspecified(t *testing.T) {
	bm := Bookmark{}
	applyCheckMode(&bm, checkModeMonitor, 0)
	if bm.MonitorIntervalMinutes != defaultMonitorIntervalMinutes {
		t.Errorf("interval = %d, want the default %d", bm.MonitorIntervalMinutes, defaultMonitorIntervalMinutes)
	}
}

// Out-of-range values are pulled into the bounds the scheduler honours. Storing
// what was asked for would leave the row claiming a cadence it never runs at.
func TestApplyCheckModeClampsInterval(t *testing.T) {
	cases := []struct {
		name     string
		asked    int
		expected int
	}{
		{"below the floor", 1, minMonitorIntervalMinutes},
		{"above the ceiling", 99999, maxMonitorIntervalMinutes},
		{"at the floor", minMonitorIntervalMinutes, minMonitorIntervalMinutes},
		{"at the ceiling", maxMonitorIntervalMinutes, maxMonitorIntervalMinutes},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bm := Bookmark{}
			applyCheckMode(&bm, checkModeMonitor, tc.asked)
			if bm.MonitorIntervalMinutes != tc.expected {
				t.Errorf("asked %d, stored %d, want %d", tc.asked, bm.MonitorIntervalMinutes, tc.expected)
			}
		})
	}
}

// Periodic and off have no cadence. Storing one would leave a stale number for
// the next enable to inherit, so an interval sent with them is ignored.
func TestApplyCheckModeIgnoresIntervalForModesWithoutCadence(t *testing.T) {
	for _, mode := range []string{checkModePeriodic, checkModeOff} {
		t.Run(mode, func(t *testing.T) {
			bm := Bookmark{Monitor: true, MonitorIntervalMinutes: 60}
			applyCheckMode(&bm, mode, 30)
			if bm.MonitorIntervalMinutes != 0 {
				t.Errorf("mode %s kept an interval: %d", mode, bm.MonitorIntervalMinutes)
			}
		})
	}
}
