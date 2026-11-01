package app

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
The funnel tools: query_bookmarks and get_stats.

A model asked "how many bookmarks are linked to a container" or "which have the
lowest health score" used to page through search results and count them, which
is wrong as soon as the list is cut off. These answer with the count itself,
taken from the whole filtered set before any limit, and with groups when the
question is "per page" or "per flag".

Every figure is read, not recomputed: health, scores, flags and the summary
counters come from the health report the Health view draws, the trend from the
recorded daily points, pooled uptime from the report's fleet view, and the
container link from matchContainerBookmark, the same steps the Containers view
takes. What the report keeps out of every answer stays out here too: no last
error text, no expectation bodies, no credentials.
*/

const (
	mcpQueryDefaultLimit = 25
	mcpQueryMaxLimit     = 100
	mcpTrendDefaultDays  = 30
	mcpTrendMaxDays      = 365
	mcpTagTop            = 20
)

// mcpHealthFlagNames is every flag the report can put on a bookmark: the
// conditions a bookmark can be told to ignore, plus "healthy".
func mcpHealthFlagNames() []string {
	names := make([]string, 0, len(knownHealthFlags)+1)
	for flag := range knownHealthFlags {
		names = append(names, flag)
	}
	names = append(names, "healthy")
	sort.Strings(names)
	return names
}

func mcpQueryDefinitions() []map[string]any {
	flags := mcpHealthFlagNames()
	return []map[string]any{
		{
			"name":        "query_bookmarks",
			"annotations": mcpAnnotations(true, false),
			"description": "Filter, sort, count and group bookmarks with their health, monitoring, usage and container link. " +
				"Answers questions such as \"which bookmarks have the lowest health score\" (sort score, order asc), " +
				"\"how many bookmarks are linked to a container\" (linked_container true, read total), " +
				"\"which links are broken on the Media page\", \"what have I not opened in 90 days\" (unused_days 90) " +
				"or \"how many bookmarks per page\" (group_by page, limit 0). " +
				"total is the exact number of matches before limit; groups count the whole filtered set. For counts read total or groups, never count the returned list. " +
				"Each bookmark has health {status ok|broken|unknown, condition, score 0-100, reasons, flags, last_checked}, " +
				"monitoring {monitored, interval_minutes, uptime_percent (30 days), avg_response_ms (24 hours)}, usage {opens, last_opened, added} " +
				"and container {name, state, via} or null. " +
				"Bookmarks in Unsorted are not in the health report: they have health null, so the status, score and flag filters leave them out and status counts can add up to less than total. " +
				"The score covers every bookmark in the report, checked or not. Does not run a check.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query":            map[string]any{"type": "string", "description": "Words that must all appear in the name, URL, tags or note."},
					"page":             map[string]any{"type": "string", "description": "Only this page, by name or id."},
					"category":         map[string]any{"type": "string", "description": "Only this category, by name or id."},
					"tag":              map[string]any{"type": "string", "description": "Only bookmarks carrying this tag."},
					"status":           map[string]any{"type": "string", "enum": []string{"ok", "broken", "unknown"}, "description": "ok: checked and answering; broken: down or failing its content check; unknown: never checked, or its failure is ignored."},
					"min_score":        map[string]any{"type": "integer", "description": "Health score at least this (0-100)."},
					"max_score":        map[string]any{"type": "integer", "description": "Health score at most this (0-100)."},
					"flag":             map[string]any{"type": "string", "enum": flags, "description": "Only bookmarks the health report flags with this condition."},
					"monitored":        map[string]any{"type": "boolean", "description": "Only monitored (true) or unmonitored (false) bookmarks."},
					"unused_days":      map[string]any{"type": "integer", "description": "Not opened for at least this many days, 0 or more (never opened counts when added before then)."},
					"opened_min":       map[string]any{"type": "integer", "description": "Opened at least this many times."},
					"opened_max":       map[string]any{"type": "integer", "description": "Opened at most this many times."},
					"added_since":      map[string]any{"type": "string", "description": "Added on or after this date (2026-01-31, from the start of that day in the server's time zone) or within this period (30d, 8w)."},
					"linked_container": map[string]any{"type": "boolean", "description": "Only bookmarks a Docker container is linked to (true) or not (false). Needs Containers: read."},
					"has_note":         map[string]any{"type": "boolean", "description": "Only bookmarks with (true) or without (false) a note."},
					"sort":             map[string]any{"type": "string", "enum": []string{"score", "name", "opens", "last_opened", "added", "uptime"}, "description": "Order of the list. Defaults to page order."},
					"order":            map[string]any{"type": "string", "enum": []string{"asc", "desc"}, "description": "Defaults to asc for score, name and uptime, desc for the others."},
					"group_by":         map[string]any{"type": "string", "enum": []string{"page", "category", "tag", "status", "flag", "linked_container"}, "description": "Also count the matches per group, each with its average score. A bookmark counts once per tag or flag it has."},
					"limit":            map[string]any{"type": "integer", "description": fmt.Sprintf("How many bookmarks to list, at most %d. Defaults to %d. With group_by, 0 lists none and returns only the groups.", mcpQueryMaxLimit, mcpQueryDefaultLimit)},
				},
			},
		},
		{
			"name":        "get_stats",
			"annotations": mcpAnnotations(true, false),
			"description": "Collection-wide statistics in one call: bookmarks per page, per category and the 20 commonest tags; " +
				"health (checked, healthy, ok, broken = broken_links + monitors_down + content_failures as the Health view counts them, unknown, average score, score buckets, a count per flag, certificates due, duplicates, unused); " +
				"the average score and the score buckets cover every bookmark in the report, checked or not, so the buckets add up to the bookmark total, not to checked; " +
				"monitoring (monitored, up, down as the header counts it, pooled uptime); usage (total opens, opened in the last 30 days, never opened, which leaves out bookmarks told to ignore \"unused\", as the weekly digest does); " +
				"the daily health trend (broken_links and monitors_down as recorded each day; content failures are not recorded there); " +
				"and containers (total, running, not_running, by_state, with updates, linked to a bookmark) when Containers: read is on. " +
				"With Health and Inbox: read on it also has inbox (lifetime added, promoted, deleted and kept since a date, average retention, by source, open items now, and the last trend_days days of daily throughput) " +
				"and trash (items, per kind, oldest and newest deletion time; never what was deleted). " +
				"Use it for \"how healthy is my collection\", \"how many bookmarks do I have per page\" or \"is my health getting better\". Does not run a check.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"trend_days": map[string]any{"type": "integer", "description": fmt.Sprintf("Days of trend to include, at most %d (about 90 are kept). Defaults to %d.", mcpTrendMaxDays, mcpTrendDefaultDays)},
				},
			},
		},
	}
}

// mcpIssueStatus is the three-way status the funnel tools filter on.
func mcpIssueStatus(issue HealthIssue) string {
	if mcpIssueDown(issue) {
		return "broken"
	}
	if issue.LastChecked > 0 && mcpHasFlag(issue, "healthy") {
		return "ok"
	}
	return "unknown"
}

/*
mcpSafeErrorLabel names a failed check without quoting it. The raw text is
not safe to hand on: a content failure quotes the expectation ("Page is missing
%q"), and a network error repeats the address it failed on and every redirect,
query string and all. What is kept is the kind of failure, and an HTTP status
code, which says nothing about the address.
*/
func mcpSafeErrorLabel(code, detail string) string {
	detail = strings.TrimSpace(detail)
	lower := strings.ToLower(detail)
	switch {
	case code == "content_mismatch" || isContentFailure(detail):
		return "The page did not pass its content check"
	case strings.Contains(lower, "timeout") || strings.Contains(lower, "timed out") || strings.Contains(lower, "deadline exceeded"):
		return "Timed out"
	case httpStatusFromDetail(lower) > 0:
		return "HTTP " + strconv.Itoa(httpStatusFromDetail(lower))
	}
	return "Unreachable"
}

// mcpSafeReasons are the report's reasons without the last error text: the two
// codes that carry it are named, never quoted, because an error can repeat the
// address it failed on, query string and all.
func mcpSafeReasons(issue HealthIssue) []string {
	out := make([]string, 0, len(issue.ReasonDetails))
	for _, r := range issue.ReasonDetails {
		switch r.Code {
		case "last_error", "unreachable", "content_mismatch":
			out = append(out, mcpSafeErrorLabel(r.Code, r.Detail))
		case "duplicate_url", "shortcut_conflict", "orphaned_category", "status_never_run", "status_stale",
			"not_opened_30_days", "never_opened", "no_preview":
			out = append(out, healthReasonLegacyLabel(HealthReason{Code: r.Code, Params: r.Params}))
		default:
			out = append(out, r.Code)
		}
	}
	return out
}

func mcpPercent(ratio float64) float64 {
	return math.Round(ratio*10000) / 100
}

// mcpScoreBuckets counts the scores in fixed ranges, worst first.
func mcpScoreBuckets(issues []HealthIssue) []map[string]any {
	ranges := []struct {
		label  string
		lo, hi int
	}{{"0-49", 0, 49}, {"50-74", 50, 74}, {"75-89", 75, 89}, {"90-99", 90, 99}, {"100", 100, 100}}
	out := make([]map[string]any, 0, len(ranges))
	for _, r := range ranges {
		n := 0
		for _, issue := range issues {
			if issue.Score >= r.lo && issue.Score <= r.hi {
				n++
			}
		}
		out = append(out, map[string]any{"range": r.label, "count": n})
	}
	return out
}

/*
mcpBookmarkData is everything one call knows about the bookmarks: the store's
copy, the report's row for each, and the container index when there is one.
Built once per call, so a query over 4000 bookmarks reads each file once.
*/
type mcpBookmarkData struct {
	now        time.Time
	bookmarks  []Bookmark
	issues     []*HealthIssue // parallel to bookmarks; nil for Unsorted
	report     BookmarkHealthReport
	pageNames  map[int]string
	catNames   map[int]map[string]string
	containers *mcpContainerIndex // nil when container links are unknown
	history    map[string][]HealthSample
	notes      []string
}

func (h *Handlers) mcpLoadBookmarkData(r *http.Request, withHealth, withContainers bool) (*mcpBookmarkData, map[string]any) {
	d := &mcpBookmarkData{now: time.Now(), pageNames: map[int]string{}, catNames: map[int]map[string]string{}}
	for _, page := range h.store.GetPages() {
		d.pageNames[page.ID] = page.Name
		names := map[string]string{}
		for _, c := range h.store.GetCategoriesByPage(page.ID) {
			names[c.ID] = c.Name
		}
		d.catNames[page.ID] = names
	}
	d.bookmarks = h.store.GetAllBookmarks()
	d.issues = make([]*HealthIssue, len(d.bookmarks))
	if withHealth {
		report, failure := h.mcpHealthReport(r)
		if failure != nil {
			return nil, failure
		}
		d.report = report
		byIndex := map[string]*HealthIssue{}
		byURL := map[string]*HealthIssue{}
		for i := range report.Issues {
			issue := &report.Issues[i]
			byIndex[strconv.Itoa(issue.PageID)+":"+strconv.Itoa(issue.Index)] = issue
			urlKey := strconv.Itoa(issue.PageID) + "::" + strings.TrimSpace(issue.URL)
			if _, seen := byURL[urlKey]; !seen {
				byURL[urlKey] = issue
			}
		}
		index := map[int]int{}
		for i, bm := range d.bookmarks {
			pos := index[bm.PageID]
			index[bm.PageID] = pos + 1
			if issue := byIndex[strconv.Itoa(bm.PageID)+":"+strconv.Itoa(pos)]; issue != nil && issue.URL == bm.URL {
				d.issues[i] = issue
				continue
			}
			d.issues[i] = byURL[matchBookmarkKey(bm)]
		}
	}
	if withContainers {
		d.containers, d.notes = h.mcpContainerIndexFor(r, d.bookmarks)
	}
	return d, nil
}

func (d *mcpBookmarkData) categoryName(bm Bookmark) string {
	return d.catNames[bm.PageID][bm.Category]
}

// avgResponse is the mean response over the last 24 hours, the window the
// report's fleet view averages over, read from one history read per call.
func (h *Handlers) mcpAvgResponse(d *mcpBookmarkData, bm Bookmark) any {
	if d.history == nil {
		d.history = h.readAllHealthHistory()
		if d.history == nil {
			d.history = map[string][]HealthSample{}
		}
	}
	mean, n := meanPingSince(d.history[canonicalBookmarkURLKey(bm.URL)], d.now.Add(-24*time.Hour).UnixMilli())
	if n == 0 {
		return nil
	}
	return mean
}

func mcpUptimePercent(issue *HealthIssue) (float64, bool) {
	if issue == nil || issue.MonitorStats == nil || issue.MonitorStats.Uptime30d.Samples == 0 {
		return 0, false
	}
	return mcpPercent(issue.MonitorStats.Uptime30d.Ratio), true
}

func mcpHealthBlock(issue *HealthIssue) any {
	if issue == nil {
		return nil
	}
	flags := issue.Flags
	if flags == nil {
		flags = []string{}
	}
	return map[string]any{
		"status":       mcpIssueStatus(*issue),
		"condition":    issue.Status,
		"score":        issue.Score,
		"reasons":      mcpSafeReasons(*issue),
		"flags":        flags,
		"last_checked": mcpTimestamp(issue.LastChecked),
	}
}

func (h *Handlers) mcpMonitoringBlock(d *mcpBookmarkData, bm Bookmark, issue *HealthIssue) map[string]any {
	out := map[string]any{"monitored": bm.Monitor}
	if !bm.Monitor {
		return out
	}
	out["interval_minutes"] = monitorIntervalMinutesFor(bm)
	out["uptime_percent"] = nil
	if pct, ok := mcpUptimePercent(issue); ok {
		out["uptime_percent"] = pct
	}
	out["avg_response_ms"] = h.mcpAvgResponse(d, bm)
	return out
}

func mcpUsageBlock(bm Bookmark) map[string]any {
	return map[string]any{
		"opens":       bm.OpenCount,
		"last_opened": mcpTimestamp(bm.LastOpened),
		"added":       mcpTimestamp(bm.CreatedAt),
	}
}

func (d *mcpBookmarkData) containerBlock(bm Bookmark) any {
	if d.containers == nil {
		return nil
	}
	link, ok := d.containers.byBookmark[strings.TrimSpace(bm.URL)]
	if !ok {
		return nil
	}
	return map[string]any{"name": link.container.Name, "state": link.container.State, "via": link.via}
}

// mcpBookmarkRow is one bookmark as query_bookmarks lists it.
func (h *Handlers) mcpBookmarkRow(d *mcpBookmarkData, i int) map[string]any {
	bm := d.bookmarks[i]
	issue := d.issues[i]
	tags := bm.Tags
	if tags == nil {
		tags = []string{}
	}
	return map[string]any{
		"name":       strings.TrimSpace(bm.Name),
		"url":        strings.TrimSpace(bm.URL),
		"page":       d.pageNames[bm.PageID],
		"category":   d.categoryName(bm),
		"tags":       tags,
		"health":     mcpHealthBlock(issue),
		"monitoring": h.mcpMonitoringBlock(d, bm, issue),
		"usage":      mcpUsageBlock(bm),
		"container":  d.containerBlock(bm),
	}
}

// mcpParseSince reads "2026-01-31", an RFC 3339 time, or a period such as
// "30d" or "8w" back from now.
func mcpParseSince(raw string, now time.Time) (int64, bool) {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" {
		return 0, false
	}
	if t, err := time.ParseInLocation("2006-01-02", raw, time.Local); err == nil {
		return t.UnixMilli(), true
	}
	if t, err := time.Parse(time.RFC3339, strings.ToUpper(raw)); err == nil {
		return t.UnixMilli(), true
	}
	units := map[byte]time.Duration{'d': 24 * time.Hour, 'w': 7 * 24 * time.Hour}
	if len(raw) >= 2 {
		if unit, ok := units[raw[len(raw)-1]]; ok {
			if n, err := strconv.Atoi(raw[:len(raw)-1]); err == nil && n >= 0 {
				return now.Add(-time.Duration(n) * unit).UnixMilli(), true
			}
		}
	}
	return 0, false
}

type mcpQueryArgs struct {
	Query           string `json:"query"`
	Page            any    `json:"page"`
	Category        string `json:"category"`
	Tag             string `json:"tag"`
	Status          string `json:"status"`
	MinScore        *int   `json:"min_score"`
	MaxScore        *int   `json:"max_score"`
	Flag            string `json:"flag"`
	Monitored       *bool  `json:"monitored"`
	UnusedDays      *int   `json:"unused_days"`
	OpenedMin       *int   `json:"opened_min"`
	OpenedMax       *int   `json:"opened_max"`
	AddedSince      string `json:"added_since"`
	LinkedContainer *bool  `json:"linked_container"`
	HasNote         *bool  `json:"has_note"`
	Sort            string `json:"sort"`
	Order           string `json:"order"`
	GroupBy         string `json:"group_by"`
	Limit           *int   `json:"limit"`
}

func mcpOneOf(value string, allowed ...string) bool {
	for _, a := range allowed {
		if value == a {
			return true
		}
	}
	return false
}

func mcpRefuseValue(name, got string, allowed []string) map[string]any {
	return map[string]any{"error": fmt.Sprintf("%s %q is not one of: %s.", name, got, strings.Join(allowed, ", "))}
}

func (h *Handlers) mcpQueryBookmarks(r *http.Request, args json.RawMessage) map[string]any {
	var a mcpQueryArgs
	if len(args) > 0 {
		if err := json.Unmarshal(args, &a); err != nil {
			return map[string]any{"error": "Could not read the arguments: " + err.Error()}
		}
	}
	a.Status = strings.ToLower(strings.TrimSpace(a.Status))
	a.Flag = strings.ToLower(strings.TrimSpace(a.Flag))
	a.Sort = strings.ToLower(strings.TrimSpace(a.Sort))
	a.Order = strings.ToLower(strings.TrimSpace(a.Order))
	a.GroupBy = strings.ToLower(strings.TrimSpace(a.GroupBy))
	if a.Status != "" && !mcpOneOf(a.Status, "ok", "broken", "unknown") {
		return mcpRefuseValue("status", a.Status, []string{"ok", "broken", "unknown"})
	}
	if a.Flag != "" && !mcpOneOf(a.Flag, mcpHealthFlagNames()...) {
		return mcpRefuseValue("flag", a.Flag, mcpHealthFlagNames())
	}
	sorts := []string{"score", "name", "opens", "last_opened", "added", "uptime"}
	if a.Sort != "" && !mcpOneOf(a.Sort, sorts...) {
		return mcpRefuseValue("sort", a.Sort, sorts)
	}
	if a.Order != "" && !mcpOneOf(a.Order, "asc", "desc") {
		return mcpRefuseValue("order", a.Order, []string{"asc", "desc"})
	}
	groups := []string{"page", "category", "tag", "status", "flag", "linked_container"}
	if a.GroupBy != "" && !mcpOneOf(a.GroupBy, groups...) {
		return mcpRefuseValue("group_by", a.GroupBy, groups)
	}
	if a.UnusedDays != nil && *a.UnusedDays < 0 {
		return map[string]any{"error": "unused_days must be 0 or more."}
	}
	now := time.Now()
	var addedSince int64
	if strings.TrimSpace(a.AddedSince) != "" {
		var ok bool
		if addedSince, ok = mcpParseSince(a.AddedSince, now); !ok {
			return map[string]any{"error": "added_since must be a date such as 2026-01-31 or a period such as 30d or 8w."}
		}
	}
	limit := mcpQueryDefaultLimit
	if a.Limit != nil {
		switch {
		case *a.Limit == 0 && a.GroupBy != "":
			limit = 0
		default:
			limit = clampLimit(*a.Limit, mcpQueryDefaultLimit, mcpQueryMaxLimit)
		}
	}

	d, failure := h.mcpLoadBookmarkData(r, true, true)
	if failure != nil {
		return failure
	}
	notes := append([]string{}, d.notes...)
	needsContainers := a.LinkedContainer != nil || a.GroupBy == "linked_container"
	if needsContainers && d.containers == nil {
		notes = append(notes, "Which bookmarks a container is linked to is unknown right now, so linked_container could not be answered: the counts below are not a zero, they are unknown.")
		if a.LinkedContainer != nil {
			return map[string]any{"total": 0, "returned": 0, "truncated": false, "bookmarks": []any{}, "notes": notes, "unknown": true}
		}
	}

	pageWant := strings.ToLower(strings.TrimSpace(fmt.Sprint(firstNonNil(a.Page, ""))))
	if f, ok := a.Page.(float64); ok {
		pageWant = strconv.Itoa(int(f))
	}
	catWant := strings.ToLower(strings.TrimSpace(a.Category))
	words := strings.Fields(strings.ToLower(strings.TrimSpace(a.Query)))
	tagWant := strings.ToLower(strings.TrimSpace(a.Tag))

	var matched []int
	for i, bm := range d.bookmarks {
		issue := d.issues[i]
		if tagWant != "" && !bookmarkHasTag(bm, tagWant) {
			continue
		}
		if !bookmarkMatchesWords(bm, words) {
			continue
		}
		if pageWant != "" && strconv.Itoa(bm.PageID) != pageWant && strings.ToLower(strings.TrimSpace(d.pageNames[bm.PageID])) != pageWant {
			continue
		}
		if catWant != "" && strings.ToLower(bm.Category) != catWant && strings.ToLower(strings.TrimSpace(d.categoryName(bm))) != catWant {
			continue
		}
		if a.Status != "" && (issue == nil || mcpIssueStatus(*issue) != a.Status) {
			continue
		}
		if a.MinScore != nil && (issue == nil || issue.Score < *a.MinScore) {
			continue
		}
		if a.MaxScore != nil && (issue == nil || issue.Score > *a.MaxScore) {
			continue
		}
		if a.Flag != "" && (issue == nil || !mcpHasFlag(*issue, a.Flag)) {
			continue
		}
		if a.Monitored != nil && bm.Monitor != *a.Monitored {
			continue
		}
		if a.UnusedDays != nil {
			cutoff := now.Add(-time.Duration(*a.UnusedDays) * 24 * time.Hour).UnixMilli()
			last := bm.LastOpened
			if last == 0 {
				// Never opened: unused for as long as it has been here.
				last = bm.CreatedAt
			}
			if last > cutoff {
				continue
			}
		}
		if a.OpenedMin != nil && bm.OpenCount < *a.OpenedMin {
			continue
		}
		if a.OpenedMax != nil && bm.OpenCount > *a.OpenedMax {
			continue
		}
		if addedSince != 0 && bm.CreatedAt < addedSince {
			continue
		}
		if a.HasNote != nil && (strings.TrimSpace(bm.Note) != "") != *a.HasNote {
			continue
		}
		if a.LinkedContainer != nil {
			_, linked := d.containers.byBookmark[strings.TrimSpace(bm.URL)]
			if linked != *a.LinkedContainer {
				continue
			}
		}
		matched = append(matched, i)
	}

	out := map[string]any{"total": len(matched)}
	if a.GroupBy != "" {
		out["groups"] = mcpBookmarkGroups(d, matched, a.GroupBy)
	}

	if a.Sort != "" {
		mcpSortBookmarks(d, matched, a.Sort, a.Order)
	}
	rows := []map[string]any{}
	for _, i := range matched {
		if len(rows) >= limit {
			break
		}
		rows = append(rows, h.mcpBookmarkRow(d, i))
	}
	out["bookmarks"] = rows
	out["returned"] = len(rows)
	out["truncated"] = len(matched) > len(rows)
	if len(matched) > len(rows) && limit > 0 {
		notes = append(notes, fmt.Sprintf("Showing %d of %d; total is the full count.", len(rows), len(matched)))
	}
	noReport := 0
	for _, i := range matched {
		if d.issues[i] == nil {
			noReport++
		}
	}
	if noReport > 0 {
		notes = append(notes, fmt.Sprintf("%d of these are in Unsorted, which the health report leaves out: they have no health, so status counts add up to %d, not %d.", noReport, len(matched)-noReport, len(matched)))
	}
	out["notes"] = notes
	return out
}

func firstNonNil(v, fallback any) any {
	if v == nil {
		return fallback
	}
	return v
}

// mcpSortKey is a bookmark's value for a sort, and whether it has one: a
// bookmark with no score or no uptime goes last whichever way the list runs.
func mcpSortKey(d *mcpBookmarkData, i int, field string) (float64, string, bool) {
	bm := d.bookmarks[i]
	issue := d.issues[i]
	switch field {
	case "score":
		if issue == nil {
			return 0, "", false
		}
		return float64(issue.Score), "", true
	case "name":
		return 0, strings.ToLower(strings.TrimSpace(bm.Name)), true
	case "opens":
		return float64(bm.OpenCount), "", true
	case "last_opened":
		return float64(bm.LastOpened), "", bm.LastOpened > 0
	case "added":
		return float64(bm.CreatedAt), "", bm.CreatedAt > 0
	case "uptime":
		pct, ok := mcpUptimePercent(issue)
		return pct, "", ok && bm.Monitor
	}
	return 0, "", false
}

func mcpSortBookmarks(d *mcpBookmarkData, idx []int, field, order string) {
	if order == "" {
		order = "desc"
		if field == "score" || field == "name" || field == "uptime" {
			order = "asc"
		}
	}
	desc := order == "desc"
	sort.SliceStable(idx, func(x, y int) bool {
		an, as, aok := mcpSortKey(d, idx[x], field)
		bn, bs, bok := mcpSortKey(d, idx[y], field)
		if aok != bok {
			return aok
		}
		if !aok {
			return false
		}
		if field == "name" {
			if desc {
				return as > bs
			}
			return as < bs
		}
		if an == bn {
			return strings.ToLower(d.bookmarks[idx[x]].Name) < strings.ToLower(d.bookmarks[idx[y]].Name)
		}
		if desc {
			return an > bn
		}
		return an < bn
	})
}

// mcpBookmarkGroups counts the matches per key, with the average score of the
// members that have one.
func mcpBookmarkGroups(d *mcpBookmarkData, idx []int, by string) []map[string]any {
	type acc struct {
		count, scored, scoreSum int
	}
	groups := map[string]*acc{}
	var order []string
	add := func(key string, issue *HealthIssue) {
		g := groups[key]
		if g == nil {
			g = &acc{}
			groups[key] = g
			order = append(order, key)
		}
		g.count++
		if issue != nil {
			g.scored++
			g.scoreSum += issue.Score
		}
	}
	for _, i := range idx {
		bm := d.bookmarks[i]
		issue := d.issues[i]
		switch by {
		case "page":
			add(d.pageNames[bm.PageID], issue)
		case "category":
			// Categories belong to a page: two pages' "Media" are two groups.
			name := d.categoryName(bm)
			if name == "" {
				name = "(none)"
			}
			add(d.pageNames[bm.PageID]+" / "+name, issue)
		case "tag":
			if len(bm.Tags) == 0 {
				add("(none)", issue)
			}
			seen := map[string]bool{}
			for _, tag := range bm.Tags {
				tag = strings.TrimSpace(tag)
				if tag != "" && !seen[strings.ToLower(tag)] {
					seen[strings.ToLower(tag)] = true
					add(tag, issue)
				}
			}
		case "status":
			if issue == nil {
				add("not in the health report", nil)
			} else {
				add(mcpIssueStatus(*issue), issue)
			}
		case "flag":
			if issue == nil || len(issue.Flags) == 0 {
				add("(none)", issue)
				continue
			}
			for _, flag := range issue.Flags {
				add(flag, issue)
			}
		case "linked_container":
			switch {
			case d.containers == nil:
				add("unknown", issue)
			default:
				_, linked := d.containers.byBookmark[strings.TrimSpace(bm.URL)]
				add(strconv.FormatBool(linked), issue)
			}
		}
	}
	sort.SliceStable(order, func(x, y int) bool {
		if groups[order[x]].count != groups[order[y]].count {
			return groups[order[x]].count > groups[order[y]].count
		}
		return order[x] < order[y]
	})
	out := make([]map[string]any, 0, len(order))
	for _, key := range order {
		g := groups[key]
		row := map[string]any{"key": key, "count": g.count}
		if g.scored > 0 {
			row["avg_score"] = g.scoreSum / g.scored
		}
		out = append(out, row)
	}
	return out
}

/*
mcpGetStats is the collection in figures.

The bookmark total is the report's (every page but Unsorted, which the report
and the trend leave out), the health counters are the report's own summary and
the flags are counted off the same rows the summary was tallied from, so a
figure here and the tile of the same name cannot disagree.
*/
func (h *Handlers) mcpGetStats(r *http.Request, args json.RawMessage) map[string]any {
	var body struct {
		TrendDays int `json:"trend_days"`
	}
	_ = json.Unmarshal(args, &body)
	days := clampLimit(body.TrendDays, mcpTrendDefaultDays, mcpTrendMaxDays)

	settings := h.store.GetSettings()
	d, failure := h.mcpLoadBookmarkData(r, true, settings.MCPContainersRead)
	if failure != nil {
		return failure
	}
	report := d.report
	notes := []string{}
	now := d.now

	// Bookmarks: the set the report counts, page by page in page order.
	dashboard := trendBookmarks(d.bookmarks)
	perPage := []map[string]any{}
	pageCount := map[int]int{}
	type catKey struct {
		page int
		id   string
	}
	catCount := map[catKey]int{}
	var catOrder []catKey
	tagCount := map[string]int{}
	for _, bm := range dashboard {
		pageCount[bm.PageID]++
		k := catKey{bm.PageID, bm.Category}
		if catCount[k] == 0 {
			catOrder = append(catOrder, k)
		}
		catCount[k]++
		for _, raw := range bm.Tags {
			if tag := strings.TrimSpace(raw); tag != "" {
				tagCount[tag]++
			}
		}
	}
	for _, page := range h.store.GetPages() {
		if page.ID == unsortedPageID {
			continue
		}
		perPage = append(perPage, map[string]any{"page": page.Name, "id": page.ID, "count": pageCount[page.ID]})
	}
	sort.SliceStable(catOrder, func(i, j int) bool { return catCount[catOrder[i]] > catCount[catOrder[j]] })
	perCategory := []map[string]any{}
	for _, k := range catOrder {
		name := d.catNames[k.page][k.id]
		if name == "" {
			name = "(none)"
		}
		perCategory = append(perCategory, map[string]any{"page": d.pageNames[k.page], "category": name, "count": catCount[k]})
	}
	tags := make([]string, 0, len(tagCount))
	for tag := range tagCount {
		tags = append(tags, tag)
	}
	sort.Slice(tags, func(i, j int) bool {
		if tagCount[tags[i]] != tagCount[tags[j]] {
			return tagCount[tags[i]] > tagCount[tags[j]]
		}
		return tags[i] < tags[j]
	})
	if len(tags) > mcpTagTop {
		tags = tags[:mcpTagTop]
	}
	perTag := []map[string]any{}
	for _, tag := range tags {
		perTag = append(perTag, map[string]any{"tag": tag, "count": tagCount[tag]})
	}
	unsorted := len(d.bookmarks) - len(dashboard)

	// Health.
	checked := 0
	statusCount := map[string]int{"ok": 0, "broken": 0, "unknown": 0}
	flagCount := map[string]int{}
	monitoredUp := 0
	for _, issue := range report.Issues {
		if issue.LastChecked > 0 {
			checked++
		}
		status := mcpIssueStatus(issue)
		statusCount[status]++
		for _, f := range issue.Flags {
			flagCount[f]++
		}
		if issue.Monitor && status == "ok" {
			monitoredUp++
		}
	}
	s := report.Summary
	health := map[string]any{
		"checked": checked,
		"healthy": s.HealthyCount,
		"ok":      statusCount["ok"],
		// The Health view's own three counters. A failing bookmark is in
		// exactly one: content when the host answered but an expectation
		// failed, else monitors_down when it is monitored, else broken_links
		// (buildBookmarkHealthReport), so their sum never counts one twice.
		"broken_links":     s.BrokenCount,
		"monitors_down":    s.MonitorDownCount,
		"content_failures": s.ContentCount,
		"broken":           s.BrokenCount + s.MonitorDownCount + s.ContentCount,
		"unknown":          statusCount["unknown"],
		"avg_score":        averageHealthScore(report.Issues),
		"score_buckets":    mcpScoreBuckets(report.Issues),
		"flags":            flagCount,
		"certificates_due": len(report.Certificates),
		"duplicates":       s.DuplicateCount,
		"unused":           s.UnusedCount,
		"note": "broken is broken_links + monitors_down + content_failures, the Health view's three counters; a bookmark is in only one of them. " +
			"healthy: nothing known to be wrong with the link (checked or not). ok/broken/unknown are the statuses query_bookmarks filters on and add up to the report total. " +
			"avg_score and score_buckets cover every bookmark in the report, checked or not.",
	}
	monitoring := map[string]any{
		"monitored":          s.MonitoredCount,
		"up":                 monitoredUp,
		"down":               s.MonitorDownCount,
		"avg_uptime_percent": nil,
		"note":               "down: monitored bookmarks that are unreachable, as the header counts them; a monitored bookmark failing its content check is in health.content_failures instead. up: monitored, checked and nothing failing.",
	}
	if report.Fleet != nil && report.Fleet.Uptime30d.Samples > 0 {
		monitoring["avg_uptime_percent"] = mcpPercent(report.Fleet.Uptime30d.Ratio)
		monitoring["uptime_24h_percent"] = mcpPercent(report.Fleet.Uptime24h.Ratio)
		if report.Fleet.AvgResponseMs > 0 {
			monitoring["avg_response_ms"] = report.Fleet.AvgResponseMs
		}
	}

	// Usage: total opens as the trend records them.
	point := trendPointFromSummary(s, averageHealthScore(report.Issues), now, dashboard)
	monthAgo := now.Add(-30 * 24 * time.Hour).UnixMilli()
	opened30 := 0
	for _, bm := range dashboard {
		if bm.LastOpened >= monthAgo {
			opened30++
		}
	}
	usage := map[string]any{
		"total_opens":         point.Opens,
		"opened_last_30_days": opened30,
		"never_opened":        s.UnusedCount,
		"note":                "never_opened leaves out bookmarks told to ignore \"unused\", as the weekly digest does.",
	}

	// Trend: the recorded daily points, the last `days` of them.
	cutoff := dayStart(now.Add(-time.Duration(days-1) * 24 * time.Hour))
	trend := []map[string]any{}
	for _, p := range h.readHealthTrend() {
		if p.T < cutoff {
			continue
		}
		trend = append(trend, map[string]any{
			"date":          time.UnixMilli(p.T).UTC().Format("2006-01-02"),
			"avg_score":     p.Score,
			"healthy":       p.Healthy,
			"broken_links":  p.Broken,
			"monitors_down": p.MonDown,
			"total":         p.Total,
		})
	}
	if days > int(healthTrendRetention/(24*time.Hour)) {
		notes = append(notes, fmt.Sprintf("The trend keeps about %d days, so older days are not there.", int(healthTrendRetention/(24*time.Hour))))
	}

	out := map[string]any{
		"bookmarks": map[string]any{
			"total":        s.TotalBookmarks,
			"unsorted":     unsorted,
			"per_page":     perPage,
			"per_category": perCategory,
			"per_tag_top":  perTag,
		},
		"health":     health,
		"monitoring": monitoring,
		"usage":      usage,
		"trend":      trend,
	}
	switch {
	case !settings.MCPContainersRead:
		notes = append(notes, "Container figures are left out: the Containers: read switch is off (Config → AI Assistant → What it can see).")
	case d.containers == nil:
		notes = append(notes, d.notes...)
	default:
		c := d.containers
		running, updates := 0, 0
		byState := map[string]int{}
		for _, item := range c.list {
			byState[item.State]++
			if item.State == "running" {
				running++
			}
			if item.Update != nil && item.Update.Status == "available" {
				updates++
			}
		}
		out["containers"] = map[string]any{
			"total":              len(c.list),
			"running":            running,
			"not_running":        len(c.list) - running,
			"by_state":           byState,
			"with_updates":       updates,
			"linked_to_bookmark": len(c.byContainer),
		}
	}
	if settings.MCPHealthInbox {
		out["inbox"] = h.mcpInboxStatsBlock(r, days, now)
		out["trash"] = h.mcpTrashBlock()
	}
	out["notes"] = notes
	return out
}
