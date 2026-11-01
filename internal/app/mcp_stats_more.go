package app

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"math"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

/*
More to read: the inbox and trash blocks of get_stats, get_app_status and
get_bookmark_history.

All three answer with counts, dates, versions and booleans. The trash block
never names what was deleted (no bookmark titles, no URLs), the app status
never carries a token, a link or a path beyond the name of the data folder,
and the history names a failed check by its kind (mcpSafeErrorLabel), never by
its text. None of them runs a check or opens a connection: the update status is
the cached one, the feeds are read from their file.
*/

const (
	mcpHistoryDefaultDays = 30
	mcpHistoryMaxDays     = 90
	// mcpDataSizeMaxEntries caps the walk over the data folder, so a huge icon
	// cache cannot make one status call slow.
	mcpDataSizeMaxEntries = 5000
)

func mcpHistoryDefinitions() []map[string]any {
	return []map[string]any{{
		"name":        "get_bookmark_history",
		"annotations": mcpAnnotations(true, false),
		"description": fmt.Sprintf("The check history of one bookmark, found by its exact URL like get_bookmark: per day the number of checks, how many answered, the uptime ratio and the mean response time in ms, "+
			"for the last `days` days (default %d, at most %d). The days come from the monitor's recorded checks, so only a monitored bookmark, or one that was checked on a schedule, has them. "+
			"Also the bookmark's current health score and flags, its open count and when it was last opened: opens are only counted in total, there is no per-day open history. "+
			"A failed check is named by its kind, never quoted. With no history it returns an empty days list and a note. Does not run a check.", mcpHistoryDefaultDays, mcpHistoryMaxDays),
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"url":  map[string]any{"type": "string", "description": "The bookmark's URL."},
				"days": map[string]any{"type": "integer", "description": fmt.Sprintf("Days of history, at most %d. Defaults to %d.", mcpHistoryMaxDays, mcpHistoryDefaultDays)},
			},
			"required": []string{"url"},
		},
	}}
}

func mcpAppStatusDefinitions() []map[string]any {
	return []map[string]any{{
		"name":        "get_app_status",
		"annotations": mcpAnnotations(true, false),
		"description": "The state of this nextDash install itself: its version and whether an update is available (from the last update check, none is made now), " +
			"the size of the data folder, how many pages, categories and bookmarks there are, whether the public status page is on and how many monitors it shows, " +
			"how many bookmark feeds are followed and how many fail, and how long the server has been running. " +
			"Use it for \"which version am I on\", \"is there an update\" or \"is my status page on\". Counts, booleans and versions only: no tokens, no links, no paths.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
	}}
}

// mcpInboxStatsBlock is the inbox's lifetime figures and its last `days` days
// of throughput, from the aggregate the Statistics view reads.
func (h *Handlers) mcpInboxStatsBlock(r *http.Request, days int, now time.Time) map[string]any {
	stats := h.store.GetInboxStats()
	out := map[string]any{
		"added":    stats.TotalAdded,
		"promoted": stats.TotalPromoted,
		"deleted":  stats.TotalDeleted,
		"kept":     stats.TotalKept,
		"since":    mcpTimestamp(stats.FirstEventAt),
	}
	if stats.FirstEventAt <= 0 {
		out["since"] = nil
	}
	if stats.RetentionCount > 0 {
		avg := time.Duration(stats.SumRetentionMs/int64(stats.RetentionCount)) * time.Millisecond
		out["avg_retention"] = mcpHumanDuration(int64(avg / time.Second))
		out["avg_retention_seconds"] = int64(avg / time.Second)
	} else {
		out["avg_retention"] = nil
		out["avg_retention_seconds"] = nil
	}
	by := map[string]int{}
	for k, v := range stats.BySource {
		by[k] = v
	}
	out["by_source"] = by
	if unread, failure := h.mcpUnreadInbox(r); failure == nil {
		out["open_items"] = len(unread)
	} else {
		out["open_items"] = nil
	}
	cutoff := now.UTC().AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	daily := []map[string]any{}
	for _, day := range sortedInboxStatBucketDays(stats.DailyBuckets) {
		if day < cutoff {
			continue
		}
		c := stats.DailyBuckets[day]
		daily = append(daily, map[string]any{"date": day, "added": c.Added, "promoted": c.Promoted, "deleted": c.Deleted, "kept": c.Kept})
	}
	out["daily"] = daily
	out["note"] = "Lifetime counters run from since; open_items is the unread inbox now. daily lists only days with activity."
	return out
}

// mcpTrashBlock counts what is in the trash and when, never what it was.
func (h *Handlers) mcpTrashBlock() map[string]any {
	items := h.store.GetTrashItems()
	byKind := map[string]int{TrashKindBookmark: 0, TrashKindCategory: 0, TrashKindPage: 0}
	var oldest, newest int64
	for _, item := range items {
		byKind[trashKindOf(item)]++
		if item.DeletedAt <= 0 {
			continue
		}
		if oldest == 0 || item.DeletedAt < oldest {
			oldest = item.DeletedAt
		}
		if item.DeletedAt > newest {
			newest = item.DeletedAt
		}
	}
	out := map[string]any{"items": len(items), "by_kind": byKind, "oldest": nil, "newest": nil}
	if oldest > 0 {
		out["oldest"] = mcpTimestamp(oldest)
		out["newest"] = mcpTimestamp(newest)
	}
	return out
}

// mcpDataFolderSize adds up the files under the data folder, looking at no more
// than mcpDataSizeMaxEntries entries; complete says whether it got to the end.
func mcpDataFolderSize() (int64, bool) {
	var total int64
	seen := 0
	complete := true
	_ = filepath.WalkDir(ResolveDataDir(), func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		seen++
		if seen > mcpDataSizeMaxEntries {
			complete = false
			return fs.SkipAll
		}
		if !d.IsDir() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total, complete
}

func (h *Handlers) mcpAppStatus() map[string]any {
	s := h.store.GetSettings()
	now := time.Now()

	// Version and update, from the cache only.
	current := strings.TrimSpace(releaseTag())
	version := map[string]any{"current": current, "build": buildVersion}
	if buildCommit != "" {
		version["commit"] = buildCommit
	}
	if !updateCheckEnabled(s) {
		version["update_check"] = "off"
		version["update_available"] = nil
	} else {
		entry := h.getUpdateCheckCache()
		switch {
		case entry.fetchedAt.IsZero():
			version["update_check"] = "not run yet"
			version["update_available"] = nil
		case entry.err != nil:
			version["update_check"] = "failed"
			version["update_check_error"] = updateCheckErrorCode(entry.err)
			version["update_available"] = nil
			version["checked_at"] = mcpTimestamp(entry.fetchedAt.UnixMilli())
		default:
			version["update_check"] = "ok"
			version["latest"] = entry.info.Tag
			version["update_available"] = current != "" && entry.info.Tag != "" && compareReleaseTags(entry.info.Tag, current) > 0
			version["checked_at"] = mcpTimestamp(entry.fetchedAt.UnixMilli())
		}
	}

	// Structure.
	pages := h.store.GetPages()
	categories := 0
	for _, p := range pages {
		categories += len(h.store.GetCategoriesByPage(p.ID))
	}

	size, complete := mcpDataFolderSize()
	data := map[string]any{"folder": filepath.Base(ResolveDataDir()), "size_bytes": size, "size_complete": complete}
	if !complete {
		data["note"] = fmt.Sprintf("size_bytes covers the first %d entries only.", mcpDataSizeMaxEntries)
	}

	statusPage := map[string]any{"enabled": false, "monitors": 0}
	if page, err := readStatusPage(); err == nil {
		monitors := 0
		for _, g := range page.Groups {
			monitors += len(g.Services)
		}
		statusPage["enabled"] = page.Enabled
		statusPage["monitors"] = monitors
	}

	feeds := map[string]any{"enabled": s.FeedsEnabled}
	state := readFeedStateFile()
	tracked, failing, retired := 0, 0, 0
	for _, f := range state.Feeds {
		if f.FeedURL == "" {
			continue
		}
		tracked++
		if f.Failures >= feedMaxFailures {
			retired++
		} else if f.Failures > 0 {
			failing++
		}
	}
	feeds["followed"] = tracked
	feeds["failing"] = failing
	feeds["given_up"] = retired
	feeds["last_poll"] = nil
	if state.LastPoll > 0 {
		feeds["last_poll"] = mcpTimestamp(state.LastPoll)
	}

	up := now.Sub(processStartedAt)
	return map[string]any{
		"version": version,
		"data":    data,
		"counts": map[string]any{
			"pages":      len(pages),
			"categories": categories,
			"bookmarks":  len(h.store.GetAllBookmarks()),
		},
		"status_page": statusPage,
		"feeds":       feeds,
		"uptime": map[string]any{
			"started_at": mcpTimestamp(processStartedAt.UnixMilli()),
			"seconds":    int64(up / time.Second),
			"human":      mcpHumanDuration(int64(up / time.Second)),
		},
	}
}

func (h *Handlers) mcpBookmarkHistory(r *http.Request, args json.RawMessage) map[string]any {
	var body struct {
		URL  string `json:"url"`
		Days int    `json:"days"`
	}
	_ = json.Unmarshal(args, &body)
	days := clampLimit(body.Days, mcpHistoryDefaultDays, mcpHistoryMaxDays)

	key := canonicalBookmarkURLKey(body.URL)
	if key == "" {
		return map[string]any{"error": "A URL is required."}
	}
	found := findBookmarkByURLKey(h.store, key)
	if found == nil {
		return map[string]any{"error": "No bookmark with that URL."}
	}

	h.healthHistoryMu.Lock()
	file := readHealthHistoryFile()
	h.healthHistoryMu.Unlock()
	// The folding the history view does: kept checks into the daily summaries,
	// on copies, nothing written.
	summaries := foldSamplesIntoDays(append([]HealthDay(nil), file.Days[key]...), append([]HealthSample(nil), file.Samples[key]...))

	now := time.Now()
	cutoff := dayStart(now.Add(-time.Duration(days-1) * 24 * time.Hour))
	list := []map[string]any{}
	for _, d := range summaries {
		if d.D < cutoff || d.N <= 0 {
			continue
		}
		row := map[string]any{
			"date":         time.UnixMilli(d.D).UTC().Format("2006-01-02"),
			"checks":       d.N,
			"ok":           d.U,
			"uptime_ratio": math.Round(float64(d.U)/float64(d.N)*10000) / 10000,
		}
		row["mean_response_ms"] = nil
		if d.P > 0 {
			row["mean_response_ms"] = d.P
		}
		list = append(list, row)
	}
	sort.Slice(list, func(i, j int) bool { return list[i]["date"].(string) < list[j]["date"].(string) })

	out := map[string]any{
		"name": found.Name,
		"days": list,
		"usage": map[string]any{
			"opens":       found.OpenCount,
			"last_opened": mcpTimestamp(found.LastOpened),
			"note":        "Opens are counted in total; there is no per-day open history.",
		},
	}
	if len(list) == 0 {
		out["note"] = "No recorded checks for this bookmark in that period. Only monitored bookmarks, and bookmarks checked on a schedule, have a history."
	}
	if found.LastError != "" {
		out["last_failure"] = mcpSafeErrorLabel("", found.LastError)
	}

	// The current score and flags, from the report the Health view draws.
	if d, failure := h.mcpLoadBookmarkData(r, true, false); failure == nil {
		for i, b := range d.bookmarks {
			if b.PageID == found.PageID && b.URL == found.URL {
				if issue := d.issues[i]; issue != nil {
					health := mcpHealthBlock(issue).(map[string]any)
					out["health"] = map[string]any{"status": health["status"], "score": health["score"], "flags": health["flags"], "last_checked": health["last_checked"]}
				}
				break
			}
		}
	}
	return out
}
