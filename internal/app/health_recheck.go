package app

import (
	"context"
	"time"
)

const (
	// defaultHealthAutoRecheckIntervalHours is the out-of-box cadence for background
	// rechecks when the feature is enabled without an explicit interval.
	defaultHealthAutoRecheckIntervalHours = 24
	// minHealthAutoRecheckIntervalHours / maxHealthAutoRecheckIntervalHours bound the
	// configurable interval: often enough to be useful, never a tight ping loop, and
	// capped at a week so a stale setting can't silently stop rechecks forever.
	minHealthAutoRecheckIntervalHours = 1
	maxHealthAutoRecheckIntervalHours = 24 * 7
	// healthAutoRecheckCheckInterval is how often the scheduler wakes to see whether a
	// recheck is due. Short relative to the interval so "every N hours" stays honest
	// across container restarts, matching the auto-backup scheduler's approach.
	healthAutoRecheckCheckInterval = 15 * time.Minute
	// healthAutoRecheckSource labels the batch in the activity log.
	healthAutoRecheckSource = "health_auto_recheck"
)

// clampHealthAutoRecheckIntervalHours normalizes a stored/incoming interval: a
// zero or missing value becomes the default, and anything outside the bounds is
// pulled back in range.
func clampHealthAutoRecheckIntervalHours(hours int) int {
	if hours <= 0 {
		return defaultHealthAutoRecheckIntervalHours
	}
	if hours < minHealthAutoRecheckIntervalHours {
		return minHealthAutoRecheckIntervalHours
	}
	if hours > maxHealthAutoRecheckIntervalHours {
		return maxHealthAutoRecheckIntervalHours
	}
	return hours
}

// healthAutoRecheckInterval returns the configured cadence as a Duration.
func (h *Handlers) healthAutoRecheckInterval() time.Duration {
	hours := clampHealthAutoRecheckIntervalHours(h.store.GetSettings().HealthAutoRecheckIntervalHours)
	return time.Duration(hours) * time.Hour
}

// lastHealthAutoRecheck reads the persisted timestamp of the last completed
// background recheck (Unix ms, 0 when none yet).
func lastHealthAutoRecheck() int64 {
	return readHealthCacheFile().LastAutoRecheck
}

// markHealthAutoRecheck records that a background recheck just completed, so the
// next "is it due?" check survives a restart. Takes the same lock as
// mergeHealthCacheUpdates so a concurrent manual retest can't clobber the stamp.
func (h *Handlers) markHealthAutoRecheck(at time.Time) error {
	h.healthCacheMu.Lock()
	defer h.healthCacheMu.Unlock()
	cache := readHealthCacheFile()
	cache.LastAutoRecheck = at.UnixMilli()
	return writeHealthCacheFile(normalizeHealthCacheFile(cache))
}

// healthAutoRecheckDue reports whether a background recheck should run now: when
// none has run yet, or the last one is older than the configured interval.
func (h *Handlers) healthAutoRecheckDue() bool {
	last := lastHealthAutoRecheck()
	if last <= 0 {
		return true
	}
	elapsed := time.Since(time.UnixMilli(last))
	return elapsed >= h.healthAutoRecheckInterval()
}

// StartHealthRecheckScheduler runs a background recheck loop until stop is closed.
// It respects HealthAutoRecheckEnabled (re-read before each run) and is robust
// across restarts by comparing the persisted last-run time rather than an
// in-process timer.
func (h *Handlers) StartHealthRecheckScheduler(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(healthAutoRecheckCheckInterval)
		defer ticker.Stop()

		h.maybeRunHealthAutoRecheck()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				h.maybeRunHealthAutoRecheck()
			}
		}
	}()
}

// maybeRunHealthAutoRecheck runs a background recheck when the setting is enabled
// and one is due. The scope mirrors the health page's "Retest all" (includeFlagged)
// so background runs can clear a broken row the same way a manual run does.
func (h *Handlers) maybeRunHealthAutoRecheck() {
	if !h.store.GetSettings().HealthAutoRecheckEnabled {
		return
	}
	if !h.healthAutoRecheckDue() {
		return
	}

	// A generous ceiling: a slow batch of unreachable hosts must not run unbounded,
	// but it also must not be cut off before it can make progress.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	result, err := h.runHealthRetest(ctx, true, healthAutoRecheckSource)
	if err != nil {
		logError(logComponentHealth, "the scheduled re-check did not run: %v", err)
		return
	}
	// Stamp completion even when nothing was eligible, so an empty dashboard does not
	// re-run the (cheap but pointless) scan every check interval.
	if err := h.markHealthAutoRecheck(time.Now()); err != nil {
		logWarn(logComponentHealth, "the re-check ran but its run time could not be recorded (%v); the next one may come early", err)
	}
	logInfo(logComponentHealth, "the scheduled re-check covered %d bookmarks", result.Tested)
}
