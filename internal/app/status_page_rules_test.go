package app

import (
	"testing"
	"time"
)

var ruleNow = time.Date(2026, 10, 7, 14, 30, 0, 0, time.UTC)

func msOf(t time.Time) int64 { return t.UnixMilli() }

func TestWorseStatusOrder(t *testing.T) {
	order := []statusState{statusOperational, statusUnknown, statusMaintenance, statusDegraded, statusDown}
	for i := 1; i < len(order); i++ {
		if worseStatus(order[i-1], order[i]) != order[i] || worseStatus(order[i], order[i-1]) != order[i] {
			t.Fatalf("%s should be worse than %s", order[i], order[i-1])
		}
	}
	if worseStatus("", statusOperational) != statusOperational {
		t.Fatal("an absent part must not count")
	}
}

func TestContainerPart(t *testing.T) {
	cases := []struct {
		state, status string
		want          statusState
	}{
		{"running", "Up 2 hours (healthy)", statusOperational},
		{"running", "Up 2 hours", statusOperational},
		{"running", "Up 2 hours (unhealthy)", statusDegraded},
		{"restarting", "Restarting (1) 3 seconds ago", statusDegraded},
		{"exited", "Exited (0) 1 hour ago", statusDown},
		{"dead", "Dead", statusDown},
	}
	for _, c := range cases {
		got := containerPart(&dockerContainerSummary{State: c.state, Status: c.status}, true, nil, ruleNow)
		if got.State != c.want {
			t.Errorf("%s/%s = %s, want %s", c.state, c.status, got.State, c.want)
		}
	}
	if containerPart(nil, true, nil, ruleNow).State != statusUnknown {
		t.Error("a missing container is unknown")
	}
	if containerPart(&dockerContainerSummary{State: "running"}, false, nil, ruleNow).State != statusUnknown {
		t.Error("Docker unreachable is unknown")
	}
	crash := ruleNow.Add(-27 * time.Minute)
	p := containerPart(&dockerContainerSummary{State: "exited"}, true,
		[]dockerTimelineEntry{{At: msOf(crash.Add(-time.Hour)), Kind: "start"}, {At: msOf(crash), Kind: "crash"}}, ruleNow)
	if p.Since != msOf(crash) {
		t.Errorf("since = %d, want the crash time %d", p.Since, msOf(crash))
	}
}

func TestMonitorPart(t *testing.T) {
	ago := func(n int) int64 { return msOf(ruleNow.Add(-time.Duration(n) * time.Minute)) }
	if monitorPart(nil, 5, ruleNow).State != statusUnknown {
		t.Fatal("no samples is unknown")
	}
	up := monitorPart([]HealthSample{{T: ago(10), Up: false}, {T: ago(5), Up: true}}, 5, ruleNow)
	if up.State != statusOperational || up.LastCheck != ago(5) {
		t.Fatalf("recovered monitor: %+v", up)
	}
	down := monitorPart([]HealthSample{{T: ago(20), Up: true}, {T: ago(15), Up: false}, {T: ago(10), Up: false}, {T: ago(5), Up: false}}, 5, ruleNow)
	if down.State != statusDown || down.Since != ago(15) {
		t.Fatalf("down since the first failure of the run: %+v", down)
	}
	stale := monitorPart([]HealthSample{{T: ago(16), Up: true}}, 5, ruleNow)
	if stale.State != statusUnknown || stale.Reason != "stale" || stale.LastCheck != ago(16) {
		t.Fatalf("16 min without a check on a 5 min monitor is stale: %+v", stale)
	}
	fresh := monitorPart([]HealthSample{{T: ago(14), Up: true}}, 5, ruleNow)
	if fresh.State != statusOperational {
		t.Fatalf("14 min on a 5 min monitor is within 3×: %+v", fresh)
	}
}

func TestCombineAndMaintenance(t *testing.T) {
	got := combineParts(statusPart{State: statusOperational, LastCheck: 5}, statusPart{State: statusDegraded, Reason: "restarting", Since: 9})
	if got.State != statusDegraded || got.Reason != "restarting" || got.Since != 9 || got.LastCheck != 5 {
		t.Fatalf("combine: %+v", got)
	}
	if applyMaintenanceState(statusPart{State: statusDown}, true).State != statusMaintenance {
		t.Fatal("down inside a linked window is maintenance")
	}
	if applyMaintenanceState(statusPart{State: statusDown}, false).State != statusDown {
		t.Fatal("outside a window down stays down")
	}
	if applyMaintenanceState(statusPart{State: statusUnknown}, true).State != statusUnknown {
		t.Fatal("unknown is not turned into maintenance")
	}
}

func TestStatusDayBars(t *testing.T) {
	today := dayStartMs(msOf(ruleNow))
	day := func(n int) int64 { return today - int64(n)*24*3600*1000 }
	mon := monitorDayStates(
		[]HealthSample{
			{T: day(1) + 1000, Up: true}, {T: day(1) + 2000, Up: false}, // mixed: degraded
			{T: day(2) + 1000, Up: false, Maint: true}, {T: day(2) + 2000, Up: true}, // only maint failures
		},
		[]HealthDay{{D: day(10), N: 10, U: 0}, {D: day(11), N: 10, U: 10}},
		func(int64) bool { return true }, // the window is linked to this group
	)
	con := containerDayStates([]dockerTimelineEntry{{At: day(3) + 5000, Kind: "crash"}, {At: day(1) + 5000, Kind: "start"}}, nil)
	bars := statusDayBars(ruleNow, statusOperational, mon, con)
	if len(bars) != statusDays || bars[statusDays-1].D != today || bars[0].D != day(29) {
		t.Fatalf("30 bars ending today expected, got %d", len(bars))
	}
	want := map[int]statusState{0: statusOperational, 1: statusDegraded, 2: statusMaintenance, 3: statusDown, 10: statusDown, 11: statusOperational, 20: statusUnknown}
	for n, s := range want {
		if got := bars[statusDays-1-n].S; got != s {
			t.Errorf("day -%d = %s, want %s", n, got, s)
		}
	}
	if b := statusDayBars(ruleNow, statusDown, mon); b[statusDays-1].S != statusDown {
		t.Error("today takes the current state")
	}
}

func TestStatusUptime(t *testing.T) {
	bars := []statusDayView{{S: statusOperational}, {S: statusDown}, {S: statusUnknown}, {S: statusMaintenance}}
	u := statusUptime(nil, nil, bars, false, ruleNow)
	if u == nil || *u < 0.666 || *u > 0.667 {
		t.Fatalf("container-only uptime = %v, want 2/3", u)
	}
	if statusUptime(nil, nil, []statusDayView{{S: statusUnknown}}, false, ruleNow) != nil {
		t.Fatal("no known day: no percentage")
	}
}

func TestMonitorDayStatesIgnoreUnlinkedWindows(t *testing.T) {
	today := dayStartMs(msOf(ruleNow))
	samples := []HealthSample{{T: today + 1000, Up: false, Maint: true}, {T: today + 2000, Up: true}}
	if got := monitorDayStates(samples, nil, nil)[today]; got != statusDegraded {
		t.Fatalf("a failure in a window not linked to this group = %s, want degraded", got)
	}
	linked := func(int64) bool { return true }
	if got := monitorDayStates(samples, nil, linked)[today]; got != statusMaintenance {
		t.Fatalf("a failure in a linked window = %s, want maintenance", got)
	}
}

func TestContainerDayStatesBriefStopsAndWindows(t *testing.T) {
	today := dayStartMs(msOf(ruleNow))
	day := func(n int) int64 { return today - int64(n)*24*3600*1000 }
	minute := int64(60 * 1000)
	timeline := []dockerTimelineEntry{
		// An update: stopped and started again within a minute.
		{At: day(4) + 60*minute, Kind: "stop"}, {At: day(4) + 61*minute, Kind: "start"},
		// Stopped for ten minutes: an outage.
		{At: day(3) + 60*minute, Kind: "stop"}, {At: day(3) + 70*minute, Kind: "start"},
		// The announced nightly backup: stopped for an hour inside the window.
		{At: day(2) + 120*minute, Kind: "stop"}, {At: day(2) + 180*minute, Kind: "start"},
	}
	window := func(atMs int64) bool {
		return atMs >= day(2)+110*minute && atMs < day(2)+240*minute
	}
	got := containerDayStates(timeline, window)
	want := map[int64]statusState{day(4): statusOperational, day(3): statusDown, day(2): statusMaintenance}
	for d, s := range want {
		if got[d] != s {
			t.Errorf("day %d = %s, want %s", (today-d)/(24*3600*1000), got[d], s)
		}
	}
}
