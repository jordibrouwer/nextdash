package main

import (
	"bufio"
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Server log capture for the in-app log viewer.

Everything on this server logs through the stdlib logger, which writes to
stderr and nowhere else — so there was no way to see what the server was doing
without shell access to the container. serverLogSink is installed as a second
writer alongside stderr, keeping the most recent lines in memory for the viewer
and appending them to a rotating file so the history survives a restart.

stderr keeps receiving everything unchanged, so `docker logs` behaves exactly as
it did before.
*/

const (
	// Lines kept in memory. At a few hundred bytes each this is a couple of MB
	// worst case, and it is the whole window the viewer can ever show.
	serverLogBufferLines = 2000
	// The on-disk copy is capped well below the activity log's 5MB: it is a
	// debugging convenience, not an audit trail.
	serverLogMaxBytes    = 2 << 20
	serverLogBackupCount = 2

	// Age-based retention, on top of the line and byte caps. 0 means keep
	// whatever fits until the user clears it.
	serverLogRetentionKeepAll  = 0
	serverLogMaxRetentionHours = 90 * 24
)

// clampServerLogRetentionHours keeps a stored retention inside a sane range.
// Anything negative is treated as "keep until cleared" rather than rejected,
// so a hand-edited settings.json cannot leave the buffer expiring instantly.
func clampServerLogRetentionHours(hours int) int {
	if hours <= 0 {
		return serverLogRetentionKeepAll
	}
	if hours > serverLogMaxRetentionHours {
		return serverLogMaxRetentionHours
	}
	return hours
}

// Severity labels. Derived rather than declared: the call sites are plain
// log.Printf with no level of their own, so the level has to be inferred from
// what was written.
const (
	logLevelInfo  = "info"
	logLevelWarn  = "warn"
	logLevelError = "error"
)

// One captured log line, as served to the viewer.
type serverLogEntry struct {
	Seq     int64  `json:"seq"`
	Time    string `json:"time"`
	Level   string `json:"level"`
	Source  string `json:"source"`
	Message string `json:"message"`

	// When the line was written, for age-based retention. Unexported, so it
	// stays out of the JSON; the client formats Time instead. Zero for a line
	// whose stamp did not parse, which retention then leaves alone rather than
	// guessing it is ancient.
	at time.Time
}

type serverLogSink struct {
	mu sync.Mutex
	// Ring of at most serverLogBufferLines entries, oldest first once wrapped.
	entries []serverLogEntry
	next    int64
	// Lines pushed out of the ring since the last clear, so the viewer can say
	// it is not showing everything.
	dropped int64
	// Partial trailing line from a Write that did not end in a newline.
	pending []byte
	file    *activityRotatingFile
	// Set while seeding from disk at boot, so replayed lines are not written
	// straight back to the file they came from.
	replaying bool
	// Age cap in hours, mirrored from settings; 0 keeps everything until the
	// user clears it. Held here so pruning does not read settings on every
	// captured line.
	retentionHours int
}

var serverLog = &serverLogSink{}

// ServerLogPath is where the on-disk copy lives.
func ServerLogPath() string {
	return filepath.Join(ResolveDataDir(), "server.log")
}

// InitServerLog wires the sink to disk and seeds the ring from the previous
// run. Call before log.SetOutput so nothing is captured half-configured.
func InitServerLog() {
	serverLog.mu.Lock()
	serverLog.file = &activityRotatingFile{
		path:     ServerLogPath(),
		maxBytes: serverLogMaxBytes,
		backups:  serverLogBackupCount,
	}
	serverLog.mu.Unlock()
	serverLog.seedFromDisk()
}

// Write implements io.Writer. The logger hands over one whole line per call in
// practice, but a writer may not assume that, so partial lines are buffered.
func (s *serverLogSink) Write(p []byte) (int, error) {
	n := len(p)
	s.mu.Lock()
	s.pending = append(s.pending, p...)
	var lines [][]byte
	for {
		i := bytes.IndexByte(s.pending, '\n')
		if i < 0 {
			break
		}
		line := make([]byte, i)
		copy(line, s.pending[:i])
		lines = append(lines, line)
		s.pending = s.pending[i+1:]
	}
	// A writer that never sees a newline must not grow without bound.
	if len(s.pending) > 64<<10 {
		s.pending = s.pending[:0]
	}
	s.mu.Unlock()

	for _, line := range lines {
		s.appendLine(string(line))
	}
	return n, nil
}

func (s *serverLogSink) appendLine(raw string) {
	raw = strings.TrimRight(raw, "\r")
	if strings.TrimSpace(raw) == "" {
		return
	}
	entry := parseServerLogLine(raw)

	s.mu.Lock()
	entry.Seq = s.next
	s.next++
	s.entries = append(s.entries, entry)
	s.pruneExpiredLocked()
	if len(s.entries) > serverLogBufferLines {
		drop := len(s.entries) - serverLogBufferLines
		s.entries = append([]serverLogEntry(nil), s.entries[drop:]...)
		s.dropped += int64(drop)
	}
	file := s.file
	replaying := s.replaying
	s.mu.Unlock()

	if file != nil && !replaying {
		_ = file.write([]byte(raw + "\n"))
	}
}

/*
Split a raw line into timestamp, source and message.

The logger's default flags put "2006/01/02 15:04:05 " in front of every line,
and most call sites then prefix a subsystem ("auto-backup: ...", "import: ..."),
which is what the viewer groups and filters on. Request lines come from
requestLogging and look like "<id> GET /api/pages 200 12B 1ms" instead — no
subsystem, but a status code worth reading a level from.
*/
func parseServerLogLine(raw string) serverLogEntry {
	entry := serverLogEntry{Level: logLevelInfo, Message: raw}

	rest := raw
	if at, after, ok := splitLogTimestamp(raw); ok {
		entry.at = at
		entry.Time = at.Format(time.RFC3339)
		rest = after
		entry.Message = after
	}

	if status, ok := requestLogStatus(rest); ok {
		entry.Source = "request"
		switch {
		case status >= 500:
			entry.Level = logLevelError
		case status >= 400:
			entry.Level = logLevelWarn
		}
		return entry
	}

	if source, msg, ok := splitLogSource(rest); ok {
		entry.Source = source
		entry.Message = msg
	}
	entry.Level = levelFromText(rest)
	return entry
}

// Pull the "2006/01/02 15:04:05" the logger's default flags emit. The caller
// formats it as RFC3339 for the client and keeps the time.Time for retention.
func splitLogTimestamp(raw string) (time.Time, string, bool) {
	const stamp = "2006/01/02 15:04:05"
	if len(raw) < len(stamp)+1 {
		return time.Time{}, raw, false
	}
	t, err := time.ParseInLocation(stamp, raw[:len(stamp)], time.Local)
	if err != nil {
		return time.Time{}, raw, false
	}
	return t, strings.TrimSpace(raw[len(stamp):]), true
}

// "auto-backup: created scheduled backup" → ("auto-backup", "created …").
//
// Every subsystem prefix in the codebase is lowercase ("import:", "web-push:",
// "health history:"), while the sentences that merely open with a colon are
// capitalised ("Dashboard: http://…", "Using data directory: …"). Requiring a
// lowercase first letter keeps those out, and a short prefix of at most two
// words keeps arbitrary prose out too.
func splitLogSource(rest string) (string, string, bool) {
	i := strings.Index(rest, ": ")
	if i <= 0 || i > 24 {
		return "", rest, false
	}
	source := rest[:i]
	if c := source[0]; c < 'a' || c > 'z' {
		return "", rest, false
	}
	if strings.ContainsAny(source, "\t/") || strings.Count(source, " ") > 1 {
		return "", rest, false
	}
	return source, strings.TrimSpace(rest[i+2:]), true
}

// Recognise a requestLogging line and read its HTTP status.
// Shape: "<reqID> <METHOD> <path> <status> <bytes>B <duration>".
func requestLogStatus(rest string) (int, bool) {
	fields := strings.Fields(rest)
	if len(fields) < 6 {
		return 0, false
	}
	switch fields[1] {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
	default:
		return 0, false
	}
	if !strings.HasPrefix(fields[2], "/") {
		return 0, false
	}
	status, err := strconv.Atoi(fields[3])
	if err != nil || status < 100 || status > 599 {
		return 0, false
	}
	return status, true
}

// Best-effort severity for non-request lines, from the words the call sites
// actually use. Deliberately conservative: anything unrecognised stays info.
func levelFromText(text string) string {
	lower := strings.ToLower(text)
	for _, w := range []string{"failed", "error", "could not", "cannot", "invalid", "rejected", "panic"} {
		if strings.Contains(lower, w) {
			return logLevelError
		}
	}
	for _, w := range []string{"warn", "skip", "retry", "unavailable", "timeout"} {
		if strings.Contains(lower, w) {
			return logLevelWarn
		}
	}
	return logLevelInfo
}

// SetRetentionHours applies a new age cap and drops anything already past it.
// Called when the setting is saved and once at startup.
func (s *serverLogSink) SetRetentionHours(hours int) {
	hours = clampServerLogRetentionHours(hours)
	s.mu.Lock()
	s.retentionHours = hours
	s.pruneExpiredLocked()
	s.mu.Unlock()
}

func (s *serverLogSink) RetentionHours() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.retentionHours
}

// Drop entries older than the age cap. Caller holds the mutex.
//
// Expired lines are not counted as "dropped": that number exists to warn that
// the ring overflowed and lines were lost unexpectedly, whereas ageing out is
// exactly what the user asked for.
func (s *serverLogSink) pruneExpiredLocked() {
	if s.retentionHours <= 0 || len(s.entries) == 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(s.retentionHours) * time.Hour)
	keep := s.entries[:0:0]
	for _, e := range s.entries {
		// A line whose stamp did not parse has no age to judge, so it stays.
		if !e.at.IsZero() && e.at.Before(cutoff) {
			continue
		}
		keep = append(keep, e)
	}
	s.entries = keep
}

// Entries newer than since (pass -1 for everything), optionally filtered.
// Returns the entries, the sequence to poll from next, and how many lines have
// been pushed out of the ring.
func (s *serverLogSink) Entries(since int64, level, query string, limit int) ([]serverLogEntry, int64, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Pruning on read as well as on write means a buffer that went quiet still
	// ages out instead of showing yesterday's lines forever.
	s.pruneExpiredLocked()

	query = strings.ToLower(strings.TrimSpace(query))
	out := make([]serverLogEntry, 0, len(s.entries))
	for _, e := range s.entries {
		if e.Seq <= since {
			continue
		}
		if !logLevelAtLeast(e.Level, level) {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(e.Message), query) &&
			!strings.Contains(strings.ToLower(e.Source), query) {
			continue
		}
		out = append(out, e)
	}
	// Newest wins when there are more matches than asked for: the viewer is a
	// tail, so the end of the list is the part worth keeping.
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, s.next, s.dropped
}

// Whether an entry passes a minimum-severity filter. An empty or unknown
// filter keeps everything.
func logLevelAtLeast(entry, min string) bool {
	rank := map[string]int{logLevelInfo: 0, logLevelWarn: 1, logLevelError: 2}
	want, ok := rank[min]
	if !ok {
		return true
	}
	return rank[entry] >= want
}

// Counts for the summary tiles, over the whole buffer rather than the current
// filter.
func (s *serverLogSink) Stats() (total, warn, errCount int, dropped int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked()
	for _, e := range s.entries {
		switch e.Level {
		case logLevelError:
			errCount++
		case logLevelWarn:
			warn++
		}
	}
	return len(s.entries), warn, errCount, s.dropped
}

// Everything currently held, oldest first — used for the download.
func (s *serverLogSink) All() []serverLogEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked()
	return append([]serverLogEntry(nil), s.entries...)
}

// Clear empties the ring and truncates the on-disk copy, including its
// rotated backups: a user asking to clear the log means all of it.
func (s *serverLogSink) Clear() {
	s.mu.Lock()
	s.entries = nil
	s.dropped = 0
	s.pending = nil
	file := s.file
	s.mu.Unlock()

	if file == nil {
		return
	}
	file.mu.Lock()
	defer file.mu.Unlock()
	_ = os.Remove(file.path)
	for i := 1; i <= file.backupCount(); i++ {
		_ = os.Remove(file.path + "." + strconv.Itoa(i))
	}
	file.size = 0
}

// Fill the ring from the tail of the previous run's file, so the viewer is not
// blank after a restart.
func (s *serverLogSink) seedFromDisk() {
	path := ServerLogPath()
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	// Only the tail can survive in the ring, so keep just that many lines.
	tail := make([]string, 0, serverLogBufferLines)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for scanner.Scan() {
		tail = append(tail, scanner.Text())
		if len(tail) > serverLogBufferLines {
			tail = tail[1:]
		}
	}
	if err := scanner.Err(); err != nil {
		return
	}

	s.mu.Lock()
	s.replaying = true
	s.mu.Unlock()
	for _, line := range tail {
		s.appendLine(line)
	}
	s.mu.Lock()
	s.replaying = false
	// Replayed lines are history, not lines this run pushed out.
	s.dropped = 0
	// The file can hold lines older than the retention window (it is capped by
	// size, not age), so drop those rather than resurrecting them on restart.
	s.pruneExpiredLocked()
	s.mu.Unlock()
}
