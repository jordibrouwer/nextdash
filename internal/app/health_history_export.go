package app

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ExportHealthHistory downloads recorded uptime samples as CSV.
//
// The samples are the one thing the monitor produces that cannot be recomputed:
// a 30-day window takes 30 days to earn back, and until now they were reachable
// only as derived numbers (uptime ratios, heartbeat buckets, incidents) attached
// to a health report. Nothing exposed the underlying measurements, so they could
// not be charted, kept beyond retention, or compared against another monitor.
//
// Query parameters:
//
//	url=<bookmark url>  restrict to one monitored bookmark (default: all)
//	days=<1..30>        restrict to the last N days (default: everything kept)
func (h *Handlers) ExportHealthHistory(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}

	history := h.readAllHealthHistory()

	// Names come from the bookmarks, not the history: the history is keyed by
	// canonical URL and carries no title, and a CSV of bare URLs is markedly
	// harder to read beside a spreadsheet.
	names := make(map[string]string)
	pages := make(map[string]string)
	pageNames := make(map[int]string)
	for _, page := range h.store.GetPages() {
		pageNames[page.ID] = page.Name
	}
	for _, bm := range h.store.GetAllBookmarks() {
		key := canonicalBookmarkURLKey(bm.URL)
		if key == "" {
			continue
		}
		if _, seen := names[key]; !seen {
			names[key] = bm.Name
			pages[key] = pageNames[bm.PageID]
		}
	}

	filterKey := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("url")); raw != "" {
		filterKey = canonicalBookmarkURLKey(raw)
		if _, ok := history[filterKey]; !ok {
			http.Error(w, "No history for that URL", http.StatusNotFound)
			return
		}
	}

	// A window is clamped rather than rejected: asking for 90 days of a 30-day
	// retention is a reasonable request that should return what exists.
	cutoff := int64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw != "" {
		days, err := strconv.Atoi(raw)
		if err != nil || days <= 0 {
			http.Error(w, "Invalid days", http.StatusBadRequest)
			return
		}
		maxDays := int(healthHistoryRetention.Hours() / 24)
		if days > maxDays {
			days = maxDays
		}
		cutoff = time.Now().AddDate(0, 0, -days).UnixMilli()
	}

	// Sorted so repeated exports of unchanged data are byte-identical, which
	// makes them diffable and safe to commit to a series.
	keys := make([]string, 0, len(history))
	for key := range history {
		if filterKey != "" && key != filterKey {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var buf bytes.Buffer
	// BOM so Excel reads UTF-8, matching the health view's own CSV export.
	buf.WriteString("\ufeff")
	writer := csv.NewWriter(&buf)
	_ = writer.Write([]string{
		"name", "url", "page", "timestamp", "up", "pingMs", "httpStatus", "maint", "reason",
	})

	rows := 0
	for _, key := range keys {
		samples := history[key]
		sort.Slice(samples, func(i, j int) bool { return samples[i].T < samples[j].T })
		for _, s := range samples {
			if cutoff > 0 && s.T < cutoff {
				continue
			}
			_ = writer.Write([]string{
				csvSafeField(names[key]),
				csvSafeField(key),
				csvSafeField(pages[key]),
				// RFC 3339 rather than epoch millis: a spreadsheet parses this as
				// a date, where a raw integer needs a formula first.
				time.UnixMilli(s.T).UTC().Format(time.RFC3339),
				strconv.FormatBool(s.Up),
				strconv.Itoa(s.PingMs),
				strconv.Itoa(s.Code),
				// Lets an external analysis exclude expected downtime instead of
				// counting a maintenance window as a real outage.
				strconv.FormatBool(s.Maint),
				// Why a failed check failed. Empty for a check that succeeded,
				// and for failures recorded before samples carried a class.
				csvSafeField(failureClassReason(s.Fail)),
			})
			rows++
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		http.Error(w, "Could not build export", http.StatusInternalServerError)
		return
	}

	filename := fmt.Sprintf("nextdash-uptime-%s.csv", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	// Lets the client report how much it got without parsing the body.
	w.Header().Set("X-NextDash-Rows", strconv.Itoa(rows))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

// csvSafeField neutralises spreadsheet formula injection.
//
// encoding/csv quotes correctly for CSV, but Excel and Sheets execute a cell
// that begins with = + - @, so a bookmark named "=cmd|..." would run on open.
// The health view's client-side export already guards this; the server export
// has the same exposure and needs the same guard.
func csvSafeField(value string) string {
	if value == "" {
		return ""
	}
	if strings.IndexAny(value[:1], "=+-@\t\r") == 0 {
		return "'" + value
	}
	return value
}
