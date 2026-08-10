package main

import (
	"context"
	"log"
	"sync"
	"time"
)

const (
	// defaultMonitorIntervalMinutes is the cadence a bookmark gets when it is
	// marked as a monitor without choosing an interval.
	defaultMonitorIntervalMinutes = 15
	// minMonitorIntervalMinutes / maxMonitorIntervalMinutes bound the per-bookmark
	// cadence. The floor is deliberately far above Uptime Kuma's 60s: this is a
	// bookmark dashboard sharing one outbound budget with favicons and previews,
	// not a NOC. The ceiling keeps a monitor meaningfully different from the
	// existing hourly recheck tier.
	minMonitorIntervalMinutes = 5
	maxMonitorIntervalMinutes = 24 * 60
	// monitorTickInterval is how often the scheduler looks for due monitors. It
	// must divide the minimum interval closely enough that "every 5 minutes" is
	// honest without waking constantly.
	monitorTickInterval = 1 * time.Minute
	// monitorDueSlack lets a check run slightly before its interval has fully
	// elapsed. A sample is timestamped after its ping completes, so it always
	// lands a little past the tick that scheduled it. Without slack the next tick
	// falls just short of the interval, the check slips a whole tick, and the
	// drift compounds: a 5-minute monitor settles into checking every 6 minutes.
	monitorDueSlack = monitorTickInterval / 2
	// monitorMaxConcurrentPings bounds parallel outbound checks so a batch of slow
	// or unreachable hosts cannot saturate the shared outbound budget.
	monitorMaxConcurrentPings = 8
	// monitorRunTimeout is a ceiling for one full sweep.
	monitorRunTimeout = 10 * time.Minute
)

// clampMonitorIntervalMinutes normalizes a stored/incoming per-bookmark cadence,
// mirroring clampHealthAutoRecheckIntervalHours: zero means "use the default",
// anything outside the bounds is pulled back in range.
func clampMonitorIntervalMinutes(minutes int) int {
	if minutes <= 0 {
		return defaultMonitorIntervalMinutes
	}
	if minutes < minMonitorIntervalMinutes {
		return minMonitorIntervalMinutes
	}
	if minutes > maxMonitorIntervalMinutes {
		return maxMonitorIntervalMinutes
	}
	return minutes
}

// monitorTarget is one bookmark due for a check, resolved to its canonical key.
type monitorTarget struct {
	key      string
	url      string
	name     string
	pageID   int
	interval time.Duration
}

// StartHealthMonitorScheduler runs the uptime-monitor loop until stop is closed.
//
// This is a second, faster tier alongside StartHealthRecheckScheduler, which is
// left untouched: that one re-checks the whole checkStatus set every N hours to
// keep the quality report fresh, while this one polls a small opted-in set often
// enough to draw a heartbeat.
func (h *Handlers) StartHealthMonitorScheduler(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(monitorTickInterval)
		defer ticker.Stop()

		h.runDueMonitors()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				h.runDueMonitors()
			}
		}
	}()
}

// dueMonitorTargets collects monitored bookmarks whose last recorded sample is
// older than their interval. Bookmarks with no history yet are always due, so a
// freshly-marked monitor produces its first heartbeat on the next tick.
func (h *Handlers) dueMonitorTargets(now time.Time) (targets []monitorTarget, known map[string]bool) {
	history := h.readAllHealthHistory()
	known = map[string]bool{}
	seen := map[string]bool{}

	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if !bm.Monitor {
				continue
			}
			key := canonicalBookmarkURLKey(bm.URL)
			if key == "" {
				continue
			}
			known[key] = true
			// The same URL can be bookmarked on several pages; check it once.
			if seen[key] {
				continue
			}
			seen[key] = true

			interval := time.Duration(clampMonitorIntervalMinutes(bm.MonitorIntervalMinutes)) * time.Minute
			samples := history[key]
			if len(samples) > 0 {
				last := time.UnixMilli(samples[len(samples)-1].T)
				if now.Sub(last) < interval-monitorDueSlack {
					continue
				}
			}
			targets = append(targets, monitorTarget{
				key:      key,
				url:      bm.URL,
				name:     bm.Name,
				pageID:   page.ID,
				interval: interval,
			})
		}
	}
	return targets, known
}

// runDueMonitors pings every due monitor once and records the results.
//
// Both stores are written: the existing health cache so the current view and
// score stay correct, and the new history so uptime/heartbeat/incidents have
// something to derive from.
func (h *Handlers) runDueMonitors() {
	now := time.Now()
	targets, known := h.dueMonitorTargets(now)

	// Sweep even when nothing is due, so un-monitoring or deleting a bookmark
	// reclaims its history without needing a due check to trigger it.
	if len(targets) == 0 {
		if err := h.sweepHealthHistory(known); err != nil {
			log.Printf("health-monitor: history sweep failed: %v", err)
		}
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), monitorRunTimeout)
	defer cancel()

	type outcome struct {
		target monitorTarget
		result PingResult
		at     int64
	}

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		outcomes = make([]outcome, 0, len(targets))
		sem      = make(chan struct{}, monitorMaxConcurrentPings)
	)

	for _, target := range targets {
		wg.Add(1)
		go func(t monitorTarget) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result := h.pingURLDetailed(ctx, t.url)
			mu.Lock()
			outcomes = append(outcomes, outcome{target: t, result: result, at: time.Now().UnixMilli()})
			mu.Unlock()
		}(target)
	}
	wg.Wait()

	cacheUpdates := make(map[string]HealthScanCache, len(outcomes))
	historyUpdates := make(map[string][]HealthSample, len(outcomes))
	transitions := make([]monitorTransition, 0, len(outcomes))

	for _, out := range outcomes {
		up := out.result.Status == "online"
		errMsg := ""
		if !up {
			errMsg = out.result.ErrorDetail
			if errMsg == "" {
				errMsg = "Unreachable"
			}
		}

		cacheUpdates[out.target.key] = HealthScanCache{
			URL:         out.target.key,
			Status:      out.result.Status,
			PingMs:      out.result.PingMs,
			LastScanned: out.at,
			Error:       errMsg,
		}
		historyUpdates[out.target.key] = []HealthSample{{
			T:      out.at,
			Up:     up,
			PingMs: out.result.PingMs,
			Code:   out.result.HTTPStatus,
		}}
		transitions = append(transitions, monitorTransition{
			key:    out.target.key,
			name:   out.target.name,
			url:    out.target.url,
			up:     up,
			reason: errMsg,
			at:     out.at,
		})
	}

	// Notifications read the pre-append history to count consecutive failures, so
	// evaluate before writing this round's samples.
	pending := h.pendingMonitorNotifications(transitions)

	if err := h.appendHealthSamples(historyUpdates); err != nil {
		log.Printf("health-monitor: failed to append history: %v", err)
	}
	if err := h.sweepHealthHistory(known); err != nil {
		log.Printf("health-monitor: history sweep failed: %v", err)
	}
	if err := h.mergeHealthCacheUpdates(cacheUpdates); err != nil {
		log.Printf("health-monitor: failed to persist health cache: %v", err)
	}
	certResults := make([]PingResult, 0, len(outcomes))
	for _, out := range outcomes {
		certResults = append(certResults, out.result)
	}
	// Expiry warnings ride the same sinks as outages: the webhook someone set up
	// for downtime is where they want to hear that a certificate is about to
	// cause some.
	pending = append(pending, certExpiryNotifications(h.recordMonitorCertificates(certResults), time.Now())...)
	h.mirrorMonitorResultsToBookmarks(cacheUpdates)
	h.invalidateHealthReportCache()

	h.dispatchMonitorNotifications(ctx, pending)
}

// mirrorMonitorResultsToBookmarks copies each result onto the matching bookmarks
// so the row and the report score agree with the monitor, matching what
// runHealthRetest and CheckBookmarkHealthURL already do.
func (h *Handlers) mirrorMonitorResultsToBookmarks(updates map[string]HealthScanCache) {
	if len(updates) == 0 {
		return
	}
	for _, page := range h.store.GetPages() {
		relevant := false
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if _, ok := updates[canonicalBookmarkURLKey(bm.URL)]; ok {
				relevant = true
				break
			}
		}
		if !relevant {
			continue
		}
		err := h.store.MutateBookmarksOnPage(page.ID, func(current []Bookmark) ([]Bookmark, error) {
			for i := range current {
				update, ok := updates[canonicalBookmarkURLKey(current[i].URL)]
				if !ok {
					continue
				}
				current[i].LastChecked = update.LastScanned
				current[i].LastError = update.Error
			}
			return current, nil
		})
		if err != nil {
			log.Printf("health-monitor: failed to update bookmarks on page %d: %v", page.ID, err)
		}
	}
}
