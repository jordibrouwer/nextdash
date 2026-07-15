package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// healthTestStore seeds a single-page store and returns handlers for it.
func healthTestStore(t *testing.T, pageJSON string) (*Handlers, *FileStore) {
	t.Helper()
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"allowLocalBookmarks":true}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	store := &FileStore{settingsFile: settingsPath, dataDir: dir}
	return &Handlers{store: store}, store
}

func healthReportVia(t *testing.T, h *Handlers) BookmarkHealthReport {
	t.Helper()
	rec := httptest.NewRecorder()
	h.GetBookmarkHealth(rec, httptest.NewRequest(http.MethodGet, "/api/bookmark-health", nil))
	return decodeHealthReport(t, rec)
}

// A ping that clears LastError must be visible immediately. Before invalidation was
// wired up, the report kept reporting broken for the full 3-minute TTL, so a repaired
// bookmark stayed red and the fix looked broken.
func TestUpdateStatusInvalidatesHealthReportCache(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[{"name":"A","url":"https://example.com","checkStatus":true,"lastError":"HTTP 500","lastChecked":1}]}`)

	before := healthReportVia(t, h)
	if before.Summary.BrokenCount != 1 {
		t.Fatalf("brokenCount = %d, want 1", before.Summary.BrokenCount)
	}

	rec := httptest.NewRecorder()
	h.UpdateBookmarkHealthStatus(rec, httptest.NewRequest(
		http.MethodPost,
		"/api/health/update-status",
		strings.NewReader(`{"pageId":1,"index":0,"status":"online"}`),
	))
	if rec.Code != http.StatusOK {
		t.Fatalf("update-status = %d, body = %s", rec.Code, rec.Body.String())
	}

	after := healthReportVia(t, h)
	if after.Summary.BrokenCount != 0 {
		t.Fatalf("brokenCount after online ping = %d, want 0 (stale report cache)", after.Summary.BrokenCount)
	}
}

func TestDeleteHealthBookmarkInvalidatesHealthReportCache(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[{"name":"A","url":"https://example.com"},{"name":"B","url":"https://example.org"}]}`)

	if got := healthReportVia(t, h).Summary.TotalBookmarks; got != 2 {
		t.Fatalf("totalBookmarks = %d, want 2", got)
	}

	rec := httptest.NewRecorder()
	h.DeleteHealthBookmark(rec, httptest.NewRequest(
		http.MethodPost,
		"/api/health/delete-bookmark",
		strings.NewReader(`{"pageId":1,"index":0}`),
	))
	if rec.Code != http.StatusOK {
		t.Fatalf("delete = %d, body = %s", rec.Code, rec.Body.String())
	}

	if got := healthReportVia(t, h).Summary.TotalBookmarks; got != 1 {
		t.Fatalf("totalBookmarks after delete = %d, want 1 (stale report cache)", got)
	}
}

// A bookmark with checkStatus off but a recorded error renders broken and scores -60.
// The default run skips it, so the health page could never clear it; scope=all must.
func TestRetestAllScopeAllIncludesFlaggedBookmarks(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[{"name":"Flagged","url":"` + target.URL + `","checkStatus":false,"lastError":"HTTP 500","lastChecked":1}]}`

	t.Run("default scope skips it", func(t *testing.T) {
		h, _ := healthTestStore(t, pageJSON)
		rec := httptest.NewRecorder()
		h.RetestAll(rec, httptest.NewRequest(http.MethodPost, "/api/health/retest-all", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("retest = %d, body = %s", rec.Code, rec.Body.String())
		}
		if got := healthReportVia(t, h).Summary.BrokenCount; got != 1 {
			t.Fatalf("brokenCount = %d, want 1 (default scope must not test it)", got)
		}
	})

	t.Run("scope=all tests and clears it", func(t *testing.T) {
		h, _ := healthTestStore(t, pageJSON)
		rec := httptest.NewRecorder()
		h.RetestAll(rec, httptest.NewRequest(http.MethodPost, "/api/health/retest-all?scope=all", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("retest = %d, body = %s", rec.Code, rec.Body.String())
		}
		if got := healthReportVia(t, h).Summary.BrokenCount; got != 0 {
			t.Fatalf("brokenCount after scope=all = %d, want 0", got)
		}
	})
}

// Applying a redirect used to clear LastError without contacting the new URL, so a
// dead replacement reported healthy.
func TestAutoHealApplyKeepsErrorWhenNewURLFails(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer dead.Close()

	h, store := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[{"name":"A","url":"https://example.com/old","lastError":"HTTP 404"}]}`)

	rec := httptest.NewRecorder()
	h.AutoHealApply(rec, httptest.NewRequest(
		http.MethodPost,
		"/api/health/auto-heal-apply",
		strings.NewReader(`{"pageId":1,"index":0,"newUrl":"`+dead.URL+`","refreshTitle":false}`),
	))
	if rec.Code != http.StatusOK {
		t.Fatalf("auto-heal-apply = %d, body = %s", rec.Code, rec.Body.String())
	}

	bookmarks := store.GetBookmarksByPage(1)
	if len(bookmarks) != 1 {
		t.Fatalf("bookmarks = %d, want 1", len(bookmarks))
	}
	if bookmarks[0].URL != dead.URL {
		t.Fatalf("URL = %q, want %q", bookmarks[0].URL, dead.URL)
	}
	if strings.TrimSpace(bookmarks[0].LastError) == "" {
		t.Fatal("LastError was cleared for a URL that returns HTTP 500; row would report healthy unverified")
	}
}

func TestAutoHealApplyClearsErrorWhenNewURLWorks(t *testing.T) {
	live := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer live.Close()

	h, store := healthTestStore(t, `{"id":1,"name":"A","bookmarks":[{"name":"A","url":"https://example.com/old","lastError":"HTTP 404"}]}`)

	rec := httptest.NewRecorder()
	h.AutoHealApply(rec, httptest.NewRequest(
		http.MethodPost,
		"/api/health/auto-heal-apply",
		strings.NewReader(`{"pageId":1,"index":0,"newUrl":"`+live.URL+`","refreshTitle":false}`),
	))
	if rec.Code != http.StatusOK {
		t.Fatalf("auto-heal-apply = %d, body = %s", rec.Code, rec.Body.String())
	}

	bookmarks := store.GetBookmarksByPage(1)
	if got := strings.TrimSpace(bookmarks[0].LastError); got != "" {
		t.Fatalf("LastError = %q, want cleared for a reachable URL", got)
	}
}

// The row explains its score by listing each reason's penalty. If the penalties
// stopped summing to 100 - score, the breakdown shown to the user would be a
// plausible-looking lie.
func TestHealthReasonPenaltiesSumToScore(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Broken+dupe","url":"https://example.com/x","checkStatus":true,"lastError":"HTTP 500","lastChecked":1,"shortcut":"A"},
		{"name":"Dupe twin","url":"https://example.com/x","checkStatus":false,"shortcut":"A"},
		{"name":"Clean-ish","url":"https://example.org/ok","openCount":3,"lastOpened":1}
	]}`)

	report := healthReportVia(t, h)
	if len(report.Issues) == 0 {
		t.Fatal("no issues in report")
	}
	for _, issue := range report.Issues {
		total := 0
		for _, reason := range issue.ReasonDetails {
			if reason.Penalty < 0 {
				t.Fatalf("%s: reason %q has negative penalty %d", issue.Name, reason.Code, reason.Penalty)
			}
			total += reason.Penalty
		}
		want := 100 - total
		if want < 0 {
			want = 0
		}
		if issue.Score != want {
			t.Fatalf("%s: score = %d, but penalties sum to %d (want score %d)", issue.Name, issue.Score, total, want)
		}
	}
}
