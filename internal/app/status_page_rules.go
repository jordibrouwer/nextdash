package app

import "time"

// statusState is what the status page says about a service. The page is
// read-only and public, so it speaks in these five words and nothing finer.
type statusState string

const (
	statusOperational statusState = "operational"
	statusDegraded    statusState = "degraded"
	statusDown        statusState = "down"
	statusMaintenance statusState = "maintenance"
	statusUnknown     statusState = "unknown"
)

const statusDays = 30

// statusPart is what one source (monitor or container) says about a service.
type statusPart struct {
	State     statusState
	Since     int64  // ms; start of the current non-operational run, 0 if not known
	LastCheck int64  // ms; monitor only: newest sample
	Reason    string // "restarting", "stale" or ""
}

type statusDayView struct {
	D int64       `json:"d"` // UTC day start, ms
	S statusState `json:"s"`
}

func statusRank(s statusState) int {
	switch s {
	case statusDown:
		return 5
	case statusDegraded:
		return 4
	case statusMaintenance:
		return 3
	case statusUnknown:
		return 2
	case statusOperational:
		return 1
	}
	return 0
}

// worseStatus ranks "" below everything, so an absent part never wins.
func worseStatus(a, b statusState) statusState {
	if statusRank(b) > statusRank(a) {
		return b
	}
	return a
}

func containerPart(c *dockerContainerSummary, dockerOK bool, timeline []dockerTimelineEntry, now time.Time) statusPart {
	if !dockerOK || c == nil {
		return statusPart{State: statusUnknown}
	}
	var p statusPart
	switch c.State {
	case "running":
		if dockerHealthFromStatus(c.Status) != "unhealthy" {
			return statusPart{State: statusOperational}
		}
		p.State = statusDegraded
	case "restarting":
		p = statusPart{State: statusDegraded, Reason: "restarting"}
	default:
		p.State = statusDown
	}
	kinds := map[string]bool{"stop": true, "exit": true, "crash": true}
	if p.State == statusDegraded {
		kinds = map[string]bool{"unhealthy": true, "restart-loop": true}
	}
	for i := len(timeline) - 1; i >= 0; i-- {
		if kinds[timeline[i].Kind] {
			p.Since = timeline[i].At
			break
		}
	}
	return p
}

func monitorPart(samples []HealthSample, intervalMinutes int, now time.Time) statusPart {
	if len(samples) == 0 {
		return statusPart{State: statusUnknown}
	}
	last := samples[len(samples)-1]
	stale := 3 * time.Duration(clampMonitorIntervalMinutes(intervalMinutes)) * time.Minute
	if now.Sub(time.UnixMilli(last.T)) > stale {
		return statusPart{State: statusUnknown, Reason: "stale", LastCheck: last.T}
	}
	if last.Up {
		return statusPart{State: statusOperational, LastCheck: last.T}
	}
	since := last.T
	for i := len(samples) - 1; i >= 0 && !samples[i].Up; i-- {
		since = samples[i].T
	}
	return statusPart{State: statusDown, Since: since, LastCheck: last.T}
}

func combineParts(parts ...statusPart) statusPart {
	var out statusPart
	for _, p := range parts {
		if p.State == "" {
			continue
		}
		if statusRank(p.State) > statusRank(out.State) {
			out.State, out.Since, out.Reason = p.State, p.Since, p.Reason
		}
		if p.LastCheck > out.LastCheck {
			out.LastCheck = p.LastCheck
		}
	}
	if out.State == "" {
		out.State = statusUnknown
	}
	return out
}

func applyMaintenanceState(p statusPart, active bool) statusPart {
	if active && (p.State == statusDown || p.State == statusDegraded) {
		p.State = statusMaintenance
	}
	return p
}

// monitorDayStates gives each day a monitor has history for its state. Daily
// summaries cover the days whose raw samples were dropped; where raw samples
// still exist they win, because only they know which failures were maintenance.
// monitorDayStates folds a monitor's history into days. A sample flagged as
// maintenance only counts as such when one of this group's linked windows
// (inWindow, may be nil) covered it: an unlinked window is not announced on
// the page, so its failures read as the failures they were.
func monitorDayStates(samples []HealthSample, days []HealthDay, inWindow func(atMs int64) bool) map[int64]statusState {
	out := map[int64]statusState{}
	for _, d := range days {
		switch {
		case d.N == 0:
			continue
		case d.U == d.N:
			out[d.D] = statusOperational
		case d.U == 0:
			out[d.D] = statusDown
		default:
			out[d.D] = statusDegraded
		}
	}
	type tally struct {
		n, up     int
		maintFail bool
	}
	per := map[int64]*tally{}
	for _, s := range samples {
		d := dayStartMs(s.T)
		t := per[d]
		if t == nil {
			t = &tally{}
			per[d] = t
		}
		if s.Maint && inWindow != nil && inWindow(s.T) {
			// Expected downtime is not an outage, but the day should still say
			// something happened.
			if !s.Up {
				t.maintFail = true
			}
			continue
		}
		t.n++
		if s.Up {
			t.up++
		}
	}
	for d, t := range per {
		switch {
		case t.n > 0 && t.up == 0:
			out[d] = statusDown
		case t.up < t.n:
			out[d] = statusDegraded
		case t.maintFail:
			out[d] = statusMaintenance
		default:
			out[d] = statusOperational
		}
	}
	return out
}

// statusBriefStop is how soon a start must follow a stop for the stop not to
// count: an update or a restart takes seconds, and a red day for it would say
// the service was down when nobody could have noticed.
const statusBriefStop = 5 * time.Minute

// containerDayStates reads a container's day from its event log: any event
// marks the day as known, the worst event decides how it went. A stop that a
// start follows within statusBriefStop does not count. A bad event inside a
// linked maintenance window (inWindow, may be nil) counts as maintenance.
func containerDayStates(timeline []dockerTimelineEntry, inWindow func(atMs int64) bool) map[int64]statusState {
	out := map[int64]statusState{}
	for i, e := range timeline {
		s := statusOperational
		switch e.Kind {
		case "stop", "exit", "crash":
			s = statusDown
			if restartedSoon(timeline, i) {
				s = statusOperational
			}
		case "unhealthy", "restart-loop":
			s = statusDegraded
		}
		if s != statusOperational && inWindow != nil && inWindow(e.At) {
			s = statusMaintenance
		}
		d := dayStartMs(e.At)
		out[d] = worseStatus(out[d], s)
	}
	return out
}

// restartedSoon reports whether the stop at timeline[i] was followed by a
// start within statusBriefStop.
func restartedSoon(timeline []dockerTimelineEntry, i int) bool {
	limit := timeline[i].At + statusBriefStop.Milliseconds()
	for _, next := range timeline[i+1:] {
		if next.At > limit {
			return false
		}
		if next.Kind == "start" || next.Kind == "restart" {
			return true
		}
	}
	return false
}

// statusDayBars lays out the last statusDays UTC days, oldest first. Today also
// takes the current state, so a service that went down an hour ago without a
// history entry yet does not show a green today.
func statusDayBars(now time.Time, current statusState, sources ...map[int64]statusState) []statusDayView {
	const dayMs = int64(24 * time.Hour / time.Millisecond)
	today := dayStartMs(now.UnixMilli())
	bars := make([]statusDayView, statusDays)
	for i := range bars {
		d := today - int64(statusDays-1-i)*dayMs
		var s statusState
		for _, src := range sources {
			s = worseStatus(s, src[d])
		}
		if i == statusDays-1 {
			s = worseStatus(s, current)
		}
		if s == "" {
			s = statusUnknown
		}
		bars[i] = statusDayView{D: d, S: s}
	}
	return bars
}

// statusUptime prefers the monitor's own ratio, which counts checks rather than
// days. Without one it falls back to the share of known days that were up;
// maintenance counts as up, as it does in the monitor's ratio.
func statusUptime(samples []HealthSample, days []HealthDay, bars []statusDayView, hasMonitor bool, now time.Time) *float64 {
	if hasMonitor {
		if w := uptimeWithDays(samples, days, statusDays*24*time.Hour, now); w.Samples > 0 {
			r := w.Ratio
			return &r
		}
	}
	known, good := 0, 0
	for _, b := range bars {
		if b.S == statusUnknown || b.S == "" {
			continue
		}
		known++
		if b.S == statusOperational || b.S == statusMaintenance {
			good++
		}
	}
	if known == 0 {
		return nil
	}
	r := float64(good) / float64(known)
	return &r
}
