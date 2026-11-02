package app

import (
	"strings"
	"time"
)

/*
Startup grace for bookmark health.

When a whole host reboots, the owner's own services (containers, LAN boxes)
come up at about the same time as nextDash, and one early check of a service
that is still starting would mark it broken. For a while after nextDash starts,
a bookmark's first failed check is therefore held back -- not recorded, the
previous status kept -- and it is checked again on the next tick. Only a second
failure of the same URL, far enough after the first, is believed.

The offline guard (health_network_guard.go) decides first; this rule applies to
the failures the guard did not hold.
*/

const (
	// startupGraceWindow is how long after the process starts a first failure is
	// held. Long enough for a slow host to bring its containers and NAS shares
	// up, short enough that a service that is really dead is not hidden for long.
	startupGraceWindow = 15 * time.Minute
	// startupGraceSecondFailureGap is how long after the first failure a second
	// one counts as a confirmation. The held target is due again on the next
	// one-minute tick; a failure sooner than this (the same URL checked twice in
	// one round) is not a second opinion.
	startupGraceSecondFailureGap = 45 * time.Second
	// startupGraceFirstFailureTTL is how long an unconfirmed first failure is
	// remembered. After that the next failure is a first one again.
	startupGraceFirstFailureTTL = 5 * time.Minute
)

// graceEntry is what is remembered about one URL during the window.
type graceEntry struct {
	at        time.Time // the first failure, or the confirming one
	confirmed bool      // a second failure was recorded; later failures are too
}

// graceDecide is the pure decision: should this check's failure be held back?
// pending is updated in place. A zero startedAt means no grace (a Handlers
// built without a start time, as in most tests).
//
// now is the START of the round being decided, so a slow first round does not
// shorten the gap to the second. window is how long after startedAt the rule
// holds (startupGraceWindow unless the environment says otherwise).
func graceDecide(now, startedAt time.Time, window time.Duration, pending map[string]graceEntry, key string, failed bool) (hold bool) {
	if startedAt.IsZero() || window <= 0 || now.Sub(startedAt) >= window {
		// After the window behaviour is as it always was; nothing is kept.
		if len(pending) > 0 {
			clear(pending)
		}
		return false
	}
	for k, e := range pending {
		if !e.confirmed && now.Sub(e.at) > startupGraceFirstFailureTTL {
			delete(pending, k)
		}
	}
	if !failed {
		delete(pending, key)
		return false
	}
	e, ok := pending[key]
	switch {
	case !ok:
		pending[key] = graceEntry{at: now}
		return true
	case e.confirmed:
		return false
	case now.Sub(e.at) < startupGraceSecondFailureGap:
		return true
	default:
		pending[key] = graceEntry{at: now, confirmed: true}
		return false
	}
}

func (h *Handlers) graceNow() time.Time {
	if h.clock != nil {
		return h.clock()
	}
	return time.Now()
}

// graceHold applies graceDecide to the Handlers' own state. key is the
// canonical URL key health samples use; at is the start of the round (zero
// means now). Call it once per key per round.
func (h *Handlers) graceHold(key string, failed bool, at time.Time) bool {
	if key == "" || h.startedAt.IsZero() {
		return false
	}
	if at.IsZero() {
		at = h.graceNow()
	}
	window := h.graceWindow
	if window <= 0 {
		window = startupGraceWindow
	}
	h.graceMu.Lock()
	defer h.graceMu.Unlock()
	if h.gracePending == nil {
		h.gracePending = map[string]graceEntry{}
	}
	return graceDecide(at, h.startedAt, window, h.gracePending, key, failed)
}

// graceWindowFromEnv reads NEXTDASH_HEALTH_STARTUP_GRACE: a Go duration such
// as "15m". Empty or invalid (or negative) is the default; "0" turns the grace
// off, which the end-to-end suite uses so its checks are deterministic.
func graceWindowFromEnv(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return startupGraceWindow
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		return startupGraceWindow
	}
	return d
}
