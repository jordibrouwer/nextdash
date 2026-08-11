package main

import (
	"context"
	"log"
	"net/url"
	"strings"
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

// monitorIntervalMinutesFor is the configured cadence for a health report row.
//
// 0 for anything not monitored, so the field is omitted from the JSON rather
// than showing a meaningless default. For a monitored bookmark this is always
// clamped and present — unlike MonitorStats, which needs sample history that
// does not exist yet for a bookmark just switched on or just given a new
// interval, and must not be the only place this value lives.
func monitorIntervalMinutesFor(bm Bookmark) int {
	if !bm.Monitor {
		return 0
	}
	return clampMonitorIntervalMinutes(bm.MonitorIntervalMinutes)
}

// monitorTarget is one bookmark due for a check, resolved to its canonical key.
type monitorTarget struct {
	key      string
	url      string
	name     string
	pageID   int
	interval time.Duration
	// expect carries the bookmark's own definition of healthy — an expected
	// status code, an expected string in the page — resolved here so the check
	// goroutine does not have to reach back into the store.
	expect expectation
	// muted silences this bookmark's outbound alerts. Resolved with the rest of
	// the bookmark's settings so the notification pass never has to reach back
	// into the store for a bookmark that may since have moved.
	muted bool
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
//
// liveHosts carries every hostname a currently monitored bookmark could account
// for — its own URL plus whatever CertHost its last check recorded, since a
// redirecting bookmark's certificate lives under the post-redirect host, not
// its own. Used to prune certificates for hosts nothing monitored points at
// any more, without dropping one still in use just because of a redirect.
func (h *Handlers) dueMonitorTargets(now time.Time) (targets []monitorTarget, known map[string]bool, liveHosts map[string]struct{}) {
	history := h.readAllHealthHistory()
	known = map[string]bool{}
	liveHosts = map[string]struct{}{}
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
			if host := strings.ToLower(strings.TrimSpace(bm.CertHost)); host != "" {
				liveHosts[host] = struct{}{}
			}
			if parsed, err := url.Parse(strings.TrimSpace(bm.URL)); err == nil && parsed.Hostname() != "" {
				liveHosts[strings.ToLower(parsed.Hostname())] = struct{}{}
			}
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
				expect:   expectationFor(bm),
				muted:    bm.NotifyMuted,
			})
		}
	}
	return targets, known, liveHosts
}

// runDueMonitors pings every due monitor once and records the results.
//
// Both stores are written: the existing health cache so the current view and
// score stay correct, and the new history so uptime/heartbeat/incidents have
// something to derive from.
func (h *Handlers) runDueMonitors() {
	now := time.Now()
	targets, known, liveHosts := h.dueMonitorTargets(now)

	// Sweep even when nothing is due, so un-monitoring or deleting a bookmark
	// reclaims its history without needing a due check to trigger it.
	if len(targets) == 0 {
		if err := h.sweepHealthHistory(known); err != nil {
			log.Printf("health-monitor: history sweep failed: %v", err)
		}
		h.pruneCertificates(liveHosts)
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

			result := h.pingURLExpecting(ctx, t.url, t.expect)
			mu.Lock()
			outcomes = append(outcomes, outcome{target: t, result: result, at: time.Now().UnixMilli()})
			mu.Unlock()
		}(target)
	}
	wg.Wait()

	// One decision for the whole round: a window that opens mid-sweep should not
	// split it into alerting and non-alerting halves.
	inMaintenance := inMaintenanceWindow(h.store.GetSettings().MaintenanceWindows, now)

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
			Maint:  inMaintenance,
		}}
		transitions = append(transitions, monitorTransition{
			key:    out.target.key,
			name:   out.target.name,
			url:    out.target.url,
			up:     up,
			reason: errMsg,
			at:     out.at,
			muted:  out.target.muted,
		})
	}

	// Notifications read the pre-append history to count consecutive failures, so
	// evaluate before writing this round's samples.
	// Inside a window the checks still ran and the samples are still recorded;
	// only the alerting is held back. Suppressing the checks instead would hide a
	// real outage that happened to start during maintenance.
	var pending []monitorNotification
	if !inMaintenance {
		pending = h.pendingMonitorNotifications(transitions)
	}

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
	// This round's own CertHost observations belong in the live set too, so a
	// bookmark whose first-ever check just discovered a redirect does not have
	// its brand new certificate entry pruned again immediately below.
	for _, result := range certResults {
		if host := strings.ToLower(strings.TrimSpace(result.CertHost)); host != "" {
			liveHosts[host] = struct{}{}
		}
	}
	h.pruneCertificates(liveHosts)
	driftResults := make(map[string]PingResult, len(outcomes))
	for _, out := range outcomes {
		driftResults[out.target.key] = out.result
	}
	h.mirrorMonitorResultsToBookmarks(cacheUpdates, driftResults)
	h.invalidateHealthReportCache()

	h.dispatchMonitorNotifications(ctx, pending)
}

// mirrorMonitorResultsToBookmarks copies each result onto the matching bookmarks
// so the row and the report score agree with the monitor, matching what
// runHealthRetest and CheckBookmarkHealthURL already do.
func (h *Handlers) mirrorMonitorResultsToBookmarks(updates map[string]HealthScanCache, drift map[string]PingResult) {
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
				result := drift[canonicalBookmarkURLKey(current[i].URL)]
				if result.CertHost != "" {
					current[i].CertHost = result.CertHost
				}
				applyDriftResult(&current[i], result, update.LastScanned)
			}
			return current, nil
		})
		if err != nil {
			log.Printf("health-monitor: failed to update bookmarks on page %d: %v", page.ID, err)
		}
	}
}
