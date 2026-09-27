package app

import (
	"sort"
	"time"
)

// A bookmark's recent opens, as timestamps, for the Usage tab's chart of
// opens per week, its busiest weekday and the hour it is usually opened.
//
// Timestamps rather than a count per day: the hour and the weekday are read
// from them in the reader's own time zone, which a day bucketed here, in the
// server's, could not give back. Bounded both ways so an often-opened
// bookmark does not grow its page file without end: half a year, and a
// year's worth of daily opens at most.
const (
	openLogMaxAgeDays = 180
	openLogMaxEntries = 365
)

// pruneOpenLog returns the log in time order, without opens older than
// openLogMaxAgeDays and, past openLogMaxEntries, without the oldest.
func pruneOpenLog(log []int64, now int64) []int64 {
	if len(log) == 0 {
		return nil
	}
	cutoff := now - int64(openLogMaxAgeDays)*int64(24*time.Hour/time.Millisecond)
	kept := make([]int64, 0, len(log))
	for _, ts := range log {
		if ts >= cutoff && ts <= now {
			kept = append(kept, ts)
		}
	}
	sort.Slice(kept, func(i, j int) bool { return kept[i] < kept[j] })
	if len(kept) > openLogMaxEntries {
		kept = kept[len(kept)-openLogMaxEntries:]
	}
	if len(kept) == 0 {
		return nil
	}
	return kept
}
