package app

import (
	"bufio"
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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
	// Lines kept in memory in time mode, and the ceiling on what the viewer can
	// ever show. At a few hundred bytes each this is a couple of MB worst case.
	// Count mode replaces it with the chosen size, up to serverLogMaxEntries.
	serverLogBufferLines = 2000
	// The largest count mode offers, and so the largest the ring can grow to —
	// about 5MB of lines, which is still a sane amount to hold for a dashboard.
	serverLogMaxEntries = 5000
	// The on-disk copy is capped well below the activity log's 5MB: it is a
	// debugging convenience, not an audit trail.
	serverLogMaxBytes    = 2 << 20
	serverLogBackupCount = 2

	// Age-based retention, on top of the line and byte caps. 0 means keep
	// whatever fits until the user clears it.
	serverLogRetentionKeepAll  = 0
	serverLogMaxRetentionHours = 90 * 24

	// The two ways to cap the log, one at a time. Capping by both would drop
	// lines for a reason whichever control you were looking at cannot explain.
	serverLogModeTime  = "time"
	serverLogModeCount = "count"
)

// The entry counts offered in count mode. serverLogBufferLines is the ceiling
// in time mode, so the largest choice matches it rather than exceeding it.
var serverLogEntryChoices = []int{100, 500, 1000, 2500, 5000}

// What an install that never picked a size gets. Every settings.json written
// before count mode existed omits the field, so unset is the common case, not
// an edge one — and the config UI shows this same number as the default.
const serverLogDefaultMaxEntries = 1000

// clampServerLogRetentionMode falls back to the age cap, which is what every
// install had before the choice existed.
func clampServerLogRetentionMode(mode string) string {
	if mode == serverLogModeCount {
		return serverLogModeCount
	}
	return serverLogModeTime
}

// clampServerLogMaxEntries snaps to one of the offered sizes. A hand-edited
// value lands on the nearest one at or above it rather than being rejected.
//
// Zero and below mean "never chosen" rather than "as small as possible": the
// field is absent from every settings.json predating count mode, and snapping
// those to the smallest size would silently cap the log at 100 lines while the
// UI, which defaults the same field to serverLogDefaultMaxEntries, showed 1000.
func clampServerLogMaxEntries(n int) int {
	if n <= 0 {
		return serverLogDefaultMaxEntries
	}
	for _, choice := range serverLogEntryChoices {
		if n <= choice {
			return choice
		}
	}
	return serverLogEntryChoices[len(serverLogEntryChoices)-1]
}

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

// Severity labels. Declared by the writer: every line from logx opens with its
// level, and these are the names the viewer filters on. Inference survives only
// for lines that predate logx and for the Go runtime's own output.
const (
	logLevelInfo  = "info"
	logLevelWarn  = "warn"
	logLevelError = "error"

	// Not a severity but a source, and it travels in the same filter because the
	// viewer offers one "show me" control rather than two. Activity lines are
	// what the user did — a bookmark saved, a page added — written through the
	// same logger as everything else and, until this existed, findable only by
	// typing "activity" into the search box and knowing to.
	logFilterActivity = "activity"

	// The subsystem prefix logActivity writes, which parseServerLogLine already
	// splits into Source. The filter matches on that rather than on the text.
	logSourceActivity = "activity"
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
	// A real fixed-size ring: buf is allocated once at serverLogBufferLines and
	// start/count walk it. The previous version re-sliced a plain slice on every
	// append past capacity, copying ~197KB per line once full.
	buf   []serverLogEntry
	start int
	count int
	next  int64
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
	// captured line. Only consulted in time mode.
	retentionHours int
	// Which cap is in force, and the size behind the count one. Exactly one
	// applies: in count mode the ring is sized to maxEntries and nothing ages
	// out; in time mode the ring is the default size and age decides.
	retentionMode string
	maxEntries    int
	// Whether capture is running. Read on every logged line, so it is an
	// atomic rather than something that needs the mutex: paused means Write
	// returns before touching the lock at all.
	paused atomic.Bool
}

var serverLog = &serverLogSink{}

// ServerLogPath is where the on-disk copy lives.
func ServerLogPath() string {
	return filepath.Join(ResolveDataDir(), "server.log")
}

// InitServerLog wires the sink to disk.
//
// Starts paused: settings are not readable yet at this point in startup, and
// capturing until they are would mean the first seconds of every boot are
// collected whatever the user chose. ConfigureServerLog applies the setting
// and seeds from disk once the store exists.
func InitServerLog() {
	serverLog.paused.Store(true)
	serverLog.mu.Lock()
	serverLog.file = &activityRotatingFile{
		path:     ServerLogPath(),
		maxBytes: serverLogMaxBytes,
		backups:  serverLogBackupCount,
		// Every request writes a line here, so the handle stays open rather
		// than paying stat+open+close each time.
		keepOpen: true,
	}
	serverLog.mu.Unlock()
}

// ConfigureServerLog applies the stored settings and, when collecting is on,
// fills the ring from the previous run. With it off nothing is seeded: a log
// the user switched off should be empty, not repopulated from disk on restart.
func ConfigureServerLog(enabled bool, mode string, retentionHours, maxEntries int) {
	serverLog.SetRetention(mode, retentionHours, maxEntries)
	if !enabled {
		serverLog.SetPaused(true)
		return
	}
	serverLog.seedFromDisk()
	// Re-apply after seeding: the file is capped by size, not age, so it can
	// hold lines older than the window (seedFromDisk prunes too, but only what
	// the retention set before it knew about).
	serverLog.SetRetention(mode, retentionHours, maxEntries)
	serverLog.SetPaused(false)
}

// Write implements io.Writer. The logger hands over one whole line per call in
// practice, but a writer may not assume that, so partial lines are buffered.
func (s *serverLogSink) Write(p []byte) (int, error) {
	n := len(p)
	// Paused: report the write as accepted and do nothing. Returning a short
	// count would make the logger treat it as a failed write, and stderr —
	// the other half of the MultiWriter — has already had the line.
	if s.paused.Load() {
		return n, nil
	}
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
	s.pushLocked(entry)
	// Deliberately no prune here. Walking 2000 entries on every line cost more
	// than everything else put together (~105µs/line once full); the readers
	// prune instead, which is where a stale line would actually be seen.
	file := s.file
	replaying := s.replaying
	s.mu.Unlock()

	if file != nil && !replaying {
		_ = file.write([]byte(raw + "\n"))
	}
}

// Add one entry, overwriting the oldest once full. Caller holds the mutex.
func (s *serverLogSink) pushLocked(entry serverLogEntry) {
	if s.buf == nil {
		s.buf = make([]serverLogEntry, s.capacityLocked())
		s.start, s.count = 0, 0
	}
	if s.count < len(s.buf) {
		s.buf[(s.start+s.count)%len(s.buf)] = entry
		s.count++
		return
	}
	// Full: the slot the oldest occupies becomes the newest.
	s.buf[s.start] = entry
	s.start = (s.start + 1) % len(s.buf)
	// "Dropped" warns that the ring overflowed and lines were lost unexpectedly,
	// which is why ageing out is not counted either. In count mode overflowing
	// is the cap the user chose, so counting it would put a permanent "N older
	// lines dropped" warning on a log behaving exactly as asked — and that
	// detail line displaces the one naming the chosen size.
	if clampServerLogRetentionMode(s.retentionMode) != serverLogModeCount {
		s.dropped++
	}
}

// The ring flattened oldest-first. Caller holds the mutex.
func (s *serverLogSink) snapshotLocked() []serverLogEntry {
	out := make([]serverLogEntry, 0, s.count)
	for i := 0; i < s.count; i++ {
		out = append(out, s.buf[(s.start+i)%len(s.buf)])
	}
	return out
}

// Drop everything the ring holds. Caller holds the mutex.
func (s *serverLogSink) resetLocked() {
	s.buf = nil
	s.start, s.count = 0, 0
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

	// A line written through logx says its own level and component: "WARN
	// archive dash… ". Read them rather than guessing, so a summary that
	// mentions "2 failed" is not filed as an error.
	if level, source, msg, ok := splitDeclaredLevel(rest); ok {
		entry.Level = level
		entry.Source = source
		entry.Message = msg
		return entry
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

// splitDeclaredLevel reads the "LEVEL component message" shape logx writes.
// Both words have to be there and the level has to be one of the four, so a
// sentence that happens to open with a capitalised word is not mistaken for one.
func splitDeclaredLevel(text string) (level, source, message string, ok bool) {
	levelWord, rest, found := strings.Cut(text, " ")
	if !found {
		return "", "", "", false
	}
	_, known := logLevelRank[strings.ToLower(levelWord)]
	if !known || levelWord != strings.ToUpper(levelWord) {
		return "", "", "", false
	}
	component, msg, found := strings.Cut(rest, " ")
	if !found || component == "" {
		return "", "", "", false
	}
	return strings.ToLower(levelWord), component, msg, true
}

// Best-effort severity for lines that do not declare one: those written before
// logx existed, and those from the Go runtime. Deliberately conservative:
// anything unrecognised stays info.
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

// SetRetention applies both caps at once and re-caps what is already held.
//
// One call rather than two setters because the caps are exclusive: setting them
// separately would briefly leave the sink with neither or both in force, and
// the resize has to see the final mode to pick a capacity.
func (s *serverLogSink) SetRetention(mode string, hours, maxEntries int) {
	mode = clampServerLogRetentionMode(mode)
	hours = clampServerLogRetentionHours(hours)
	maxEntries = clampServerLogMaxEntries(maxEntries)

	s.mu.Lock()
	s.retentionMode = mode
	s.retentionHours = hours
	s.maxEntries = maxEntries
	s.resizeLocked()
	s.pruneExpiredLocked()
	s.mu.Unlock()
}

// Retention reports the active cap and the capacity it implies, for the
// viewer's controls. The capacity comes from here rather than being recomputed
// by the caller: it is the same rule pushLocked sizes the ring by, and two
// copies of it would drift the moment the modes change.
func (s *serverLogSink) Retention() (mode string, hours, maxEntries, capacity int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return clampServerLogRetentionMode(s.retentionMode),
		s.retentionHours,
		clampServerLogMaxEntries(s.maxEntries),
		s.capacityLocked()
}

// How many lines the ring holds under the current mode. Caller holds the mutex.
func (s *serverLogSink) capacityLocked() int {
	if clampServerLogRetentionMode(s.retentionMode) == serverLogModeCount {
		return clampServerLogMaxEntries(s.maxEntries)
	}
	return serverLogBufferLines
}

// Grow or shrink the ring to the current capacity, keeping the newest lines.
// Caller holds the mutex.
func (s *serverLogSink) resizeLocked() {
	want := s.capacityLocked()
	if s.buf == nil || len(s.buf) == want {
		return
	}
	kept := s.snapshotLocked()
	// Shrinking discards the oldest, exactly as the ring would have done had it
	// always been this size, so this is not counted as lines being dropped.
	if len(kept) > want {
		kept = kept[len(kept)-want:]
	}
	s.buf = make([]serverLogEntry, want)
	copy(s.buf, kept)
	s.start = 0
	s.count = len(kept)
}

// SetPaused starts or stops capture. Stopping keeps whatever is already held —
// it is a pause, not a clear — and releases the file handle so a stopped log
// holds nothing open.
func (s *serverLogSink) SetPaused(paused bool) {
	if s.paused.Swap(paused) == paused {
		return
	}
	if !paused {
		return
	}
	s.mu.Lock()
	file := s.file
	// Any half-line from mid-write is meaningless once capture stops.
	s.pending = nil
	s.mu.Unlock()
	if file != nil {
		file.mu.Lock()
		file.closeHandleLocked()
		file.mu.Unlock()
	}
}

func (s *serverLogSink) Paused() bool {
	return s.paused.Load()
}

// Drop entries older than the age cap. Caller holds the mutex.
//
// Expired lines are not counted as "dropped": that number exists to warn that
// the ring overflowed and lines were lost unexpectedly, whereas ageing out is
// exactly what the user asked for.
func (s *serverLogSink) pruneExpiredLocked() {
	// Count mode caps by how many lines are held, not how old they are, so age
	// is not consulted at all — a line stays until the ring pushes it out.
	if clampServerLogRetentionMode(s.retentionMode) == serverLogModeCount {
		return
	}
	if s.retentionHours <= 0 || s.count == 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(s.retentionHours) * time.Hour)

	// Entries go in oldest-first and never move, so expiry is a prefix: advance
	// start past the expired head and stop at the first line that survives.
	// No allocation, and nothing to do at all in the common case where the
	// oldest line is still inside the window.
	for s.count > 0 {
		e := s.buf[s.start]
		// A line whose stamp did not parse has no age to judge, so it stays —
		// and stops the scan, since anything behind it is newer still.
		if e.at.IsZero() || !e.at.Before(cutoff) {
			return
		}
		s.buf[s.start] = serverLogEntry{}
		s.start = (s.start + 1) % len(s.buf)
		s.count--
	}
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

	// Sequences only increase, so everything at or below `since` is a prefix of
	// the ring. A poll asking for "what is new" therefore skips straight to the
	// first unseen entry instead of walking all 2000 to reject them.
	first := 0
	if since >= 0 && s.count > 0 {
		oldest := s.buf[s.start].Seq
		if since >= oldest {
			if skip := int(since - oldest + 1); skip < s.count {
				first = skip
			} else {
				first = s.count
			}
		}
	}

	out := make([]serverLogEntry, 0, s.count-first)
	for i := first; i < s.count; i++ {
		e := s.buf[(s.start+i)%len(s.buf)]
		if e.Seq <= since {
			continue
		}
		if !logEntryMatchesFilter(e, level) {
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

// Whether an entry passes the viewer's "show me" filter, which is severity for
// three of its values and a source for the fourth.
func logEntryMatchesFilter(e serverLogEntry, filter string) bool {
	if filter == logFilterActivity {
		return isActivityComponent(e.Source)
	}
	return logLevelAtLeast(e.Level, filter)
}

/*
isActivityComponent reports whether a line came from the activity trail.

It used to be one source name: every trail line was written as "activity: {…}"
and carried that word. Now the trail writes a sentence under the channel it
belongs to — "INFO mutate added …" — so the filter matches the channel names
instead. Anything else, a request line or a plain server line, is not activity.
*/
func isActivityComponent(source string) bool {
	switch source {
	case logSourceActivity,
		activityCategoryMutate, activityCategoryStatus, activityCategoryOpen, activityCategorySecurity,
		activityCategoryHealth, activityCategorySources, activityCategoryFeeds, activityCategoryArchive,
		activityCategoryBackup, activityCategoryStore, activityCategoryWidgets, activityCategoryNotify:
		return true
	}
	return false
}

// Counts for the summary tiles, over the whole buffer rather than the current
// filter.
func (s *serverLogSink) Stats() (total, warn, errCount int, dropped int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked()
	for i := 0; i < s.count; i++ {
		switch s.buf[(s.start+i)%len(s.buf)].Level {
		case logLevelError:
			errCount++
		case logLevelWarn:
			warn++
		}
	}
	return s.count, warn, errCount, s.dropped
}

// Everything currently held, oldest first — used for the download.
func (s *serverLogSink) All() []serverLogEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked()
	return s.snapshotLocked()
}

// Clear empties the ring and truncates the on-disk copy, including its
// rotated backups: a user asking to clear the log means all of it.
func (s *serverLogSink) Clear() {
	s.mu.Lock()
	s.resetLocked()
	s.dropped = 0
	s.pending = nil
	file := s.file
	s.mu.Unlock()

	if file == nil {
		return
	}
	file.mu.Lock()
	defer file.mu.Unlock()
	// Drop the cached handle first: on Unix the file would otherwise keep
	// existing unlinked, and writes would go on landing in a file nobody can
	// see while the size counter says it is empty.
	file.closeHandleLocked()
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

	// Only the tail can survive in the ring, so keep just that many lines —
	// read under the current mode's capacity, which count mode can raise above
	// the default.
	s.mu.Lock()
	capacity := s.capacityLocked()
	s.mu.Unlock()
	tail := make([]string, 0, capacity)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for scanner.Scan() {
		tail = append(tail, scanner.Text())
		if len(tail) > capacity {
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
