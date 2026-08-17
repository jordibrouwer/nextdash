package main

import (
	"strconv"
	"time"
)

// defaultHeartbeatBuckets is how many segments the heartbeat bar renders.
const defaultHeartbeatBuckets = 40

// Heartbeat bucket states.
const (
	heartbeatUnknown  = "unknown"  // no samples in this slice of time
	heartbeatUp       = "up"       // every sample reachable
	heartbeatDown     = "down"     // every sample unreachable
	heartbeatDegraded = "degraded" // mixed — a flap inside one bucket
)

// UptimeWindow is the uptime ratio over one period.
type UptimeWindow struct {
	Ratio   float64 `json:"ratio"`   // 0..1
	Samples int     `json:"samples"` // samples the ratio is based on
}

// HeartbeatBucket is one segment of the heartbeat bar.
type HeartbeatBucket struct {
	State  string `json:"state"`
	From   int64  `json:"from"`
	To     int64  `json:"to"`
	Up     int    `json:"up,omitempty"`
	Down   int    `json:"down,omitempty"`
	AvgMs  int    `json:"avgMs,omitempty"`
	Reason string `json:"reason,omitempty"`
}

// HealthIncident is a contiguous run of failed checks. End is 0 while ongoing.
type HealthIncident struct {
	Start    int64  `json:"start"`
	End      int64  `json:"end,omitempty"`
	Duration int64  `json:"durationMs"`
	Checks   int    `json:"checks"`
	Reason   string `json:"reason,omitempty"`
	Ongoing  bool   `json:"ongoing,omitempty"`
}

// MonitorStats is the derived monitoring view of one bookmark, attached to its
// HealthIssue. Everything here is computed from the stored samples — nothing in
// this struct is persisted, so retention changes cannot leave it stale.
type MonitorStats struct {
	IntervalMinutes int               `json:"intervalMinutes"`
	Uptime24h       UptimeWindow      `json:"uptime24h"`
	Uptime7d        UptimeWindow      `json:"uptime7d"`
	Uptime30d       UptimeWindow      `json:"uptime30d"`
	Heartbeat       []HeartbeatBucket `json:"heartbeat,omitempty"`
	Incidents       []HealthIncident  `json:"incidents,omitempty"`
	// DownSince is the start of the current outage (0 when up or unknown).
	DownSince   int64 `json:"downSince,omitempty"`
	LastSample  int64 `json:"lastSample,omitempty"`
	LastPingMs  int   `json:"lastPingMs,omitempty"`
	TotalChecks int   `json:"totalChecks"`
	// CoveredMs is how far back this monitor's samples actually reach.
	//
	// The retention window is 30 days, but maxHealthSamplesPerURL trims first
	// for anything checked often: at the 5-minute floor, 2000 samples are about
	// seven days. The 30-day figure was still printed as "30d", computed over
	// whatever happened to be there — so a number that described a week was
	// labelled a month, and nothing on screen said so.
	//
	// Reporting the span lets the view mark a window it cannot honestly fill.
	// Keeping every sample instead would mean rewriting megabytes every minute;
	// a daily roll-up is the real answer and a larger piece of work.
	CoveredMs int64 `json:"coveredMs,omitempty"`
}

// uptimeRatio computes the reachable fraction over the window ending at now.
// Windows with no samples return a zero UptimeWindow, which the UI renders as
// "no data" rather than as 0% downtime — an important distinction for a monitor
// that was only just enabled.
func uptimeRatio(samples []HealthSample, window time.Duration, now time.Time) UptimeWindow {
	cutoff := now.Add(-window).UnixMilli()
	var up, total int
	for _, s := range samples {
		if s.T < cutoff {
			continue
		}
		// Maintenance samples are recorded but not counted: expected downtime is
		// not an availability failure, and a nightly backup window would otherwise
		// cap a perfectly healthy host's monthly uptime at around 99.3%.
		if s.Maint {
			continue
		}
		total++
		if s.Up {
			up++
		}
	}
	if total == 0 {
		return UptimeWindow{}
	}
	return UptimeWindow{Ratio: float64(up) / float64(total), Samples: total}
}

// uptimeWithDays counts the raw samples in the window and adds the summarised
// days that fall before the raw history starts.
func uptimeWithDays(samples []HealthSample, days []HealthDay, window time.Duration, now time.Time) UptimeWindow {
	raw := uptimeRatio(samples, window, now)
	if len(days) == 0 {
		return raw
	}
	rawFrom := int64(0)
	if len(samples) > 0 {
		rawFrom = samples[0].T
	}
	upDays, totalDays := uptimeFromDays(days, window, rawFrom, now)
	total := raw.Samples + totalDays
	if total == 0 {
		return UptimeWindow{}
	}
	up := int(float64(raw.Samples)*raw.Ratio+0.5) + upDays
	return UptimeWindow{Ratio: float64(up) / float64(total), Samples: total}
}

// deriveIncidents turns the sample stream into outages: each maximal run of
// failed checks becomes one incident. The final incident is marked Ongoing when
// the most recent sample is still failing.
//
// Duration for an ongoing incident is measured to now, not to the last sample,
// so "down since" keeps counting between checks.
func deriveIncidents(samples []HealthSample, now time.Time) []HealthIncident {
	var incidents []HealthIncident
	var current *HealthIncident

	for _, s := range samples {
		// A maintenance-window sample is expected downtime, not an outage: it must
		// not open, extend, or close an incident. Mirrors uptimeRatio's exclusion.
		if s.Maint {
			continue
		}
		if !s.Up {
			if current == nil {
				incidents = append(incidents, HealthIncident{Start: s.T})
				current = &incidents[len(incidents)-1]
			}
			current.Checks++
			current.End = s.T
			// The reason is the HTTP status when there is one, and the recorded
			// failure class when there is not. Before samples carried a class,
			// every network-level failure — DNS, timeout, refused, TLS — reached
			// this list with a blank reason, because a network failure stores no
			// code. Later samples in the same outage win, so a run that ends 500
			// is not still labelled with its first 503.
			if s.Code > 0 {
				current.Reason = "HTTP " + strconv.Itoa(s.Code)
			} else if s.Fail != "" {
				current.Reason = failureClassReason(s.Fail)
			}
			continue
		}
		if current != nil {
			// Recovery observed: the outage ended at this successful check.
			current.End = s.T
			current.Duration = current.End - current.Start
			current = nil
		}
	}

	if current != nil {
		current.Ongoing = true
		current.End = 0
		current.Duration = now.UnixMilli() - current.Start
	}
	for i := range incidents {
		if !incidents[i].Ongoing && incidents[i].Duration == 0 {
			incidents[i].Duration = incidents[i].End - incidents[i].Start
		}
	}
	return incidents
}

// heartbeatBuckets slices [now-window, now] into count equal buckets and folds
// the samples into them.
//
// Bucketing by time rather than by "last N samples" is deliberate: monitors have
// different intervals and gaps (restarts, paused monitors), so a per-sample bar
// would silently misrepresent the time axis and make two rows incomparable.
func heartbeatBuckets(samples []HealthSample, window time.Duration, count int, now time.Time) []HeartbeatBucket {
	if count <= 0 {
		count = defaultHeartbeatBuckets
	}
	end := now.UnixMilli()
	start := now.Add(-window).UnixMilli()
	span := end - start
	if span <= 0 {
		return nil
	}
	width := span / int64(count)
	if width <= 0 {
		width = 1
	}

	buckets := make([]HeartbeatBucket, count)
	sums := make([]int, count)
	pings := make([]int, count)
	for i := 0; i < count; i++ {
		buckets[i] = HeartbeatBucket{
			State: heartbeatUnknown,
			From:  start + int64(i)*width,
			To:    start + int64(i+1)*width,
		}
	}
	buckets[count-1].To = end

	for _, s := range samples {
		if s.T < start || s.T > end {
			continue
		}
		// A maintenance sample is expected downtime: it must not paint the bucket
		// down or degraded. Skipping it can leave a bucket at heartbeatUnknown,
		// which is the honest answer for "nothing outside maintenance ran here".
		if s.Maint {
			continue
		}
		idx := int((s.T - start) / width)
		if idx < 0 {
			idx = 0
		}
		if idx >= count {
			idx = count - 1
		}
		if s.Up {
			buckets[idx].Up++
			if s.PingMs > 0 {
				sums[idx] += s.PingMs
				pings[idx]++
			}
		} else {
			buckets[idx].Down++
		}
	}

	for i := range buckets {
		switch {
		case buckets[i].Up > 0 && buckets[i].Down > 0:
			buckets[i].State = heartbeatDegraded
		case buckets[i].Up > 0:
			buckets[i].State = heartbeatUp
		case buckets[i].Down > 0:
			buckets[i].State = heartbeatDown
		}
		if pings[i] > 0 {
			buckets[i].AvgMs = sums[i] / pings[i]
		}
	}
	return buckets
}

// buildMonitorStats assembles the full derived view for one monitored bookmark.
// Returns nil when there is no history yet, so the UI can distinguish "monitored
// but not yet checked" from "monitored and healthy".
func buildMonitorStats(samples []HealthSample, intervalMinutes int, now time.Time) *MonitorStats {
	return buildMonitorStatsWithDays(samples, nil, intervalMinutes, now)
}

// buildMonitorStatsWithDays is buildMonitorStats with the daily summaries that
// stand in for the checks the per-URL cap has already dropped. The short windows
// are unaffected — they are inside the raw history by definition — and the long
// ones stop being computed over a week and labelled a month.
func buildMonitorStatsWithDays(samples []HealthSample, days []HealthDay, intervalMinutes int, now time.Time) *MonitorStats {
	if len(samples) == 0 {
		return nil
	}
	interval := clampMonitorIntervalMinutes(intervalMinutes)

	// Span the heartbeat over enough time to show roughly one bar per check, so a
	// 5-minute monitor shows the last few hours and a daily one shows weeks.
	//
	// "Roughly one bar per check" only holds below the cap. History does not
	// outlive healthHistoryRetention, so a slow enough interval (12h+) has its
	// window capped there instead of at 40x its own interval, and each bucket
	// then spans less than one interval — a daily monitor ends up with a bit
	// under one and a half checks per bar rather than exactly one. Still the
	// right trade: this bounds the query to data that actually exists instead
	// of drawing empty buckets past the retention edge.
	window := time.Duration(interval) * time.Minute * time.Duration(defaultHeartbeatBuckets)
	if window > healthHistoryRetention {
		window = healthHistoryRetention
	}

	last := samples[len(samples)-1]
	stats := &MonitorStats{
		IntervalMinutes: interval,
		Uptime24h:       uptimeRatio(samples, 24*time.Hour, now),
		Uptime7d:        uptimeWithDays(samples, days, 7*24*time.Hour, now),
		Uptime30d:       uptimeWithDays(samples, days, healthHistoryRetention, now),
		Heartbeat:       heartbeatBuckets(samples, window, defaultHeartbeatBuckets, now),
		LastSample:      last.T,
		LastPingMs:      last.PingMs,
		TotalChecks:     len(samples),
		CoveredMs:       last.T - samples[0].T,
	}
	// Covered span includes the summarised days: the point of the field is "how
	// much history is behind this figure", and a folded day is history.
	if len(days) > 0 && days[0].D < samples[0].T {
		stats.CoveredMs = last.T - days[0].D
	}

	incidents := deriveIncidents(samples, now)
	// Newest first, and only a handful: the row shows a summary, not an audit log.
	for i, j := 0, len(incidents)-1; i < j; i, j = i+1, j-1 {
		incidents[i], incidents[j] = incidents[j], incidents[i]
	}
	if len(incidents) > 0 && incidents[0].Ongoing {
		stats.DownSince = incidents[0].Start
	}
	if len(incidents) > 5 {
		incidents = incidents[:5]
	}
	stats.Incidents = incidents

	return stats
}
