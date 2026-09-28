package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The server's "stale" is the reader's own "count as neglected after" setting,
// so Statistics, the cleanup score and the Health view agree on one number.
func TestStaleFollowsBookmarkStaleDays(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"bookmarkStaleDays":7}`)
	tenDays := time.Now().Add(-10 * 24 * time.Hour).UnixMilli()
	threeDays := time.Now().Add(-3 * 24 * time.Hour).UnixMilli()
	page := `{"id":1,"name":"P","bookmarks":[
		{"name":"Ten","url":"https://ten.example","openCount":2,"lastOpened":` + itoa(tenDays) + `},
		{"name":"Three","url":"https://three.example","openCount":2,"lastOpened":` + itoa(threeDays) + `}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	report := h.buildBookmarkHealthReport()
	ten := findIssue(t, report, "Ten")
	if !hasFlag(ten, "stale") {
		t.Errorf("10 days unopened with a 7-day setting must be stale")
	}
	if hasFlag(findIssue(t, report, "Three"), "stale") {
		t.Errorf("3 days unopened must not be stale")
	}
	if report.Summary.StaleCount != 1 {
		t.Errorf("StaleCount = %d, want 1", report.Summary.StaleCount)
	}
	found := false
	for _, r := range ten.ReasonDetails {
		if r.Code == "not_opened_30_days" && r.Params["days"] == "7" {
			found = true
		}
	}
	if !found {
		t.Errorf("stale reason should carry days=7: %#v", ten.ReasonDetails)
	}
}

func TestStaleThresholdDefaultsAndClamps(t *testing.T) {
	cases := map[int]time.Duration{0: 90, 3: 7, 30: 30, 400: 365}
	for in, wantDays := range cases {
		got := staleOpenThreshold(Settings{BookmarkStaleDays: in})
		if got != wantDays*24*time.Hour {
			t.Errorf("staleOpenThreshold(%d) = %v, want %d days", in, got, wantDays)
		}
	}
}

// Changing the setting must not leave a cached report counting against the old
// threshold for its remaining minutes. Saving settings bumps the store's data
// generation, which is what retires the cached report.
func TestSavingStaleDaysDropsCachedReport(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"bookmarkStaleDays":90}`)
	tenDays := time.Now().Add(-10 * 24 * time.Hour).UnixMilli()
	page := `{"id":1,"name":"P","bookmarks":[
		{"name":"Ten","url":"https://ten.example","openCount":2,"lastOpened":` + itoa(tenDays) + `}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	if n := h.loadBookmarkHealthReport(false).Summary.StaleCount; n != 0 {
		t.Fatalf("StaleCount at 90 days = %d, want 0", n)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"bookmarkStaleDays":7}`))
	rec := httptest.NewRecorder()
	h.SaveSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("save settings: %d %s", rec.Code, rec.Body.String())
	}
	if n := h.loadBookmarkHealthReport(false).Summary.StaleCount; n != 1 {
		t.Errorf("StaleCount after saving 7 days = %d, want 1", n)
	}
}
