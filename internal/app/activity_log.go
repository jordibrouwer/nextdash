package app

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	activityCategoryMutate   = "mutate"
	activityCategoryStatus   = "status"
	activityCategoryOpen     = "open"
	activityCategorySecurity = "security"

	// The eight channels the rest of the server writes to. All off unless
	// asked for: a trail nobody switched on should not start filling the disk
	// the moment someone upgrades.
	activityCategoryHealth  = "health"
	activityCategorySources = "sources"
	activityCategoryFeeds   = "feeds"
	activityCategoryArchive = "archive"
	activityCategoryBackup  = "backup"
	activityCategoryStore   = "store"
	activityCategoryWidgets = "widgets"
	activityCategoryNotify  = "notify"

	activityLogMaxBytes     = 5 << 20
	activityLogBackupCount  = 3
	activityStatusDedupeTTL = 10 * time.Minute
)

type activityLogConfig struct {
	enabled     map[string]bool
	persist     bool
	filePath    string
	disabled    bool
	openDetail  string
	format      string
	urls        string
	sampleRates map[string]float64
	maxAgeDays  int
}

var (
	// activityCfgMu guards a runtime replacement of the config; the read path
	// is unsynchronised and hot, so the swap is done whole rather than field by
	// field.
	activityCfgMu    sync.Mutex
	activityCfgOnce  sync.Once
	activityCfg      activityLogConfig
	activityCfgTest  *activityLogConfig
	activityFile     *activityRotatingFile
	activityFileOnce sync.Once

	activityStatusDedupe = newStatusDedupeCache(activityStatusDedupeTTL)
)

func loadActivityLogConfig() activityLogConfig {
	raw := strings.TrimSpace(os.Getenv("NEXTDASH_ACTIVITY_LOG"))
	if strings.EqualFold(raw, "off") {
		return activityLogConfig{disabled: true, enabled: map[string]bool{}}
	}

	enabled := map[string]bool{
		activityCategoryMutate: true,
		activityCategoryStatus: true,
	}
	if raw != "" {
		enabled = map[string]bool{}
		for _, part := range strings.Split(raw, ",") {
			key := strings.ToLower(strings.TrimSpace(part))
			if key != "" {
				enabled[key] = true
			}
		}
	}

	cfg := activityLogConfig{enabled: enabled}
	cfg.openDetail = strings.TrimSpace(os.Getenv("NEXTDASH_ACTIVITY_OPEN_DETAIL"))
	cfg.format = strings.TrimSpace(os.Getenv("NEXTDASH_ACTIVITY_LOG_FORMAT"))
	cfg.urls = strings.TrimSpace(os.Getenv("NEXTDASH_ACTIVITY_LOG_URLS"))
	if sampleRaw := strings.TrimSpace(os.Getenv("NEXTDASH_ACTIVITY_LOG_SAMPLE")); sampleRaw != "" {
		rates, badPart := parseActivitySampleRates(sampleRaw)
		if badPart != "" {
			// Once, at startup: a malformed rate is a configuration mistake to
			// notice and fix, not a line to repeat on every request that would
			// otherwise have been sampled.
			logWarn(logComponentServer,
				"NEXTDASH_ACTIVITY_LOG_SAMPLE: %q is not channel=rate with rate in [0,1]; sampling is off, every channel logs in full",
				badPart)
		} else {
			cfg.sampleRates = rates
		}
	}
	if ageRaw := strings.TrimSpace(os.Getenv("NEXTDASH_ACTIVITY_LOG_MAX_AGE_DAYS")); ageRaw != "" {
		if days, err := strconv.Atoi(ageRaw); err == nil && days > 0 {
			cfg.maxAgeDays = days
		}
	}
	if strings.TrimSpace(os.Getenv("NEXTDASH_ACTIVITY_LOG_PERSIST")) == "1" {
		cfg.persist = true
		cfg.filePath = strings.TrimSpace(os.Getenv("NEXTDASH_ACTIVITY_LOG_FILE"))
		if cfg.filePath == "" {
			cfg.filePath = filepath.Join(ResolveDataDir(), "activity.log")
		}
	}
	return cfg
}

func activityConfig() activityLogConfig {
	if activityCfgTest != nil {
		return *activityCfgTest
	}
	activityCfgOnce.Do(func() {
		activityCfg = loadActivityLogConfig()
	})
	return activityCfg
}

/*
setActivityChannelsForRuntime replaces which channels are recorded, leaving
where they are written alone.

persist and filePath stay as the environment set them: choosing which channels
to record is a different question from whether the trail goes to disk, and
answering the first should not silently answer the second.
*/
func setActivityChannelsForRuntime(enabled map[string]bool) {
	cfg := activityConfig()
	cfg.enabled = enabled
	// A channel list that was asked for is an answer to "off", too.
	cfg.disabled = false
	activityCfgMu.Lock()
	defer activityCfgMu.Unlock()
	if activityCfgTest != nil {
		*activityCfgTest = cfg
		return
	}
	activityCfgOnce.Do(func() {})
	activityCfg = cfg
}

/*
setActivityOpenDetailForRuntime replaces how much an open record carries, the
same way setActivityChannelsForRuntime replaces which channels are on —
persistence and the channel list are left exactly as they were.
*/
func setActivityOpenDetailForRuntime(level string) {
	cfg := activityConfig()
	cfg.openDetail = level
	activityCfgMu.Lock()
	defer activityCfgMu.Unlock()
	if activityCfgTest != nil {
		*activityCfgTest = cfg
		return
	}
	activityCfgOnce.Do(func() {})
	activityCfg = cfg
}

// activityOpenDetailLevel is how much the open record carries beyond the
// pageId/index it always had: off strips source/method back out, basic is
// exactly Phase 1's two fields, and full adds the client-supplied extras.
// Basic is the default for the same reason the eight channels default off —
// an unset or unrecognised value must read as whatever a reader who has
// never touched this setting already has, which is Phase 1's shape.
func activityOpenDetailLevel() string {
	switch strings.ToLower(strings.TrimSpace(activityConfig().openDetail)) {
	case "off":
		return "off"
	case "full":
		return "full"
	default:
		return "basic"
	}
}

// activityLogFormatValue is text unless the reader asked for json, the same
// unset-reads-as-today's-shape rule every other knob here follows.
func activityLogFormatValue() string {
	if strings.EqualFold(strings.TrimSpace(activityConfig().format), "json") {
		return "json"
	}
	return "text"
}

// activityLogURLsValue is full — today's behaviour, complete URLs and query
// text — unless the reader asked for less.
func activityLogURLsValue() string {
	switch strings.ToLower(strings.TrimSpace(activityConfig().urls)) {
	case "host":
		return "host"
	case "off":
		return "off"
	default:
		return "full"
	}
}

// activityHostOnly keeps a URL's scheme and host and drops everything after
// it — path, query, fragment — since the query string is exactly where a
// token or a search term would otherwise ride along. Text that does not
// parse as a URL (an ordinary search query, most of the time) has no host to
// reduce it to, so it passes through unchanged: "host" is a statement about
// URLs, not a general redaction of anything that might resemble one.
func activityHostOnly(s string) string {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return trimmed
	}
	parsed, err := neturl.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return trimmed
	}
	return parsed.Scheme + "://" + parsed.Host
}

// activityURL is activityUserText's sibling for a call site that interpolates
// a URL directly into a readable sentence with fmt.Sprintf, rather than
// through a fields map. A field can drop out silently when its value is
// empty — logActivity already does that — but a sentence with a blank pair
// of parens reads as broken, so "off" here returns a fixed placeholder
// instead of "". Every place that builds a sentence containing a bookmark's
// address calls this rather than interpolating bm.URL, so NEXTDASH_ACTIVITY_LOG_URLS
// governs the sentence and the field the same way.
func activityURL(u string) string {
	switch activityLogURLsValue() {
	case "off":
		return "(url hidden)"
	case "host":
		return activityHostOnly(u)
	default:
		return u
	}
}

// activitySampleRand is a var so a test can pin the roll instead of
// tolerating a probabilistic assertion.
var activitySampleRand = rand.Float64

// activitySampleAllows is the per-channel sampling gate. A channel absent
// from the configured rates is unsampled — every line is logged, exactly as
// before this setting existed — and a malformed NEXTDASH_ACTIVITY_LOG_SAMPLE
// leaves the map empty, which reads the same way for every channel.
func activitySampleAllows(category string) bool {
	rates := activityConfig().sampleRates
	if rates == nil {
		return true
	}
	rate, ok := rates[category]
	if !ok {
		return true
	}
	if rate <= 0 {
		return false
	}
	if rate >= 1 {
		return true
	}
	return activitySampleRand() < rate
}

// parseActivitySampleRates reads "open=0.1,keys=0.25". The second return is
// the exact segment that failed to parse, so the startup warning can name it
// rather than making whoever set the variable guess which of several
// channels was the problem.
func parseActivitySampleRates(raw string) (map[string]float64, string) {
	rates := make(map[string]float64)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			return nil, part
		}
		channel := strings.ToLower(strings.TrimSpace(kv[0]))
		rate, err := strconv.ParseFloat(strings.TrimSpace(kv[1]), 64)
		if channel == "" || err != nil || rate < 0 || rate > 1 {
			return nil, part
		}
		rates[channel] = rate
	}
	if len(rates) == 0 {
		return nil, raw
	}
	return rates, ""
}

func activityEnabled(category string) bool {
	cfg := activityConfig()
	if cfg.disabled {
		return false
	}
	return cfg.enabled[strings.ToLower(strings.TrimSpace(category))]
}

func resetActivityLogForTest(cfg activityLogConfig) {
	copy := cfg
	activityCfgTest = &copy
	activityFileOnce = sync.Once{}
	activityFile = nil
	activityStatusDedupe = newStatusDedupeCache(activityStatusDedupeTTL)
}

func clearActivityLogTestOverride() {
	activityCfgTest = nil
}

// logActivity records one event twice, for two readers. The JSON goes to the
// activity file and the buffer, where a machine or a later search can find it;
// the sentence goes to the container log, where a person watching it can read
// what happened without parsing anything. Until this split the container log
// carried the JSON between its readable lines.
func logActivity(category, event string, fields map[string]any, sentence string) {
	if !activityEnabled(category) {
		return
	}
	if !activitySampleAllows(category) {
		return
	}
	entry := map[string]any{
		"ts":    time.Now().UTC().Format(time.RFC3339),
		"event": event,
	}
	for key, value := range fields {
		if value == nil {
			continue
		}
		if s, ok := value.(string); ok && s == "" {
			continue
		}
		entry[key] = value
	}

	payload, err := json.Marshal(entry)
	if err != nil {
		return
	}
	line := append(payload, '\n')
	// text (the default) writes exactly what it always has: the readable
	// sentence, to the container log. json instead puts the same structured
	// line docker logs sees there too, so a setup piping stdout straight into
	// Loki or Vector — with no file mounted at all — gets one parseable
	// stream instead of a sentence that tool would have to throw away.
	if activityLogFormatValue() == "json" {
		if category == activityCategorySecurity {
			logWarn(category, "%s", string(payload))
		} else {
			logInfo(category, "%s", string(payload))
		}
	} else if trimmed := strings.TrimSpace(sentence); trimmed != "" {
		// Security is the exception to the INFO default: a denied write or a
		// rate limit hit should be visible without switching a channel on.
		if category == activityCategorySecurity {
			logWarn(category, "%s", trimmed)
		} else {
			logInfo(category, "%s", trimmed)
		}
	}
	writeActivityLogLine(line)
}

func writeActivityLogLine(line []byte) {
	cfg := activityConfig()
	if !cfg.persist || cfg.filePath == "" {
		return
	}
	activityFileOnce.Do(func() {
		activityFile = &activityRotatingFile{path: cfg.filePath, maxAgeDays: cfg.maxAgeDays}
	})
	_ = activityFile.write(line)
}

// A size-capped append-only file that keeps a few numbered older copies.
//
// maxBytes and backups are fields rather than constants so the server log can
// reuse this with its own limits; zero means the activity-log defaults.
//
// keepOpen holds the file open between writes instead of stat/open/close per
// line. The activity log writes on user actions and leaves it off; the server
// log writes on every request, where those three syscalls were measured at
// ~19.5µs of a ~21.8µs line — 93% of the cost — against ~1.4µs for a write to
// an open handle.
type activityRotatingFile struct {
	mu       sync.Mutex
	path     string
	size     int64
	maxBytes int64
	backups  int
	keepOpen bool
	fh       *os.File
	// maxAgeDays prunes rotated backups older than this many days, on top of
	// the size ceiling above rather than instead of it — whichever a backup
	// hits first is the one that removes it. Zero (the default) leaves every
	// backup exactly as long as the count above already did.
	maxAgeDays int
}

func (f *activityRotatingFile) limit() int64 {
	if f.maxBytes > 0 {
		return f.maxBytes
	}
	return activityLogMaxBytes
}

func (f *activityRotatingFile) backupCount() int {
	if f.backups > 0 {
		return f.backups
	}
	return activityLogBackupCount
}

func (f *activityRotatingFile) write(line []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.pruneOldBackupsLocked()

	// With a handle held open, size is tracked in memory and only re-read when
	// the file is first opened; stat-ing per line is what made this expensive.
	if !f.keepOpen || f.fh == nil {
		info, err := os.Stat(f.path)
		switch {
		case err == nil:
			f.size = info.Size()
		case os.IsNotExist(err):
			f.size = 0
		default:
			return err
		}
	}

	if f.size+int64(len(line)) > f.limit() {
		if err := f.rotate(); err != nil {
			return err
		}
	}

	file := f.fh
	if file == nil {
		opened, err := os.OpenFile(f.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			return err
		}
		if f.keepOpen {
			f.fh = opened
		} else {
			defer opened.Close()
		}
		file = opened
	}

	n, err := file.Write(line)
	if err != nil {
		// A handle that failed mid-write may be stale (the file was rotated or
		// removed underneath us); drop it so the next call reopens.
		f.closeHandleLocked()
		return err
	}
	f.size += int64(n)
	return nil
}

// Release the cached handle. Caller holds the mutex.
func (f *activityRotatingFile) closeHandleLocked() {
	if f.fh != nil {
		_ = f.fh.Close()
		f.fh = nil
	}
}

// pruneOldBackupsLocked removes a rotated backup once it is older than
// maxAgeDays, independent of whether the count-based limit above would have
// kept it. A zero maxAgeDays (the default) costs one comparison and touches
// no file, so an install that never sets NEXTDASH_ACTIVITY_LOG_MAX_AGE_DAYS
// sees no change in behaviour or in how often this stats the disk. Caller
// holds the mutex.
func (f *activityRotatingFile) pruneOldBackupsLocked() {
	if f.maxAgeDays <= 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(f.maxAgeDays) * 24 * time.Hour)
	for i := 1; i <= f.backupCount(); i++ {
		path := f.path + "." + strconv.Itoa(i)
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(path)
		}
	}
}

func (f *activityRotatingFile) rotate() error {
	// The current file is about to be renamed, so a held handle would keep
	// writing into the rotated copy.
	f.closeHandleLocked()
	count := f.backupCount()
	_ = os.Remove(f.path + "." + strconv.Itoa(count))
	for i := count - 1; i >= 1; i-- {
		src := f.path
		if i > 1 {
			src = f.path + "." + strconv.Itoa(i-1)
		}
		dst := f.path + "." + strconv.Itoa(i)
		if _, err := os.Stat(src); err == nil {
			_ = os.Rename(src, dst)
		}
	}
	if _, err := os.Stat(f.path); err == nil {
		if err := os.Rename(f.path, f.path+".1"); err != nil {
			return err
		}
	}
	f.size = 0
	return nil
}

func activitySourceFromRequest(r *http.Request) string {
	if r == nil {
		return "api"
	}
	// Config and health are views inside the dashboard now, at /#config and
	// /#health. A fragment never travels in the Referer header, so both arrive
	// indistinguishable from the dashboard they are part of, and any browser
	// request is reported as "dashboard". Matching on "/config" or "/health"
	// here only ever produced false negatives once those pages went away.
	if r.Referer() != "" {
		return "dashboard"
	}
	if strings.Contains(strings.ToLower(r.Header.Get("User-Agent")), "chrome-extension") {
		return "extension"
	}
	return "api"
}

func activityRequestID(r *http.Request) string {
	if r == nil {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(requestIDHeader))
}

func activityFieldsFromRequest(r *http.Request) map[string]any {
	fields := map[string]any{
		"source": activitySourceFromRequest(r),
	}
	if reqID := activityRequestID(r); reqID != "" {
		fields["requestId"] = reqID
	}
	return fields
}

func mergeActivityFields(base map[string]any, extra map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(extra))
	for key, value := range base {
		out[key] = value
	}
	for key, value := range extra {
		out[key] = value
	}
	return out
}

type statusDedupeCache struct {
	mu      sync.Mutex
	ttl     time.Duration
	entries map[string]time.Time
}

func newStatusDedupeCache(ttl time.Duration) *statusDedupeCache {
	return &statusDedupeCache{
		ttl:     ttl,
		entries: make(map[string]time.Time),
	}
}

func (c *statusDedupeCache) shouldLog(urlKey, status string, force bool) bool {
	if force || urlKey == "" {
		return true
	}
	key := urlKey + "\x00" + status
	now := time.Now()

	c.mu.Lock()
	defer c.mu.Unlock()

	for entryKey, seenAt := range c.entries {
		if now.Sub(seenAt) > c.ttl {
			delete(c.entries, entryKey)
		}
	}
	if seenAt, ok := c.entries[key]; ok && now.Sub(seenAt) <= c.ttl {
		return false
	}
	c.entries[key] = now
	return true
}

// bookmarkStatusSentence says what a check found, in the terms a reader cares
// about: reachable or not, and when not, what stood in the way.
func bookmarkStatusSentence(url string, result PingResult) string {
	detail := strings.TrimSpace(result.ErrorDetail)
	switch {
	case detail != "" && result.HTTPStatus > 0:
		return fmt.Sprintf("%s answered %d: %s", url, result.HTTPStatus, detail)
	case detail != "":
		return fmt.Sprintf("%s could not be reached: %s", url, detail)
	case result.HTTPStatus > 0:
		return fmt.Sprintf("%s answered %d (%s)", url, result.HTTPStatus, result.Status)
	default:
		return fmt.Sprintf("%s is %s", url, result.Status)
	}
}

func logBookmarkStatus(url string, result PingResult, source string, force bool) {
	if !activityEnabled(activityCategoryStatus) {
		return
	}
	urlKey := canonicalBookmarkURLKey(url)
	if !activityStatusDedupe.shouldLog(urlKey, result.Status, force) {
		return
	}
	fields := map[string]any{
		"url":    activityUserText(url),
		"status": result.Status,
		"source": source,
	}
	if result.PingMs > 0 {
		fields["pingMs"] = result.PingMs
	}
	if result.ErrorDetail != "" {
		fields["error"] = result.ErrorDetail
	}
	if result.HTTPStatus > 0 {
		fields["httpStatus"] = result.HTTPStatus
	}
	logActivity(activityCategoryStatus, "bookmark.status", fields,
		bookmarkStatusSentence(activityURL(url), result))
}

func logBookmarkStatusBatch(tested, online, offline int, source string) {
	if !activityEnabled(activityCategoryStatus) || tested == 0 {
		return
	}
	logActivity(activityCategoryStatus, "bookmark.status_batch", map[string]any{
		"tested":  tested,
		"online":  online,
		"offline": offline,
		"source":  source,
	}, fmt.Sprintf("checked %d bookmarks (%s): %d reachable, %d not", tested, source, online, offline))
}

func logAuthDenied(r *http.Request, reason string) {
	if !activityEnabled(activityCategorySecurity) {
		return
	}
	fields := activityFieldsFromRequest(r)
	fields["reason"] = reason
	logActivity(activityCategorySecurity, "auth.denied", fields,
		fmt.Sprintf("refused %s %s: %s", r.Method, r.URL.Path, reason))
}

func logRateLimitHit(r *http.Request, endpoint string) {
	if !activityEnabled(activityCategorySecurity) {
		return
	}
	fields := activityFieldsFromRequest(r)
	fields["endpoint"] = endpoint
	logActivity(activityCategorySecurity, "rate_limit.hit", fields,
		fmt.Sprintf("too many requests to %s; this one was turned away", endpoint))
}
