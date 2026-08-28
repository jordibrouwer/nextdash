package app

import (
	"fmt"
	"log"
	"strings"
	"sync/atomic"
	"time"
)

/*
What the server says about itself.

Every line carries a level and a component, in one shape: "WARN archive dash…".
The buffer behind the Server log tab parses that shape, and the sentence after
it is written for someone who runs nextDash and does not read its source — the
address, the count, the status, and what it means, rather than a Go error
passed through.

The floor is a single atomic read on every call, so a level that is switched
off costs a comparison and no formatting at all.
*/

const (
	logLevelErrorName = "error"
	logLevelWarnName  = "warn"
	logLevelInfoName  = "info"
	logLevelDebugName = "debug"
)

// Components are constants rather than strings at the call site: "auto-backup"
// and "autobackup" cannot both come into being, and the settings panel can list
// them without guessing.
const (
	logComponentHealth  = "health"
	logComponentImport  = "import"
	logComponentSources = "sources"
	logComponentFeeds   = "feeds"
	logComponentArchive = "archive"
	logComponentBackup  = "backup"
	logComponentStore   = "store"
	logComponentWidgets = "widgets"
	logComponentNotify  = "notify"
	logComponentAuth    = "auth"
	logComponentMutate  = "mutate"
	logComponentStatus  = "status"
	logComponentServer  = "server"
)

// logLevelRank orders the levels; a line is written when its rank is at or
// below the floor's.
var logLevelRank = map[string]int{
	logLevelErrorName: 0,
	logLevelWarnName:  1,
	logLevelInfoName:  2,
	logLevelDebugName: 3,
}

// The floor, as a rank. Atomic because it is read on every log call and written
// from the settings save.
var logFloor atomic.Int64

func init() {
	logFloor.Store(int64(logLevelRank[logLevelInfoName]))
}

// setLogLevel moves the floor. An unrecognised name leaves it alone: a typo in
// a settings file must not silence the server or flood it.
func setLogLevel(name string) {
	rank, ok := logLevelRank[strings.ToLower(strings.TrimSpace(name))]
	if !ok {
		return
	}
	logFloor.Store(int64(rank))
}

func currentLogLevel() string {
	floor := int(logFloor.Load())
	for name, rank := range logLevelRank {
		if rank == floor {
			return name
		}
	}
	return logLevelInfoName
}

// logEnabled reports whether a line at this level would be written, so an
// expensive message can be skipped before it is built.
func logEnabled(level string) bool {
	rank, ok := logLevelRank[level]
	return ok && int64(rank) <= logFloor.Load()
}

func logAt(level, component, format string, args ...any) {
	if !logEnabled(level) {
		return
	}
	message := format
	if len(args) > 0 {
		message = fmt.Sprintf(format, args...)
	}
	log.Printf("%s %s %s", strings.ToUpper(level), component, message)
}

func logError(component, format string, args ...any) {
	logAt(logLevelErrorName, component, format, args...)
}

func logWarn(component, format string, args ...any) {
	logAt(logLevelWarnName, component, format, args...)
}

func logInfo(component, format string, args ...any) {
	logAt(logLevelInfoName, component, format, args...)
}

func logDebug(component, format string, args ...any) {
	logAt(logLevelDebugName, component, format, args...)
}

/*
Request lines are the one exception to the shape above.

They have carried "<id> METHOD /path STATUS BYTES DURATION" since before this
layer existed, the viewer reads their level from the status code rather than
from a word, and there are thousands of them. Prefixing them would cost the
parser its cheapest branch and gain nothing a reader wants. They still pass
through here, so logx stays the only door to the logger, and they still answer
to the floor: at Quiet, request lines stop.
*/
func logRequestLine(format string, args ...any) {
	if !logEnabled(logLevelInfoName) {
		return
	}
	log.Printf(format, args...)
}

// logCheckRound is the one line a finished sweep writes, and the trail entry
// that goes with it. A helper rather than each call site's own formatting,
// because the round is reported from two places — the scheduler and a manual
// re-check — and they must read the same.
//
// The sentence is written here rather than handed to logActivity, because the
// health channel is off by default and this line should appear either way.
func logCheckRound(checked, failed int, took time.Duration) {
	took = took.Round(100 * time.Millisecond)
	logInfo(logComponentHealth, "checked %s, %d failed, %s", plural(checked, "bookmark", "bookmarks"), failed, took)
	if activityEnabled(activityCategoryHealth) {
		logActivity(activityCategoryHealth, "health.round", map[string]any{
			"checked": checked,
			"failed":  failed,
			"ms":      took.Milliseconds(),
		}, "")
	}
}

/*
applyLogSettings puts the reader's choices in charge.

Anything they have not chosen is left to the environment: an empty level does
not reset the floor a compose file set, and an empty channel list does not
override NEXTDASH_ACTIVITY_LOG. That is the whole precedence rule — the app
wins where it has an opinion, and stays quiet where it does not.
*/
func applyLogSettings(s Settings) {
	if level := strings.TrimSpace(s.ServerLogLevel); level != "" {
		setLogLevel(level)
	}
	if len(s.ActivityChannels) > 0 {
		enabled := make(map[string]bool, len(s.ActivityChannels))
		for _, channel := range s.ActivityChannels {
			if key := strings.ToLower(strings.TrimSpace(channel)); key != "" {
				enabled[key] = true
			}
		}
		setActivityChannelsForRuntime(enabled)
	}
}

/*
plural is "1 feed" rather than "1 feeds".

Only for the log's own sentences, which are English by design — these lines go
to the container log, where they are read by whoever runs the server, and they
are deliberately not translated. Anything shown in the app goes through the
locale files instead.
*/
func plural(n int, singular, pluralForm string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, singular)
	}
	return fmt.Sprintf("%d %s", n, pluralForm)
}
