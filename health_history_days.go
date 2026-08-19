package main

import (
	"sort"
	"time"
)

const (
	// healthDayRetention is how far back daily summaries are kept. Longer than
	// the raw samples on purpose: a day costs a handful of bytes, so keeping a
	// quarter of them is cheaper than the week of individual checks it replaces.
	healthDayRetention = 90 * 24 * time.Hour
)

// dayStartMs is dayStart for a timestamp in milliseconds — the form every
// sample carries.
func dayStartMs(ms int64) int64 {
	return dayStart(time.UnixMilli(ms))
}

// foldSamplesIntoDays adds the samples that are about to be dropped to the daily
// summaries, and returns the merged list in ascending order.
//
// Maintenance samples are skipped, matching uptimeRatio: expected downtime is
// not an availability failure, and a summary that counted it would make the long
// windows disagree with the short ones for no reason the reader could see.
func foldSamplesIntoDays(days []HealthDay, dropped []HealthSample) []HealthDay {
	if len(dropped) == 0 {
		return days
	}
	byDay := make(map[int64]*HealthDay, len(days)+4)
	for i := range days {
		d := days[i]
		byDay[d.D] = &d
	}
	// Mean response time is stored, not the samples behind it, so folding more
	// checks into an existing day has to weight what is already there.
	pingTotal := make(map[int64]int, len(byDay))
	pingCount := make(map[int64]int, len(byDay))
	for key, d := range byDay {
		if d.P > 0 && d.U > 0 {
			pingTotal[key] = d.P * d.U
			pingCount[key] = d.U
		}
	}

	for _, s := range dropped {
		if s.Maint {
			continue
		}
		key := dayStartMs(s.T)
		day, ok := byDay[key]
		if !ok {
			day = &HealthDay{D: key}
			byDay[key] = day
		}
		day.N++
		if s.Up {
			day.U++
			if s.PingMs > 0 {
				pingTotal[key] += s.PingMs
				pingCount[key]++
			}
		}
	}

	out := make([]HealthDay, 0, len(byDay))
	for key, day := range byDay {
		if count := pingCount[key]; count > 0 {
			day.P = pingTotal[key] / count
		}
		out = append(out, *day)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].D < out[j].D })
	return out
}

// trimDays drops summaries older than the retention window.
func trimDays(days []HealthDay, now time.Time) []HealthDay {
	cutoff := dayStart(now.Add(-healthDayRetention))
	out := days[:0]
	for _, d := range days {
		if d.D >= cutoff {
			out = append(out, d)
		}
	}
	if len(out) == 0 {
		return nil
	}
	kept := make([]HealthDay, len(out))
	copy(kept, out)
	return kept
}

// uptimeFromDays adds the days inside the window to a raw-sample tally.
//
// `rawFrom` is the oldest raw sample being counted: a day at or after it is
// already represented check by check, and counting it twice would let a single
// bad day weigh more the older the raw history gets. A day that straddles the
// boundary is left to the raw samples for the same reason — half of it is
// already counted, and the half that is not is worth less than the distortion.
func uptimeFromDays(days []HealthDay, window time.Duration, rawFrom int64, now time.Time) (up, total int) {
	cutoff := now.Add(-window).UnixMilli()
	for _, d := range days {
		if d.N <= 0 || d.D < dayStartMs(cutoff) {
			continue
		}
		if rawFrom > 0 && d.D >= dayStartMs(rawFrom) {
			continue
		}
		total += d.N
		up += d.U
	}
	return up, total
}
