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

// Turning Monitor off must clear the drift baseline the same way
// SetBookmarkExpectations does when WatchDrift itself is switched off:
// otherwise a manual re-check on a bookmark that looks "off" in the UI (drift
// is hidden from the report while Monitor is false) can still silently evolve
// the stored baseline, since expectationFor used to be reached regardless of
// Monitor. Switching Monitor back on later would then compare against that
// stale, invisibly-mutated baseline instead of establishing a fresh one.
func TestApplyCheckModeClearsDriftWhenMonitorTurnsOff(t *testing.T) {
	for _, mode := range []string{checkModePeriodic, checkModeOff} {
		t.Run(mode, func(t *testing.T) {
			bm := Bookmark{
				Monitor: true, WatchDrift: true,
				DriftURL: "https://example.com/", DriftTitle: "Example",
				DriftFingerprint: "abc123", DriftNoticed: "redirect",
				DriftReason: "Now redirects elsewhere", DriftSince: 1700000000000,
			}
			applyCheckMode(&bm, mode, 0)
			if bm.DriftURL != "" || bm.DriftTitle != "" || bm.DriftFingerprint != "" ||
				bm.DriftNoticed != "" || bm.DriftReason != "" || bm.DriftSince != 0 {
				t.Errorf("drift state survived switching to %s: %+v", mode, bm)
			}
		})
	}
}

// The opposite direction: switching from periodic/off to monitor must not
// touch drift fields that were not there to begin with, and must not clear
// WatchDrift itself — applyCheckMode only ever changes drift state on the
// off-transition, the same boundary SetBookmarkExpectations uses.
func TestApplyCheckModeKeepsDriftWhenMonitorStaysOnOrTurnsOn(t *testing.T) {
	bm := Bookmark{
		WatchDrift: true, DriftNoticed: "title", DriftReason: "Retitled",
	}
	applyCheckMode(&bm, checkModeMonitor, 0)
	if !bm.WatchDrift || bm.DriftNoticed != "title" || bm.DriftReason != "Retitled" {
		t.Errorf("drift state was cleared on off->monitor transition: %+v", bm)
	}

	bm2 := Bookmark{
		Monitor: true, WatchDrift: true, DriftNoticed: "content", DriftReason: "Body changed",
	}
	applyCheckMode(&bm2, checkModeMonitor, 15)
	if !bm2.WatchDrift || bm2.DriftNoticed != "content" || bm2.DriftReason != "Body changed" {
		t.Errorf("drift state was cleared on monitor->monitor transition: %+v", bm2)
	}
}
