package app

import (
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// The five channels added after the eight in activity_log.go and the ninth
// (open) added alongside bookmark-open detail. Off by default like every
// channel here: loadActivityLogConfig's default set names only mutate and
// status, so a new channel constant needs nothing further to stay quiet on
// an upgrade.
const (
	activityCategorySearch      = "search"
	activityCategoryKeys        = "keys"
	activityCategoryNav         = "nav"
	activityCategorySession     = "session"
	activityCategoryClientError = "clienterror"
)

// activityUserText is where NEXTDASH_ACTIVITY_LOG_URLS will do its trimming
// once Phase 4 adds it — a search query today, full; host-only or nothing
// once that setting says so. Every place that logs client-typed text calls
// this instead of using the string directly, so that phase changes one
// function rather than every call site that logs something a person typed.
func activityUserText(s string) string {
	return s
}

// activitySessionIDPattern is the shape a per-tab session id may take: hex
// characters from crypto.getRandomValues, nothing else. It only relates one
// line to another — no server decision reads it — so the bar is "plausible",
// not verified.
var activitySessionIDPattern = regexp.MustCompile(`^[a-f0-9]{16,64}$`)

func validActivitySessionID(id string) string {
	if activitySessionIDPattern.MatchString(id) {
		return id
	}
	return ""
}

// Bounds for the free-text and count fields below. Every one of these is
// what the page claims, so a value of the right type but an unreasonable
// size gets truncated or dropped rather than trusted onto the disk whole.
const (
	activityMaxQueryRunes    = 500
	activityMaxResultCount   = 1_000_000
	activityMaxKeysPerFlush  = 200
	activityMaxKeyLen        = 40
	activityMaxKeyCount      = 1_000_000
	activityMaxNavDetailLen  = 120
	activityMaxErrorMsgRunes = 500
	activityMaxStackRunes    = 4000
	activityMaxScriptPathLen = 200
)

// truncateRunes (cuts to at most n runes without splitting one) already
// exists in inbox.go; reused here rather than redefined.

// activityNavActions is the fixed set of things nav.activity can report — a
// bookmark-page switch, a category folding open or closed, a layout change,
// or a switch between dashboard/health/inbox/config. "page" and "view" are
// deliberately separate: switching pages 1-9 and switching from the grid to
// Health are both "the reader went somewhere else" but not the same
// question, and a reader filtering the trail for one should not have to
// exclude the other by hand. Free text here would make "which happened" a
// string comparison instead of a field a query can group by.
var activityNavActions = map[string]bool{
	"page":              true,
	"view":              true,
	"category-expand":   true,
	"category-collapse": true,
	"layout":            true,
}

func logSearchActivity(query string, resultCount int, opened bool, sessionID string, r *http.Request) {
	if !activityEnabled(activityCategorySearch) {
		return
	}
	fields := activityFieldsFromRequest(r)
	fields["query"] = activityUserText(truncateRunes(query, activityMaxQueryRunes))
	if resultCount >= 0 && resultCount <= activityMaxResultCount {
		fields["resultCount"] = resultCount
	}
	fields["opened"] = opened
	if sid := validActivitySessionID(sessionID); sid != "" {
		fields["sessionId"] = sid
	}
	logActivity(activityCategorySearch, "search.query", fields,
		"a search was issued")
}

// logKeyActivity writes one line per key rather than one line per request,
// because "which shortcuts are dead" is a question answered by grepping for
// a key, and a payload with every key buried inside one JSON blob cannot be
// grepped that way. The client is expected to have aggregated presses over
// an interval already; this only bounds what a single flush can claim.
func logKeyActivity(counts map[string]int, sessionID string, r *http.Request) {
	if !activityEnabled(activityCategoryKeys) || len(counts) == 0 {
		return
	}
	sid := validActivitySessionID(sessionID)
	base := activityFieldsFromRequest(r)
	seen := 0
	for key, count := range counts {
		if seen >= activityMaxKeysPerFlush {
			return
		}
		key = strings.TrimSpace(key)
		if key == "" || len(key) > activityMaxKeyLen {
			continue
		}
		if count <= 0 || count > activityMaxKeyCount {
			continue
		}
		seen++
		fields := mergeActivityFields(base, map[string]any{
			"key":   key,
			"count": count,
		})
		if sid != "" {
			fields["sessionId"] = sid
		}
		logActivity(activityCategoryKeys, "keys.pressed", fields,
			"a keyboard shortcut fired")
	}
}

func logNavActivity(action, detail, sessionID string, r *http.Request) {
	if !activityEnabled(activityCategoryNav) {
		return
	}
	action = strings.ToLower(strings.TrimSpace(action))
	if !activityNavActions[action] {
		return
	}
	fields := activityFieldsFromRequest(r)
	fields["action"] = action
	if detail = strings.TrimSpace(detail); detail != "" {
		fields["detail"] = truncateRunes(detail, activityMaxNavDetailLen)
	}
	if sid := validActivitySessionID(sessionID); sid != "" {
		fields["sessionId"] = sid
	}
	logActivity(activityCategoryNav, "nav."+action, fields,
		"the view changed")
}

func logSessionActivity(pageID int, sessionID string, r *http.Request) {
	if !activityEnabled(activityCategorySession) {
		return
	}
	sid := validActivitySessionID(sessionID)
	if sid == "" {
		// The whole point of this channel is relating later lines to this
		// one; without a usable id there is nothing for it to do.
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), map[string]any{
		"sessionId": sid,
		"pageId":    pageID,
	})
	logActivity(activityCategorySession, "session.start", fields,
		"a dashboard tab loaded")
}

// activityScriptPath keeps the path a script error came from and drops
// everything else a URL can carry — origin, query, fragment — since none of
// that is needed to tell one broken widget file from another and a query
// string is exactly the kind of thing that turns out to carry a token.
func activityScriptPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	path := u.Path
	if len(path) > activityMaxScriptPathLen {
		path = path[:activityMaxScriptPathLen]
	}
	return path
}

func logClientErrorActivity(message, stack, script, sessionID string, r *http.Request) {
	if !activityEnabled(activityCategoryClientError) {
		return
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	fields := activityFieldsFromRequest(r)
	fields["message"] = truncateRunes(message, activityMaxErrorMsgRunes)
	if stack = strings.TrimSpace(stack); stack != "" {
		fields["stack"] = truncateRunes(stack, activityMaxStackRunes)
	}
	if path := activityScriptPath(script); path != "" {
		fields["script"] = path
	}
	if sid := validActivitySessionID(sessionID); sid != "" {
		fields["sessionId"] = sid
	}
	logActivity(activityCategoryClientError, "clienterror.report", fields,
		"a script error was reported")
}
