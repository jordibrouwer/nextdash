package app

import (
	"sort"
	"time"
)

// maxFleetIncidents bounds the collection-wide outage list. Per-row incidents are
// capped at 5 because a row shows a summary; this list is the whole month across
// every monitor, so it is allowed to be longer — but not unbounded, since it
// travels in every report.
const maxFleetIncidents = 25

// maxWorstMonitors is how many of the least-available monitors are named. Enough
// to show a pattern, short enough to stay a shortlist rather than a second table.
const maxWorstMonitors = 5

// FleetMonitor is one monitor's standing in the collection-wide view.
type FleetMonitor struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	// Ratio is 7-day availability, 0..1. Samples is what it rests on, so the UI
	// can distinguish a genuine 80% from one derived from five checks.
	Ratio   float64 `json:"ratio"`
	Samples int     `json:"samples"`
	// AvgMs is the mean response time over the same window, 0 when nothing
	// answered.
	AvgMs int `json:"avgMs,omitempty"`
	// Down marks a monitor that is failing right now, which sorts it above a
	// merely poor average.
	Down bool `json:"down,omitempty"`
}

// FleetIncident is one outage, carrying which bookmark it belonged to so the list
// reads as a timeline across the collection.
type FleetIncident struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Start    int64  `json:"start"`
	End      int64  `json:"end,omitempty"`
	Duration int64  `json:"durationMs"`
	Checks   int    `json:"checks"`
	Reason   string `json:"reason,omitempty"`
	Ongoing  bool   `json:"ongoing,omitempty"`
}

// FleetResponseShift compares recent response times against the preceding week,
// which is the "this got slower" question the per-row sparkline cannot answer.
type FleetResponseShift struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	// RecentMs is the mean over the last 24h; BaselineMs the mean over the 7 days
	// before that. Both are only reported when each side has enough samples to be
	// worth comparing.
	RecentMs   int `json:"recentMs"`
	BaselineMs int `json:"baselineMs"`
	// ChangePct is the percentage difference, positive for slower.
	ChangePct int `json:"changePct"`
}

// FleetStats is the collection-wide monitoring view: what the per-row strips add
// up to. Populated only when something is monitored, keeping the report payload
// unchanged for installs that never turn monitoring on.
type FleetStats struct {
	Monitors int `json:"monitors"`
	// Uptime across every monitor's samples pooled together, so one flapping
	// service does not weigh the same as one that is checked ten times as often.
	// Pooling by sample rather than averaging per-monitor ratios is deliberate:
	// the latter lets a monitor with three samples cancel out one with three
	// thousand.
	Uptime24h UptimeWindow `json:"uptime24h"`
	Uptime7d  UptimeWindow `json:"uptime7d"`
	Uptime30d UptimeWindow `json:"uptime30d"`
	// DownNow is how many monitors are failing at this moment.
	DownNow int `json:"downNow"`
	// AvgResponseMs is the mean response across every monitor over 24h.
	AvgResponseMs int `json:"avgResponseMs,omitempty"`
	// Worst names the least-available monitors over 7 days, down ones first.
	Worst []FleetMonitor `json:"worst,omitempty"`
	// Incidents is every outage in the retained history, newest first.
	Incidents []FleetIncident `json:"incidents,omitempty"`
	// TotalIncidents is how many there were before the list was capped, so the UI
	// can say "showing 25 of 40" rather than implying the month had 25.
	TotalIncidents int `json:"totalIncidents,omitempty"`
	// Slower lists monitors whose recent response time rose meaningfully against
	// the previous week.
	Slower []FleetResponseShift `json:"slower,omitempty"`
}

// fleetMonitorInput is one monitored bookmark plus the samples it owns.
type fleetMonitorInput struct {
	name    string
	url     string
	samples []HealthSample
}

// meanPingSince averages response time over samples at or after cutoff, counting
// only successful checks with a recorded time. Returns 0 and 0 when there is
// nothing to average, which callers treat as "no reading" rather than "0ms".
func meanPingSince(samples []HealthSample, cutoff int64) (mean int, count int) {
	total := 0
	for _, s := range samples {
		if s.T < cutoff || !s.Up || s.PingMs <= 0 {
			continue
		}
		total += s.PingMs
		count++
	}
	if count == 0 {
		return 0, 0
	}
	return total / count, count
}

// pooledUptime folds every monitor's samples into one window, counting samples
// rather than averaging ratios.
func pooledUptime(inputs []fleetMonitorInput, window time.Duration, now time.Time) UptimeWindow {
	cutoff := now.Add(-window).UnixMilli()
	var up, total int
	for _, in := range inputs {
		for _, s := range in.samples {
			if s.T < cutoff {
				continue
			}
			// Mirrors uptimeRatio: expected downtime during a maintenance window is
			// not an availability failure.
			if s.Maint {
				continue
			}
			total++
			if s.Up {
				up++
			}
		}
	}
	if total == 0 {
		return UptimeWindow{}
	}
	return UptimeWindow{Ratio: float64(up) / float64(total), Samples: total}
}

// minSamplesForShift is how many readings each side of a response-time comparison
// needs. Comparing two averages of one or two checks reports noise as a trend.
const minSamplesForShift = 5

// responseShiftThresholdPct is how much slower a monitor has to get before it is
// worth naming. Response times vary by tens of percent between checks; below this
// the list would be a different five monitors every refresh.
const responseShiftThresholdPct = 25

// deriveResponseShifts finds monitors measurably slower over the last day than
// over the week before it. Only slowdowns are reported: a service that got faster
// is not something to act on, and listing both would halve the space for the one
// that matters.
func deriveResponseShifts(inputs []fleetMonitorInput, now time.Time) []FleetResponseShift {
	recentFrom := now.Add(-24 * time.Hour).UnixMilli()
	baselineFrom := now.Add(-8 * 24 * time.Hour).UnixMilli()

	var shifts []FleetResponseShift
	for _, in := range inputs {
		recent, recentN := meanPingSince(in.samples, recentFrom)
		if recentN < minSamplesForShift {
			continue
		}
		// The baseline window ends where the recent one begins, so the two never
		// share a sample — an overlap would drag the baseline toward the value it
		// is meant to be compared against.
		var baseTotal, baseN int
		for _, s := range in.samples {
			if s.T < baselineFrom || s.T >= recentFrom || !s.Up || s.PingMs <= 0 {
				continue
			}
			baseTotal += s.PingMs
			baseN++
		}
		if baseN < minSamplesForShift || baseTotal == 0 {
			continue
		}
		baseline := baseTotal / baseN
		if baseline <= 0 {
			continue
		}
		change := (recent - baseline) * 100 / baseline
		if change < responseShiftThresholdPct {
			continue
		}
		shifts = append(shifts, FleetResponseShift{
			Name:       in.name,
			URL:        in.url,
			RecentMs:   recent,
			BaselineMs: baseline,
			ChangePct:  change,
		})
	}

	sort.SliceStable(shifts, func(i, j int) bool { return shifts[i].ChangePct > shifts[j].ChangePct })
	if len(shifts) > maxWorstMonitors {
		shifts = shifts[:maxWorstMonitors]
	}
	return shifts
}

// buildFleetStats assembles the collection-wide view. Returns nil when nothing is
// monitored or no samples exist yet, so the UI can leave the section out rather
// than render a panel of zeroes.
func buildFleetStats(inputs []fleetMonitorInput, now time.Time) *FleetStats {
	withSamples := inputs[:0:0]
	for _, in := range inputs {
		if len(in.samples) > 0 {
			withSamples = append(withSamples, in)
		}
	}
	if len(withSamples) == 0 {
		return nil
	}

	stats := &FleetStats{
		Monitors:  len(withSamples),
		Uptime24h: pooledUptime(withSamples, 24*time.Hour, now),
		Uptime7d:  pooledUptime(withSamples, 7*24*time.Hour, now),
		Uptime30d: pooledUptime(withSamples, healthHistoryRetention, now),
	}

	dayAgo := now.Add(-24 * time.Hour).UnixMilli()
	var pingTotal, pingCount int
	var monitors []FleetMonitor
	var incidents []FleetIncident

	for _, in := range withSamples {
		if mean, n := meanPingSince(in.samples, dayAgo); n > 0 {
			pingTotal += mean * n
			pingCount += n
		}

		week := uptimeRatio(in.samples, 7*24*time.Hour, now)
		avg, _ := meanPingSince(in.samples, now.Add(-7*24*time.Hour).UnixMilli())

		// "Down right now" comes from the same place the per-row strip gets it:
		// an open outage in the derived incidents, not the last sample alone.
		perRow := deriveIncidents(in.samples, now)
		down := len(perRow) > 0 && perRow[len(perRow)-1].Ongoing
		if down {
			stats.DownNow++
		}
		if week.Samples > 0 {
			monitors = append(monitors, FleetMonitor{
				Name: in.name, URL: in.url,
				Ratio: week.Ratio, Samples: week.Samples, AvgMs: avg, Down: down,
			})
		}

		for _, inc := range perRow {
			incidents = append(incidents, FleetIncident{
				Name: in.name, URL: in.url,
				Start: inc.Start, End: inc.End, Duration: inc.Duration,
				Checks: inc.Checks, Reason: inc.Reason, Ongoing: inc.Ongoing,
			})
		}
	}

	if pingCount > 0 {
		stats.AvgResponseMs = pingTotal / pingCount
	}

	// Down first, then least available, then the noisier one of two equals. Name
	// last so the order is stable across rebuilds rather than following map order.
	sort.SliceStable(monitors, func(i, j int) bool {
		if monitors[i].Down != monitors[j].Down {
			return monitors[i].Down
		}
		if monitors[i].Ratio != monitors[j].Ratio {
			return monitors[i].Ratio < monitors[j].Ratio
		}
		return monitors[i].Name < monitors[j].Name
	})
	// Only monitors with something to report: a shortlist padded with perfect
	// scores reads as though five things are wrong.
	for _, m := range monitors {
		if len(stats.Worst) >= maxWorstMonitors {
			break
		}
		if !m.Down && m.Ratio >= 1 {
			continue
		}
		stats.Worst = append(stats.Worst, m)
	}

	sort.SliceStable(incidents, func(i, j int) bool { return incidents[i].Start > incidents[j].Start })
	stats.TotalIncidents = len(incidents)
	if len(incidents) > maxFleetIncidents {
		incidents = incidents[:maxFleetIncidents]
	}
	stats.Incidents = incidents

	stats.Slower = deriveResponseShifts(withSamples, now)

	return stats
}
