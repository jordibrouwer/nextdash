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
		if !s.Up {
			if current == nil {
				incidents = append(incidents, HealthIncident{Start: s.T})
				current = &incidents[len(incidents)-1]
			}
			current.Checks++
			current.End = s.T
			// The reason comes from the sample's HTTP status, which is all the
			// history keeps: a network-level failure stores no code, so it stays
			// blank rather than inventing a cause. Later codes in the same outage
			// win, so a run that ends 500 is not still labelled with its first 503.
			if s.Code > 0 {
				current.Reason = "HTTP " + strconv.Itoa(s.Code)
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
	if len(samples) == 0 {
		return nil
	}
	interval := clampMonitorIntervalMinutes(intervalMinutes)

	// Span the heartbeat over enough time to show roughly one bar per check, so a
	// 5-minute monitor shows the last few hours and a daily one shows weeks.
	window := time.Duration(interval) * time.Minute * time.Duration(defaultHeartbeatBuckets)
	if window > healthHistoryRetention {
		window = healthHistoryRetention
	}

	last := samples[len(samples)-1]
	stats := &MonitorStats{
		IntervalMinutes: interval,
		Uptime24h:       uptimeRatio(samples, 24*time.Hour, now),
		Uptime7d:        uptimeRatio(samples, 7*24*time.Hour, now),
		Uptime30d:       uptimeRatio(samples, healthHistoryRetention, now),
		Heartbeat:       heartbeatBuckets(samples, window, defaultHeartbeatBuckets, now),
		LastSample:      last.T,
		LastPingMs:      last.PingMs,
		TotalChecks:     len(samples),
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
