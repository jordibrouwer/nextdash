package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Cap on lines returned in one poll. The viewer asks for new lines only, so
// this bites on the first load and after a long pause.
const serverLogPageLimit = 500

// GetServerLog returns captured log lines for the config log viewer.
//
// The viewer polls with ?since=<seq> and receives only what it has not seen,
// which keeps a 2s refresh interval close to free once the first page is in.
func (h *Handlers) GetServerLog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	since := int64(-1)
	if raw := strings.TrimSpace(q.Get("since")); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil {
			since = n
		}
	}
	limit := serverLogPageLimit
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n < serverLogPageLimit {
			limit = n
		}
	}

	entries, nextSeq, dropped := serverLog.Entries(since, strings.TrimSpace(q.Get("level")), q.Get("q"), limit)
	total, warn, errCount, _ := serverLog.Stats()

	if entries == nil {
		entries = []serverLogEntry{}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"entries": entries,
		"nextSeq": nextSeq,
		"dropped": dropped,
		"stats": map[string]int{
			"total": total,
			"warn":  warn,
			"error": errCount,
		},
		"capacity":       serverLogBufferLines,
		"retentionHours": serverLog.RetentionHours(),
		"capturing":      !serverLog.Paused(),
	})
}

// ClearServerLog empties the ring buffer and removes the on-disk copy.
func (h *Handlers) ClearServerLog(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	serverLog.Clear()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// DownloadServerLog serves the buffer as a plain text attachment.
func (h *Handlers) DownloadServerLog(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	entries := serverLog.All()

	var b strings.Builder
	for _, e := range entries {
		ts := e.Time
		if ts == "" {
			ts = "-"
		}
		if e.Source != "" {
			fmt.Fprintf(&b, "%s [%s] %s: %s\n", ts, e.Level, e.Source, e.Message)
			continue
		}
		fmt.Fprintf(&b, "%s [%s] %s\n", ts, e.Level, e.Message)
	}

	name := "nextdash-server-" + time.Now().Format("20060102-150405") + ".log"
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(b.String()))
}
