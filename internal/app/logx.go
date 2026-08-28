package app

import (
	"fmt"
	"log"
	"strings"
	"sync/atomic"
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
