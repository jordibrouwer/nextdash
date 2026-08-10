package main

import (
	"encoding/json"
	"log"
	"net/http"
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

	activityLogMaxBytes     = 5 << 20
	activityLogBackupCount  = 3
	activityStatusDedupeTTL = 10 * time.Minute
)

type activityLogConfig struct {
	enabled  map[string]bool
	persist  bool
	filePath string
	disabled bool
}

var (
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

func logActivity(category, event string, fields map[string]any) {
	if !activityEnabled(category) {
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
	log.Printf("activity: %s", string(payload))
	writeActivityLogLine(line)
}

func writeActivityLogLine(line []byte) {
	cfg := activityConfig()
	if !cfg.persist || cfg.filePath == "" {
		return
	}
	activityFileOnce.Do(func() {
		activityFile = &activityRotatingFile{path: cfg.filePath}
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

func logBookmarkStatus(url string, result PingResult, source string, force bool) {
	if !activityEnabled(activityCategoryStatus) {
		return
	}
	urlKey := canonicalBookmarkURLKey(url)
	if !activityStatusDedupe.shouldLog(urlKey, result.Status, force) {
		return
	}
	fields := map[string]any{
		"url":    url,
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
	logActivity(activityCategoryStatus, "bookmark.status", fields)
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
	})
}

func logAuthDenied(r *http.Request, reason string) {
	if !activityEnabled(activityCategorySecurity) {
		return
	}
	fields := activityFieldsFromRequest(r)
	fields["reason"] = reason
	logActivity(activityCategorySecurity, "auth.denied", fields)
}

func logRateLimitHit(r *http.Request, endpoint string) {
	if !activityEnabled(activityCategorySecurity) {
		return
	}
	fields := activityFieldsFromRequest(r)
	fields["endpoint"] = endpoint
	logActivity(activityCategorySecurity, "rate_limit.hit", fields)
}
