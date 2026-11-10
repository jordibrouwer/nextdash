package app

import (
	"context"
	"sort"
	"strings"
	"time"
)

// netDue is one network check that is due this round, with what the monitor
// loop needs to run it and file the answer.
type netDue struct {
	key      string // netHistoryKey(check.ID)
	bm       Bookmark
	pageID   int
	check    NetCheck
	host     string // the host gate: same key as an HTTP check on that host
	interval time.Duration
	muted    bool
}

// netOutcome is the answer of one due check.
type netOutcome struct {
	due netDue
	res NetResult
}

// dueNetChecks collects the enabled checks whose last sample is older than
// their interval, and the history key of every check that exists (enabled or
// not) so a sweep never drops the history of a switched-off check.
//
// Nothing is due when network checks are switched off; known is still full, as
// turning them off promises the history stays. At most netMaxPerTick are due,
// the longest unchecked first. A check ID that occurs twice (corrupt data) is
// scheduled once.
func (h *Handlers) dueNetChecks(now time.Time, history map[string][]HealthSample, s Settings) (due []netDue, known []string) {
	seen := map[string]bool{}
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			for _, chk := range bm.Checks {
				if chk.ID == "" {
					continue
				}
				if seen[chk.ID] {
					logWarn(logComponentHealth, "network check %s occurs twice; the second one is skipped", chk.ID)
					continue
				}
				seen[chk.ID] = true
				key := netHistoryKey(chk.ID)
				known = append(known, key)
				if !s.NetToolsEnabled || !chk.Enabled || !netTypesBuilt[chk.Type] {
					continue
				}
				interval := netCheckInterval(chk, bm)
				if samples := history[key]; len(samples) > 0 {
					last := time.UnixMilli(samples[len(samples)-1].T)
					if now.Sub(last) < interval-monitorDueSlack {
						continue
					}
				}
				host := monitorHostKey(bm.URL)
				if target, err := netCheckTarget(bm, chk, s); err == nil && target.Host != "" {
					host = target.Host
				}
				due = append(due, netDue{
					key:      key,
					bm:       bm,
					pageID:   page.ID,
					check:    chk,
					host:     strings.ToLower(host),
					interval: interval,
					muted:    bm.NotifyMuted || chk.Muted,
				})
			}
		}
	}
	sort.SliceStable(due, func(i, j int) bool {
		return lastSampleAt(history[due[i].key]) < lastSampleAt(history[due[j].key])
	})
	if len(due) > netMaxPerTick {
		due = due[:netMaxPerTick]
	}
	return due, known
}

// netClassNotAnOutage are the classes that say something about this install's
// settings, not about the network: a guard refusal, the demo, a switched-off or
// forbidden ping. They are never retried and never count towards the
// "this server is offline" guard.
func netClassNotAnOutage(class string) bool {
	return class == "guard" || class == "demo" || class == "icmp"
}

// runNetDue runs one due check, and once more after a short wait when it
// failed, so a blip is confirmed before it is believed. A refusal by the guard
// is final and not retried.
func (h *Handlers) runNetDue(ctx context.Context, d netDue) NetResult {
	run := h.netRunner
	if run == nil {
		run = h.runNetCheck
	}
	res := run(ctx, d.bm, d.check)
	for attempt := 0; attempt < monitorConfirmRetries && !res.OK && !netClassNotAnOutage(res.Class); attempt++ {
		select {
		case <-ctx.Done():
			return res
		case <-time.After(monitorConfirmDelay):
			res = run(ctx, d.bm, d.check)
		}
	}
	return res
}

// netSweepHostResult is a network check as the offline-guard's input. Results
// that are not about the network are left out.
func netSweepHostResult(out netOutcome) (sweepHostResult, bool) {
	if out.due.host == "" || netClassNotAnOutage(out.res.Class) {
		return sweepHostResult{}, false
	}
	return sweepHostResult{Host: out.due.host, Answered: out.res.OK, Class: out.res.Class}, true
}

// netHoldableFailure is whether a failed check is held back when the sweep
// looks offline: only a failure of a host that needs the internet.
func netHoldableFailure(out netOutcome) bool {
	if out.res.OK || netClassNotAnOutage(out.res.Class) {
		return false
	}
	return !hostNeedsNoInternet(out.due.host)
}

// mergeNetChecksInto moves the checks of a duplicate that is being merged away
// onto the bookmark that stays (at most netMaxChecksPerBookmark; IDs, and so
// the history, are kept).
func mergeNetChecksInto(keeper *Bookmark, src Bookmark) {
	have := map[string]bool{}
	for _, c := range keeper.Checks {
		have[c.ID] = true
	}
	for _, c := range src.Checks {
		if len(keeper.Checks) >= netMaxChecksPerBookmark {
			return
		}
		if c.ID == "" || have[c.ID] {
			continue
		}
		have[c.ID] = true
		keeper.Checks = append(keeper.Checks, c)
	}
}
