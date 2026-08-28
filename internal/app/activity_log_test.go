package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// captureActivityLogs runs fn and hands back the JSON the trail recorded.
//
// It reads the activity file rather than the container log: since the two
// channels were split, the container log carries the readable sentence and the
// JSON goes only to the trail. The caller's config is reused as given, with
// persistence pointed at a temp file so the trail has somewhere to land.
func captureActivityLogs(t *testing.T, fn func()) []string {
	t.Helper()
	t.Cleanup(clearActivityLogTestOverride)

	cfg := activityConfig()
	cfg.persist = true
	cfg.filePath = filepath.Join(t.TempDir(), "activity.log")
	resetActivityLogForTest(cfg)

	fn()

	raw, err := os.ReadFile(cfg.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		t.Fatalf("read the activity trail: %v", err)
	}
	var activity []string
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			activity = append(activity, line)
		}
	}
	return activity
}

func TestActivityLogMutateDefaultEnabled(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{
		enabled: map[string]bool{
			activityCategoryMutate: true,
		},
	})

	lines := captureActivityLogs(t, func() {
		bm := Bookmark{PageID: 1, Name: "Example", URL: "https://example.com"}
		logBookmarkAdd(bm, httptest.NewRequest(http.MethodPost, "/api/bookmarks/add", nil))
	})
	if len(lines) != 1 {
		t.Fatalf("expected 1 activity line, got %d (%v)", len(lines), lines)
	}
	if !strings.Contains(lines[0], `"event":"bookmark.add"`) {
		t.Fatalf("unexpected payload: %s", lines[0])
	}
}

func TestActivityLogOpenDisabledByDefault(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{
		enabled: map[string]bool{
			activityCategoryMutate: true,
			activityCategoryStatus: true,
		},
	})

	lines := captureActivityLogs(t, func() {
		logBookmarkOpen(1, 0, Bookmark{Name: "HN", URL: "https://news.ycombinator.com"}, nil)
	})
	if len(lines) != 0 {
		t.Fatalf("expected no open logs, got %v", lines)
	}
}

func TestActivityLogOpenWhenEnabled(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{
		enabled: map[string]bool{activityCategoryOpen: true},
	})

	lines := captureActivityLogs(t, func() {
		logBookmarkOpen(1, 2, Bookmark{PageID: 1, Name: "HN", URL: "https://news.ycombinator.com"}, nil)
	})
	if len(lines) != 1 || !strings.Contains(lines[0], `"event":"bookmark.open"`) {
		t.Fatalf("unexpected open log: %v", lines)
	}
}

func TestBookmarkSaveDiffDetectsAddUpdateDeleteReorder(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{
		enabled: map[string]bool{activityCategoryMutate: true},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks?page=1", nil)

	before := []Bookmark{
		{Name: "A", URL: "https://a.example", Shortcut: "A"},
		{Name: "B", URL: "https://b.example", Shortcut: "B"},
	}
	afterUpdate := []Bookmark{
		{Name: "A renamed", URL: "https://a.example", Shortcut: "A"},
		{Name: "B", URL: "https://b.example", Shortcut: "B"},
	}
	lines := captureActivityLogs(t, func() {
		logBookmarkSaveDiff(1, before, afterUpdate, req)
	})
	if len(lines) != 1 || !strings.Contains(lines[0], `"event":"bookmark.update"`) {
		t.Fatalf("expected update log, got %v", lines)
	}

	afterReorder := []Bookmark{
		{Name: "B", URL: "https://b.example", Shortcut: "B"},
		{Name: "A", URL: "https://a.example", Shortcut: "A"},
	}
	lines = captureActivityLogs(t, func() {
		logBookmarkSaveDiff(1, before, afterReorder, req)
	})
	if len(lines) != 1 || !strings.Contains(lines[0], `"event":"bookmark.reorder"`) {
		t.Fatalf("expected reorder log, got %v", lines)
	}

	afterDelete := []Bookmark{
		{Name: "A", URL: "https://a.example", Shortcut: "A"},
	}
	lines = captureActivityLogs(t, func() {
		logBookmarkSaveDiff(1, before, afterDelete, req)
	})
	if len(lines) != 1 || !strings.Contains(lines[0], `"event":"bookmark.delete"`) {
		t.Fatalf("expected delete log, got %v", lines)
	}

	afterAdd := append([]Bookmark{}, before...)
	afterAdd = append(afterAdd, Bookmark{Name: "C", URL: "https://c.example"})
	lines = captureActivityLogs(t, func() {
		logBookmarkSaveDiff(1, before, afterAdd, req)
	})
	if len(lines) != 1 || !strings.Contains(lines[0], `"event":"bookmark.add"`) {
		t.Fatalf("expected add log, got %v", lines)
	}
}

func TestStatusDedupeSuppressesRepeatLogs(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{
		enabled: map[string]bool{activityCategoryStatus: true},
	})
	result := PingResult{Status: "online", PingMs: 12}

	lines := captureActivityLogs(t, func() {
		logBookmarkStatus("https://example.com", result, "status-bar", false)
		logBookmarkStatus("https://example.com", result, "status-bar", false)
	})
	if len(lines) != 1 {
		t.Fatalf("expected deduped status log, got %d lines: %v", len(lines), lines)
	}

	lines = captureActivityLogs(t, func() {
		logBookmarkStatus("https://example.com", result, "status-bar", true)
	})
	if len(lines) != 1 {
		t.Fatalf("expected forced status log, got %v", lines)
	}
}

func TestActivityLogPersistWritesFile(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "activity.log")
	resetActivityLogForTest(activityLogConfig{
		enabled:  map[string]bool{activityCategoryMutate: true},
		persist:  true,
		filePath: logPath,
	})

	logBookmarkAdd(Bookmark{PageID: 1, Name: "X", URL: "https://x.example"}, nil)

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read activity log: %v", err)
	}
	if !strings.Contains(string(data), `"event":"bookmark.add"`) {
		t.Fatalf("unexpected file contents: %s", string(data))
	}
}

func TestActivitySourceFromRequest(t *testing.T) {
	cases := []struct {
		name    string
		referer string
		agent   string
		want    string
	}{
		// The config view is part of the dashboard, and its /#config fragment
		// never reaches the server, so its activity reads as "dashboard".
		{name: "config view", referer: "http://localhost:8080/", want: "dashboard"},
		// /health redirects to /#health, so the referer arrives without the
		// path — health activity is dashboard activity.
		{name: "health view", referer: "http://localhost:8080/", want: "dashboard"},
		// A stale bookmark of the old page would still carry the path; it is
		// the dashboard either way now.
		{name: "legacy /health url", referer: "http://localhost:8080/health", want: "dashboard"},
		{name: "dashboard", referer: "http://localhost:8080/", want: "dashboard"},
		{name: "no referer", want: "api"},
		{name: "extension", agent: "Mozilla/5.0 chrome-extension", want: "extension"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/ping", nil)
			if tc.referer != "" {
				req.Header.Set("Referer", tc.referer)
			}
			if tc.agent != "" {
				req.Header.Set("User-Agent", tc.agent)
			}
			if got := activitySourceFromRequest(req); got != tc.want {
				t.Fatalf("source = %q, want %q", got, tc.want)
			}
		})
	}
}

// The trail keeps its JSON; the container log gets a sentence instead of it.
func TestActivityWritesSentenceNotJSONToTheLog(t *testing.T) {
	buf := captureLog(t)
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryMutate: true}})
	t.Cleanup(clearActivityLogTestOverride)
	setLogLevelForTest(t, logLevelInfoName)

	logActivity(activityCategoryMutate, "bookmark.add", map[string]any{"url": "https://example.com"},
		"added “Example” to page 1")

	out := buf.String()
	if strings.Contains(out, "{") {
		t.Fatalf("JSON reached the container log: %q", out)
	}
	if !strings.Contains(out, "INFO mutate added “Example” to page 1") {
		t.Fatalf("the sentence is missing: %q", out)
	}
}

// A denied write is worth seeing without switching a channel on, so security
// is the one category that logs above INFO.
func TestActivitySecurityLogsAsAWarning(t *testing.T) {
	buf := captureLog(t)
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategorySecurity: true}})
	t.Cleanup(clearActivityLogTestOverride)
	setLogLevelForTest(t, logLevelWarnName)

	logActivity(activityCategorySecurity, "auth.denied", nil, "refused a write from 10.0.0.2: no valid token")

	if !strings.Contains(buf.String(), "WARN security refused a write from 10.0.0.2") {
		t.Fatalf("the warning is missing: %q", buf.String())
	}
}

// A channel that is switched off writes nothing at all, as before.
func TestActivityRespectsItsChannels(t *testing.T) {
	buf := captureLog(t)
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{}})
	t.Cleanup(clearActivityLogTestOverride)

	logActivity(activityCategoryMutate, "bookmark.add", nil, "added something")

	if strings.TrimSpace(buf.String()) != "" {
		t.Fatalf("a disabled channel still wrote: %q", buf.String())
	}
}
