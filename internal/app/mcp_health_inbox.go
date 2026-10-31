package app

import (
	"encoding/json"
	"net/http"
	"time"
)

/*
The Health and Inbox read tools.

They read what the browser reads, through the same handlers, and reshape it.
Nothing here decides whether a bookmark is down or a certificate is due: the
report already did, and a second opinion would drift from the first.

Read only on purpose. The report is built from what the last checks found; it
is requested without refresh, so asking never sends a request to any of the
bookmarked sites, and the answer can be as old as the last check says.
Credentials and expectation bodies are not part of any answer.
*/

const (
	mcpListDefaultLimit = 25
	mcpListMaxLimit     = 100
)

func mcpHealthInboxDefinitions() []map[string]any {
	limitProp := map[string]any{
		"type":        "integer",
		"description": "How many to return, at most 100. Defaults to 25.",
	}
	limitSchema := map[string]any{
		"type":       "object",
		"properties": map[string]any{"limit": limitProp},
	}
	return []map[string]any{
		{
			"name":        "get_health_summary",
			"annotations": mcpAnnotations(true, false),
			"description": "Counts from the last link checks: how many bookmarks have been checked, how many were up and how many down, " +
				"how many certificates are close to expiring, and how many inbox links are unread. " +
				"Does not run a check; it reports what the most recent one found. Use list_health_issues for which ones.",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			"name":        "list_health_issues",
			"annotations": mcpAnnotations(true, false),
			"description": "Bookmarks that are down right now or whose certificate is due to expire, with their page, category and since when they have been failing. " +
				"Does not run a check. Bookmarks that are merely stale or unused are not listed.",
			"inputSchema": limitSchema,
		},
		{
			"name":        "list_inbox",
			"annotations": mcpAnnotations(true, false),
			"description": "Unread links waiting in the inbox, newest first. Read links are not listed.",
			"inputSchema": limitSchema,
		},
	}
}

func mcpTimestamp(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

// mcpHealthReport asks the report endpoint, without refresh, so the cached
// report is used and no site is contacted.
func (h *Handlers) mcpHealthReport(r *http.Request) (BookmarkHealthReport, map[string]any) {
	var report BookmarkHealthReport
	rec, err := h.mcpInner(r, "GET", "/api/bookmark-health", nil, nil, h.GetBookmarkHealth)
	if err != nil {
		return report, map[string]any{"error": "Could not read the health report."}
	}
	if rec.status >= 400 {
		return report, mcpErrorFrom(rec)
	}
	if err := json.Unmarshal(rec.body.Bytes(), &report); err != nil {
		return report, map[string]any{"error": "Could not read the health report."}
	}
	return report, nil
}

type mcpInboxEntry struct {
	Items []InboxLink `json:"items"`
}

func (h *Handlers) mcpUnreadInbox(r *http.Request) ([]InboxLink, map[string]any) {
	rec, err := h.mcpInner(r, "GET", "/api/inbox", nil, nil, h.GetInbox)
	if err != nil || rec.status >= 400 {
		return nil, map[string]any{"error": "Could not read the inbox."}
	}
	var body mcpInboxEntry
	if err := json.Unmarshal(rec.body.Bytes(), &body); err != nil {
		return nil, map[string]any{"error": "Could not read the inbox."}
	}
	unread := make([]InboxLink, 0, len(body.Items))
	for _, item := range body.Items {
		if item.ReadAt == 0 {
			unread = append(unread, item)
		}
	}
	return unread, nil
}

func mcpHasFlag(issue HealthIssue, flag string) bool {
	for _, f := range issue.Flags {
		if f == flag {
			return true
		}
	}
	return false
}

// mcpIssueDown: a bookmark the report flags as failing. The flag, not the
// status, because status keeps only the worst single thing.
func mcpIssueDown(issue HealthIssue) bool {
	return mcpHasFlag(issue, "broken") || mcpHasFlag(issue, "content")
}

func mcpIssueCertDue(report BookmarkHealthReport, issue HealthIssue) bool {
	if issue.CertHost == "" {
		return false
	}
	_, due := report.Certificates[issue.CertHost]
	return due
}

func (h *Handlers) mcpHealthSummary(r *http.Request) map[string]any {
	report, failure := h.mcpHealthReport(r)
	if failure != nil {
		return failure
	}
	unread, failure := h.mcpUnreadInbox(r)
	if failure != nil {
		return failure
	}
	checked, up, down := 0, 0, 0
	for _, issue := range report.Issues {
		if issue.LastChecked > 0 {
			checked++
			if mcpHasFlag(issue, "healthy") {
				up++
			}
		}
		if mcpIssueDown(issue) {
			down++
		}
	}
	return map[string]any{
		"checked":          checked,
		"up":               up,
		"down":             down,
		"certificates_due": len(report.Certificates),
		"inbox_unread":     len(unread),
	}
}

func (h *Handlers) mcpHealthIssues(r *http.Request, args json.RawMessage) map[string]any {
	var body struct {
		Limit int `json:"limit"`
	}
	_ = json.Unmarshal(args, &body)
	limit := clampLimit(body.Limit, mcpListDefaultLimit, mcpListMaxLimit)

	report, failure := h.mcpHealthReport(r)
	if failure != nil {
		return failure
	}
	issues := []map[string]any{}
	total := 0
	for _, issue := range report.Issues {
		down := mcpIssueDown(issue)
		certDue := mcpIssueCertDue(report, issue)
		if !down && !certDue {
			continue
		}
		total++
		if len(issues) >= limit {
			continue
		}
		status := "up"
		if down {
			status = "down"
		}
		category := ""
		if issue.Category != "" {
			category = categoryNameForID(h.store, issue.PageID, issue.Category)
		}
		issues = append(issues, map[string]any{
			"name":            issue.Name,
			"url":             issue.URL,
			"page":            issue.PageName,
			"category":        category,
			"status":          status,
			"since":           mcpTimestamp(issue.BrokenSince),
			"certificate_due": certDue,
		})
	}
	return map[string]any{"issues": issues, "truncated": total > len(issues)}
}

func (h *Handlers) mcpListInbox(r *http.Request, args json.RawMessage) map[string]any {
	var body struct {
		Limit int `json:"limit"`
	}
	_ = json.Unmarshal(args, &body)
	limit := clampLimit(body.Limit, mcpListDefaultLimit, mcpListMaxLimit)

	unread, failure := h.mcpUnreadInbox(r)
	if failure != nil {
		return failure
	}
	items := []map[string]any{}
	for _, item := range unread {
		if len(items) >= limit {
			break
		}
		items = append(items, map[string]any{
			"title": item.Title,
			"url":   item.URL,
			"added": mcpTimestamp(item.AddedAt),
		})
	}
	return map[string]any{"items": items, "truncated": len(unread) > len(items)}
}
