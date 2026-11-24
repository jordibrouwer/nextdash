package app

import "time"

/*
alertSilence is what a bookmark's ignored health conditions mean for outbound
alerts: ignoring "broken" or "content" on a bookmark stops the webhook, the push
and the reminders for that kind of failure, the same way it already takes the
bookmark out of the counts.

It is per kind on purpose. Someone who ignored a failing keyword rule has not
asked to miss a real outage, so a content failure is held back only by "content"
and everything else only by "broken".

NotifyMuted stays separate. It means "do not alert, but keep showing it as
down"; this means "this is not a problem to report".
*/
type alertSilence struct {
	broken, content bool
}

func alertSilenceFor(bm Bookmark, now time.Time) alertSilence {
	if len(bm.HealthIgnored) == 0 {
		return alertSilence{}
	}
	set := healthIgnoreSet(bm.HealthIgnored, now)
	_, broken := set["broken"]
	_, content := set["content"]
	return alertSilence{broken: broken, content: content}
}

// merge unions two silences: one URL can be bookmarked twice, and ignoring any
// copy ignores the URL, as muting any copy mutes it.
func (s alertSilence) merge(o alertSilence) alertSilence {
	return alertSilence{broken: s.broken || o.broken, content: s.content || o.content}
}

// holds answers whether a down transition is held back, with the report's own
// idea of which failures are content ones (isContentFailure), so the alerts, the
// tile and the counts agree about what an ignore covers.
//
// A recovery is never held back here. An outage that was silenced was never
// stamped as alerted, and a recovery is only announced after an alert, so it
// stays quiet by itself. Holding it by kind instead dropped "back online" for
// an outage that had been announced: only "content" ignored, host goes down,
// down alert goes out, recovery was muted.
func (s alertSilence) holds(up bool, reason string) bool {
	if up {
		return false
	}
	if isContentFailure(reason) {
		return s.content
	}
	return s.broken
}
