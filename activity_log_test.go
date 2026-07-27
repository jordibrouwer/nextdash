package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func captureActivityLogs(t *testing.T, fn func()) []string {
	t.Helper()
	t.Cleanup(clearActivityLogTestOverride)
	var buf bytes.Buffer
	original := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() {
		log.SetOutput(original)
	})
	fn()
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	var activity []string
	for _, line := range lines {
		if idx := strings.Index(line, "activity: "); idx >= 0 {
			activity = append(activity, strings.TrimSpace(line[idx+len("activity: "):]))
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
		{name: "health page", referer: "http://localhost:8080/health", want: "health"},
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
