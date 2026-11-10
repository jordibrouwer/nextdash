package app

import (
	"context"
	"errors"
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

// checksOfMovedRow is the checks of the stored row a move comes from: the row
// with this address on a page other than the one it moves to. A move is an add
// followed by a delete, and the checks (and so their history) go with it. nil
// when there is no such row.
func checksOfMovedRow(store Store, movedFrom string, toPage int) []NetCheck {
	key := canonicalBookmarkURLKey(movedFrom)
	if key == "" {
		return nil
	}
	for _, page := range store.GetPages() {
		if page.ID == toPage {
			continue
		}
		for _, bm := range store.GetBookmarksByPage(page.ID) {
			if canonicalBookmarkURLKey(bm.URL) == key && len(bm.Checks) > 0 {
				return append([]NetCheck(nil), bm.Checks...)
			}
		}
	}
	return nil
}

// netCheckLedger counts what the rest of the install holds: every check ID, and
// how many of the checks are enabled, leaving out the row at (skipPage, skipIdx)
// (skipIdx < 0 leaves out none). It reads the store, so it is never called from
// inside a page mutation.
func netCheckLedger(store Store, skipPage, skipIdx int) (taken map[string]bool, enabled int) {
	taken = map[string]bool{}
	for _, page := range store.GetPages() {
		for i, bm := range store.GetBookmarksByPage(page.ID) {
			if page.ID == skipPage && i == skipIdx {
				continue
			}
			for _, c := range bm.Checks {
				taken[c.ID] = true
				if c.Enabled {
					enabled++
				}
			}
		}
	}
	return taken, enabled
}

// restoredNetChecks is what a bookmark that comes back from the trash may keep
// of the checks it carries. The trash entry was reported by a tab, so the list
// goes through the same rules as a saved one (a fresh ID each, the limits, the
// ceiling, the credential and the custom host), with no stored row to inherit
// from: the baseline and the drift are the server's and are not taken from it.
// A list that over the ceiling comes back switched off rather than lost; one that
// does not hold up at all is dropped. The caller holds h.netChecksMu.
func (h *Handlers) restoredNetChecks(bm Bookmark) []NetCheck {
	if len(bm.Checks) == 0 {
		return nil
	}
	settings := h.store.GetSettings()
	taken, enabled := netCheckLedger(h.store, 0, -1)
	out, err := normalizeNetChecks(bm.Checks, nil, bm, settings, taken, enabled)
	if errors.Is(err, errNetCheckCap) {
		off := append([]NetCheck(nil), bm.Checks...)
		for i := range off {
			off[i].Enabled = false
		}
		out, err = normalizeNetChecks(off, nil, bm, settings, taken, enabled)
	}
	if err != nil || len(out) == 0 {
		return nil
	}
	return out
}
