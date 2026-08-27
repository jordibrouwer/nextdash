package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func decodeHealthReport(t *testing.T, rec *httptest.ResponseRecorder) BookmarkHealthReport {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var report BookmarkHealthReport
	if err := json.Unmarshal(rec.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode report: %v", err)
	}
	return report
}

func TestGetBookmarkHealthUsesCacheUntilRefresh(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	pagePath := filepath.Join(dir, "bookmarks-1.json")
	if err := os.WriteFile(pagePath, []byte(`{"id":1,"name":"Page 1","bookmarks":[{"name":"A","url":"https://example.com"}]}`), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	h := &Handlers{store: &FileStore{settingsFile: settingsPath, dataDir: dir}}

	first := httptest.NewRecorder()
	h.GetBookmarkHealth(first, httptest.NewRequest(http.MethodGet, "/api/bookmark-health", nil))
	report1 := decodeHealthReport(t, first)

	second := httptest.NewRecorder()
	h.GetBookmarkHealth(second, httptest.NewRequest(http.MethodGet, "/api/bookmark-health", nil))
	report2 := decodeHealthReport(t, second)
	if report2.GeneratedAt != report1.GeneratedAt {
		t.Fatalf("cached GeneratedAt = %d, want %d", report2.GeneratedAt, report1.GeneratedAt)
	}

	third := httptest.NewRecorder()
	h.GetBookmarkHealth(third, httptest.NewRequest(http.MethodGet, "/api/bookmark-health?refresh=1", nil))
	report3 := decodeHealthReport(t, third)
	if report3.GeneratedAt < report1.GeneratedAt {
		t.Fatalf("refresh GeneratedAt = %d, want >= %d", report3.GeneratedAt, report1.GeneratedAt)
	}
}

func TestGetBookmarkHealthCacheExpires(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}

	h := &Handlers{store: &FileStore{settingsFile: settingsPath, dataDir: dir, readCache: newStoreReadCache()}}

	first := httptest.NewRecorder()
	h.GetBookmarkHealth(first, httptest.NewRequest(http.MethodGet, "/api/bookmark-health", nil))
	report1 := decodeHealthReport(t, first)
	if report1.Summary.TotalBookmarks != 0 {
		t.Fatalf("initial total = %d, want 0", report1.Summary.TotalBookmarks)
	}

	/*
		Written past the store, deliberately.

		A write that goes through the store is seen at once now -- the store
		counts its writes and the report is stamped with that count, which is
		what stopped a bookmark added from being invisible for three minutes.
		The clock still has a job, and this is it: a file changed underneath
		the process, by an import, a restore, or a hand on the data directory.
		Nothing bumped the count, so only the age of the report can catch it.
	*/
	page := PageWithBookmarks{
		Page:      Page{ID: 1, Name: "Page 1"},
		Bookmarks: []Bookmark{{Name: "A", URL: "https://example.com", PageID: 1}},
	}
	encoded, err := json.Marshal(page)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), encoded, 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	// What an import does after replacing files: tell the store its own read
	// caches are stale. That does not count as a write, so the health report
	// is left holding what it built -- which is the case the clock is for.
	h.store.InvalidateReadCache()

	cached := httptest.NewRecorder()
	h.GetBookmarkHealth(cached, httptest.NewRequest(http.MethodGet, "/api/bookmark-health", nil))
	reportCached := decodeHealthReport(t, cached)
	if reportCached.Summary.TotalBookmarks != 0 {
		t.Fatalf("cached total = %d, want still 0 before expiry", reportCached.Summary.TotalBookmarks)
	}

	h.healthReportMu.Lock()
	h.healthReportAt = time.Now().Add(-healthReportCacheTTL - time.Second)
	h.healthReportMu.Unlock()

	second := httptest.NewRecorder()
	h.GetBookmarkHealth(second, httptest.NewRequest(http.MethodGet, "/api/bookmark-health", nil))
	report2 := decodeHealthReport(t, second)
	if report2.Summary.TotalBookmarks != 1 {
		t.Fatalf("expired cache total = %d, want 1", report2.Summary.TotalBookmarks)
	}
}

func TestLoadBookmarkHealthReportSingleflight(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	pagePath := filepath.Join(dir, "bookmarks-1.json")
	if err := os.WriteFile(pagePath, []byte(`{"id":1,"name":"Page 1","bookmarks":[{"name":"A","url":"https://example.com"}]}`), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	h := &Handlers{store: &FileStore{settingsFile: settingsPath, dataDir: dir}}
	h.healthReportBuildCond = sync.NewCond(&h.healthReportBuildMu)

	const workers = 8
	var wg sync.WaitGroup
	reports := make([]BookmarkHealthReport, workers)
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		i := i
		go func() {
			defer wg.Done()
			reports[i] = h.loadBookmarkHealthReport(false)
		}()
	}
	wg.Wait()

	first := reports[0].GeneratedAt
	for i := 1; i < workers; i++ {
		if reports[i].GeneratedAt != first {
			t.Fatalf("worker %d GeneratedAt = %d, want %d", i, reports[i].GeneratedAt, first)
		}
	}
}
